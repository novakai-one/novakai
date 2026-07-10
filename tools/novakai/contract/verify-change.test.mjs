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

// Repeated literals, hoisted once (sonarjs/no-duplicate-string).
const CHANGE_ID = 'frame-transform';
const DESIGN_SPEC_FILE = 'design.spec.ts';
const DESIGN_SPEC_PATH = 'tests/e2e/design.spec.ts';
const E2E_REPORT_FLAG = '--e2e-report';
const DRIFT_BASE_FLAG = '--drift-base';
const DRIFT_OUT_FLAG = '--drift-out';
const DRIFT_MARKER = '\n// drift-test\n';

// M2b: NOVAKAI_ROOT is the emitter seam only — verdict events from these runs
// land in a scratch sink, never in the repo's real metrics log.
const SINK = mkdtempSync(join(tmpdir(), 'verify-change-metrics-'));
process.on('exit', () => rmSync(SINK, { recursive: true, force: true }));
const SINK_LOG = join(SINK, 'docs', 'novakai', 'metrics', 'session-log.jsonl');

function run(args) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NOVAKAI_ROOT: SINK },
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

test('an implemented + contracted change verdicts PASS (structural built AND behavioural green)', () => {
  const result = run(['--change', CHANGE_ID, '--json']);
  assert.equal(result.status, 0);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'PASS');
  assert.equal(verdict.structural.status, 'built');
  assert.equal(verdict.behavioural.hasContract, true);
  assert.equal(verdict.behavioural.passed, verdict.behavioural.total);
  assert.equal(verdict.behavioural.total, 3);
});

test('a built but UNCONTRACTED change verdicts PASS_UNPROVEN (never a bare PASS)', () => {
  // fit-clamp is a structure-only built change with no behavioural contract.
  const result = run(['--change', 'fit-clamp', '--json']);
  assert.equal(result.status, 0);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'PASS_UNPROVEN');
  assert.equal(verdict.structural.status, 'built');
  assert.equal(verdict.behavioural.hasContract, false);
  assert.equal(verdict.behavioural.proven, false);
});

test('a pending (unimplemented) change verdicts FAIL with exit 1', () => {
  const result = run(['--change', 'frame-node', '--json']);
  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'FAIL');
  assert.equal(verdict.structural.status, 'pending');
});

test('the verdict is data-only with a valid content hash', () => {
  const result = run(['--change', CHANGE_ID, '--json']);
  const verdict = JSON.parse(result.stdout);
  const { verdictHash, ...body } = verdict;
  assert.equal(hashOf(body), verdictHash);
  // data-only: no free-text / path / time fields leaked into the verdict
  assert.equal(JSON.stringify(verdict).includes('/'), false, 'verdict must contain no paths');
});

test('emission is byte-deterministic (same change -> identical bytes)', () => {
  const first = run(['--change', CHANGE_ID, '--json']).stdout;
  const second = run(['--change', CHANGE_ID, '--json']).stdout;
  assert.equal(first, second);
});

test('a missing change id is a hard error (exit 3)', () => {
  const result = run(['--change', 'no-such-change-xyz', '--json']);
  assert.equal(result.status, 3);
});

test('PASS_UNPROVEN exits 1 under --strict (JSON unchanged)', () => {
  const result = run(['--change', 'fit-clamp', '--json', '--strict']);
  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'PASS_UNPROVEN');
});

test('PASS still exits 0 under --strict', () => {
  const result = run(['--change', CHANGE_ID, '--json', '--strict']);
  assert.equal(result.status, 0);
  const verdict = JSON.parse(result.stdout);
  assert.equal(verdict.verdict, 'PASS');
});

