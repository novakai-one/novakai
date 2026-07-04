/* turn-gate.test.mjs — M10 FORCE: PreToolUse gate on Read|Grep|Glob that
   denies a streak of unbatched single-read turns. Synthetic transcript
   fixtures + PreToolUse payloads on stdin, hermetic FLOWMAP_ROOT tmp dirs
   (same harness pattern as edit-gate.test.mjs), independent of the live
   session's own transcript. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join('tools', 'flowmap', 'turn-gate.mjs');
const MARKER = '.flowmap-turn-gate.json';
const LOG_REL = join('docs', 'flowmap', 'metrics', 'session-log.jsonl');

function gate(payload, env = {}) {
  const r = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

let n = 0;
function toolUse(name) { return { type: 'tool_use', id: `toolu_${n++}`, name, input: {} }; }
function assistantLine(id, tools) {
  return JSON.stringify({ type: 'assistant', message: { id, usage: {}, content: tools.map(toolUse) } });
}
function mktmp() { return mkdtempSync(join(tmpdir(), 'turn-gate-')); }
/** calls: array of tool-name arrays, one per assistant turn, in order. */
function mkTranscript(dir, calls) {
  const file = join(dir, 'transcript.jsonl');
  writeFileSync(file, calls.map((names, i) => assistantLine(`msg_${i}`, names)).join('\n') + '\n');
  return file;
}
const payloadFor = (file, session = 'sess-1') =>
  ({ tool_name: 'Read', tool_input: { file_path: 'x.ts' }, transcript_path: file, session_id: session });

test('ALLOW: a batched last turn (>=2 tool_use blocks) passes regardless of prior streak', () => {
  const dir = mktmp();
  try {
    const file = mkTranscript(dir, [['Read'], ['Read'], ['Read'], ['Read', 'Grep']]);
    const r = gate(payloadFor(file), { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: a streak of 3 single-read turns is under threshold', () => {
  const dir = mktmp();
  try {
    const file = mkTranscript(dir, [['Read'], ['Grep'], ['Glob']]);
    const r = gate(payloadFor(file), { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: a streak of 4 single-read turns blocks, names the streak, and writes the marker', () => {
  const dir = mktmp();
  try {
    const file = mkTranscript(dir, [['Read'], ['Grep'], ['Glob'], ['Read']]);
    const r = gate(payloadFor(file), { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /4 consecutive single-read turns/);
    assert.match(r.stdout, /"decision":"block"/);
    assert.ok(existsSync(join(dir, MARKER)), 'the deny arms the one-free-retry marker');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('streak >=4: deny, then the one free identical retry allows and consumes the marker, then a third identical call denies again', () => {
  const dir = mktmp();
  try {
    const file = mkTranscript(dir, [['Read'], ['Grep'], ['Glob'], ['Read']]);
    const payload = payloadFor(file);

    const r1 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r1.status, 2, 'first: denied, streak 4');
    assert.ok(existsSync(join(dir, MARKER)));

    const r2 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r2.status, 0, `retry should be allowed: ${r2.stderr}`);
    assert.ok(!existsSync(join(dir, MARKER)), 'the one free retry consumes the marker');

    const r3 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r3.status, 2, 'marker already consumed — the still->=4 streak re-arms and denies again');
    assert.ok(existsSync(join(dir, MARKER)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('growing transcript: deny at streak 4, retry after the transcript GREW to 5 still allows (<=, not ==) and records allow-after-deny, then a further append denies again', () => {
  const dir = mktmp();
  try {
    const session = 'sess-growing';
    const calls = [['Read'], ['Grep'], ['Glob'], ['Read']]; // streak 4 == THRESHOLD

    const file1 = mkTranscript(dir, calls);
    const r1 = gate(payloadFor(file1, session), { FLOWMAP_ROOT: dir });
    assert.equal(r1.status, 2, 'first: denied at streak 4, marker written');
    assert.ok(existsSync(join(dir, MARKER)));
    assert.deepEqual(JSON.parse(readFileSync(join(dir, MARKER), 'utf8')), { session, streak: 4 });

    // Simulates the live-fire finding: the in-flight call's own message was NOT
    // yet in the transcript when the hook ran, so the retry's transcript has
    // grown by one more single-read line since the marker was written — streak
    // is now 5, not 4. The marker's streak (4) must still satisfy <= 5.
    calls.push(['Read']);
    const file2 = mkTranscript(dir, calls);
    const r2 = gate(payloadFor(file2, session), { FLOWMAP_ROOT: dir });
    assert.equal(r2.status, 0, `retry should be allowed even though the streak grew: ${r2.stderr}`);
    assert.ok(!existsSync(join(dir, MARKER)), 'the retry consumes the marker despite the grown streak');
    const logPath = join(dir, LOG_REL);
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.decision), ['deny', 'allow-after-deny']);

    // A further append with no marker present re-arms and denies again.
    calls.push(['Read']);
    const file3 = mkTranscript(dir, calls);
    const r3 = gate(payloadFor(file3, session), { FLOWMAP_ROOT: dir });
    assert.equal(r3.status, 2, 'no marker left — the still-growing streak denies again');
    assert.ok(existsSync(join(dir, MARKER)));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW (never wedge): malformed stdin exits 0', () => {
  const dir = mktmp();
  const r = gate('not json at all', { FLOWMAP_ROOT: dir });
  assert.equal(r.status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('ALLOW (never wedge): missing/unreadable transcript_path exits 0', () => {
  const dir = mktmp();
  try {
    const r = gate(payloadFor(join(dir, 'does-not-exist.jsonl')), { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('telemetry: deny is recorded in session-log.jsonl; a plain allow is NEVER recorded', () => {
  const dir = mktmp();
  try {
    const logPath = join(dir, LOG_REL);

    const batched = mkTranscript(dir, [['Read'], ['Read'], ['Read', 'Grep']]);
    const allowed = gate(payloadFor(batched, 's1'), { FLOWMAP_ROOT: dir });
    assert.equal(allowed.status, 0);
    assert.ok(!existsSync(logPath), 'a plain allow must not write to the log at all (this hook fires on every read)');

    const denyFile = mkTranscript(dir, [['Read'], ['Grep'], ['Glob'], ['Read']]);
    const denied = gate(payloadFor(denyFile, 's2'), { FLOWMAP_ROOT: dir });
    assert.equal(denied.status, 2);
    const lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.equal(lines.length, 1);
    assert.deepEqual({ event: lines[0].event, gate: lines[0].gate, decision: lines[0].decision },
      { event: 'gate', gate: 'turns', decision: 'deny' });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
