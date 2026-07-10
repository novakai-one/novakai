/* metrics.test.mjs — M2b: the summarizer + ship-run recorder, via the real
   spawned CLI against hermetic NOVAKAI_ROOT fixtures (the gate-test pattern).
   Locks the design's failure semantics: exit 0 on absent/empty log (graceful
   n/a — the reader is never itself a gate), malformed lines skip+count without
   touching the exit code, 0/0 is null/"n/a" (never a fake 0%), and `wrap` is
   invisible to callers (child exit code / signal pass through). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const METRICS_SOURCE = 'metrics.mjs';
const CLI = join('tools', 'novakai', 'status', METRICS_SOURCE);
const LOG_REL = join('docs', 'novakai', 'metrics', 'session-log.jsonl');

function cli(args, env = {}) {
  const result = spawnSync('node', [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: result.status, signal: result.signal, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function mkroot(lines = null) {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-'));
  if (lines !== null) {
    mkdirSync(join(dir, 'docs', 'novakai', 'metrics'), { recursive: true });
    writeFileSync(join(dir, LOG_REL), lines.length ? lines.join('\n') + '\n' : '');
  }
  return dir;
}

const mkEvent = (overrides) =>
  JSON.stringify({ 'v': 1, 'ts': '2026-07-03T10:00:00.000Z', session: null, ...overrides });

/** Every rate must be null (n/a), never a fake 0, when there are no events yet. */
function assertAllRatesNull(summary) {
  assert.equal(summary.quiz.passRate, null, '0/0 must be null, never a fake 0');
  assert.equal(summary.ship.okRate, null);
  assert.equal(summary.cert.passRate, null);
  assert.equal(summary.verify.unprovenRatio, null);
}

/** quiz/gate/ship portion of the "four intent metrics" fixture: 2 quiz, 2 edit-gate,
    1 contract gate, 2 ship (1 completed, 1 aborted). */
function quizGateShipLines() {
  return [
    mkEvent({ event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true, score: '12/12' }),
    mkEvent({ event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: false, score: '9/12' }),
    mkEvent({ event: 'gate', source: 'edit-gate.mjs', gate: 'edit', decision: 'allow' }),
    mkEvent({ event: 'gate', source: 'edit-gate.mjs', gate: 'edit', decision: 'deny', reason: 'no quiz pass' }),
    mkEvent({ event: 'gate', source: 'contract-gate.mjs', gate: 'contract', decision: 'allow' }),
    mkEvent({ event: 'ship', source: METRICS_SOURCE, phase: 'start' }),
    mkEvent({ event: 'ship', source: METRICS_SOURCE, phase: 'end', 'ok': true, durationMs: 1000 }),
    mkEvent({ event: 'ship', source: METRICS_SOURCE, phase: 'start' }), // aborted: no end
  ];
}

/** verdict + unknown-event portion of the "four intent metrics" fixture: 2 verify-change,
    2 plan-cert, 1 unknown event (must land in "other", never crash). */
function verdictLines() {
  return [
    mkEvent({
      event: 'verdict', source: 'verify-change.mjs', tool: 'verify-change',
      verdict: 'PASS', change: 'C1', strict: false,
    }),
    mkEvent({
      event: 'verdict', source: 'verify-change.mjs', tool: 'verify-change',
      verdict: 'PASS_UNPROVEN', change: 'C2', strict: false,
    }),
    mkEvent({ event: 'verdict', source: 'plan-cert.mjs', tool: 'plan-cert', verdict: 'PASS' }),
    mkEvent({ event: 'verdict', source: 'plan-cert.mjs', tool: 'plan-cert', verdict: 'FAIL' }),
    mkEvent({ event: 'mystery', source: 'future-tool.mjs' }), // unknown event -> "other", never a crash
  ];
}

/** The 13-event fixture log for the "four intent metrics" test. */
function wellFormedLogLines() {
  return [...quizGateShipLines(), ...verdictLines()];
}

function assertQuizAndGateMetrics(summary) {
  assert.equal(summary.totalEvents, 13);
  assert.deepEqual({ attempts: summary.quiz.attempts, passes: summary.quiz.passes }, { attempts: 2, passes: 1 });
  assert.equal(summary.quiz.passRate, 0.5);
  assert.equal(summary.gates.edit.allow, 1);
  assert.equal(summary.gates.edit.deny, 1);
  assert.equal(summary.gates.contract.allow, 1);
  assert.equal(summary.gates.plan.deny, 0, 'the fixed gate taxonomy is always present');
}

function assertShipCertVerifyMetrics(summary) {
  assert.deepEqual({ runs: summary.ship.runs, completed: summary.ship.completed, aborted: summary.ship.aborted },
    { runs: 2, completed: 1, aborted: 1 }, 'an unmatched start is REPORTED as aborted, not hidden');
  assert.equal(summary.ship.okRate, 1);
  assert.equal(summary.ship.medianDurationMs, 1000);
  assert.deepEqual({ total: summary.cert.total, pass: summary.cert.pass }, { total: 2, pass: 1 });
  assert.equal(summary.cert.passRate, 0.5);
  assert.deepEqual(
    { total: summary.verify.total, passUnproven: summary.verify.passUnproven },
    { total: 2, passUnproven: 1 },
  );
  assert.equal(summary.verify.unprovenRatio, 0.5);
  assert.equal(summary.other, 1);
}

