/* verify-change.test.mjs — acceptance for the closed-form verdict (node #2).
   Proves: a real implemented+contracted change verdicts PASS (structural built
   AND behavioural green), a pending change verdicts FAIL, the verdict is
   data-only with a valid hash, and emission is byte-deterministic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'contract', 'verify-change.mjs');

// M2b: NOVAKAI_ROOT is the emitter seam only — verdict events from these runs
// land in a scratch sink, never in the repo's real metrics log.
const SINK = mkdtempSync(join(tmpdir(), 'verify-change-metrics-'));
process.on('exit', () => rmSync(SINK, { recursive: true, force: true }));
const SINK_LOG = join(SINK, 'docs', 'novakai', 'metrics', 'session-log.jsonl');

function run(args) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NOVAKAI_ROOT: SINK },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('an implemented + contracted change verdicts PASS (structural built AND behavioural green)', () => {
  const r = run(['--change', 'frame-transform', '--json']);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'PASS');
  assert.equal(v.structural.status, 'built');
  assert.equal(v.behavioural.hasContract, true);
  assert.equal(v.behavioural.passed, v.behavioural.total);
  assert.equal(v.behavioural.total, 3);
});

test('a built but UNCONTRACTED change verdicts PASS_UNPROVEN (never a bare PASS)', () => {
  // fit-clamp is a structure-only built change with no behavioural contract.
  const r = run(['--change', 'fit-clamp', '--json']);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'PASS_UNPROVEN');
  assert.equal(v.structural.status, 'built');
  assert.equal(v.behavioural.hasContract, false);
  assert.equal(v.behavioural.proven, false);
});

test('a pending (unimplemented) change verdicts FAIL with exit 1', () => {
  const r = run(['--change', 'frame-node', '--json']);
  assert.equal(r.status, 1);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'FAIL');
  assert.equal(v.structural.status, 'pending');
});

test('the verdict is data-only with a valid content hash', () => {
  const r = run(['--change', 'frame-transform', '--json']);
  const v = JSON.parse(r.stdout);
  const { verdictHash, ...body } = v;
  assert.equal(hashOf(body), verdictHash);
  // data-only: no free-text / path / time fields leaked into the verdict
  assert.equal(JSON.stringify(v).includes('/'), false, 'verdict must contain no paths');
});

test('emission is byte-deterministic (same change -> identical bytes)', () => {
  const a = run(['--change', 'frame-transform', '--json']).stdout;
  const b = run(['--change', 'frame-transform', '--json']).stdout;
  assert.equal(a, b);
});

test('a missing change id is a hard error (exit 3)', () => {
  const r = run(['--change', 'no-such-change-xyz', '--json']);
  assert.equal(r.status, 3);
});

test('PASS_UNPROVEN exits 1 under --strict (JSON unchanged)', () => {
  const r = run(['--change', 'fit-clamp', '--json', '--strict']);
  assert.equal(r.status, 1);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'PASS_UNPROVEN');
});

test('PASS still exits 0 under --strict', () => {
  const r = run(['--change', 'frame-transform', '--json', '--strict']);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'PASS');
});

test('M2b: each verdict is metered to the side log; the canonical stdout stays byte-identical', () => {
  const before = existsSync(SINK_LOG) ? readFileSync(SINK_LOG, 'utf8').split('\n').filter(Boolean).length : 0;
  const a = run(['--change', 'fit-clamp', '--json']).stdout;
  const b = run(['--change', 'fit-clamp', '--json', '--strict']).stdout;
  assert.equal(a, b, 'telemetry must not perturb the deterministic verdict bytes');
  const lines = readFileSync(SINK_LOG, 'utf8').split('\n').filter(Boolean).slice(before).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.event, l.tool, l.verdict, l.strict]),
    [['verdict', 'verify-change', 'PASS_UNPROVEN', false], ['verdict', 'verify-change', 'PASS_UNPROVEN', true]]);
  assert.equal(lines[0].change, 'fit-clamp');
});

/* =====================================================================
   C5' — UI obligations via --e2e-report (opt-in). NO browser is ever
   spawned by these tests: a report is just a JSON file, hand-crafted here
   to the real shape (proven once against a genuine `playwright test
   --reporter=json` run of tests/e2e/design.spec.ts — same suites/specs/
   tests/results/ok/status fields).
   ===================================================================== */

const FRAME_TRANSFORM_TITLE = 'design draft lane: outcome -> just draft it -> toggle restructures the card -> confirm -> hand off -> persists';

/** A real public/plan.json, with frame-transform's `verification.journeys` set. */
function planWithJourneys(journeys) {
  const plan = JSON.parse(readFileSync(join(ROOT, 'public', 'plan.json'), 'utf8'));
  const c = plan.changes.find((x) => x.id === 'frame-transform');
  c.verification = { kind: 'visual', journeys };
  const dir = mkdtempSync(join(tmpdir(), 'verify-change-e2e-'));
  const p = join(dir, 'plan.json');
  writeFileSync(p, JSON.stringify(plan));
  return { planPath: p, dir };
}

