/* metrics.test.mjs — M2b: the summarizer + ship-run recorder, via the real
   spawned CLI against hermetic FLOWMAP_ROOT fixtures (the gate-test pattern).
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
const CLI = join('tools', 'flowmap', 'status', 'metrics.mjs');
const LOG_REL = join('docs', 'flowmap', 'metrics', 'session-log.jsonl');

function cli(args, env = {}) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: r.status, signal: r.signal, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function mkroot(lines = null) {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-'));
  if (lines !== null) {
    mkdirSync(join(dir, 'docs', 'flowmap', 'metrics'), { recursive: true });
    writeFileSync(join(dir, LOG_REL), lines.length ? lines.join('\n') + '\n' : '');
  }
  return dir;
}

const ev = (o) => JSON.stringify({ v: 1, ts: '2026-07-03T10:00:00.000Z', session: null, ...o });

test('usage: no subcommand / unknown subcommand exit 2', () => {
  assert.equal(cli([]).status, 2);
  assert.equal(cli(['frobnicate']).status, 2);
});

test('summary on NO log: exit 0, every rate is null (n/a), zero events', () => {
  const dir = mkroot(null);
  try {
    const r = cli(['summary', '--json'], { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(r.stdout);
    assert.equal(s.totalEvents, 0);
    assert.equal(s.quiz.passRate, null, '0/0 must be null, never a fake 0');
    assert.equal(s.ship.okRate, null);
    assert.equal(s.cert.passRate, null);
    assert.equal(s.verify.unprovenRatio, null);
    const human = cli(['summary'], { FLOWMAP_ROOT: dir });
    assert.equal(human.status, 0);
    assert.match(human.stdout, /n\/a/, 'human mode renders 0/0 as n/a');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M10: summary appends a best-effort "turn discipline" section; n/a when the fixture root has no transcripts, exit code untouched', () => {
  const dir = mkroot(null);
  try {
    const r = cli(['summary'], { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /turn discipline: n\/a \(no transcripts\)/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('summary on EMPTY log file: exit 0, all n/a', () => {
  const dir = mkroot([]);
  try {
    const r = cli(['summary', '--json'], { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).totalEvents, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('summary on a well-formed log computes the four intent metrics', () => {
  const dir = mkroot([
    ev({ event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true, score: '12/12' }),
    ev({ event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: false, score: '9/12' }),
    ev({ event: 'gate', source: 'edit-gate.mjs', gate: 'edit', decision: 'allow' }),
    ev({ event: 'gate', source: 'edit-gate.mjs', gate: 'edit', decision: 'deny', reason: 'no quiz pass' }),
    ev({ event: 'gate', source: 'contract-gate.mjs', gate: 'contract', decision: 'allow' }),
    ev({ event: 'ship', source: 'metrics.mjs', phase: 'start' }),
    ev({ event: 'ship', source: 'metrics.mjs', phase: 'end', ok: true, durationMs: 1000 }),
    ev({ event: 'ship', source: 'metrics.mjs', phase: 'start' }), // aborted: no end
    ev({ event: 'verdict', source: 'verify-change.mjs', tool: 'verify-change', verdict: 'PASS', change: 'C1', strict: false }),
    ev({ event: 'verdict', source: 'verify-change.mjs', tool: 'verify-change', verdict: 'PASS_UNPROVEN', change: 'C2', strict: false }),
    ev({ event: 'verdict', source: 'plan-cert.mjs', tool: 'plan-cert', verdict: 'PASS' }),
    ev({ event: 'verdict', source: 'plan-cert.mjs', tool: 'plan-cert', verdict: 'FAIL' }),
    ev({ event: 'mystery', source: 'future-tool.mjs' }), // unknown event -> "other", never a crash
  ]);
  try {
    const r = cli(['summary', '--json'], { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stderr);
    const s = JSON.parse(r.stdout);
    assert.equal(s.totalEvents, 13);
    assert.deepEqual({ attempts: s.quiz.attempts, passes: s.quiz.passes }, { attempts: 2, passes: 1 });
    assert.equal(s.quiz.passRate, 0.5);
    assert.equal(s.gates.edit.allow, 1);
    assert.equal(s.gates.edit.deny, 1);
    assert.equal(s.gates.contract.allow, 1);
    assert.equal(s.gates.plan.deny, 0, 'the fixed gate taxonomy is always present');
    assert.deepEqual({ runs: s.ship.runs, completed: s.ship.completed, aborted: s.ship.aborted },
      { runs: 2, completed: 1, aborted: 1 }, 'an unmatched start is REPORTED as aborted, not hidden');
    assert.equal(s.ship.okRate, 1);
    assert.equal(s.ship.medianDurationMs, 1000);
    assert.deepEqual({ total: s.cert.total, pass: s.cert.pass }, { total: 2, pass: 1 });
    assert.equal(s.cert.passRate, 0.5);
    assert.deepEqual({ total: s.verify.total, passUnproven: s.verify.passUnproven }, { total: 2, passUnproven: 1 });
    assert.equal(s.verify.unprovenRatio, 0.5);
    assert.equal(s.other, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed lines: skipped and COUNTED, exit code untouched', () => {
  const dir = mkroot([
    ev({ event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true }),
    '{"torn line that never finish',
    'not json at all',
    ev({ event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true }),
  ]);
  try {
    const r = cli(['summary', '--json'], { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, 'a summarizer that dies on one torn line hides every other metric');
    const s = JSON.parse(r.stdout);
    assert.equal(s.malformed, 2);
    assert.equal(s.quiz.attempts, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('windowing: --since keeps events at/after the instant; --last N keeps the last N', () => {
  const at = (ts, o) => JSON.stringify({ v: 1, ts, session: null, ...o });
  const dir = mkroot([
    at('2026-07-01T00:00:00.000Z', { event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: false }),
    at('2026-07-02T00:00:00.000Z', { event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true }),
    at('2026-07-03T00:00:00.000Z', { event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true }),
  ]);
  try {
    const since = JSON.parse(cli(['summary', '--json', '--since', '2026-07-02T00:00:00.000Z'], { FLOWMAP_ROOT: dir }).stdout);
    assert.equal(since.quiz.attempts, 2, '--since is inclusive of the instant');
    assert.equal(since.quiz.passRate, 1);
    const last = JSON.parse(cli(['summary', '--json', '--last', '1'], { FLOWMAP_ROOT: dir }).stdout);
    assert.equal(last.quiz.attempts, 1);
    const human = cli(['summary', '--last', '1'], { FLOWMAP_ROOT: dir });
    assert.match(human.stdout, /last 1/, 'the active window is echoed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('usage: an unparseable --since is a usage error (exit 2)', () => {
  const dir = mkroot([]);
  try {
    assert.equal(cli(['summary', '--since', 'not-a-date'], { FLOWMAP_ROOT: dir }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('log present but unreadable at the FILE level: exit 1', () => {
  const dir = mkroot(null);
  try {
    mkdirSync(join(dir, LOG_REL), { recursive: true }); // a directory where the file should be
    assert.equal(cli(['summary'], { FLOWMAP_ROOT: dir }).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wrap: transparent on success — child exit 0 passes through, start/end pair recorded', () => {
  const dir = mkroot(null);
  try {
    const r = cli(['wrap', '--event', 'ship', '--', 'node', '-e', 'process.exit(0)'], { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0);
    const lines = readFileSync(join(dir, LOG_REL), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
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
    const r = cli(['wrap', '--event', 'ship', '--', 'node', '-e', 'process.exit(1)'], { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 1, 'callers cannot tell the wrapper is there');
    const lines = readFileSync(join(dir, LOG_REL), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines[1].ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wrap: a KILLED child terminates the wrapper by the same signal (end still recorded)', () => {
  const dir = mkroot(null);
  try {
    const r = cli(['wrap', '--event', 'ship', '--', 'node', '-e', 'process.kill(process.pid, "SIGTERM")'], { FLOWMAP_ROOT: dir });
    assert.equal(r.signal, 'SIGTERM', 'signal transparency, not a laundered exit code');
    const lines = readFileSync(join(dir, LOG_REL), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.length, 2, 'the end line is recorded before the wrapper re-raises');
    assert.equal(lines[1].ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('wrap usage: missing -- command is exit 2 (nothing recorded)', () => {
  const dir = mkroot(null);
  try {
    assert.equal(cli(['wrap', '--event', 'ship'], { FLOWMAP_ROOT: dir }).status, 2);
    assert.equal(cli(['wrap', '--event', 'ship', '--'], { FLOWMAP_ROOT: dir }).status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
