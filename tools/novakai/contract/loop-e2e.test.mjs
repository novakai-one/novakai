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
import { mkdtempSync, rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runM9Chain, m9Json, ROOT, METRICS_SINK, PLAN, PLAN_CHECK_TOOL, PLAN_CERT_TOOL,
  APPROVE_EXPORT_TOOL, SCAFFOLD_TOOL, ADD_FROM_PLAN_FLAG, FRAGMENT_FLAG,
  APPROVED_MMD_FILE, CHECKLIST_MD_FILE, PLAN_CHECK_STAGE, M9_CHANGE,
} from './loop-e2e-m9-chain.mjs';

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
// The M9 step implementations (steps 0-17, constants, audit lines) live in
// ./loop-e2e-m9-chain.mjs — split in whole-repo standards session 3.
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