/** Minimal playwright JSON-reporter shape (verified against a real run). */
function writeReport(dir, specs) {
  const p = join(dir, 'report.json');
  writeFileSync(p, JSON.stringify({
    suites: [{
      title: 'design.spec.ts',
      file: 'design.spec.ts',
      specs: specs.map((s) => ({
        title: s.title,
        file: s.file,
        ok: s.status === 'passed',
        tests: [{ results: [{ status: s.status }] }],
      })),
    }],
  }));
  return p;
}

test('--e2e-report: a green matching journey resolves ui.passed=1 and does not disturb PASS', () => {
  const { planPath, dir } = planWithJourneys([{ spec: 'tests/e2e/design.spec.ts', grep: 'draft it' }]);
  const reportPath = writeReport(dir, [{ file: 'design.spec.ts', title: FRAME_TRANSFORM_TITLE, status: 'passed' }]);
  const r = run(['--change', 'frame-transform', '--plan', planPath, '--json', '--e2e-report', reportPath]);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.deepEqual(v.ui, { total: 1, passed: 1, pending: 0 });
  assert.equal(v.verdict, 'PASS');
});

test('--e2e-report: a journey with no matching report entry is pending -> PASS_UNPROVEN (exit 0 without --strict)', () => {
  const { planPath, dir } = planWithJourneys([{ spec: 'tests/e2e/design.spec.ts', grep: 'no-such-title-xyz' }]);
  const reportPath = writeReport(dir, [{ file: 'design.spec.ts', title: FRAME_TRANSFORM_TITLE, status: 'passed' }]);
  const r = run(['--change', 'frame-transform', '--plan', planPath, '--json', '--e2e-report', reportPath]);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.deepEqual(v.ui, { total: 1, passed: 0, pending: 1 });
  assert.equal(v.verdict, 'PASS_UNPROVEN');
});

test('--e2e-report absent (journeys declared, no flag): all obligations pending -> PASS_UNPROVEN', () => {
  const { planPath } = planWithJourneys([{ spec: 'tests/e2e/design.spec.ts', grep: 'draft it' }]);
  const r = run(['--change', 'frame-transform', '--plan', planPath, '--json']);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.deepEqual(v.ui, { total: 1, passed: 0, pending: 1 });
  assert.equal(v.verdict, 'PASS_UNPROVEN');
});

test('--e2e-report: a matching FAILED result is neither passed nor pending — it forces verdict FAIL (exit 1, even without --strict)', () => {
  const { planPath, dir } = planWithJourneys([{ spec: 'tests/e2e/design.spec.ts', grep: 'draft it' }]);
  const reportPath = writeReport(dir, [{ file: 'design.spec.ts', title: FRAME_TRANSFORM_TITLE, status: 'failed' }]);
  const r = run(['--change', 'frame-transform', '--plan', planPath, '--json', '--e2e-report', reportPath]);
  assert.equal(r.status, 1);
  const v = JSON.parse(r.stdout);
  assert.deepEqual(v.ui, { total: 1, passed: 0, pending: 0 });
  assert.equal(v.verdict, 'FAIL');
});

test('a change with no verification block gets ui zeros and an unchanged verdict (fold identical to today)', () => {
  const a = JSON.parse(run(['--change', 'frame-transform', '--json']).stdout);
  assert.deepEqual(a.ui, { total: 0, passed: 0, pending: 0 });
  assert.equal(a.verdict, 'PASS');
  const b = JSON.parse(run(['--change', 'fit-clamp', '--json']).stdout);
  assert.deepEqual(b.ui, { total: 0, passed: 0, pending: 0 });
  assert.equal(b.verdict, 'PASS_UNPROVEN');
});

test('--e2e-report on a change with no verification block is a no-op: stdout byte-identical to not passing it', () => {
  const a = run(['--change', 'fit-clamp', '--json']).stdout;
  const b = run(['--change', 'fit-clamp', '--json', '--e2e-report', '/nonexistent-report-file.json']).stdout;
  assert.equal(a, b);
});

/* =====================================================================
   C6' — scopeDrift via --drift-base/--drift-out (opt-in pair). Verified
   FIRST against the real repo (no fixture needed: the pairing check and
   the stdout-identity claim hold regardless of what the diff contains),
   THEN against a throwaway scratch git repo for drift CONTENT (frozenHit,
   warn vs frozen vs allow-omitted) — mutating the real worktree, even
   transiently, is unsafe (parallel subagents may share it).
   ===================================================================== */

test('--drift-base without --drift-out (or the reverse) is a bad invocation: exit 2', () => {
  const a = run(['--change', 'frame-transform', '--json', '--drift-base', 'HEAD']);
  assert.equal(a.status, 2);
  const b = run(['--change', 'frame-transform', '--json', '--drift-out', join(tmpdir(), 'verify-change-drift-orphan.json')]);
  assert.equal(b.status, 2);
});