test('usage: no subcommand / unknown subcommand exit 2', () => {
  assert.equal(cli([]).status, 2);
  assert.equal(cli(['frobnicate']).status, 2);
});

test('summary on NO log: exit 0, every rate is null (n/a), zero events', () => {
  const dir = mkroot(null);
  try {
    const result = cli(['summary', '--json'], { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.totalEvents, 0);
    assertAllRatesNull(summary);
    const human = cli(['summary'], { NOVAKAI_ROOT: dir });
    assert.equal(human.status, 0);
    assert.match(human.stdout, /n\/a/, 'human mode renders 0/0 as n/a');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M10: summary appends a best-effort "turn discipline" section; n/a when the fixture ' +
  'root has no transcripts, exit code untouched', () => {
  const dir = mkroot(null);
  try {
    const result = cli(['summary'], { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /turn discipline: n\/a \(no transcripts\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('summary on EMPTY log file: exit 0, all n/a', () => {
  const dir = mkroot([]);
  try {
    const result = cli(['summary', '--json'], { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).totalEvents, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('summary on a well-formed log computes the four intent metrics', () => {
  const dir = mkroot(wellFormedLogLines());
  try {
    const result = cli(['summary', '--json'], { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0, result.stderr);
    const summary = JSON.parse(result.stdout);
    assertQuizAndGateMetrics(summary);
    assertShipCertVerifyMetrics(summary);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed lines: skipped and COUNTED, exit code untouched', () => {
  const dir = mkroot([
    mkEvent({ event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true }),
    '{"torn line that never finish',
    'not json at all',
    mkEvent({ event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true }),
  ]);
  try {
    const result = cli(['summary', '--json'], { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0, 'a summarizer that dies on one torn line hides every other metric');
    const summary = JSON.parse(result.stdout);
    assert.equal(summary.malformed, 2);
    assert.equal(summary.quiz.attempts, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('windowing: --since keeps events at/after the instant; --last N keeps the last N', () => {
  const mkEventAt = (timestamp, overrides) =>
    JSON.stringify({ 'v': 1, 'ts': timestamp, session: null, ...overrides });
  const dir = mkroot([
    mkEventAt('2026-07-01T00:00:00.000Z', { event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: false }),
    mkEventAt('2026-07-02T00:00:00.000Z', { event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true }),
    mkEventAt('2026-07-03T00:00:00.000Z', { event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true }),
  ]);
  try {
    const since = JSON.parse(
      cli(['summary', '--json', '--since', '2026-07-02T00:00:00.000Z'], { NOVAKAI_ROOT: dir }).stdout,
    );
    assert.equal(since.quiz.attempts, 2, '--since is inclusive of the instant');
    assert.equal(since.quiz.passRate, 1);
    const last = JSON.parse(cli(['summary', '--json', '--last', '1'], { NOVAKAI_ROOT: dir }).stdout);
    assert.equal(last.quiz.attempts, 1);
    const human = cli(['summary', '--last', '1'], { NOVAKAI_ROOT: dir });
    assert.match(human.stdout, /last 1/, 'the active window is echoed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('usage: an unparseable --since is a usage error (exit 2)', () => {
  const dir = mkroot([]);
  try {
    assert.equal(cli(['summary', '--since', 'not-a-date'], { NOVAKAI_ROOT: dir }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('log present but unreadable at the FILE level: exit 1', () => {
  const dir = mkroot(null);
  try {
    mkdirSync(join(dir, LOG_REL), { recursive: true }); // a directory where the file should be
    assert.equal(cli(['summary'], { NOVAKAI_ROOT: dir }).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wrap: transparent on success — child exit 0 passes through, start/end pair recorded', () => {
  const dir = mkroot(null);
  try {
    const result = cli(['wrap', '--event', 'ship', '--', 'node', '-e', 'process.exit(0)'], { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0);
    const lines = readFileSync(join(dir, LOG_REL), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(lines.length, 2);
    assert.deepEqual({ event: lines[0].event, phase: lines[0].phase }, { event: 'ship', phase: 'start' });
    assert.equal(lines[1].phase, 'end');
    assert.equal(lines[1].ok, true);
    assert.equal(typeof lines[1].durationMs, 'number');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wrap: transparent on failure — child exit 1 passes through, end records ok:false', () => {
  const dir = mkroot(null);
  try {
    const result = cli(['wrap', '--event', 'ship', '--', 'node', '-e', 'process.exit(1)'], { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 1, 'callers cannot tell the wrapper is there');
    const lines = readFileSync(join(dir, LOG_REL), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(lines[1].ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wrap: a KILLED child terminates the wrapper by the same signal (end still recorded)', () => {
  const dir = mkroot(null);
  try {
    const result = cli(
      ['wrap', '--event', 'ship', '--', 'node', '-e', 'process.kill(process.pid, "SIGTERM")'],
      { NOVAKAI_ROOT: dir },
    );
    assert.equal(result.signal, 'SIGTERM', 'signal transparency, not a laundered exit code');
    const lines = readFileSync(join(dir, LOG_REL), 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(lines.length, 2, 'the end line is recorded before the wrapper re-raises');
    assert.equal(lines[1].ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wrap usage: missing -- command is exit 2 (nothing recorded)', () => {
  const dir = mkroot(null);
  try {
    assert.equal(cli(['wrap', '--event', 'ship'], { NOVAKAI_ROOT: dir }).status, 2);
    assert.equal(cli(['wrap', '--event', 'ship', '--'], { NOVAKAI_ROOT: dir }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
