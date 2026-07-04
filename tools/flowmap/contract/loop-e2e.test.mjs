/* =====================================================================
   loop-e2e.test.mjs — F5: run the WHOLE loop as one sequence on the REAL
   in-flight plan (public/plan.json), not as isolated unit tests.

     understand → plan-check (coherence) → cert (apply→stubs→tsc→gate)
       → approve-export (approved.mmd + stubs + checklist) → status
       (built/pending vs the live gate) → writeback (--dry) → edges (--strict)

   Each link is exercised by its real CLI, chained, and asserted green. This
   is the first execution of the loop end-to-end — the spine the roadmap
   names, proven to actually run through, not just pass component-wise.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync,
  appendFileSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PLAN = 'public/plan.json';

// M2b: FLOWMAP_ROOT is the emitter seam only — verdict events from the chain's
// plan-cert stage land in a scratch sink, never in the repo's real metrics log.
const METRICS_SINK = mkdtempSync(join(tmpdir(), 'loop-e2e-metrics-'));
process.on('exit', () => rmSync(METRICS_SINK, { recursive: true, force: true }));

const node = (args) => spawnSync('node', args, {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, FLOWMAP_ROOT: METRICS_SINK },
});

/* =====================================================================
   M9 — the FAIL->PASS end-to-end loop (docs/flowmap/plans/m9-design.md).
   ---------------------------------------------------------------------
   F5 above proves the loop RUNS on the real in-flight plan; it never
   proves the loop's reason to exist — a change going from provably-NOT-
   built to provably-BUILT through the full spine (understand -> plan ->
   review -> approve -> implement -> verify), with a real code-driven
   red->green flip no mock can fake. public/plan.json can't drive that
   flip (its one acceptance-bearing change is already built), so M9 uses
   a disposable fixture (docs/flowmap/plans/m9-loop.plan.json, one `add`
   change `m9-probe`) built and torn down inside a THROWAWAY git worktree
   — the real repo never gains the probe symbol.

   Sandbox mechanism: `git worktree add --detach <tmp> HEAD` + a symlinked
   `node_modules` (worktrees don't get their own — see orchestrate.mjs's
   header). Steps 4-17 run the WORKTREE's own copies of the tools with
   cwd = the worktree — load-bearing, not cosmetic: every verdict tool
   derives its ROOT from `import.meta.url` (pins ROOT to the worktree when
   its own copy runs), but quiz's PASS_FILE and status/extract's symbol
   resolution are CWD-relative, so cwd must be the worktree too.

   Namespacing note: state.flowmap.mmd is a non-global fragment (`%% root
   state`), so flowmap-bundle.mjs prefixes the probe's fragment-local id
   `m9Probe` to `state__m9Probe` at merge time (exactly how every sibling
   in that fragment — createState, frameTransform, etc. — already works,
   and how every real fixture in docs/flowmap/plans/*.plan.json names its
   target.ref, e.g. `unfold__ufVerbAllowed`). The committed fixture's
   target.ref is therefore the POST-bundle id `state__m9Probe`; the
   in-test implement step feeds scaffold a bare-ref SHIM copy (scaffold
   itself is namespace-unaware and writes target.ref verbatim as the
   fragment-local id) so the fragment keeps the bare-id convention its
   siblings use, then the real resync step is what produces the
   `state__m9Probe` id the tracked plan expects. ===================== */

const M9_PLAN = 'docs/flowmap/plans/m9-loop.plan.json';
const M9_CHANGE = 'm9-probe';
const M9_REF = 'state__m9Probe'; // post-bundle id (matches the fixture's target.ref)
const M9_LOCAL = 'm9Probe';      // bare fragment-local id + real TS export name
// Forward-slash literals: these strings are both CLI args (--fragment) AND
// verbatim text inside the .mmd `%% src` directive, which is always POSIX-style.
const M9_FRAGMENT_REL = 'src/core/state/state.flowmap.mmd';
const M9_TS_REL = 'src/core/state/state.ts';

/** Run a node tool from an explicit cwd (the M9 sandbox needs its OWN tool
 *  copies + its own cwd-relative state — see the header note above). */
function nodeAt(cwd, args) {
  return spawnSync('node', args, {
    cwd, encoding: 'utf8', env: { ...process.env, FLOWMAP_ROOT: METRICS_SINK },
  });
}

