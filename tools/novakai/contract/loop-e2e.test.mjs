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
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync, readFileSync,
  appendFileSync, symlinkSync, cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJSON } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PLAN = 'public/plan.json';
const PLAN_CHECK_TOOL = 'tools/novakai/plan/plan-check.mjs';
const PLAN_CERT_TOOL = 'tools/novakai/plan/plan-cert.mjs';
const APPROVE_EXPORT_TOOL = 'tools/novakai/plan/approve-export.mjs';
const SCAFFOLD_TOOL = 'tools/buildspec/scaffold/scaffold.mjs';
const ADD_FROM_PLAN_FLAG = '--add-from-plan';
const FRAGMENT_FLAG = '--fragment';
const APPROVED_MMD_FILE = 'approved.mmd';
const CHECKLIST_MD_FILE = 'CHECKLIST.md';
const PLAN_CHECK_STAGE = 'plan-check';

// M2b: NOVAKAI_ROOT is the emitter seam only — verdict events from the chain's
// plan-cert stage land in a scratch sink, never in the repo's real metrics log.
const METRICS_SINK = mkdtempSync(join(tmpdir(), 'loop-e2e-metrics-'));
process.on('exit', () => rmSync(METRICS_SINK, { recursive: true, force: true }));

const node = (args) => spawnSync('node', args, {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, NOVAKAI_ROOT: METRICS_SINK },
});

/** Find any existing fragment so the writeback --dry stage has a real target. */
function anyFragment() {
  const stack = [join(ROOT, 'src')];
  while (stack.length) {
    const dir = stack.pop();
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = join(dir, e.name);
      if (e.isDirectory()) stack.push(entryPath);
      else if (e.name.endsWith('.novakai.mmd')) return entryPath;
    }
  }
  return null;
}

// Incoherent on two axes: a dangling dependsOn + a modify targeting a node
// that does not exist in the map (REAL-IDS).
function incoherentPlanFixture() {
  return {
    base: 'red-chain-fixture',
    changes: [
      { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'zzNoSuchNode' },
        'fm': { name: 'x', interfaces: [] }, dependsOn: ['no-such-change'] },
    ],
  };
}

/** Run the loop stages in order against a bad plan; stop at the first
 *  non-zero exit — exactly how an orchestrating agent consumes exit codes. */
function runChainUntilBlocked(badPlan, work) {
  const stages = [
    [PLAN_CHECK_STAGE, [PLAN_CHECK_TOOL, '--plan', badPlan]],
    ['cert', [PLAN_CERT_TOOL, '--plan', badPlan]],
    ['approve', [APPROVE_EXPORT_TOOL, '--plan', badPlan, '--out', join(work, 'export')]],
  ];
  const executed = [];
  let blockedAt = null;
  for (const [name, args] of stages) {
    executed.push(name);
    const stepResult = node(args);
    if (stepResult.status !== 0) {
      blockedAt = { name, status: stepResult.status };
      break;
    }
  }
  return { executed, blockedAt };
}

// 1 — PLAN coherence (C3): refs real, deps acyclic, accepted set coherent.
// 2 — CERT (C2): apply → stubs → tsc → gate, delta vs base.
function runPlanCheckAndCertStages() {
  const check = node([PLAN_CHECK_TOOL, '--plan', PLAN]);
  assert.equal(check.status, 0, 'plan-check failed:\n' + check.stdout + check.stderr);
  assert.match(check.stdout, /coherent/);

  const cert = node([PLAN_CERT_TOOL, '--plan', PLAN]);
  assert.equal(cert.status, 0, 'cert failed:\n' + cert.stdout + cert.stderr);
  assert.match(cert.stdout, /CERTIFIED/);
}

/** 3 — APPROVE-EXPORT (E1): one artifact = approved.mmd + stubs + checklist.
 *  Returns the export dir so the status stage can consume it. */
function runApproveExportStage(work) {
  const out = join(work, 'export');
  const exp = node([APPROVE_EXPORT_TOOL, '--plan', PLAN, '--out', out]);
  assert.equal(exp.status, 0, 'approve-export failed:\n' + exp.stdout + exp.stderr);
  assert.ok(existsSync(join(out, APPROVED_MMD_FILE)), 'approved.mmd missing');
  assert.ok(existsSync(join(out, 'plan.json')), 'exported plan.json (build checklist) missing');
  assert.ok(existsSync(join(out, CHECKLIST_MD_FILE)), 'CHECKLIST.md missing');
  assert.ok(existsSync(join(out, 'contracts')), 'generated contracts/ missing');
  return out;
}

// 4 — STATUS (C1): build-state derived from the live gate, not prose. Exit 0 =
// fully built; exit 3 = work remaining (the normal mid-loop state, a verified
// pending checklist — not a failure). Any other code is broken.
function runStatusStage(out) {
  const status = node(['tools/novakai/status/status.mjs', '--plan', join(out, 'plan.json')]);
  assert.ok([0, 3].includes(status.status), 'status crashed:\n' + status.stdout + status.stderr);
  assert.match(status.stdout, /pending|built/i);
}

// 5 — WRITEBACK (E3): approved nodes append to a fragment (dry — no mutation).
// 6 — RE-SYNC GUARD (A5): the map's edges stay code-backed-or-audited.
function runWritebackAndEdgeVerifyStages(work) {
  const frag = anyFragment();
  assert.ok(frag, 'no fragment found to exercise writeback');
  const writeback = node([SCAFFOLD_TOOL, ADD_FROM_PLAN_FLAG, PLAN, FRAGMENT_FLAG, frag, '--dry']);
  assert.equal(writeback.status, 0, 'writeback --dry failed:\n' + writeback.stdout + writeback.stderr);

  const edges = node(['tools/novakai/verify/edge-verify.mjs', '--strict']);
  assert.equal(edges.status, 0, 'edge gate failed:\n' + edges.stdout + edges.stderr);
  assert.match(edges.stdout, /every edge is code-backed/);
}