test('M2b: each verdict is metered to the side log; the canonical stdout stays byte-identical', () => {
  const before = existsSync(SINK_LOG) ? readFileSync(SINK_LOG, 'utf8').split('\n').filter(Boolean).length : 0;
  const first = run(['--change', 'fit-clamp', '--json']).stdout;
  const second = run(['--change', 'fit-clamp', '--json', '--strict']).stdout;
  assert.equal(first, second, 'telemetry must not perturb the deterministic verdict bytes');
  const lines = readFileSync(SINK_LOG, 'utf8').split('\n').filter(Boolean).slice(before)
    .map((line) => JSON.parse(line));
  assert.deepEqual(lines.map((line) => [line.event, line.tool, line.verdict, line.strict]),
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

const FRAME_TRANSFORM_TITLE = 'design draft lane: outcome -> just draft it -> toggle restructures the card '
  + '-> confirm -> hand off -> persists';

/** A real public/plan.json, with frame-transform's `verification.journeys` set. */
function planWithJourneys(journeys) {
  const plan = JSON.parse(readFileSync(join(ROOT, 'public', 'plan.json'), 'utf8'));
  const changeEntry = plan.changes.find((candidate) => candidate.id === CHANGE_ID);
  changeEntry.verification = { kind: 'visual', journeys };
  const dir = mkdtempSync(join(tmpdir(), 'verify-change-e2e-'));
  const planFilePath = join(dir, 'plan.json');
  writeFileSync(planFilePath, JSON.stringify(plan));
  return { planPath: planFilePath, dir };
}

/** Minimal playwright JSON-reporter shape (verified against a real run). */
function writeReport(dir, specs) {
  const reportFilePath = join(dir, 'report.json');
  writeFileSync(reportFilePath, JSON.stringify({
    suites: [{
      title: DESIGN_SPEC_FILE,
      file: DESIGN_SPEC_FILE,
      specs: specs.map((spec) => ({
        title: spec.title,
        file: spec.file,
        'ok': spec.status === 'passed',
        tests: [{ results: [{ status: spec.status }] }],
      })),
    }],
  }));
  return reportFilePath;
}

test('--e2e-report: a green matching journey resolves ui.passed=1 and does not disturb PASS', () => {
  const { planPath, dir } = planWithJourneys([{ spec: DESIGN_SPEC_PATH, grep: 'draft it' }]);
  const reportPath = writeReport(dir, [{ file: DESIGN_SPEC_FILE, title: FRAME_TRANSFORM_TITLE, status: 'passed' }]);
  const result = run(['--change', CHANGE_ID, '--plan', planPath, '--json', E2E_REPORT_FLAG, reportPath]);
  assert.equal(result.status, 0);
  const verdict = JSON.parse(result.stdout);
  assert.deepEqual(verdict.ui, { total: 1, passed: 1, pending: 0 });
  assert.equal(verdict.verdict, 'PASS');
});

test(
  '--e2e-report: a journey with no matching report entry is pending -> PASS_UNPROVEN (exit 0 without --strict)',
  () => {
  const { planPath, dir } = planWithJourneys([{ spec: DESIGN_SPEC_PATH, grep: 'no-such-title-xyz' }]);
  const reportPath = writeReport(dir, [{ file: DESIGN_SPEC_FILE, title: FRAME_TRANSFORM_TITLE, status: 'passed' }]);
  const result = run(['--change', CHANGE_ID, '--plan', planPath, '--json', E2E_REPORT_FLAG, reportPath]);
  assert.equal(result.status, 0);
  const verdict = JSON.parse(result.stdout);
  assert.deepEqual(verdict.ui, { total: 1, passed: 0, pending: 1 });
  assert.equal(verdict.verdict, 'PASS_UNPROVEN');
  },
);

test('--e2e-report absent (journeys declared, no flag): all obligations pending -> PASS_UNPROVEN', () => {
  const { planPath } = planWithJourneys([{ spec: DESIGN_SPEC_PATH, grep: 'draft it' }]);
  const result = run(['--change', CHANGE_ID, '--plan', planPath, '--json']);
  assert.equal(result.status, 0);
  const verdict = JSON.parse(result.stdout);
  assert.deepEqual(verdict.ui, { total: 1, passed: 0, pending: 1 });
  assert.equal(verdict.verdict, 'PASS_UNPROVEN');
});

test(
  '--e2e-report: a matching FAILED result is neither passed nor pending — it forces verdict FAIL '
  + '(exit 1, even without --strict)',
  () => {
  const { planPath, dir } = planWithJourneys([{ spec: DESIGN_SPEC_PATH, grep: 'draft it' }]);
  const reportPath = writeReport(dir, [{ file: DESIGN_SPEC_FILE, title: FRAME_TRANSFORM_TITLE, status: 'failed' }]);
  const result = run(['--change', CHANGE_ID, '--plan', planPath, '--json', E2E_REPORT_FLAG, reportPath]);
  assert.equal(result.status, 1);
  const verdict = JSON.parse(result.stdout);
  assert.deepEqual(verdict.ui, { total: 1, passed: 0, pending: 0 });
  assert.equal(verdict.verdict, 'FAIL');
  },
);

test('a change with no verification block gets ui zeros and an unchanged verdict (fold identical to today)', () => {
  const frameVerdict = JSON.parse(run(['--change', CHANGE_ID, '--json']).stdout);
  assert.deepEqual(frameVerdict.ui, { total: 0, passed: 0, pending: 0 });
  assert.equal(frameVerdict.verdict, 'PASS');
  const fitClampVerdict = JSON.parse(run(['--change', 'fit-clamp', '--json']).stdout);
  assert.deepEqual(fitClampVerdict.ui, { total: 0, passed: 0, pending: 0 });
  assert.equal(fitClampVerdict.verdict, 'PASS_UNPROVEN');
});

test('--e2e-report on a change with no verification block is a no-op: stdout byte-identical to not passing it', () => {
  const first = run(['--change', 'fit-clamp', '--json']).stdout;
  const second = run(['--change', 'fit-clamp', '--json', E2E_REPORT_FLAG, '/nonexistent-report-file.json']).stdout;
  assert.equal(first, second);
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
  const missingOut = run(['--change', CHANGE_ID, '--json', DRIFT_BASE_FLAG, 'HEAD']);
  assert.equal(missingOut.status, 2);
  const orphanOutPath = join(tmpdir(), 'verify-change-drift-orphan.json');
  const missingBase = run(['--change', CHANGE_ID, '--json', DRIFT_OUT_FLAG, orphanOutPath]);
  assert.equal(missingBase.status, 2);
});

test(
  'stdout is byte-identical with vs without --drift-base/--drift-out (drift never enters the hashed verdict body)',
  () => {
  const noFlags = run(['--change', CHANGE_ID, '--json']);
  const driftOut = join(mkdtempSync(join(tmpdir(), 'verify-change-drift-stdout-')), 'drift.json');
  const withFlags = run(['--change', CHANGE_ID, '--json', DRIFT_BASE_FLAG, 'HEAD', DRIFT_OUT_FLAG, driftOut]);
  assert.equal(noFlags.stdout, withFlags.stdout);
  assert.equal(
    JSON.stringify(JSON.parse(withFlags.stdout)).includes('drift'), false, 'no drift key leaks into the verdict body',
  );
  },
);

/** A throwaway git repo: a full filesystem copy of ROOT (working-tree state,
 *  not just HEAD — a plain `git worktree add` only checks out committed
 *  history, which would miss this change's own not-yet-committed files),
 *  re-initialised as its own repo with one base commit. Self-contained;
 *  never touches ROOT's git state. */
function makeDriftRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'verify-change-drift-repo-'));
  const rsyncResult = spawnSync('rsync', [
    '-a', '--exclude=.git', '--exclude=node_modules', '--exclude=test-results', '--exclude=playwright-report',
    ROOT + '/', dir + '/',
  ], { encoding: 'utf8' });
  assert.equal(rsyncResult.status, 0, 'rsync fixture copy failed: ' + rsyncResult.stderr);
  symlinkSync(join(ROOT, 'node_modules'), join(dir, 'node_modules'), 'dir'); // status.mjs needs ts-morph
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['add', '-A'], { cwd: dir });
  spawnSync('git', ['-c', 'user.email=t@t.com', '-c', 'user.name=t', 'commit', '-q', '-m', 'base'], {
    cwd: dir, encoding: 'utf8',
  });
  return dir;
}