test('stdout is byte-identical with vs without --drift-base/--drift-out (drift never enters the hashed verdict body)', () => {
  const noFlags = run(['--change', 'frame-transform', '--json']);
  const driftOut = join(mkdtempSync(join(tmpdir(), 'verify-change-drift-stdout-')), 'drift.json');
  const withFlags = run(['--change', 'frame-transform', '--json', '--drift-base', 'HEAD', '--drift-out', driftOut]);
  assert.equal(noFlags.stdout, withFlags.stdout);
  assert.equal(JSON.stringify(JSON.parse(withFlags.stdout)).includes('drift'), false, 'no drift key leaks into the verdict body');
});

/** A throwaway git repo: a full filesystem copy of ROOT (working-tree state,
 *  not just HEAD — a plain `git worktree add` only checks out committed
 *  history, which would miss this change's own not-yet-committed files),
 *  re-initialised as its own repo with one base commit. Self-contained;
 *  never touches ROOT's git state. */
function makeDriftRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-change-drift-repo-'));
  const rs = spawnSync('rsync', [
    '-a', '--exclude=.git', '--exclude=node_modules', '--exclude=test-results', '--exclude=playwright-report',
    ROOT + '/', dir + '/',
  ], { encoding: 'utf8' });
  assert.equal(rs.status, 0, 'rsync fixture copy failed: ' + rs.stderr);
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir'); // status.mjs needs ts-morph
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'base'], { cwd: dir, encoding: 'utf8' });
  return dir;
}

const DRIFT_REPO = makeDriftRepo();
process.on('exit', () => rmSync(DRIFT_REPO, { recursive: true, force: true }));

function runInDriftRepo(args) {
  const r = spawnSync('node', [join(DRIFT_REPO, 'tools', 'novakai', 'contract', 'verify-change.mjs'), ...args],
    { cwd: DRIFT_REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function resetDriftRepo() {
  spawnSync('git', ['checkout', '--', '.'], { cwd: DRIFT_REPO });
}

test('drift: a FROZEN file classifies "frozen" (frozenHit true); a non-scope file classifies "warn"', () => {
  resetDriftRepo();
  writeFileSync(join(DRIFT_REPO, 'src', 'main.ts'), readFileSync(join(DRIFT_REPO, 'src', 'main.ts'), 'utf8') + '\n// drift-test\n');
  writeFileSync(join(DRIFT_REPO, 'tools', 'novakai', 'contract', 'replay.mjs'), readFileSync(join(DRIFT_REPO, 'tools', 'novakai', 'contract', 'replay.mjs'), 'utf8') + '\n// drift-test\n');
  const driftOutPath = join(DRIFT_REPO, 'drift-out-frozen.json');
  const r = runInDriftRepo(['--change', 'frame-transform', '--drift-base', 'HEAD', '--drift-out', driftOutPath, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const drift = JSON.parse(readFileSync(driftOutPath, 'utf8'));
  assert.equal(drift.frozenHit, true);
  const byPath = Object.fromEntries(drift.files.map((f) => [f.path, f.class]));
  assert.equal(byPath['src/main.ts'], 'frozen');
  assert.equal(byPath['tools/novakai/contract/replay.mjs'], 'warn');
  const { driftHash, ...body } = drift;
  assert.equal(hashOf(body), driftHash, 'driftHash is the recomputable content hash of the rest of the report');
  resetDriftRepo();
});

test('drift: a file inside the change\'s own editScope.allow is omitted from files[] and never trips frozenHit', () => {
  resetDriftRepo();
  const ownFile = join(DRIFT_REPO, 'src', 'core', 'state', 'state.ts');
  writeFileSync(ownFile, readFileSync(ownFile, 'utf8') + '\n// drift-test\n');
  const driftOutPath = join(DRIFT_REPO, 'drift-out-allow.json');
  const r = runInDriftRepo(['--change', 'frame-transform', '--drift-base', 'HEAD', '--drift-out', driftOutPath, '--json']);
  assert.equal(r.status, 0, r.stderr);
  const drift = JSON.parse(readFileSync(driftOutPath, 'utf8'));
  assert.equal(drift.frozenHit, false);
  assert.equal(drift.files.length, 0, 'own-scope edits are in-allow, never reported as drift');
  resetDriftRepo();
});

test('drift: --strict + a frozen/warn finding exits 1; the identical finding without --strict exits 0 (warn-level, not blocking)', () => {
  resetDriftRepo();
  writeFileSync(join(DRIFT_REPO, 'src', 'main.ts'), readFileSync(join(DRIFT_REPO, 'src', 'main.ts'), 'utf8') + '\n// drift-test\n');
  const nonStrict = runInDriftRepo(['--change', 'frame-transform', '--drift-base', 'HEAD', '--drift-out', join(DRIFT_REPO, 'drift-out-ns.json'), '--json']);
  assert.equal(nonStrict.status, 0);
  const strict = runInDriftRepo(['--change', 'frame-transform', '--drift-base', 'HEAD', '--drift-out', join(DRIFT_REPO, 'drift-out-s.json'), '--json', '--strict']);
  assert.equal(strict.status, 1);
  assert.equal(nonStrict.stdout, strict.stdout, 'the verdict body is identical; only the exit code differs under --strict');
  resetDriftRepo();
});
