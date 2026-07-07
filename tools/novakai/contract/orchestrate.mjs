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
        (the non-colliding workspace a parallel subagent would build in),
        symlinks in node_modules, and drops that change's novakai:contract
        packet — the SLICED packet (sub-map + sliced bodies, slice-
        completeness gated) — into it as CONTRACT.json — then tears the
        worktree down (--keep-worktrees to inspect);
     3. routes to novakai:verify-change (--strict aware), run INSIDE the
        worktree, for each change's data-only verdict;
     4. emits a canonical, content-hashed summary.

   WHY the verdict is computed INSIDE the worktree, not the main repo:
   the worktree is a detached HEAD checkout that shares .git but not the
   gitignored node_modules — but node_modules is gitignored, ~119M, and
   has no pre/postinstall or native build step, so a plain directory
   SYMLINK (`node_modules` -> the main repo's) makes it a fully working
   tree: ts-morph and every other dep resolve exactly as in main. Each
   verdict tool derives its own ROOT from `import.meta.url`, so running
   the worktree's OWN copy of verify-change.mjs with cwd set to the
   worktree pins that verdict to the worktree's tree state — a build
   agent's edits inside the worktree are what get verified, not main's.
   --plan/--map/--tsconfig are remapped to their worktree counterparts too
   (ts-morph resolves tsconfig's "include" relative to the tsconfig file's
   OWN directory, so a main-rooted --tsconfig would silently type-check
   main's src regardless of cwd). Proven byte-identical to a main-repo run
   for an unchanged change (and divergent for a worktree-local edit) before
   this mechanism was wired in; see
   docs/novakai/plans/contract-slice.build.md's PROBE RESULT. Spawning an
   actual build agent INTO the worktree (an Agent-tool step this plain
   node script cannot itself take) is the next increment — the
   isolation, the contract and the in-worktree verdict exist here.

   DETERMINISM (enforced by novakai:replay): stdout is ONLY the canonical
   summary — no timestamps, no Math.random, no absolute paths. All worktree
   provisioning noise goes to STDERR, so a worktree that fails to create
   never perturbs the hashed verdict bytes.

   Usage:
     node orchestrate.mjs [--plan public/plan.json] [--map docs/novakai/_bundle.mmd]
            [--tsconfig tsconfig.json] [--strict] [--no-worktree] [--keep-worktrees] [--json]
   Exit: 0 = no FAIL (and, under --strict, no PASS_UNPROVEN); 1 = a change
         is unbuilt/failing (EXPECTED for a not-yet-built plan — replay
         still proves determinism via identical stdout+exit); 2 = bad args.
   ===================================================================== */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, symlinkSync, realpathSync } from 'node:fs';
import { join, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { canonicalJSON, hashOf, sha256hex } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function arg(flag, fb = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fb;
}

const PLAN = arg('--plan', join(ROOT, 'public', 'plan.json'));
const MAP = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
const TSCONFIG = arg('--tsconfig', join(ROOT, 'tsconfig.json'));
const STRICT = process.argv.includes('--strict');
const NO_WORKTREE = process.argv.includes('--no-worktree');
const KEEP_WT = process.argv.includes('--keep-worktrees');
const JSON_OUT = process.argv.includes('--json');

// Worktree base lives OUTSIDE the repo (git refuses a worktree inside the main
// tree). Deterministic per (repo instance, change id) — no pid/timestamp — so
// a crashed run's leftovers are reused/cleaned, not accumulated. Never written
// to stdout. Namespaced by a hash of ROOT: this repo is routinely checked out
// as SEVERAL git worktrees sharing one .git (main + per-task agent worktrees),
// and os.tmpdir() is one machine-global directory — an un-namespaced WT_BASE
// gives every one of those worktrees the SAME path for change id "x". Two
// orchestrate runs from different worktrees then race the same directory's
// `git worktree remove`/`add` cycle, and the loser's checkout is torn down
// mid-flight — verify-change.mjs hits ERR_MODULE_NOT_FOUND for some arbitrary
// file and crashes, so orchestrate's JSON differs run to run (caught replaying
// this exact command: a stale-looking file went missing only under
// concurrent worktree traffic, never in isolation). Hashing ROOT keeps the
// path stable for repeat runs from the SAME worktree (the reuse/cleanup
// property above) while giving every worktree its own sandbox.
// realpathSync(tmpdir()): on macOS, os.tmpdir() returns a path through /var,
// which is itself a symlink to /private/var — but a spawned child's OWN
// process.cwd() is always OS-canonicalized (/private/var/...). If WT_BASE
// stayed un-realpath'd, the --tsconfig/--map path STRING we pass (/var/...)
// and the cwd the child actually reports (/private/var/...) would disagree,
// ts-morph's Project would key source files by one prefix while extract.mjs's
// `%% src`-directive resolution (CWD-relative) looks them up under the
// other, silently finding NOTHING — every in-worktree change would verdict
// FAIL/"drifted" no matter how correct the code is. Canonicalizing once here
// keeps every path built from WT_BASE consistent with the child's real cwd.
const WT_BASE = join(realpathSync(tmpdir()), `novakai-orchestrate-wt-${sha256hex(ROOT).slice(0, 12)}`);

/** Run a node tool, capture stdout. Runs the TOOL'S OWN COPY relative to
 *  `cwd` (default: main ROOT) — pointed at a worktree, this spawns the
 *  worktree's own script, whose ROOT (derived from import.meta.url) then
 *  resolves to the worktree, so it verifies against that tree's state,
 *  not main's. Never throws. */
function routeTool(relPath, extraArgs, cwd = ROOT) {
  const r = spawnSync('node', [join('tools', 'novakai', 'contract', relPath), ...extraArgs],
    { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout || '', stderr: r.stderr || '' };
}

/** Absolute path of the (potential) worktree for a change id — shared by
 *  provision/remove/route so there is exactly one definition of "where". */
function wtPath(id) { return join(WT_BASE, id); }

/** Remap a --plan/--map/--tsconfig path so a verdict tool routed into the
 *  worktree reads the WORKTREE's copy, not main's: ts-morph resolves
 *  tsconfig's "include" relative to the tsconfig file's own directory, so
 *  a main-rooted --tsconfig would silently type-check main's src no matter
 *  what cwd the tool runs from. Paths outside ROOT (external fixtures)
 *  pass through unchanged. */
function toWorktreePath(p, wt) {
  const rel = relative(ROOT, p);
  if (rel.startsWith('..') || isAbsolute(rel)) return p;
  return join(wt, rel);
}

/** Run git from ROOT, capture everything, never throw. */
function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function elog(msg) { process.stderr.write(msg + '\n'); }

/** Provision an isolated worktree at HEAD, symlink in node_modules (gitignored,
 *  so a fresh worktree checkout never gets its own — see the header WHY), and
 *  drop the change's sliced contract packet in it as CONTRACT.json.
 *  Returns { ok, verifiable }: ok = the worktree exists; verifiable = its
 *  node_modules resolves too, so a verdict tool can actually run inside it
 *  (ts-morph et al). All output is stderr; never affects stdout bytes. */
function provisionWorktree(id, contractText) {
  const wt = wtPath(id);
  // pre-clean any leftover from a prior/crashed run
  git(['worktree', 'remove', '--force', wt]);
  try { if (existsSync(wt)) rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  git(['worktree', 'prune']);
  mkdirSync(WT_BASE, { recursive: true });
  const add = git(['worktree', 'add', '--detach', wt, 'HEAD']);
  if (add.status !== 0) { elog(`  worktree[${id}]: provisioning skipped (${(add.stderr || '').trim().split('\n')[0]})`); return { ok: false, verifiable: false }; }
  const nodeModules = join(wt, 'node_modules');
  if (!existsSync(nodeModules)) {
    try { symlinkSync(join(ROOT, 'node_modules'), nodeModules, 'dir'); }
    catch (e) { elog(`  worktree[${id}]: node_modules symlink failed (${e.message}) — verdict will route to main instead`); }
  }
  try { writeFileSync(join(wt, 'CONTRACT.json'), contractText); } catch { /* best effort */ }
  const verifiable = existsSync(nodeModules);
  elog(`  worktree[${id}]: provisioned at ${wt} with CONTRACT.json (sliced packet) + node_modules ${verifiable ? 'symlinked' : 'MISSING'}`);
  return { ok: true, verifiable };
}

function removeWorktree(id) {
  if (KEEP_WT) { elog(`  worktree[${id}]: kept (--keep-worktrees)`); return; }
  const wt = wtPath(id);
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
  let worktree = { ok: false, verifiable: false };
  if (!NO_WORKTREE) {
    worktree = provisionWorktree(id, contractText);
  }

  // verdict — data-only, --strict aware. Routed to the WORKTREE's own copy of
  // verify-change.mjs (cwd:<wt>) when it's verifiable, so the verdict reflects
  // that tree's state (a build agent's edits), not main's; falls back to main
  // for --no-worktree runs or a worktree whose node_modules symlink failed.
  // plan/map/tsconfig are remapped into the worktree too — otherwise a
  // main-rooted --tsconfig would point ts-morph straight back at main's src.
  const wt = wtPath(id);
  const vPlan = worktree.verifiable ? toWorktreePath(PLAN, wt) : PLAN;
  const vMap = worktree.verifiable ? toWorktreePath(MAP, wt) : MAP;
  const vTsconfig = worktree.verifiable ? toWorktreePath(TSCONFIG, wt) : TSCONFIG;
  const vArgs = ['--change', id, '--plan', vPlan, '--map', vMap, '--tsconfig', vTsconfig, '--json'];
  if (STRICT) vArgs.push('--strict');
  const vr = routeTool('verify-change.mjs', vArgs, worktree.verifiable ? wt : ROOT);
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