const DRIFT_REPO = makeDriftRepo();
process.on('exit', () => rmSync(DRIFT_REPO, { recursive: true, force: true }));

function runInDriftRepo(args) {
  const result = spawnSync('node', [join(DRIFT_REPO, 'tools', 'novakai', 'contract', 'verify-change.mjs'), ...args],
    { cwd: DRIFT_REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function resetDriftRepo() {
  spawnSync('git', ['checkout', '--', '.'], { cwd: DRIFT_REPO });
}

/** Append DRIFT_MARKER to an existing file in DRIFT_REPO, so it shows up in `git diff`. */
function touchFile(path) {
  writeFileSync(path, readFileSync(path, 'utf8') + DRIFT_MARKER);
}

/** Run verify-change.mjs with --drift-base/--drift-out wired to driftOutPath, then read the report back. */
function runDrift(driftOutPath, extraArgs = []) {
  const result = runInDriftRepo([
    '--change', CHANGE_ID, DRIFT_BASE_FLAG, 'HEAD', DRIFT_OUT_FLAG, driftOutPath, '--json', ...extraArgs,
  ]);
  const drift = JSON.parse(readFileSync(driftOutPath, 'utf8'));
  return { result, drift };
}

test('drift: a FROZEN file classifies "frozen" (frozenHit true); a non-scope file classifies "warn"', () => {
  resetDriftRepo();
  touchFile(join(DRIFT_REPO, 'src', 'main.ts'));
  touchFile(join(DRIFT_REPO, 'tools', 'novakai', 'contract', 'replay.mjs'));
  const { result, drift } = runDrift(join(DRIFT_REPO, 'drift-out-frozen.json'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(drift.frozenHit, true);
  const byPath = Object.fromEntries(drift.files.map((entry) => [entry.path, entry.class]));
  assert.deepEqual(byPath, { 'src/main.ts': 'frozen', 'tools/novakai/contract/replay.mjs': 'warn' });
  const { driftHash, ...body } = drift;
  assert.equal(hashOf(body), driftHash, 'driftHash is the recomputable content hash of the rest of the report');
  resetDriftRepo();
});

test('drift: a file inside the change\'s own editScope.allow is omitted from files[] and never trips frozenHit', () => {
  resetDriftRepo();
  const ownFile = join(DRIFT_REPO, 'src', 'core', 'state', 'state.ts');
  touchFile(ownFile);
  const { result, drift } = runDrift(join(DRIFT_REPO, 'drift-out-allow.json'));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(drift.frozenHit, false);
  assert.equal(drift.files.length, 0, 'own-scope edits are in-allow, never reported as drift');
  resetDriftRepo();
});

test(
  'drift: --strict + a frozen/warn finding exits 1; the identical finding without --strict exits 0 '
  + '(warn-level, not blocking)',
  () => {
  resetDriftRepo();
  touchFile(join(DRIFT_REPO, 'src', 'main.ts'));
  const { result: nonStrict } = runDrift(join(DRIFT_REPO, 'drift-out-ns.json'));
  assert.equal(nonStrict.status, 0);
  const { result: strict } = runDrift(join(DRIFT_REPO, 'drift-out-s.json'), ['--strict']);
  assert.equal(strict.status, 1);
  assert.equal(
    nonStrict.stdout, strict.stdout, 'the verdict body is identical; only the exit code differs under --strict',
  );
  resetDriftRepo();
  },
);