/** Provision a throwaway sandbox at HEAD: a detached worktree + a symlinked
 *  node_modules (worktrees don't get their own — orchestrate.mjs's own
 *  documented mechanism, promoted here from "provision only" to "the build
 *  happens here" — M9 step 0). */
function makeSandbox() {
  const wt = mkdtempSync(join(tmpdir(), 'm9-sandbox-'));
  rmSync(wt, { recursive: true, force: true }); // git worktree add creates the dir itself
  const add = spawnSync('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(add.status, 0, 'git worktree add failed:\n' + add.stdout + add.stderr);
  symlinkSync(join(ROOT, 'node_modules'), join(wt, 'node_modules'), 'dir');
  return wt;
}

function destroySandbox(wt) {
  spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, encoding: 'utf8' });
  try { rmSync(wt, { recursive: true, force: true }); } catch { /* best effort */ }
  spawnSync('git', ['worktree', 'prune'], { cwd: ROOT, encoding: 'utf8' });
}

test('M9: the loop flips a real change from FAIL to PASS inside an isolated sandbox worktree', () => {
  const work = mkdtempSync(join(tmpdir(), 'm9-work-'));
  const wt = makeSandbox();
  try {
    // ---- step 0 — sandbox isolation mechanism proven (orchestrate.mjs's H4 gap) ----
    const validate0 = nodeAt(wt, ['tools/flowmap/verify/validate.mjs', 'docs/flowmap/_bundle.mmd']);
    assert.equal(validate0.status, 0, 'sandbox map does not validate:\n' + validate0.stdout + validate0.stderr);

    // ---- step 2 — RED: quiz.mjs verify fail-closed with no pass artifact ----
    // A fresh worktree checkout carries no gitignored .flowmap-quiz-pass.json.
    const quizVerify = nodeAt(wt, ['tools/flowmap/onboard/quiz.mjs', 'verify']);
    assert.notEqual(quizVerify.status, 0, 'quiz.mjs verify must fail-closed with no pass artifact (Keystone 1)');

    // ---- step 4 — plan-check: the fixture is coherent ----
    const check = nodeAt(wt, ['tools/flowmap/plan/plan-check.mjs', '--plan', M9_PLAN]);
    assert.equal(check.status, 0, 'plan-check failed:\n' + check.stdout + check.stderr);
    assert.match(check.stdout, /coherent/);

    // ---- step 5 — plan-cert: the fixture's proposed contract is enforceable ----
    const cert = nodeAt(wt, ['tools/flowmap/plan/plan-cert.mjs', '--plan', M9_PLAN]);
    assert.equal(cert.status, 0, 'plan-cert failed:\n' + cert.stdout + cert.stderr);
    assert.match(cert.stdout, /CERTIFIED/);

    // ---- step 6 — RED: approve-export refuses --accepted-only on a verdict-less plan ----
    const noVerdictsPlan = JSON.parse(readFileSync(join(wt, M9_PLAN), 'utf8'));
    delete noVerdictsPlan.verdicts;
    const noVerdictsPath = join(work, 'm9-no-verdicts.plan.json');
    writeFileSync(noVerdictsPath, JSON.stringify(noVerdictsPlan));
    const redExportDir = join(work, 'm9-red-export');
    const redExport = nodeAt(wt, ['tools/flowmap/plan/approve-export.mjs', '--plan', noVerdictsPath, '--out', redExportDir, '--accepted-only']);
    assert.equal(redExport.status, 2, 'approve-export must refuse --accepted-only on a verdict-less plan (exit 2)');
    assert.ok(!existsSync(redExportDir), 'no artifact may come out of the refused export');

    // ---- step 8 — approve-export, real, on the verdict path (F5 only ran verdict-less) ----
    const exportDir = join(work, 'm9-export');
    const exp = nodeAt(wt, ['tools/flowmap/plan/approve-export.mjs', '--plan', M9_PLAN, '--out', exportDir, '--accepted-only']);
    assert.equal(exp.status, 0, 'approve-export failed:\n' + exp.stdout + exp.stderr);
    assert.ok(existsSync(join(exportDir, 'approved.mmd')), 'approved.mmd missing');
    assert.ok(existsSync(join(exportDir, 'plan.json')), 'exported plan.json missing');
    assert.ok(existsSync(join(exportDir, 'CHECKLIST.md')), 'CHECKLIST.md missing');
    assert.ok(existsSync(join(exportDir, 'contracts')), 'generated contracts/ missing');
    const exportPlanPath = join(exportDir, 'plan.json');

    // ---- step 9 — status: the honest RED baseline (not built yet) ----
    const status0 = nodeAt(wt, ['tools/flowmap/status/status.mjs', '--plan', exportPlanPath, '--json']);
    assert.equal(status0.status, 3, 'status must report work remaining pre-implementation');
    const status0Body = JSON.parse(status0.stdout);
    const status0Row = status0Body.changes.find((c) => c.id === M9_CHANGE);
    assert.equal(status0Row.status, 'pending', 'm9-probe must be pending pre-implementation');

    // ---- step 10 — waves + contract: dispatch schedule + subagent packet ----
    const waves0 = nodeAt(wt, ['tools/flowmap/contract/waves.mjs', '--plan', exportPlanPath, '--json']);
    assert.equal(waves0.status, 0, 'waves.mjs failed:\n' + waves0.stdout + waves0.stderr);
    const waves0Body = JSON.parse(waves0.stdout);
    assert.deepEqual(waves0Body.waves[0], [M9_CHANGE], 'wave 0 must contain m9-probe pre-implementation');

    const contract0 = nodeAt(wt, ['tools/flowmap/contract/contract.mjs', '--change', M9_CHANGE, '--plan', exportPlanPath, '--json']);
    assert.equal(contract0.status, 0, 'contract.mjs failed:\n' + contract0.stdout + contract0.stderr);
    const contract0Body = JSON.parse(contract0.stdout);
    assert.equal(contract0Body.coherent, true, 'contract packet must be coherent');
    assert.ok(contract0Body.contractHash, 'contract packet must carry a contractHash');

    // ---- step 11 — RED: verify-change FAIL pre-implementation ----
    const verify0 = nodeAt(wt, ['tools/flowmap/contract/verify-change.mjs', '--change', M9_CHANGE, '--plan', exportPlanPath, '--json']);
    assert.equal(verify0.status, 1, 'verify-change must FAIL pre-implementation');
    const verify0Body = JSON.parse(verify0.stdout);
    assert.equal(verify0Body.verdict, 'FAIL', 'pre-implementation verdict must be FAIL');
    assert.equal(verify0Body.structural.status, 'pending', 'structural status must be pending pre-implementation');
    const redVerdictHash = verify0Body.verdictHash;

    // ---- step 12 — RED: acceptance cases fail (symbol not yet implemented) ----
    const acc0 = nodeAt(wt, ['tools/buildspec/acceptance/acceptance.mjs', '--plan', exportPlanPath, '--json']);
    assert.equal(acc0.status, 1, 'acceptance must be red pre-implementation');
    const acc0Body = JSON.parse(acc0.stdout);
    assert.equal(acc0Body.results.length, 3, 'all 3 acceptance cases must be present');
    assert.ok(acc0Body.results.every((r) => r.pass === false), 'every acceptance case must fail pre-implementation');

    // ---- step 16 (RED half) — orchestrate must dispatch the unbuilt change and report its FAIL ----
    const orch0 = nodeAt(wt, ['tools/flowmap/contract/orchestrate.mjs', '--plan', exportPlanPath, '--strict', '--no-worktree', '--json']);
    assert.equal(orch0.status, 1, 'orchestrate must exit non-zero while the change is unbuilt');
    const orch0Body = JSON.parse(orch0.stdout);
    assert.deepEqual(orch0Body.dispatched, [M9_CHANGE], 'orchestrate must dispatch the unbuilt change');
    assert.equal(orch0Body.verdicts[M9_CHANGE].verdict, 'FAIL', 'orchestrate must report the RED verdict');
    assert.ok(orch0Body.orchestrateHash, 'orchestrate must emit an orchestrateHash');

    // ---- step 13 — IMPLEMENT for real: write the probe fn + run REAL (non-dry) writeback ----
    const stateTs = join(wt, M9_TS_REL);
    appendFileSync(stateTs, `\n/** M9 loop probe (test-only, never lands in real src): doubles a number. */\nexport function ${M9_LOCAL}(n: number): number {\n  return n * 2;\n}\n`);

    // scaffold.mjs writes target.ref VERBATIM as the fragment-local id (it is
    // namespace-unaware); feed it a bare-ref shim so the fragment keeps the
    // bare-id convention its siblings already use (see header note).
    const realPlan = JSON.parse(readFileSync(join(wt, M9_PLAN), 'utf8'));
    const shimPlan = JSON.parse(JSON.stringify(realPlan));
    shimPlan.changes[0].target.ref = M9_LOCAL;
    shimPlan.changes[0].newNode.label = M9_LOCAL;
    const shimPlanPath = join(work, 'm9-scaffold-shim.plan.json');
    writeFileSync(shimPlanPath, JSON.stringify(shimPlan));

    const fragPath = join(wt, M9_FRAGMENT_REL);
    const scaffold1 = nodeAt(wt, ['tools/buildspec/scaffold/scaffold.mjs', '--add-from-plan', shimPlanPath, '--fragment', M9_FRAGMENT_REL]);
    assert.equal(scaffold1.status, 0, 'scaffold --add-from-plan failed:\n' + scaffold1.stdout + scaffold1.stderr);
    let fragText = readFileSync(fragPath, 'utf8');
    assert.match(fragText, new RegExp(`%%\\s*kind\\s+${M9_LOCAL}\\s+function`), 'fragment must gain the new node');

    // scaffold provably does NOT emit `%% src` (extract.mjs populates a
    // signature only for srcMap ids) — the checklist path appends it.
    assert.doesNotMatch(fragText, /%%\s*src\s+m9Probe\b/, 'sanity: scaffold really did not emit %% src');
    appendFileSync(fragPath, `%% src ${M9_LOCAL} ${M9_TS_REL}#${M9_LOCAL}\n`);
    fragText = readFileSync(fragPath, 'utf8');
    assert.match(fragText, new RegExp(`%%\\s*src\\s+${M9_LOCAL}\\s+.*#${M9_LOCAL}`), 'fragment must carry the appended %% src line');

    // idempotency: a second (identical) scaffold run adds nothing new.
    const scaffold2 = nodeAt(wt, ['tools/buildspec/scaffold/scaffold.mjs', '--add-from-plan', shimPlanPath, '--fragment', M9_FRAGMENT_REL]);
    assert.equal(scaffold2.status, 0);
    assert.match(scaffold2.stdout, /no new nodes to add/, 'scaffold must be idempotent on a second run');

    // ---- step 14 — re-sync (A2 chain), run mid-loop: bundle -> validate -> extract -> gate ----
    const bundle1 = nodeAt(wt, ['tools/flowmap/verify/bundle.mjs', '--root', 'docs/flowmap/root.mmd', '--dir', 'src']);
    assert.equal(bundle1.status, 0, 'bundle.mjs failed:\n' + bundle1.stderr);
    assert.match(bundle1.stdout, new RegExp(M9_REF), 'regenerated bundle must contain the probe node');
    writeFileSync(join(wt, 'docs', 'flowmap', '_bundle.mmd'), bundle1.stdout);

    const validate1 = nodeAt(wt, ['tools/flowmap/verify/validate.mjs', 'docs/flowmap/_bundle.mmd']);
    assert.equal(validate1.status, 0, 'regenerated bundle failed validation:\n' + validate1.stdout + validate1.stderr);

    const extractedPath = join(work, 'm9-extracted.mmd');
    const extract1 = nodeAt(wt, ['tools/buildspec/pipeline/extract.mjs', '--map', 'docs/flowmap/_bundle.mmd', '--tsconfig', 'tsconfig.json', '--out', extractedPath]);
    assert.equal(extract1.status, 0, 'extract.mjs failed:\n' + extract1.stdout + extract1.stderr);

    const gate1 = nodeAt(wt, ['tools/buildspec/pipeline/gate.mjs', '--spec', 'docs/flowmap/_bundle.mmd', '--code', extractedPath]);
    assert.equal(gate1.status, 0, 'gate.mjs found drift after the implement + resync:\n' + gate1.stdout + gate1.stderr);

    // ---- step 15 — GREEN: acceptance + verify-change flip, the row M9 exists for ----
    const acc1 = nodeAt(wt, ['tools/buildspec/acceptance/acceptance.mjs', '--plan', exportPlanPath, '--json']);
    assert.equal(acc1.status, 0, 'acceptance must be green post-implementation:\n' + acc1.stdout + acc1.stderr);
    const acc1Body = JSON.parse(acc1.stdout);
    assert.ok(acc1Body.results.every((r) => r.pass === true), 'every acceptance case must pass post-implementation');

    const verify1 = nodeAt(wt, ['tools/flowmap/contract/verify-change.mjs', '--change', M9_CHANGE, '--plan', exportPlanPath, '--strict', '--json']);
    assert.equal(verify1.status, 0, 'verify-change must PASS post-implementation:\n' + verify1.stdout + verify1.stderr);
    const verify1Body = JSON.parse(verify1.stdout);
    assert.equal(verify1Body.verdict, 'PASS', 'post-implementation verdict must be PASS');
    assert.equal(verify1Body.behavioural.proven, true, 'behavioural contract must be proven, not just structural');
    assert.notEqual(verify1Body.verdictHash, redVerdictHash, 'verdictHash must flip: the verdict is a function of the code');

    // ---- step 16 (GREEN half) — orchestrate must dispatch NOTHING; waves must show it done ----
    const orch1 = nodeAt(wt, ['tools/flowmap/contract/orchestrate.mjs', '--plan', exportPlanPath, '--strict', '--no-worktree', '--json']);
    assert.equal(orch1.status, 0, 'orchestrate must exit 0 once nothing is left to dispatch');
    const orch1Body = JSON.parse(orch1.stdout);
    assert.deepEqual(orch1Body.dispatched, [], 'orchestrate must dispatch nothing once the change is built');
    assert.equal(orch1Body.summary.total, 0, 'summary.total must be 0 (a built change is never dispatched, by construction)');
    assert.ok(orch1Body.orchestrateHash, 'orchestrate must emit an orchestrateHash');

    const waves1 = nodeAt(wt, ['tools/flowmap/contract/waves.mjs', '--plan', exportPlanPath, '--json']);
    assert.equal(waves1.status, 0);
    const waves1Body = JSON.parse(waves1.stdout);
    assert.ok(waves1Body.done.includes(M9_CHANGE), 'waves.mjs must show m9-probe as done post-implementation');

    // ---- step 17 — replay: determinism of the PASS verdict, post-real-build ----
    const replayTask = `node tools/flowmap/contract/verify-change.mjs --change ${M9_CHANGE} --plan ${exportPlanPath} --json`;
    const replay1 = nodeAt(wt, ['tools/flowmap/contract/replay.mjs', '--task', replayTask, '--n', '5', '--json']);
    assert.equal(replay1.status, 0, 'replay must find the PASS verdict deterministic:\n' + replay1.stdout + replay1.stderr);
    const replay1Body = JSON.parse(replay1.stdout);
    assert.equal(replay1Body.deterministic, true, 'the PASS verdict must replay byte-identically across 5 runs');
    assert.equal(replay1Body.distinctOutputs, 1, 'exactly one distinct stdout hash across 5 runs');
  } finally {
    destroySandbox(wt);
    rmSync(work, { recursive: true, force: true });
  }
});

