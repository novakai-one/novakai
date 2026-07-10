/* =====================================================================
   loop-e2e-m9-chain.mjs — the M9 sandbox chain step implementations for
   loop-e2e.test.mjs (split out in whole-repo standards session 3; the
   test file keeps every named test and assertion, this module only RUNS
   the chain and records per-step raw results). Test-only machinery —
   allowlisted in docs/novakai/tooling-curation-allowlist.txt, not
   mapped architecture.
   ===================================================================== */
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, existsSync, writeFileSync, readFileSync,
  appendFileSync, symlinkSync, cpSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJSON } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const ROOT = join(HERE, '..', '..', '..');

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

export {
  PLAN, PLAN_CHECK_TOOL, PLAN_CERT_TOOL, APPROVE_EXPORT_TOOL, SCAFFOLD_TOOL,
  ADD_FROM_PLAN_FLAG, FRAGMENT_FLAG, APPROVED_MMD_FILE, CHECKLIST_MD_FILE,
  PLAN_CHECK_STAGE, METRICS_SINK, M9_CHANGE, m9Json, runM9Chain,
};