test('the loop runs end-to-end on the real plan', () => {
  const work = mkdtempSync(join(tmpdir(), 'novakai-loop-'));
  try {
    runPlanCheckAndCertStages();
    const out = runApproveExportStage(work);
    runStatusStage(out);
    runWritebackAndEdgeVerifyStages(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

/* ---------- AUD5/F-13: the RED chain — the loop must STOP, not just run.
   AUD3 T8: the spine above is pure happy-path; no stage was ever fed bad
   input, so F5 proved the loop RUNS, never that it stops. This chain feeds
   an incoherent plan in and asserts the FIRST gate blocks and nothing
   downstream executes. (M9 step 18 — retained unchanged: the OTHER stops
   (steps 2, 6, 11, 12 below) are new; this stop-at-first-gate was already
   proven and is not duplicated.) ---------- */

test('the loop STOPS on an incoherent plan: plan-check blocks, the chain does not proceed', () => {
  const work = mkdtempSync(join(tmpdir(), 'novakai-loop-red-'));
  try {
    const badPlan = join(work, 'bad-plan.json');
    writeFileSync(badPlan, JSON.stringify(incoherentPlanFixture()));
    // The chain, in loop order; each stage runs ONLY if the previous passed —
    // exactly how an orchestrating agent consumes the exit codes.
    const { executed, blockedAt } = runChainUntilBlocked(badPlan, work);

    assert.ok(blockedAt, 'a chain fed an incoherent plan must block at some stage');
    assert.equal(blockedAt.name, PLAN_CHECK_STAGE, 'the FIRST gate (coherence) is the one that blocks');
    assert.equal(blockedAt.status, 1, 'plan-check reports problems with exit 1');
    assert.deepEqual(executed, [PLAN_CHECK_STAGE], 'nothing downstream of the block executed');
    assert.ok(!existsSync(join(work, 'export')), 'no approval artifact came out of a red chain');
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
});

/* =====================================================================
   M9 — the FAIL->PASS end-to-end loop (docs/novakai/plans/m9-design.md).
   ---------------------------------------------------------------------
   F5 above proves the loop RUNS on the real in-flight plan; it never
   proves the loop's REASON TO EXIST — a change going from provably-NOT-
   built to provably-BUILT through the full spine (understand -> plan ->
   review -> approve -> implement -> verify), with a real code-driven
   red->green flip no mock can fake. public/plan.json can't drive that
   flip (its one acceptance-bearing change is already built), so M9 uses
   a disposable fixture (docs/novakai/plans/m9-loop.plan.json, one `add`
   change `m9-probe`, already committed) built and torn down inside a
   THROWAWAY git worktree — the real repo never gains the probe symbol.

   Sandbox mechanism (step 0): `git worktree add --detach <tmp> HEAD` + a
   symlinked `node_modules` (worktrees don't get their own — see
   orchestrate.mjs's own header). Every step below runs the WORKTREE's own
   copies of the tools with cwd = the worktree — load-bearing, not
   cosmetic: every verdict tool derives its ROOT from `import.meta.url`
   (pins ROOT to the worktree when its own copy runs), but quiz's
   PASS_FILE and status/extract's symbol resolution are CWD-relative, so
   cwd must be the worktree too. The fixture is already committed at HEAD
   (docs/novakai/plans/m9-loop.plan.json), so the worktree checkout
   contains it with no copy-in step needed.

   Namespacing note: state.novakai.mmd is a non-global fragment (`%% root
   state`), so novakai-bundle.mjs prefixes the probe's fragment-local id
   `m9Probe` to `state__m9Probe` at merge time (exactly how every sibling
   in that fragment — createState, frameTransform, etc. — already works,
   and how every real fixture in docs/novakai/plans/*.plan.json names its
   target.ref, e.g. `unfold__ufVerbAllowed`). The committed fixture's
   target.ref is therefore the POST-bundle id `state__m9Probe`; the
   implement step (13) feeds scaffold a bare-ref SHIM copy (scaffold.mjs
   is namespace-unaware and writes target.ref verbatim as the fragment-
   local id — see docs/novakai/plans/m9-loop.plan.json's own "note" field
   and the build report's DEVIATIONS for why scaffold.mjs itself was left
   unmodified) so the fragment keeps the bare-id convention its siblings
   use; the real resync (step 14) is what produces the `state__m9Probe`
   id the tracked plan expects.

   AUDITABILITY: one named test per M9 step, so the TAP output of
   `npm run novakai:loop` is itself the per-step audit record. Each step
   ALSO logs one `M9-AUDIT {...}` line (canonical JSON, no timestamps) to
   stdout during setup, so `grep M9-AUDIT` on a fresh run recovers every
   step's command/expectation/observed-exit/verdict/hash without reading
   this file. RED steps (2, 6, 11, 12, 16-red) assert the observed
   non-zero exit / FAIL verdict explicitly: a red expectation that is MET
   is a PASSING test with "RED" in its name.
   ===================================================================== */

const M9_PLAN = 'docs/novakai/plans/m9-loop.plan.json';
const M9_CHANGE = 'm9-probe';
const M9_REF = 'state__m9Probe';   // post-bundle id (matches the fixture's target.ref)
const M9_LOCAL = 'm9Probe';        // bare fragment-local id + real TS export name
// Forward-slash literals: these strings are both CLI args (--fragment) AND
// verbatim text inside the .mmd `%% src` directive, which is always POSIX-style.
const M9_FRAGMENT_REL = 'src/core/state/state.novakai.mmd';
const M9_TS_REL = 'src/core/state/state.ts';
const BUNDLE_MMD_PATH = 'docs/novakai/_bundle.mmd';
const RED_EXPECTED_VERDICT = 'PASS (RED expected, observed)';
const STATUS_TOOL = 'tools/novakai/status/status.mjs';
const VALIDATE_TOOL = 'tools/novakai/verify/validate.mjs';
const QUIZ_TOOL = 'tools/novakai/onboard/quiz.mjs';
const WAVES_TOOL = 'tools/novakai/contract/waves.mjs';
const CONTRACT_TOOL = 'tools/novakai/contract/contract.mjs';
const VERIFY_CHANGE_TOOL = 'tools/novakai/contract/verify-change.mjs';
const ACCEPTANCE_TOOL = 'tools/buildspec/acceptance/acceptance.mjs';
const ORCHESTRATE_TOOL = 'tools/novakai/contract/orchestrate.mjs';
const BUNDLE_TOOL = 'tools/novakai/verify/bundle.mjs';
const EXTRACT_TOOL = 'tools/buildspec/pipeline/extract.mjs';
const GATE_TOOL = 'tools/buildspec/pipeline/gate.mjs';
const REPLAY_TOOL = 'tools/novakai/contract/replay.mjs';

/** Run a node tool from an explicit cwd (the M9 sandbox needs its OWN tool
 *  copies + its own cwd-relative state — see the header note above). */
function m9NodeAt(cwd, args) {
  return spawnSync('node', args, {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NOVAKAI_ROOT: METRICS_SINK },
  });
}

function m9Json(result) {
  try {
    return JSON.parse(result.stdout);
  } catch {
    return null;
  }
}

/** One M9-AUDIT line per step: grep-able, canonical (no timestamps), so a
 *  fresh run's stdout alone is the audit trail (the AUDITABILITY REQUIREMENT). */
// Per-step (cmd, expected) audit metadata, keyed by step id — kept as data so
// every m9Audit() call site stays a short positional call (observedExit,
// verdict, hash only) instead of repeating this descriptive text 16 times.
const M9_STEP_META = {
  0: ['git worktree add --detach <tmp> HEAD + symlink node_modules + validate.mjs',
    'worktree HEAD == main HEAD; validate exit 0'],
  2: ['quiz.mjs verify (no pass artifact, fresh worktree)', 'exit != 0 (fail-closed)'],
  4: ['plan-check.mjs --plan m9-loop.plan.json', 'exit 0, /coherent/'],
  5: ['plan-cert.mjs --plan m9-loop.plan.json', 'exit 0, /CERTIFIED/'],
  6: ['approve-export.mjs --accepted-only (verdicts-stripped plan)', 'exit 2, no artifacts'],
  8: ['approve-export.mjs --accepted-only --plan m9-loop.plan.json', 'exit 0, full artifact bundle'],
  9: ['status.mjs --plan <export>/plan.json --json', 'exit 3, m9-probe pending'],
  10: ['waves.mjs --json + contract.mjs --change m9-probe --json',
    'wave 0 = [m9-probe]; contract coherent + hashed'],
  11: ['verify-change.mjs --change m9-probe --json (pre-implementation)',
    'exit 1, verdict FAIL, structural pending'],
  12: ['acceptance.mjs --plan <export>/plan.json --json (pre-implementation)',
    'exit 1, all 3 cases fail (no %% src mapping)'],
  '16-red': ['orchestrate.mjs --strict --no-worktree --json (pre-implementation)',
    'exit 1, dispatched=[m9-probe], verdict FAIL'],
  13: ['write probe fn to state.ts + scaffold.mjs --add-from-plan (shim) x2 + %% src append',
    'both scaffold runs exit 0; fragment has node + %% src; 2nd run idempotent'],
  14: ['bundle.mjs --root root.mmd --dir src + validate.mjs + extract.mjs + gate.mjs (mid-loop re-sync)',
    'all exit 0; bundle contains state__m9Probe'],
  15: ['acceptance.mjs + verify-change.mjs --strict --change m9-probe --json (post-implementation)',
    'acceptance exit 0; verify-change exit 0, verdict PASS, behavioural.proven true, verdictHash != step-11 hash'],
  '16-green': ['orchestrate.mjs --strict --no-worktree --json (post-implementation) + waves.mjs --json',
    'exit 0, dispatched=[], summary.total=0; waves.done contains m9-probe'],
  17: ['replay.mjs --task "verify-change --change m9-probe --json" --n 5 (post-green)',
    'exit 0, deterministic, 1 distinct hash'],
};

function m9Audit(step, observedExit, verdict, hash = null) {
  const [cmd, expected] = M9_STEP_META[step];
  console.log('M9-AUDIT ' + canonicalJSON({ step: String(step), cmd, expected, observedExit, verdict, hash }));
}

/** True/false checks -> PASS/FAIL (or custom labels). Keeps step verdicts as
 *  flat data instead of deeply nested && chains, which is what was blowing
 *  out each step function's cyclomatic complexity. */
function m9Verdict(conditions, passLabel = 'PASS', failLabel = 'FAIL') {
  return conditions.every(Boolean) ? passLabel : failLabel;
}

/** git worktree add --detach <tmp> HEAD + symlink node_modules + bodies.json
 *  (bodies.json is gitignored — a per-checkout generated artifact — so the
 *  worktree's checkout of HEAD does not carry it; copy the main repo's copy
 *  in, generating it once first if even main lacks it). Returns the raw
 *  pieces step 0's audit needs. */
function m9ProvisionWorktree(worktree) {
  const mainHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0;
  const add = spawnSync('git', ['worktree', 'add', '--detach', worktree, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  if (add.status === 0) {
    symlinkSync(join(ROOT, 'node_modules'), join(worktree, 'node_modules'), 'dir');
    const mainBodies = join(ROOT, 'public', 'bodies.json');
    if (!existsSync(mainBodies)) spawnSync('npm', ['run', 'novakai:bodies'], { cwd: ROOT, encoding: 'utf8' });
    if (existsSync(mainBodies)) cpSync(mainBodies, join(worktree, 'public', 'bodies.json'));
  }
  const wtHead = add.status === 0
    ? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).stdout.trim() : null;
  return { add, mainHead, dirty, wtHead };
}

// ---- step 0 — sandbox isolation mechanism (orchestrate.mjs's H4 gap closed) ----
function m9Step0(worktree, results) {
  const { add, mainHead, dirty, wtHead } = m9ProvisionWorktree(worktree);
  // Open risk 6: the sandbox is a checkout of committed HEAD; a dirty main
  // working tree means "onboard attests both" would be false (onboard
  // attests the working tree, not just HEAD) — that specific claim is
  // scoped to a clean tree (always true in CI) and is why step 1 (onboard)
  // is NOT re-run inside this chain (see the deviation note below).
  results.wtAdd = add;
  results.step0 = { mainHead, wtHead, dirty, headsMatch: mainHead === wtHead };
  const validate0 = add.status === 0
    ? m9NodeAt(worktree, [VALIDATE_TOOL, BUNDLE_MMD_PATH])
    : { status: 2, stdout: '', stderr: 'worktree not provisioned' };
  results.step0.validate = validate0;
  m9Audit(0, validate0.status, m9Verdict([add.status === 0, mainHead === wtHead, validate0.status === 0]));
  if (add.status !== 0) throw new Error('git worktree add failed: ' + add.stdout + add.stderr);
}

// ---- steps 2/4/5 — quiz RED (Keystone 1), then plan-check + plan-cert GREEN ----
// A fresh worktree checkout carries no gitignored .novakai-quiz-pass.json, so
// quiz.mjs must fail-closed; the fixture itself must then be coherent and its
// proposed contract enforceable.
function m9Step2And4And5(worktree, results) {
  const quiz2 = m9NodeAt(worktree, [QUIZ_TOOL, 'verify']);
  results.step2 = quiz2;
  m9Audit(2, quiz2.status, quiz2.status !== 0 ? RED_EXPECTED_VERDICT : 'FAIL (fail-open)');

  const check4 = m9NodeAt(worktree, [PLAN_CHECK_TOOL, '--plan', M9_PLAN]);
  results.step4 = check4;
  m9Audit(4, check4.status, m9Verdict([check4.status === 0, /coherent/.test(check4.stdout)]));

  const cert5 = m9NodeAt(worktree, [PLAN_CERT_TOOL, '--plan', M9_PLAN]);
  results.step5 = cert5;
  m9Audit(5, cert5.status, m9Verdict([cert5.status === 0, /CERTIFIED/.test(cert5.stdout)]));
}

// ---- step 6 — RED: approve-export refuses --accepted-only on a verdict-less plan ----
function m9Step6(worktree, work, results) {
  const noVerdictsPlan = JSON.parse(readFileSync(join(worktree, M9_PLAN), 'utf8'));
  delete noVerdictsPlan.verdicts;
  const noVerdictsPath = join(work, 'm9-no-verdicts.plan.json');
  writeFileSync(noVerdictsPath, JSON.stringify(noVerdictsPlan));
  const redExportDir = join(work, 'm9-red-export');
  const redExport = m9NodeAt(worktree,
    [APPROVE_EXPORT_TOOL, '--plan', noVerdictsPath, '--out', redExportDir, '--accepted-only']);
  results.step6 = { ...redExport, outExists: existsSync(redExportDir) };
  m9Audit(6, redExport.status,
    m9Verdict([redExport.status === 2, !existsSync(redExportDir)], RED_EXPECTED_VERDICT, 'FAIL'));
}

// ---- step 8 — approve-export, real, on the verdict path (F5 only ran verdict-less) ----
function m9Step8(worktree, work, results) {
  const exportDir = join(work, 'm9-export');
  const exp8 = m9NodeAt(worktree, [APPROVE_EXPORT_TOOL, '--plan', M9_PLAN, '--out', exportDir, '--accepted-only']);
  results.step8 = { ...exp8, exportDir, exportPlanPath: join(exportDir, 'plan.json') };
  const artifacts8 = [APPROVED_MMD_FILE, 'plan.json', CHECKLIST_MD_FILE, 'contracts']
    .every((file) => existsSync(join(exportDir, file)));
  m9Audit(8, exp8.status, m9Verdict([exp8.status === 0, artifacts8]));
  return results.step8.exportPlanPath;
}

// ---- step 9 — status: the honest RED baseline (not built yet) ----
function m9Step9(worktree, exportPlanPath, results) {
  const status9 = m9NodeAt(worktree, [STATUS_TOOL, '--plan', exportPlanPath, '--json']);
  results.step9 = status9;
  const status9Body = m9Json(status9);
  const status9Row = status9Body?.changes?.find((change) => change.id === M9_CHANGE);
  m9Audit(9, status9.status, m9Verdict([status9.status === 3, status9Row?.status === 'pending']));
}

// ---- step 10 — waves + contract: dispatch schedule + subagent packet ----
function m9Step10(worktree, exportPlanPath, results) {
  const waves10 = m9NodeAt(worktree, [WAVES_TOOL, '--plan', exportPlanPath, '--json']);
  results.step10waves = waves10;
  const waves10Body = m9Json(waves10);
  const contract10 = m9NodeAt(worktree,
    [CONTRACT_TOOL, '--change', M9_CHANGE, '--plan', exportPlanPath, '--json']);
  results.step10contract = contract10;
  const contract10Body = m9Json(contract10);
  const wave0Ok = JSON.stringify(waves10Body?.waves?.[0] ?? null) === JSON.stringify([M9_CHANGE]);
  m9Audit(10, waves10.status, m9Verdict([
    waves10.status === 0, wave0Ok, contract10.status === 0,
    contract10Body?.coherent === true, !!contract10Body?.contractHash,
  ]), contract10Body?.contractHash ?? null);
}

/** Shared shape check for the 3 Keystone-2 acceptance cases: every case's
 *  `pass` must equal `expected` (false pre-implementation, true post-). */
function m9AcceptanceAllPass(body, expected) {
  return Array.isArray(body?.results) && body.results.length === 3
    && body.results.every((one) => one.pass === expected);
}

// ---- step 11 — RED: verify-change FAIL pre-implementation, then
// ---- step 12 — RED: acceptance cases fail (symbol not yet implemented, Keystone 2) ----
function m9Step11And12(worktree, exportPlanPath, results) {
  const verify11 = m9NodeAt(worktree,
    [VERIFY_CHANGE_TOOL, '--change', M9_CHANGE, '--plan', exportPlanPath, '--json']);
  results.step11 = verify11;
  const verify11Body = m9Json(verify11);
  results.verdictHash11 = verify11Body?.verdictHash ?? null;
  m9Audit(11, verify11.status, m9Verdict([
    verify11.status === 1, verify11Body?.verdict === 'FAIL', verify11Body?.structural?.status === 'pending',
  ], RED_EXPECTED_VERDICT, 'FAIL'), results.verdictHash11);

  const acc12 = m9NodeAt(worktree, [ACCEPTANCE_TOOL, '--plan', exportPlanPath, '--json']);
  results.step12 = acc12;
  const allRed12 = m9AcceptanceAllPass(m9Json(acc12), false);
  m9Audit(12, acc12.status, m9Verdict([acc12.status === 1, allRed12], RED_EXPECTED_VERDICT, 'FAIL'));
}

// ---- step 16 (RED half) — orchestrate must dispatch the unbuilt change and report its FAIL ----
function m9Step16Red(worktree, exportPlanPath, results) {
  const orch16red = m9NodeAt(worktree,
    [ORCHESTRATE_TOOL, '--plan', exportPlanPath, '--strict', '--no-worktree', '--json']);
  results.step16red = orch16red;
  const orch16redBody = m9Json(orch16red);
  const dispatchOk = JSON.stringify(orch16redBody?.dispatched ?? null) === JSON.stringify([M9_CHANGE]);
  m9Audit('16-red', orch16red.status, m9Verdict([
    orch16red.status === 1, dispatchOk, orch16redBody?.verdicts?.[M9_CHANGE]?.verdict === 'FAIL',
  ], RED_EXPECTED_VERDICT, 'FAIL'), orch16redBody?.orchestrateHash ?? null);
}

// ---- step 13 (part 1) — write the probe fn to state.ts + a bare-ref SHIM plan.
// scaffold.mjs writes target.ref VERBATIM as the fragment-local id (it is
// namespace-unaware); feed it a bare-ref SHIM so the fragment keeps the
// bare-id convention its siblings already use (see the header note and the
// fixture's own "note" field for why scaffold.mjs was left unmodified).
// ---- step 13 (part 2) — run scaffold twice (real + idempotency) + append %% src.
// scaffold provably does NOT emit `%% src` (extract.mjs populates a real
// signature only for ids carrying a `%% src` directive) — append it per
// build-checklist step 3 (Open risk 1: decided to leave scaffold.mjs
// unmodified rather than teach it to emit %% src; see DEVIATIONS).
function m9ApplyScaffold(worktree, shimPlanPath, fragPath) {
  const scaffold1 = m9NodeAt(worktree,
    [SCAFFOLD_TOOL, ADD_FROM_PLAN_FLAG, shimPlanPath, FRAGMENT_FLAG, M9_FRAGMENT_REL]);
  let fragText = readFileSync(fragPath, 'utf8');
  const hasNode13 = new RegExp(`%%\\s*kind\\s+${M9_LOCAL}\\s+function`).test(fragText);
  const hadSrcBeforeAppend = new RegExp(`%%\\s*src\\s+${M9_LOCAL}\\b`).test(fragText);
  if (!hadSrcBeforeAppend) appendFileSync(fragPath, `%% src ${M9_LOCAL} ${M9_TS_REL}#${M9_LOCAL}\n`);
  fragText = readFileSync(fragPath, 'utf8');
  const hasSrc13 = new RegExp(`%%\\s*src\\s+${M9_LOCAL}\\s+.*#${M9_LOCAL}`).test(fragText);
  // idempotency: a second (identical) scaffold run adds nothing new.
  const scaffold2 = m9NodeAt(worktree,
    [SCAFFOLD_TOOL, ADD_FROM_PLAN_FLAG, shimPlanPath, FRAGMENT_FLAG, M9_FRAGMENT_REL]);
  const idempotent13 = /no new nodes to add/.test(scaffold2.stdout);
  return { scaffold1, scaffold2, hasNode13, hasSrc13, idempotent13, hadSrcBeforeAppend };
}

// ---- step 13 — IMPLEMENT for real: write the probe fn to state.ts, build a
// bare-ref SHIM plan (scaffold.mjs writes target.ref VERBATIM as the
// fragment-local id — namespace-unaware — so the fixture's real post-bundle
// ref would not round-trip; see the fixture's own "note" field for why
// scaffold.mjs was left unmodified), then run REAL (non-dry) writeback. ----
function m9Step13(worktree, work, results) {
  const stateTs = join(worktree, M9_TS_REL);
  const probeSrc = `\n/** M9 loop probe (test-only, never lands in real src): doubles a number. */\n`
    + `export function ${M9_LOCAL}(n: number): number {\n  return n * 2;\n}\n`;
  appendFileSync(stateTs, probeSrc);
  const shimPlan = structuredClone(JSON.parse(readFileSync(join(worktree, M9_PLAN), 'utf8')));
  shimPlan.changes[0].target.ref = M9_LOCAL;
  const shimPlanPath = join(work, 'm9-scaffold-shim.plan.json');
  writeFileSync(shimPlanPath, JSON.stringify(shimPlan));
  const fragPath = join(worktree, M9_FRAGMENT_REL);
  const scaffoldResult = m9ApplyScaffold(worktree, shimPlanPath, fragPath);
  results.step13 = scaffoldResult;
  const { scaffold1, scaffold2, hasNode13, hasSrc13, idempotent13 } = scaffoldResult;
  m9Audit(13, scaffold1.status,
    m9Verdict([scaffold1.status === 0, scaffold2.status === 0, hasNode13, hasSrc13, idempotent13]));
}

// ---- step 14 — re-sync (A2 chain), run mid-loop: bundle -> validate -> extract -> gate ----
function m9Step14(worktree, work, results) {
  const bundle14 = m9NodeAt(worktree,
    [BUNDLE_TOOL, '--root', 'docs/novakai/root.mmd', '--dir', 'src']);
  const bundleHasProbe14 = bundle14.status === 0 && bundle14.stdout.includes(M9_REF);
  if (bundle14.status === 0) writeFileSync(join(worktree, 'docs', 'novakai', '_bundle.mmd'), bundle14.stdout);
  const validate14 = m9NodeAt(worktree, [VALIDATE_TOOL, BUNDLE_MMD_PATH]);
  const extractedPath14 = join(work, 'm9-extracted.mmd');
  const extract14 = m9NodeAt(worktree,
    [EXTRACT_TOOL, '--map', BUNDLE_MMD_PATH,
      '--tsconfig', 'tsconfig.json', '--out', extractedPath14]);
  const gate14 = m9NodeAt(worktree,
    [GATE_TOOL, '--spec', BUNDLE_MMD_PATH, '--code', extractedPath14]);
  results.step14 = { bundle14, validate14, extract14, gate14, bundleHasProbe14 };
  m9Audit(14, gate14.status, m9Verdict([
    bundle14.status === 0, validate14.status === 0, extract14.status === 0, gate14.status === 0, bundleHasProbe14,
  ]));
}

// The row M9 exists for: acceptance green, verify-change PASS with a proven
// behavioural contract, and the verdictHash actually flips vs step 11's (the
// verdict is a function of the code, not a fixed fixture).
function m9Step15Conditions({ acc15, allGreen15, verify15, verify15Body, results }) {
  return [
    acc15.status === 0, allGreen15, verify15.status === 0,
    verify15Body?.verdict === 'PASS', verify15Body?.behavioural?.proven === true,
    results.verdictHash15 !== results.verdictHash11, !!results.verdictHash15,
  ];
}

// ---- step 15 — GREEN: acceptance + verify-change flip, the row M9 exists for ----
function m9Step15(worktree, exportPlanPath, results) {
  const acc15 = m9NodeAt(worktree, [ACCEPTANCE_TOOL, '--plan', exportPlanPath, '--json']);
  results.step15acc = acc15;
  const allGreen15 = m9AcceptanceAllPass(m9Json(acc15), true);
  const verify15 = m9NodeAt(worktree,
    [VERIFY_CHANGE_TOOL, '--change', M9_CHANGE, '--plan', exportPlanPath,
      '--strict', '--json']);
  results.step15verify = verify15;
  const verify15Body = m9Json(verify15);
  results.verdictHash15 = verify15Body?.verdictHash ?? null;
  m9Audit(15, verify15.status,
    m9Verdict(m9Step15Conditions({ acc15, allGreen15, verify15, verify15Body, results })), results.verdictHash15);
}

function m9Step16GreenConditions({ orch16green, orch16greenBody, waves16green, waves16greenBody }) {
  return [
    orch16green.status === 0,
    Array.isArray(orch16greenBody?.dispatched), orch16greenBody?.dispatched?.length === 0,
    orch16greenBody?.summary?.total === 0,
    waves16green.status === 0,
    Array.isArray(waves16greenBody?.done), waves16greenBody?.done?.includes(M9_CHANGE),
  ];
}

// ---- step 16 (GREEN half) — orchestrate must dispatch NOTHING; waves must show it done ----
function m9Step16Green(worktree, exportPlanPath, results) {
  const orch16green = m9NodeAt(worktree,
    [ORCHESTRATE_TOOL, '--plan', exportPlanPath, '--strict', '--no-worktree', '--json']);
  results.step16green = orch16green;
  const orch16greenBody = m9Json(orch16green);
  const waves16green = m9NodeAt(worktree, [WAVES_TOOL, '--plan', exportPlanPath, '--json']);
  results.waves16green = waves16green;
  const waves16greenBody = m9Json(waves16green);
  m9Audit('16-green', orch16green.status,
    m9Verdict(m9Step16GreenConditions({ orch16green, orch16greenBody, waves16green, waves16greenBody })),
    orch16greenBody?.orchestrateHash ?? null);
}

// ---- step 17 — replay: determinism of the PASS verdict, post-real-build ----
function m9Step17(worktree, exportPlanPath, results) {
  const replayTask = `node tools/novakai/contract/verify-change.mjs --change ${M9_CHANGE}`
    + ` --plan ${exportPlanPath} --json`;
  const replay17 = m9NodeAt(worktree,
    [REPLAY_TOOL, '--task', replayTask, '--n', '5', '--json']);
  results.step17 = replay17;
  const replay17Body = m9Json(replay17);
  m9Audit(17, replay17.status,
    m9Verdict([replay17.status === 0, replay17Body?.deterministic === true, replay17Body?.distinctOutputs === 1]),
    replay17Body?.hash ?? null);
}

function runM9ChainPhase1(worktree, work, results) {
  m9Step0(worktree, results);
  m9Step2And4And5(worktree, results);
  m9Step6(worktree, work, results);
  return m9Step8(worktree, work, results);
}

/** Phase 2 of the M9 sandbox chain: the RED baseline through the real
 *  FAIL->PASS flip and its post-green determinism check. */
function runM9ChainPhase2(worktree, exportPlanPath, work, results) {
  m9Step9(worktree, exportPlanPath, results);
  m9Step10(worktree, exportPlanPath, results);
  m9Step11And12(worktree, exportPlanPath, results);
  m9Step16Red(worktree, exportPlanPath, results);
  m9Step13(worktree, work, results);
  m9Step14(worktree, work, results);
  m9Step15(worktree, exportPlanPath, results);
  m9Step16Green(worktree, exportPlanPath, results);
  m9Step17(worktree, exportPlanPath, results);
}

/** The whole M9 sandbox chain, steps 0-17, in loop order (see the header note
 *  above for why steps run in this exact sequence, and the RED/GREEN pairing). */
function runM9Chain(worktree, work, results) {
  const exportPlanPath = runM9ChainPhase1(worktree, work, results);
  runM9ChainPhase2(worktree, exportPlanPath, work, results);
}

let m9Worktree;
let m9Work;
const m9Results = {}; // per-step raw CLI results, populated once in m9BeforeHook()
let m9SetupError = null;

function m9BeforeHook() {
  m9Work = mkdtempSync(join(tmpdir(), 'm9-work-'));
  m9Worktree = mkdtempSync(join(tmpdir(), 'm9-sandbox-'));
  rmSync(m9Worktree, { recursive: true, force: true }); // git worktree add creates the dir itself
  try {
    runM9Chain(m9Worktree, m9Work, m9Results);
  } catch (e) {
    m9SetupError = e;
  }
}

function m9AfterHook() {
  if (m9Worktree) {
    spawnSync('git', ['worktree', 'remove', '--force', m9Worktree], { cwd: ROOT, encoding: 'utf8' });
    try {
      rmSync(m9Worktree, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
    spawnSync('git', ['worktree', 'prune'], { cwd: ROOT, encoding: 'utf8' });
  }
  if (m9Work) rmSync(m9Work, { recursive: true, force: true });
}

function noSetupError() {
  assert.equal(m9SetupError, null, 'M9 sandbox chain setup failed before this step could run: '
    + (m9SetupError && (m9SetupError.stack || m9SetupError.message)));
}

function testM9Step0() {
  noSetupError();
  assert.equal(m9Results.wtAdd.status, 0,
    'git worktree add failed:\n' + m9Results.wtAdd.stdout + m9Results.wtAdd.stderr);
  assert.equal(m9Results.step0.mainHead, m9Results.step0.wtHead,
    'the sandbox worktree must be pinned to the exact same commit as the main repo HEAD');
  assert.equal(m9Results.step0.validate.status, 0,
    'sandbox map does not validate:\n' + m9Results.step0.validate.stdout + m9Results.step0.validate.stderr);
  // Open risk 6: onboard attests the WORKING TREE, not just HEAD, so "one run
  // attests both" is only true on a clean tree. Not re-asserted as a hard
  // failure here (a dirty dev tree is normal mid-build); recorded so a CI
  // run (always clean) is where the stronger claim actually holds.
  if (m9Results.step0.dirty) {
    console.log('M9 note: main working tree is dirty — the "onboard attests both sandbox and main" claim'
      + ' is scoped to a clean tree (CI), not asserted here.');
  }
}

function testM9Step2() {
  noSetupError();
  assert.notEqual(m9Results.step2.status, 0, 'quiz.mjs verify must fail-closed with no pass artifact');
}

function testM9Step4() {
  noSetupError();
  assert.equal(m9Results.step4.status, 0,
    'plan-check failed:\n' + m9Results.step4.stdout + m9Results.step4.stderr);
  assert.match(m9Results.step4.stdout, /coherent/);
}

function testM9Step5() {
  noSetupError();
  assert.equal(m9Results.step5.status, 0,
    'plan-cert failed:\n' + m9Results.step5.stdout + m9Results.step5.stderr);
  assert.match(m9Results.step5.stdout, /CERTIFIED/);
}

function testM9Step6() {
  noSetupError();
  assert.equal(m9Results.step6.status, 2, 'approve-export must refuse --accepted-only on a verdict-less plan (exit 2)');
  assert.ok(!m9Results.step6.outExists, 'no artifact may come out of the refused export');
}

function testM9Step8() {
  noSetupError();
  assert.equal(m9Results.step8.status, 0,
    'approve-export failed:\n' + m9Results.step8.stdout + m9Results.step8.stderr);
  assert.ok(existsSync(join(m9Results.step8.exportDir, APPROVED_MMD_FILE)), 'approved.mmd missing');
  assert.ok(existsSync(join(m9Results.step8.exportDir, 'plan.json')), 'exported plan.json missing');
  assert.ok(existsSync(join(m9Results.step8.exportDir, CHECKLIST_MD_FILE)), 'CHECKLIST.md missing');
  assert.ok(existsSync(join(m9Results.step8.exportDir, 'contracts')), 'generated contracts/ missing');
}

function testM9Step9() {
  noSetupError();
  assert.equal(m9Results.step9.status, 3, 'status must report work remaining pre-implementation');
  const body = m9Json(m9Results.step9);
  const row = body.changes.find((change) => change.id === M9_CHANGE);
  assert.equal(row.status, 'pending', 'm9-probe must be pending pre-implementation');
}

function testM9Step10() {
  noSetupError();
  assert.equal(m9Results.step10waves.status, 0,
    'waves.mjs failed:\n' + m9Results.step10waves.stdout + m9Results.step10waves.stderr);
  const wavesBody = m9Json(m9Results.step10waves);
  assert.deepEqual(wavesBody.waves[0], [M9_CHANGE], 'wave 0 must contain m9-probe pre-implementation');
  assert.equal(m9Results.step10contract.status, 0,
    'contract.mjs failed:\n' + m9Results.step10contract.stdout + m9Results.step10contract.stderr);
  const contractBody = m9Json(m9Results.step10contract);
  assert.equal(contractBody.coherent, true, 'contract packet must be coherent');
  assert.ok(contractBody.contractHash, 'contract packet must carry a contractHash');
}

function testM9Step11() {
  noSetupError();
  assert.equal(m9Results.step11.status, 1, 'verify-change must FAIL (exit 1) pre-implementation');
  const body = m9Json(m9Results.step11);
  assert.equal(body.verdict, 'FAIL', 'pre-implementation verdict must be FAIL');
  assert.equal(body.structural.status, 'pending', 'structural status must be pending pre-implementation');
  assert.ok(m9Results.verdictHash11, 'a FAIL verdict must still carry a verdictHash (data-only, always present)');
}

function testM9Step12() {
  noSetupError();
  assert.equal(m9Results.step12.status, 1, 'acceptance must be red (exit 1) pre-implementation');
  const body = m9Json(m9Results.step12);
  assert.equal(body.results.length, 3, 'all 3 acceptance cases must be present');
  assert.ok(body.results.every((one) => one.pass === false),
    'every acceptance case must fail pre-implementation (no %% src mapping yet)');
}

function testM9Step16Red() {
  noSetupError();
  assert.equal(m9Results.step16red.status, 1, 'orchestrate must exit non-zero while the change is unbuilt');
  const body = m9Json(m9Results.step16red);
  assert.deepEqual(body.dispatched, [M9_CHANGE], 'orchestrate must dispatch the unbuilt change');
  assert.equal(body.verdicts[M9_CHANGE].verdict, 'FAIL', 'orchestrate must report the RED verdict');
  assert.ok(body.orchestrateHash, 'orchestrate must emit an orchestrateHash');
}

function testM9Step13() {
  noSetupError();
  assert.equal(m9Results.step13.scaffold1.status, 0,
    'scaffold --add-from-plan failed:\n' + m9Results.step13.scaffold1.stdout + m9Results.step13.scaffold1.stderr);
  assert.ok(m9Results.step13.hasNode13, 'fragment must gain the new node');
  assert.equal(m9Results.step13.hadSrcBeforeAppend, false, 'sanity: scaffold really does not emit %% src on its own');
  assert.ok(m9Results.step13.hasSrc13, 'fragment must carry the %% src line (appended per build-checklist step 3)');
  assert.equal(m9Results.step13.scaffold2.status, 0);
  assert.ok(m9Results.step13.idempotent13, 'a second identical scaffold run must add nothing new');
}

function testM9Step14() {
  noSetupError();
  const step14 = m9Results.step14;
  assert.equal(step14.bundle14.status, 0, 'bundle.mjs failed:\n' + step14.bundle14.stderr);
  assert.ok(step14.bundleHasProbe14, 'regenerated bundle must contain the probe node (state__m9Probe)');
  assert.equal(step14.validate14.status, 0,
    'regenerated bundle failed validation:\n' + step14.validate14.stdout + step14.validate14.stderr);
  assert.equal(step14.extract14.status, 0,
    'extract.mjs failed:\n' + step14.extract14.stdout + step14.extract14.stderr);
  assert.equal(step14.gate14.status, 0,
    'gate.mjs found drift after the implement + resync:\n' + step14.gate14.stdout + step14.gate14.stderr);
}

function testM9Step15() {
  noSetupError();
  assert.equal(m9Results.step15acc.status, 0,
    'acceptance must be green post-implementation:\n' + m9Results.step15acc.stdout + m9Results.step15acc.stderr);
  const accBody = m9Json(m9Results.step15acc);
  assert.ok(accBody.results.every((one) => one.pass === true), 'every acceptance case must pass post-implementation');

  assert.equal(m9Results.step15verify.status, 0,
    'verify-change must PASS post-implementation:\n' + m9Results.step15verify.stdout + m9Results.step15verify.stderr);
  const verifyBody = m9Json(m9Results.step15verify);
  assert.equal(verifyBody.verdict, 'PASS', 'post-implementation verdict must be PASS');
  assert.equal(verifyBody.behavioural.proven, true, 'behavioural contract must be proven, not just structural');
  assert.notEqual(m9Results.verdictHash15, m9Results.verdictHash11,
    'verdictHash must flip: the verdict is a function of the code, not a fixed fixture');
}

function testM9Step16Green() {
  noSetupError();
  assert.equal(m9Results.step16green.status, 0, 'orchestrate must exit 0 once nothing is left to dispatch');
  const orchBody = m9Json(m9Results.step16green);
  assert.deepEqual(orchBody.dispatched, [], 'orchestrate must dispatch nothing once the change is built');
  assert.equal(orchBody.summary.total, 0,
    'summary.total must be 0 (a built change is never dispatched, by construction)');
  assert.ok(orchBody.orchestrateHash, 'orchestrate must emit an orchestrateHash');

  assert.equal(m9Results.waves16green.status, 0);
  const wavesBody = m9Json(m9Results.waves16green);
  assert.ok(wavesBody.done.includes(M9_CHANGE), 'waves.mjs must show m9-probe as done post-implementation');
}

function testM9Step17() {
  noSetupError();
  assert.equal(m9Results.step17.status, 0,
    'replay must find the PASS verdict deterministic:\n' + m9Results.step17.stdout + m9Results.step17.stderr);
  const body = m9Json(m9Results.step17);
  assert.equal(body.deterministic, true, 'the PASS verdict must replay byte-identically across 5 runs');
  assert.equal(body.distinctOutputs, 1, 'exactly one distinct stdout hash across 5 runs');
}

// One named test per M9 step (the AUDITABILITY REQUIREMENT — see header): a
// module-scope table, not nested test() calls, so describe() stays tiny.
const M9_TESTS = [
  ['M9 step 0 — sandbox isolation: throwaway worktree at HEAD + validate.mjs (orchestrate.mjs H4 gap closed)',
    testM9Step0],
  ['M9 step 2 — quiz RED: fail-closed with no pass artifact (Keystone 1)', testM9Step2],
  ['M9 step 4 — plan-check: the fixture is coherent', testM9Step4],
  ['M9 step 5 — plan-cert: the fixture\'s proposed contract is enforceable', testM9Step5],
  ['M9 step 6 — approve-export RED: refuses --accepted-only on a verdict-less plan', testM9Step6],
  ['M9 step 8 — approve-export GREEN: the real verdict path (accepted-only, with verdicts)', testM9Step8],
  ['M9 step 9 — status RED baseline: the honest "not built yet" state', testM9Step9],
  ['M9 step 10 — waves + contract: dispatch schedule + subagent packet', testM9Step10],
  ['M9 step 11 — verify-change RED: FAIL expected pre-implementation', testM9Step11],
  ['M9 step 12 — acceptance RED: Keystone 2 cases fail pre-implementation', testM9Step12],
  ['M9 step 16-red — orchestrate RED: dispatches the unbuilt change and reports its FAIL', testM9Step16Red],
  ['M9 step 13 — IMPLEMENT: real (non-dry) writeback lands the probe + %% src, idempotently', testM9Step13],
  ['M9 step 14 — RE-SYNC: bundle -> validate -> extract -> gate, run mid-loop', testM9Step14],
  ['M9 step 15 — GREEN: the FAIL->PASS flip (acceptance + verify-change), the row M9 exists for', testM9Step15],
  ['M9 step 16-green — orchestrate GREEN: dispatches nothing; waves shows the change done', testM9Step16Green],
  ['M9 step 17 — replay: the PASS verdict is byte-deterministic across 5 runs, post-real-build', testM9Step17],
];

describe('M9 — end-to-end FAIL->PASS loop (docs/novakai/plans/m9-design.md)', () => {
  before(m9BeforeHook);
  after(m9AfterHook);
  for (const [name, testFn] of M9_TESTS) test(name, testFn);
});