/** Find any existing fragment so the writeback --dry stage has a real target. */
function anyFragment() {
  const stack = [join(ROOT, 'src')];
  while (stack.length) {
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.flowmap.mmd')) return p;
    }
  }
  return null;
}

test('the loop runs end-to-end on the real plan', () => {
  const work = mkdtempSync(join(tmpdir(), 'flowmap-loop-'));
  try {
    // 1 — PLAN coherence (C3): refs real, deps acyclic, accepted set coherent.
    const check = node(['tools/flowmap/plan/plan-check.mjs', '--plan', PLAN]);
    assert.equal(check.status, 0, 'plan-check failed:\n' + check.stdout + check.stderr);
    assert.match(check.stdout, /coherent/);

    // 2 — CERT (C2): apply → stubs → tsc → gate, delta vs base.
    const cert = node(['tools/flowmap/plan/plan-cert.mjs', '--plan', PLAN]);
    assert.equal(cert.status, 0, 'cert failed:\n' + cert.stdout + cert.stderr);
    assert.match(cert.stdout, /CERTIFIED/);

    // 3 — APPROVE-EXPORT (E1): one artifact = approved.mmd + stubs + checklist.
    const out = join(work, 'export');
    const exp = node(['tools/flowmap/plan/approve-export.mjs', '--plan', PLAN, '--out', out]);
    assert.equal(exp.status, 0, 'approve-export failed:\n' + exp.stdout + exp.stderr);
    assert.ok(existsSync(join(out, 'approved.mmd')), 'approved.mmd missing');
    assert.ok(existsSync(join(out, 'plan.json')), 'exported plan.json (build checklist) missing');
    assert.ok(existsSync(join(out, 'CHECKLIST.md')), 'CHECKLIST.md missing');
    assert.ok(existsSync(join(out, 'contracts')), 'generated contracts/ missing');

    // 4 — STATUS (C1): build-state derived from the live gate, not prose.
    // Exit 0 = fully built; exit 3 = work remaining (the normal mid-loop state,
    // a verified pending checklist — not a failure). Any other code is broken.
    const status = node(['tools/flowmap/status/status.mjs', '--plan', join(out, 'plan.json')]);
    assert.ok([0, 3].includes(status.status), 'status crashed:\n' + status.stdout + status.stderr);
    assert.match(status.stdout, /pending|built/i);

    // 5 — WRITEBACK (E3): approved nodes append to a fragment (dry — no mutation).
    const frag = anyFragment();
    assert.ok(frag, 'no fragment found to exercise writeback');
    const wb = node(['tools/buildspec/scaffold/scaffold.mjs', '--add-from-plan', PLAN, '--fragment', frag, '--dry']);
    assert.equal(wb.status, 0, 'writeback --dry failed:\n' + wb.stdout + wb.stderr);

    // 6 — RE-SYNC GUARD (A5): the map's edges stay code-backed-or-audited.
    const edges = node(['tools/flowmap/verify/edge-verify.mjs', '--strict']);
    assert.equal(edges.status, 0, 'edge gate failed:\n' + edges.stdout + edges.stderr);
    assert.match(edges.stdout, /every edge is code-backed/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

/* ---------- AUD5/F-13: the RED chain — the loop must STOP, not just run.
   AUD3 T8: the spine above is pure happy-path; no stage was ever fed bad
   input, so F5 proved the loop RUNS, never that it stops. This chain feeds
   an incoherent plan in and asserts the FIRST gate blocks and nothing
   downstream executes. ---------- */

test('the loop STOPS on an incoherent plan: plan-check blocks, the chain does not proceed', () => {
  const work = mkdtempSync(join(tmpdir(), 'flowmap-loop-red-'));
  try {
    // Incoherent on two axes: a dangling dependsOn + a modify targeting a
    // node that does not exist in the map (REAL-IDS).
    const badPlan = join(work, 'bad-plan.json');
    writeFileSync(badPlan, JSON.stringify({
      base: 'red-chain-fixture',
      changes: [
        { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'zzNoSuchNode' },
          fm: { name: 'x', interfaces: [] }, dependsOn: ['no-such-change'] },
      ],
    }));

    // The chain, in loop order; each stage runs ONLY if the previous passed —
    // exactly how an orchestrating agent consumes the exit codes.
    const stages = [
      ['plan-check', ['tools/flowmap/plan/plan-check.mjs', '--plan', badPlan]],
      ['cert',       ['tools/flowmap/plan/plan-cert.mjs', '--plan', badPlan]],
      ['approve',    ['tools/flowmap/plan/approve-export.mjs', '--plan', badPlan, '--out', join(work, 'export')]],
    ];
    const executed = [];
    let blockedAt = null;
    for (const [name, args] of stages) {
      executed.push(name);
      const r = node(args);
      if (r.status !== 0) { blockedAt = { name, status: r.status }; break; }
    }

    assert.ok(blockedAt, 'a chain fed an incoherent plan must block at some stage');
    assert.equal(blockedAt.name, 'plan-check', 'the FIRST gate (coherence) is the one that blocks');
    assert.equal(blockedAt.status, 1, 'plan-check reports problems with exit 1');
    assert.deepEqual(executed, ['plan-check'], 'nothing downstream of the block executed');
    assert.ok(!existsSync(join(work, 'export')), 'no approval artifact came out of a red chain');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});
