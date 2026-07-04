#!/usr/bin/env node
/* =====================================================================
   orchestrate.mjs — H4: the autonomous driver of the subagent-contract
   spine (waves -> per-change isolated worktree + contract -> verdict ->
   summary). The piece that was missing in Phase G: the contract,
   verdict, replay, gate and waves all existed per-task, but NOTHING
   chained them. This routes them into one run.
   ---------------------------------------------------------------------
   For a plan it:
     1. routes to waves.mjs --json for the dispatchable set (wave 0 =
        unbuilt changes whose deps are all built);
     2. for each dispatchable change, provisions an ISOLATED git worktree
        (the non-colliding workspace a parallel subagent would build in)
        and drops that change's flowmap:contract packet into it as
        CONTRACT.json — then tears the worktree down (--keep-worktrees to
        inspect);
     3. routes to flowmap:verify-change (--strict aware) for each change's
        data-only verdict;
     4. emits a canonical, content-hashed summary.

   WHY the verdict is computed in the MAIN repo, not inside the worktree:
   the worktree is a detached HEAD checkout that shares .git but NOT the
   gitignored node_modules (ts-morph), so the gate cannot run there. v1
   therefore provisions the isolated workspace + its contract (proving the
   per-change isolation mechanism) and routes the verdict via the main
   repo's tooling. Wiring an actual build agent INTO each worktree (then
   re-verifying from within) is the next increment; the schedule, the
   isolation and the routed verdict exist here.

   DETERMINISM (enforced by flowmap:replay): stdout is ONLY the canonical
   summary — no timestamps, no Math.random, no absolute paths. All worktree
   provisioning noise goes to STDERR, so a worktree that fails to create
   never perturbs the hashed verdict bytes.

   Usage:
     node orchestrate.mjs [--plan public/plan.json] [--map docs/flowmap/_bundle.mmd]
            [--tsconfig tsconfig.json] [--strict] [--no-worktree] [--keep-worktrees] [--json]
   Exit: 0 = no FAIL (and, under --strict, no PASS_UNPROVEN); 1 = a change
         is unbuilt/failing (EXPECTED for a not-yet-built plan — replay
         still proves determinism via identical stdout+exit); 2 = bad args.
   ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { canonicalJSON, hashOf } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function arg(flag, fb = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fb;
}

const PLAN = arg('--plan', join(ROOT, 'public', 'plan.json'));
const MAP = arg('--map', join(ROOT, 'docs', 'flowmap', '_bundle.mmd'));
const TSCONFIG = arg('--tsconfig', join(ROOT, 'tsconfig.json'));
const STRICT = process.argv.includes('--strict');
const NO_WORKTREE = process.argv.includes('--no-worktree');
const KEEP_WT = process.argv.includes('--keep-worktrees');
const JSON_OUT = process.argv.includes('--json');

// Worktree base lives OUTSIDE the repo (git refuses a worktree inside the main
// tree). Deterministic per change id (no pid/timestamp) so a crashed run's
// leftovers are reused/cleaned, not accumulated. Never written to stdout.
const WT_BASE = join(tmpdir(), 'flowmap-orchestrate-wt');

/** Run a node tool from ROOT, capture stdout. Never throws. */
function routeTool(relPath, extraArgs) {
  const r = spawnSync('node', [join('tools', 'flowmap', 'contract', relPath), ...extraArgs],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Run git from ROOT, capture everything, never throw. */
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function elog(msg) { process.stderr.write(msg + '\n'); }

/** Provision an isolated worktree at HEAD and drop the change's contract in it.
 *  Returns true on success. All output is stderr; never affects stdout bytes. */
function provisionWorktree(id, contractText) {
  const wt = join(WT_BASE, id);
  // pre-clean any leftover from a prior/crashed run
  git(['worktree', 'remove', '--force', wt]);
  try { if (existsSync(wt)) rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  git(['worktree', 'prune']);
  mkdirSync(WT_BASE, { recursive: true });
  const add = git(['worktree', 'add', '--detach', wt, 'HEAD']);
  if (add.status !== 0) { elog(`  worktree[${id}]: provisioning skipped (${(add.stderr || '').trim().split('\n')[0]})`); return false; }
  try { writeFileSync(join(wt, 'CONTRACT.json'), contractText); } catch { /* best effort */ }
  elog(`  worktree[${id}]: provisioned at ${wt} with CONTRACT.json (isolated workspace for a build agent)`);
  return true;
}

function removeWorktree(id) {
  if (KEEP_WT) { elog(`  worktree[${id}]: kept (--keep-worktrees)`); return; }
  const wt = join(WT_BASE, id);
  git(['worktree', 'remove', '--force', wt]);
  try { if (existsSync(wt)) rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  git(['worktree', 'prune']);
}

/* ---------- load plan ---------- */
let plan;
try { plan = JSON.parse(readFileSync(PLAN, 'utf8')); }
catch (e) { console.error('cannot read plan: ' + e.message); process.exit(2); }

/* ---------- 1. route to waves.mjs for the dispatchable set ---------- */
const wavesRes = routeTool('waves.mjs', ['--plan', PLAN, '--map', MAP, '--tsconfig', TSCONFIG, '--json']);
if (!wavesRes.stdout) { console.error('waves.mjs produced no output: ' + wavesRes.stderr.slice(0, 400)); process.exit(2); }
let wavesReport;
try { wavesReport = JSON.parse(wavesRes.stdout); }
catch { console.error('waves.mjs produced unparseable output'); process.exit(2); }

const dispatched = (wavesReport.waves && wavesReport.waves[0]) ? wavesReport.waves[0].slice() : [];
elog(`orchestrate: plan ${wavesReport.planBase ?? '(none)'} — ${wavesReport.totalChanges} change(s), ` +
  `${wavesReport.done?.length ?? 0} built, dispatching wave 0 (${dispatched.length}): ${dispatched.join(', ') || '(none)'}`);

/* ---------- 2+3. per change: isolate -> contract -> verdict ---------- */
const verdicts = {};
for (const id of dispatched) {
  // contract packet (also the payload dropped into the worktree)
  const cr = routeTool('contract.mjs', ['--change', id, '--plan', PLAN, '--map', MAP, '--json']);
  let contract = null;
  try { contract = JSON.parse(cr.stdout); } catch { /* leave null */ }
  const contractText = cr.stdout && contract ? canonicalJSON(contract) : '{}';

  // provision the isolated workspace (the boundary a parallel subagent builds in)
  let worktreeOk = false;
  if (!NO_WORKTREE) {
    worktreeOk = provisionWorktree(id, contractText);
  }

  // verdict — data-only, --strict aware. Routed via the main repo's tooling.
  const vArgs = ['--change', id, '--plan', PLAN, '--map', MAP, '--tsconfig', TSCONFIG, '--json'];
  if (STRICT) vArgs.push('--strict');
  const vr = routeTool('verify-change.mjs', vArgs);
  let verdict = null;
  try { verdict = JSON.parse(vr.stdout); } catch { /* leave null */ }

  if (!NO_WORKTREE) removeWorktree(id);

  verdicts[id] = {
    verdict: verdict?.verdict ?? 'FAIL',
    verdictHash: verdict?.verdictHash ?? null,
    contractHash: contract?.contractHash ?? null,
    coherent: contract?.coherent ?? null,
  };
}

/* ---------- 4. summary + canonical output ---------- */
let pass = 0, passUnproven = 0, fail = 0;
for (const id of dispatched) {
  const v = verdicts[id].verdict;
  if (v === 'PASS') pass++;
  else if (v === 'PASS_UNPROVEN') passUnproven++;
  else fail++;
}

const body = {
  orchestrateVersion: 1,
  planBase: wavesReport.planBase ?? null,
  totalChanges: wavesReport.totalChanges ?? 0,
  wavesTotal: Array.isArray(wavesReport.waves) ? wavesReport.waves.length : 0,
  strict: STRICT,
  dispatched,
  verdicts,
  summary: { total: dispatched.length, pass, passUnproven, fail },
};
const out = { ...body, orchestrateHash: hashOf(body) };

const failed = fail > 0 || (STRICT && passUnproven > 0);

if (JSON_OUT) {
  process.stdout.write(canonicalJSON(out) + '\n');
  process.exit(failed ? 1 : 0);
}

/* ---------- human summary ---------- */
console.log(`=== orchestrate — wave 0 of ${out.planBase ?? '(plan)'} (${dispatched.length} dispatched${STRICT ? ', strict' : ''}) ===`);
for (const id of dispatched) {
  const v = verdicts[id];
  const mark = v.verdict === 'PASS' ? '✓' : v.verdict === 'PASS_UNPROVEN' ? '◐' : '✗';
  console.log(`  ${mark} ${id} — ${v.verdict}${v.coherent === false ? ' (contract INCOHERENT)' : ''}`);
}
console.log(`  summary: ${pass} pass · ${passUnproven} pass-unproven · ${fail} fail / ${dispatched.length}`);
console.log(`  orchestrateHash: ${out.orchestrateHash}`);
if (failed) console.log('  (non-zero exit: unbuilt/failing changes remain — expected until the wave is built; replay still proves determinism)');
process.exit(failed ? 1 : 0);
