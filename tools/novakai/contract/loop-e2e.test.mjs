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
  appendFileSync, symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJSON } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PLAN = 'public/plan.json';

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
    const d = stack.pop();
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (e.name.endsWith('.novakai.mmd')) return p;
    }
  }
  return null;
}

test('the loop runs end-to-end on the real plan', () => {
  const work = mkdtempSync(join(tmpdir(), 'novakai-loop-'));
  try {
    // 1 — PLAN coherence (C3): refs real, deps acyclic, accepted set coherent.
    const check = node(['tools/novakai/plan/plan-check.mjs', '--plan', PLAN]);
    assert.equal(check.status, 0, 'plan-check failed:\n' + check.stdout + check.stderr);
    assert.match(check.stdout, /coherent/);

    // 2 — CERT (C2): apply → stubs → tsc → gate, delta vs base.
    const cert = node(['tools/novakai/plan/plan-cert.mjs', '--plan', PLAN]);
    assert.equal(cert.status, 0, 'cert failed:\n' + cert.stdout + cert.stderr);
    assert.match(cert.stdout, /CERTIFIED/);

    // 3 — APPROVE-EXPORT (E1): one artifact = approved.mmd + stubs + checklist.
    const out = join(work, 'export');
    const exp = node(['tools/novakai/plan/approve-export.mjs', '--plan', PLAN, '--out', out]);
    assert.equal(exp.status, 0, 'approve-export failed:\n' + exp.stdout + exp.stderr);
    assert.ok(existsSync(join(out, 'approved.mmd')), 'approved.mmd missing');
    assert.ok(existsSync(join(out, 'plan.json')), 'exported plan.json (build checklist) missing');
    assert.ok(existsSync(join(out, 'CHECKLIST.md')), 'CHECKLIST.md missing');
    assert.ok(existsSync(join(out, 'contracts')), 'generated contracts/ missing');

    // 4 — STATUS (C1): build-state derived from the live gate, not prose.
    // Exit 0 = fully built; exit 3 = work remaining (the normal mid-loop state,
    // a verified pending checklist — not a failure). Any other code is broken.
    const status = node(['tools/novakai/status/status.mjs', '--plan', join(out, 'plan.json')]);
    assert.ok([0, 3].includes(status.status), 'status crashed:\n' + status.stdout + status.stderr);
    assert.match(status.stdout, /pending|built/i);

    // 5 — WRITEBACK (E3): approved nodes append to a fragment (dry — no mutation).
    const frag = anyFragment();
    assert.ok(frag, 'no fragment found to exercise writeback');
    const wb = node(['tools/buildspec/scaffold/scaffold.mjs', '--add-from-plan', PLAN, '--fragment', frag, '--dry']);
    assert.equal(wb.status, 0, 'writeback --dry failed:\n' + wb.stdout + wb.stderr);

    // 6 — RE-SYNC GUARD (A5): the map's edges stay code-backed-or-audited.
    const edges = node(['tools/novakai/verify/edge-verify.mjs', '--strict']);
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
   downstream executes. (M9 step 18 — retained unchanged: the OTHER stops
   (steps 2, 6, 11, 12 below) are new; this stop-at-first-gate was already
   proven and is not duplicated.) ---------- */

test('the loop STOPS on an incoherent plan: plan-check blocks, the chain does not proceed', () => {
  const work = mkdtempSync(join(tmpdir(), 'novakai-loop-red-'));
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
      ['plan-check', ['tools/novakai/plan/plan-check.mjs', '--plan', badPlan]],
      ['cert',       ['tools/novakai/plan/plan-cert.mjs', '--plan', badPlan]],
      ['approve',    ['tools/novakai/plan/approve-export.mjs', '--plan', badPlan, '--out', join(work, 'export')]],
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

/** Run a node tool from an explicit cwd (the M9 sandbox needs its OWN tool
 *  copies + its own cwd-relative state — see the header note above). */
function m9NodeAt(cwd, args) {
  return spawnSync('node', args, {
    cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, NOVAKAI_ROOT: METRICS_SINK },
  });
}

function m9Json(r) { try { return JSON.parse(r.stdout); } catch { return null; } }

/** One M9-AUDIT line per step: grep-able, canonical (no timestamps), so a
 *  fresh run's stdout alone is the audit trail (the AUDITABILITY REQUIREMENT). */
function m9Audit(step, cmd, expected, observedExit, verdict, hash = null) {
  console.log('M9-AUDIT ' + canonicalJSON({ step: String(step), cmd, expected, observedExit, verdict, hash }));
}

describe('M9 — end-to-end FAIL->PASS loop (docs/novakai/plans/m9-design.md)', () => {
  let wt;
  let work;
  const r = {}; // per-step raw CLI results, populated once in before()
  let setupError = null;

  before(() => {
    work = mkdtempSync(join(tmpdir(), 'm9-work-'));
    wt = mkdtempSync(join(tmpdir(), 'm9-sandbox-'));
    rmSync(wt, { recursive: true, force: true }); // git worktree add creates the dir itself

    try {
      // ---- step 0 — sandbox isolation mechanism (orchestrate.mjs's H4 gap closed) ----
      const mainHead = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
      const dirty = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim().length > 0;
      const add = spawnSync('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
      r.wtAdd = add;
      if (add.status === 0) symlinkSync(join(ROOT, 'node_modules'), join(wt, 'node_modules'), 'dir');
      const wtHead = add.status === 0
        ? spawnSync('git', ['rev-parse', 'HEAD'], { cwd: wt, encoding: 'utf8' }).stdout.trim() : null;
      // Open risk 6: the sandbox is a checkout of committed HEAD; a dirty main
      // working tree means "onboard attests both" would be false (onboard
      // attests the working tree, not just HEAD) — that specific claim is
      // scoped to a clean tree (always true in CI) and is why step 1 (onboard)
      // is NOT re-run inside this chain (see the deviation note below).
      r.step0 = { mainHead, wtHead, dirty, headsMatch: mainHead === wtHead };
      const validate0 = add.status === 0
        ? m9NodeAt(wt, ['tools/novakai/verify/validate.mjs', 'docs/novakai/_bundle.mmd']) : { status: 2, stdout: '', stderr: 'worktree not provisioned' };
      r.step0.validate = validate0;
      m9Audit(0, 'git worktree add --detach <tmp> HEAD + symlink node_modules + validate.mjs', 'worktree HEAD == main HEAD; validate exit 0',
        validate0.status, (add.status === 0 && mainHead === wtHead && validate0.status === 0) ? 'PASS' : 'FAIL');
      if (add.status !== 0) throw new Error('git worktree add failed: ' + add.stdout + add.stderr);

      // ---- step 2 — RED: quiz.mjs verify fail-closed with no pass artifact ----
      // A fresh worktree checkout carries no gitignored .novakai-quiz-pass.json.
      const quiz2 = m9NodeAt(wt, ['tools/novakai/onboard/quiz.mjs', 'verify']);
      r.step2 = quiz2;
      m9Audit(2, 'quiz.mjs verify (no pass artifact, fresh worktree)', 'exit != 0 (fail-closed)', quiz2.status,
        quiz2.status !== 0 ? 'PASS (RED expected, observed)' : 'FAIL (fail-open)');

      // ---- step 4 — plan-check: the fixture is coherent ----
      const check4 = m9NodeAt(wt, ['tools/novakai/plan/plan-check.mjs', '--plan', M9_PLAN]);
      r.step4 = check4;
      m9Audit(4, 'plan-check.mjs --plan m9-loop.plan.json', 'exit 0, /coherent/', check4.status,
        (check4.status === 0 && /coherent/.test(check4.stdout)) ? 'PASS' : 'FAIL');

      // ---- step 5 — plan-cert: the fixture's proposed contract is enforceable ----
      const cert5 = m9NodeAt(wt, ['tools/novakai/plan/plan-cert.mjs', '--plan', M9_PLAN]);
      r.step5 = cert5;
      m9Audit(5, 'plan-cert.mjs --plan m9-loop.plan.json', 'exit 0, /CERTIFIED/', cert5.status,
        (cert5.status === 0 && /CERTIFIED/.test(cert5.stdout)) ? 'PASS' : 'FAIL');

      // ---- step 6 — RED: approve-export refuses --accepted-only on a verdict-less plan ----
      const noVerdictsPlan = JSON.parse(readFileSync(join(wt, M9_PLAN), 'utf8'));
      delete noVerdictsPlan.verdicts;
      const noVerdictsPath = join(work, 'm9-no-verdicts.plan.json');
      writeFileSync(noVerdictsPath, JSON.stringify(noVerdictsPlan));
      const redExportDir = join(work, 'm9-red-export');
      const redExport = m9NodeAt(wt, ['tools/novakai/plan/approve-export.mjs', '--plan', noVerdictsPath, '--out', redExportDir, '--accepted-only']);
      r.step6 = { ...redExport, outExists: existsSync(redExportDir) };
      m9Audit(6, 'approve-export.mjs --accepted-only (verdicts-stripped plan)', 'exit 2, no artifacts', redExport.status,
        (redExport.status === 2 && !existsSync(redExportDir)) ? 'PASS (RED expected, observed)' : 'FAIL');

      // ---- step 8 — approve-export, real, on the verdict path (F5 only ran verdict-less) ----
      const exportDir = join(work, 'm9-export');
      const exp8 = m9NodeAt(wt, ['tools/novakai/plan/approve-export.mjs', '--plan', M9_PLAN, '--out', exportDir, '--accepted-only']);
      r.step8 = { ...exp8, exportDir, exportPlanPath: join(exportDir, 'plan.json') };
      const artifacts8 = ['approved.mmd', 'plan.json', 'CHECKLIST.md', 'contracts'].every((f) => existsSync(join(exportDir, f)));
      m9Audit(8, 'approve-export.mjs --accepted-only --plan m9-loop.plan.json', 'exit 0, full artifact bundle', exp8.status,
        (exp8.status === 0 && artifacts8) ? 'PASS' : 'FAIL');
      const exportPlanPath = r.step8.exportPlanPath;

      // ---- step 9 — status: the honest RED baseline (not built yet) ----
      const status9 = m9NodeAt(wt, ['tools/novakai/status/status.mjs', '--plan', exportPlanPath, '--json']);
      r.step9 = status9;
      const status9Body = m9Json(status9);
      const status9Row = status9Body?.changes?.find((c) => c.id === M9_CHANGE);
      m9Audit(9, 'status.mjs --plan <export>/plan.json --json', 'exit 3, m9-probe pending', status9.status,
        (status9.status === 3 && status9Row?.status === 'pending') ? 'PASS' : 'FAIL');

      // ---- step 10 — waves + contract: dispatch schedule + subagent packet ----
      const waves10 = m9NodeAt(wt, ['tools/novakai/contract/waves.mjs', '--plan', exportPlanPath, '--json']);
      r.step10waves = waves10;
      const waves10Body = m9Json(waves10);
      const contract10 = m9NodeAt(wt, ['tools/novakai/contract/contract.mjs', '--change', M9_CHANGE, '--plan', exportPlanPath, '--json']);
      r.step10contract = contract10;
      const contract10Body = m9Json(contract10);
      const wave0Ok = JSON.stringify(waves10Body?.waves?.[0] ?? null) === JSON.stringify([M9_CHANGE]);
      m9Audit(10, 'waves.mjs --json + contract.mjs --change m9-probe --json', 'wave 0 = [m9-probe]; contract coherent + hashed',
        waves10.status, (waves10.status === 0 && wave0Ok && contract10.status === 0 && contract10Body?.coherent === true && !!contract10Body?.contractHash) ? 'PASS' : 'FAIL',
        contract10Body?.contractHash ?? null);

      // ---- step 11 — RED: verify-change FAIL pre-implementation ----
      const verify11 = m9NodeAt(wt, ['tools/novakai/contract/verify-change.mjs', '--change', M9_CHANGE, '--plan', exportPlanPath, '--json']);
      r.step11 = verify11;
      const verify11Body = m9Json(verify11);
      r.verdictHash11 = verify11Body?.verdictHash ?? null;
      m9Audit(11, 'verify-change.mjs --change m9-probe --json (pre-implementation)', 'exit 1, verdict FAIL, structural pending',
        verify11.status, (verify11.status === 1 && verify11Body?.verdict === 'FAIL' && verify11Body?.structural?.status === 'pending') ? 'PASS (RED expected, observed)' : 'FAIL',
        r.verdictHash11);

      // ---- step 12 — RED: acceptance cases fail (symbol not yet implemented, Keystone 2) ----
      const acc12 = m9NodeAt(wt, ['tools/buildspec/acceptance/acceptance.mjs', '--plan', exportPlanPath, '--json']);
      r.step12 = acc12;
      const acc12Body = m9Json(acc12);
      const allRed12 = Array.isArray(acc12Body?.results) && acc12Body.results.length === 3 && acc12Body.results.every((x) => x.pass === false);
      m9Audit(12, 'acceptance.mjs --plan <export>/plan.json --json (pre-implementation)', 'exit 1, all 3 cases fail (no %% src mapping)',
        acc12.status, (acc12.status === 1 && allRed12) ? 'PASS (RED expected, observed)' : 'FAIL');

      // ---- step 16 (RED half) — orchestrate must dispatch the unbuilt change and report its FAIL ----
      const orch16red = m9NodeAt(wt, ['tools/novakai/contract/orchestrate.mjs', '--plan', exportPlanPath, '--strict', '--no-worktree', '--json']);
      r.step16red = orch16red;
      const orch16redBody = m9Json(orch16red);
      const dispatchOk = JSON.stringify(orch16redBody?.dispatched ?? null) === JSON.stringify([M9_CHANGE]);
      m9Audit('16-red', 'orchestrate.mjs --strict --no-worktree --json (pre-implementation)', 'exit 1, dispatched=[m9-probe], verdict FAIL',
        orch16red.status, (orch16red.status === 1 && dispatchOk && orch16redBody?.verdicts?.[M9_CHANGE]?.verdict === 'FAIL') ? 'PASS (RED expected, observed)' : 'FAIL',
        orch16redBody?.orchestrateHash ?? null);

      // ---- step 13 — IMPLEMENT for real: write the probe fn + run REAL (non-dry) writeback ----
      const stateTs = join(wt, M9_TS_REL);
      appendFileSync(stateTs, `\n/** M9 loop probe (test-only, never lands in real src): doubles a number. */\nexport function ${M9_LOCAL}(n: number): number {\n  return n * 2;\n}\n`);

      // scaffold.mjs writes target.ref VERBATIM as the fragment-local id (it is
      // namespace-unaware); feed it a bare-ref SHIM so the fragment keeps the
      // bare-id convention its siblings already use (see the header note and
      // the fixture's own "note" field for why scaffold.mjs was left unmodified).
      const realPlan13 = JSON.parse(readFileSync(join(wt, M9_PLAN), 'utf8'));
      const shimPlan = JSON.parse(JSON.stringify(realPlan13));
      shimPlan.changes[0].target.ref = M9_LOCAL;
      const shimPlanPath = join(work, 'm9-scaffold-shim.plan.json');
      writeFileSync(shimPlanPath, JSON.stringify(shimPlan));

      const fragPath = join(wt, M9_FRAGMENT_REL);
      const scaffold1 = m9NodeAt(wt, ['tools/buildspec/scaffold/scaffold.mjs', '--add-from-plan', shimPlanPath, '--fragment', M9_FRAGMENT_REL]);
      let fragText = readFileSync(fragPath, 'utf8');
      const hasNode13 = new RegExp(`%%\\s*kind\\s+${M9_LOCAL}\\s+function`).test(fragText);

      // scaffold provably does NOT emit `%% src` (extract.mjs populates a real
      // signature only for ids carrying a `%% src` directive) — append it per
      // build-checklist step 3 (Open risk 1: decided to leave scaffold.mjs
      // unmodified rather than teach it to emit %% src; see DEVIATIONS).
      const hadSrcBeforeAppend = new RegExp(`%%\\s*src\\s+${M9_LOCAL}\\b`).test(fragText);
      if (!hadSrcBeforeAppend) appendFileSync(fragPath, `%% src ${M9_LOCAL} ${M9_TS_REL}#${M9_LOCAL}\n`);
      fragText = readFileSync(fragPath, 'utf8');
      const hasSrc13 = new RegExp(`%%\\s*src\\s+${M9_LOCAL}\\s+.*#${M9_LOCAL}`).test(fragText);

      // idempotency: a second (identical) scaffold run adds nothing new.
      const scaffold2 = m9NodeAt(wt, ['tools/buildspec/scaffold/scaffold.mjs', '--add-from-plan', shimPlanPath, '--fragment', M9_FRAGMENT_REL]);
      const idempotent13 = /no new nodes to add/.test(scaffold2.stdout);

      r.step13 = { scaffold1, scaffold2, hasNode13, hasSrc13, idempotent13, hadSrcBeforeAppend };
      m9Audit(13, 'write probe fn to state.ts + scaffold.mjs --add-from-plan (shim) x2 + %% src append', 'both scaffold runs exit 0; fragment has node + %% src; 2nd run idempotent',
        scaffold1.status, (scaffold1.status === 0 && scaffold2.status === 0 && hasNode13 && hasSrc13 && idempotent13) ? 'PASS' : 'FAIL');

      // ---- step 14 — re-sync (A2 chain), run mid-loop: bundle -> validate -> extract -> gate ----
      const bundle14 = m9NodeAt(wt, ['tools/novakai/verify/bundle.mjs', '--root', 'docs/novakai/root.mmd', '--dir', 'src']);
      const bundleHasProbe14 = bundle14.status === 0 && bundle14.stdout.includes(M9_REF);
      if (bundle14.status === 0) writeFileSync(join(wt, 'docs', 'novakai', '_bundle.mmd'), bundle14.stdout);
      const validate14 = m9NodeAt(wt, ['tools/novakai/verify/validate.mjs', 'docs/novakai/_bundle.mmd']);
      const extractedPath14 = join(work, 'm9-extracted.mmd');
      const extract14 = m9NodeAt(wt, ['tools/buildspec/pipeline/extract.mjs', '--map', 'docs/novakai/_bundle.mmd', '--tsconfig', 'tsconfig.json', '--out', extractedPath14]);
      const gate14 = m9NodeAt(wt, ['tools/buildspec/pipeline/gate.mjs', '--spec', 'docs/novakai/_bundle.mmd', '--code', extractedPath14]);
      r.step14 = { bundle14, validate14, extract14, gate14, bundleHasProbe14 };
      m9Audit(14, 'bundle.mjs --root root.mmd --dir src + validate.mjs + extract.mjs + gate.mjs (mid-loop re-sync)', 'all exit 0; bundle contains state__m9Probe',
        gate14.status, (bundle14.status === 0 && validate14.status === 0 && extract14.status === 0 && gate14.status === 0 && bundleHasProbe14) ? 'PASS' : 'FAIL');

      // ---- step 15 — GREEN: acceptance + verify-change flip, the row M9 exists for ----
      const acc15 = m9NodeAt(wt, ['tools/buildspec/acceptance/acceptance.mjs', '--plan', exportPlanPath, '--json']);
      r.step15acc = acc15;
      const acc15Body = m9Json(acc15);
      const allGreen15 = Array.isArray(acc15Body?.results) && acc15Body.results.length === 3 && acc15Body.results.every((x) => x.pass === true);

      const verify15 = m9NodeAt(wt, ['tools/novakai/contract/verify-change.mjs', '--change', M9_CHANGE, '--plan', exportPlanPath, '--strict', '--json']);
      r.step15verify = verify15;
      const verify15Body = m9Json(verify15);
      r.verdictHash15 = verify15Body?.verdictHash ?? null;
      m9Audit(15, 'acceptance.mjs + verify-change.mjs --strict --change m9-probe --json (post-implementation)',
        'acceptance exit 0; verify-change exit 0, verdict PASS, behavioural.proven true, verdictHash != step-11 hash',
        verify15.status,
        (acc15.status === 0 && allGreen15 && verify15.status === 0 && verify15Body?.verdict === 'PASS' && verify15Body?.behavioural?.proven === true && r.verdictHash15 !== r.verdictHash11 && !!r.verdictHash15)
          ? 'PASS' : 'FAIL',
        r.verdictHash15);

      // ---- step 16 (GREEN half) — orchestrate must dispatch NOTHING; waves must show it done ----
      const orch16green = m9NodeAt(wt, ['tools/novakai/contract/orchestrate.mjs', '--plan', exportPlanPath, '--strict', '--no-worktree', '--json']);
      r.step16green = orch16green;
      const orch16greenBody = m9Json(orch16green);
      const waves16green = m9NodeAt(wt, ['tools/novakai/contract/waves.mjs', '--plan', exportPlanPath, '--json']);
      r.waves16green = waves16green;
      const waves16greenBody = m9Json(waves16green);
      const dispatchedEmpty = Array.isArray(orch16greenBody?.dispatched) && orch16greenBody.dispatched.length === 0;
      const doneHasM9 = Array.isArray(waves16greenBody?.done) && waves16greenBody.done.includes(M9_CHANGE);
      m9Audit('16-green', 'orchestrate.mjs --strict --no-worktree --json (post-implementation) + waves.mjs --json',
        'exit 0, dispatched=[], summary.total=0; waves.done contains m9-probe',
        orch16green.status, (orch16green.status === 0 && dispatchedEmpty && orch16greenBody?.summary?.total === 0 && waves16green.status === 0 && doneHasM9) ? 'PASS' : 'FAIL',
        orch16greenBody?.orchestrateHash ?? null);

      // ---- step 17 — replay: determinism of the PASS verdict, post-real-build ----
      const replayTask = `node tools/novakai/contract/verify-change.mjs --change ${M9_CHANGE} --plan ${exportPlanPath} --json`;
      const replay17 = m9NodeAt(wt, ['tools/novakai/contract/replay.mjs', '--task', replayTask, '--n', '5', '--json']);
      r.step17 = replay17;
      const replay17Body = m9Json(replay17);
      m9Audit(17, 'replay.mjs --task "verify-change --change m9-probe --json" --n 5 (post-green)', 'exit 0, deterministic, 1 distinct hash',
        replay17.status, (replay17.status === 0 && replay17Body?.deterministic === true && replay17Body?.distinctOutputs === 1) ? 'PASS' : 'FAIL',
        replay17Body?.hash ?? null);
    } catch (e) {
      setupError = e;
    }
  });

  after(() => {
    if (wt) {
      spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT, encoding: 'utf8' });
      try { rmSync(wt, { recursive: true, force: true }); } catch { /* best effort */ }
      spawnSync('git', ['worktree', 'prune'], { cwd: ROOT, encoding: 'utf8' });
    }
    if (work) rmSync(work, { recursive: true, force: true });
  });

  function noSetupError() {
    assert.equal(setupError, null, 'M9 sandbox chain setup failed before this step could run: ' + (setupError && (setupError.stack || setupError.message)));
  }

  test('M9 step 0 — sandbox isolation: throwaway worktree at HEAD + validate.mjs (orchestrate.mjs H4 gap closed)', () => {
    noSetupError();
    assert.equal(r.wtAdd.status, 0, 'git worktree add failed:\n' + r.wtAdd.stdout + r.wtAdd.stderr);
    assert.equal(r.step0.mainHead, r.step0.wtHead, 'the sandbox worktree must be pinned to the exact same commit as the main repo HEAD');
    assert.equal(r.step0.validate.status, 0, 'sandbox map does not validate:\n' + r.step0.validate.stdout + r.step0.validate.stderr);
    // Open risk 6: onboard attests the WORKING TREE, not just HEAD, so "one run
    // attests both" is only true on a clean tree. Not re-asserted as a hard
    // failure here (a dirty dev tree is normal mid-build); recorded so a CI
    // run (always clean) is where the stronger claim actually holds.
    if (r.step0.dirty) console.log('M9 note: main working tree is dirty — the "onboard attests both sandbox and main" claim is scoped to a clean tree (CI), not asserted here.');
  });

  test('M9 step 2 — quiz RED: fail-closed with no pass artifact (Keystone 1)', () => {
    noSetupError();
    assert.notEqual(r.step2.status, 0, 'quiz.mjs verify must fail-closed with no pass artifact');
  });

  test('M9 step 4 — plan-check: the fixture is coherent', () => {
    noSetupError();
    assert.equal(r.step4.status, 0, 'plan-check failed:\n' + r.step4.stdout + r.step4.stderr);
    assert.match(r.step4.stdout, /coherent/);
  });

  test('M9 step 5 — plan-cert: the fixture\'s proposed contract is enforceable', () => {
    noSetupError();
    assert.equal(r.step5.status, 0, 'plan-cert failed:\n' + r.step5.stdout + r.step5.stderr);
    assert.match(r.step5.stdout, /CERTIFIED/);
  });

  test('M9 step 6 — approve-export RED: refuses --accepted-only on a verdict-less plan', () => {
    noSetupError();
    assert.equal(r.step6.status, 2, 'approve-export must refuse --accepted-only on a verdict-less plan (exit 2)');
    assert.ok(!r.step6.outExists, 'no artifact may come out of the refused export');
  });

  test('M9 step 8 — approve-export GREEN: the real verdict path (accepted-only, with verdicts)', () => {
    noSetupError();
    assert.equal(r.step8.status, 0, 'approve-export failed:\n' + r.step8.stdout + r.step8.stderr);
    assert.ok(existsSync(join(r.step8.exportDir, 'approved.mmd')), 'approved.mmd missing');
    assert.ok(existsSync(join(r.step8.exportDir, 'plan.json')), 'exported plan.json missing');
    assert.ok(existsSync(join(r.step8.exportDir, 'CHECKLIST.md')), 'CHECKLIST.md missing');
    assert.ok(existsSync(join(r.step8.exportDir, 'contracts')), 'generated contracts/ missing');
  });

  test('M9 step 9 — status RED baseline: the honest "not built yet" state', () => {
    noSetupError();
    assert.equal(r.step9.status, 3, 'status must report work remaining pre-implementation');
    const body = m9Json(r.step9);
    const row = body.changes.find((c) => c.id === M9_CHANGE);
    assert.equal(row.status, 'pending', 'm9-probe must be pending pre-implementation');
  });

  test('M9 step 10 — waves + contract: dispatch schedule + subagent packet', () => {
    noSetupError();
    assert.equal(r.step10waves.status, 0, 'waves.mjs failed:\n' + r.step10waves.stdout + r.step10waves.stderr);
    const wavesBody = m9Json(r.step10waves);
    assert.deepEqual(wavesBody.waves[0], [M9_CHANGE], 'wave 0 must contain m9-probe pre-implementation');
    assert.equal(r.step10contract.status, 0, 'contract.mjs failed:\n' + r.step10contract.stdout + r.step10contract.stderr);
    const contractBody = m9Json(r.step10contract);
    assert.equal(contractBody.coherent, true, 'contract packet must be coherent');
    assert.ok(contractBody.contractHash, 'contract packet must carry a contractHash');
  });

  test('M9 step 11 — verify-change RED: FAIL expected pre-implementation', () => {
    noSetupError();
    assert.equal(r.step11.status, 1, 'verify-change must FAIL (exit 1) pre-implementation');
    const body = m9Json(r.step11);
    assert.equal(body.verdict, 'FAIL', 'pre-implementation verdict must be FAIL');
    assert.equal(body.structural.status, 'pending', 'structural status must be pending pre-implementation');
    assert.ok(r.verdictHash11, 'a FAIL verdict must still carry a verdictHash (data-only, always present)');
  });

  test('M9 step 12 — acceptance RED: Keystone 2 cases fail pre-implementation', () => {
    noSetupError();
    assert.equal(r.step12.status, 1, 'acceptance must be red (exit 1) pre-implementation');
    const body = m9Json(r.step12);
    assert.equal(body.results.length, 3, 'all 3 acceptance cases must be present');
    assert.ok(body.results.every((x) => x.pass === false), 'every acceptance case must fail pre-implementation (no %% src mapping yet)');
  });

  test('M9 step 16-red — orchestrate RED: dispatches the unbuilt change and reports its FAIL', () => {
    noSetupError();
    assert.equal(r.step16red.status, 1, 'orchestrate must exit non-zero while the change is unbuilt');
    const body = m9Json(r.step16red);
    assert.deepEqual(body.dispatched, [M9_CHANGE], 'orchestrate must dispatch the unbuilt change');
    assert.equal(body.verdicts[M9_CHANGE].verdict, 'FAIL', 'orchestrate must report the RED verdict');
    assert.ok(body.orchestrateHash, 'orchestrate must emit an orchestrateHash');
  });

  test('M9 step 13 — IMPLEMENT: real (non-dry) writeback lands the probe + %% src, idempotently', () => {
    noSetupError();
    assert.equal(r.step13.scaffold1.status, 0, 'scaffold --add-from-plan failed:\n' + r.step13.scaffold1.stdout + r.step13.scaffold1.stderr);
    assert.ok(r.step13.hasNode13, 'fragment must gain the new node');
    assert.equal(r.step13.hadSrcBeforeAppend, false, 'sanity: scaffold really does not emit %% src on its own');
    assert.ok(r.step13.hasSrc13, 'fragment must carry the %% src line (appended per build-checklist step 3)');
    assert.equal(r.step13.scaffold2.status, 0);
    assert.ok(r.step13.idempotent13, 'a second identical scaffold run must add nothing new');
  });

  test('M9 step 14 — RE-SYNC: bundle -> validate -> extract -> gate, run mid-loop', () => {
    noSetupError();
    assert.equal(r.step14.bundle14.status, 0, 'bundle.mjs failed:\n' + r.step14.bundle14.stderr);
    assert.ok(r.step14.bundleHasProbe14, 'regenerated bundle must contain the probe node (state__m9Probe)');
    assert.equal(r.step14.validate14.status, 0, 'regenerated bundle failed validation:\n' + r.step14.validate14.stdout + r.step14.validate14.stderr);
    assert.equal(r.step14.extract14.status, 0, 'extract.mjs failed:\n' + r.step14.extract14.stdout + r.step14.extract14.stderr);
    assert.equal(r.step14.gate14.status, 0, 'gate.mjs found drift after the implement + resync:\n' + r.step14.gate14.stdout + r.step14.gate14.stderr);
  });

  test('M9 step 15 — GREEN: the FAIL->PASS flip (acceptance + verify-change), the row M9 exists for', () => {
    noSetupError();
    assert.equal(r.step15acc.status, 0, 'acceptance must be green post-implementation:\n' + r.step15acc.stdout + r.step15acc.stderr);
    const accBody = m9Json(r.step15acc);
    assert.ok(accBody.results.every((x) => x.pass === true), 'every acceptance case must pass post-implementation');

    assert.equal(r.step15verify.status, 0, 'verify-change must PASS post-implementation:\n' + r.step15verify.stdout + r.step15verify.stderr);
    const verifyBody = m9Json(r.step15verify);
    assert.equal(verifyBody.verdict, 'PASS', 'post-implementation verdict must be PASS');
    assert.equal(verifyBody.behavioural.proven, true, 'behavioural contract must be proven, not just structural');
    assert.notEqual(r.verdictHash15, r.verdictHash11, 'verdictHash must flip: the verdict is a function of the code, not a fixed fixture');
  });

  test('M9 step 16-green — orchestrate GREEN: dispatches nothing; waves shows the change done', () => {
    noSetupError();
    assert.equal(r.step16green.status, 0, 'orchestrate must exit 0 once nothing is left to dispatch');
    const orchBody = m9Json(r.step16green);
    assert.deepEqual(orchBody.dispatched, [], 'orchestrate must dispatch nothing once the change is built');
    assert.equal(orchBody.summary.total, 0, 'summary.total must be 0 (a built change is never dispatched, by construction)');
    assert.ok(orchBody.orchestrateHash, 'orchestrate must emit an orchestrateHash');

    assert.equal(r.waves16green.status, 0);
    const wavesBody = m9Json(r.waves16green);
    assert.ok(wavesBody.done.includes(M9_CHANGE), 'waves.mjs must show m9-probe as done post-implementation');
  });

  test('M9 step 17 — replay: the PASS verdict is byte-deterministic across 5 runs, post-real-build', () => {
    noSetupError();
    assert.equal(r.step17.status, 0, 'replay must find the PASS verdict deterministic:\n' + r.step17.stdout + r.step17.stderr);
    const body = m9Json(r.step17);
    assert.equal(body.deterministic, true, 'the PASS verdict must replay byte-identically across 5 runs');
    assert.equal(body.distinctOutputs, 1, 'exactly one distinct stdout hash across 5 runs');
  });
});
