/* turn-gate.test.mjs — M10 FORCE: PreToolUse gate on Read|Grep|Glob that
   denies a streak of unbatched single-read turns. Synthetic transcript
   fixtures + PreToolUse payloads on stdin, hermetic FLOWMAP_ROOT tmp dirs
   (same harness pattern as edit-gate.test.mjs), independent of the live
   session's own transcript. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
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
/** Same as mkTranscript but at an exact path (for sidechain fixtures). */
function writeTranscriptAt(file, calls) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, calls.map((names, i) => assistantLine(`msg_${i}`, names)).join('\n') + '\n');
  return file;
}
/** A completed assistant message with ZERO tool_use blocks — message.content
    holds only a text block, distinct message.id. assistantLine(id, []) can't
    express this: tools.map(toolUse) on [] yields content: [], not a text
    block, so this is a sibling helper (see turn-gate.mjs header: sidechain
    persistence timing pins the trailing-zero-tool-call case). */
function textOnlyLine(id) {
  return JSON.stringify({ type: 'assistant', message: { id, usage: {}, content: [{ type: 'text', text: 'thinking...' }] } });
}
/** calls (as mkTranscript) PLUS one trailing zero-tool-use assistant message. */
function mkTranscriptTrailingText(dir, calls) {
  const file = join(dir, 'transcript.jsonl');
  const lines = calls.map((names, i) => assistantLine(`msg_${i}`, names));
  lines.push(textOnlyLine(`msg_${calls.length}`));
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}
/** Same as mkTranscriptTrailingText but at an exact path (sidechain fixtures). */
function writeTranscriptTrailingTextAt(file, calls) {
  mkdirSync(dirname(file), { recursive: true });
  const lines = calls.map((names, i) => assistantLine(`msg_${i}`, names));
  lines.push(textOnlyLine(`msg_${calls.length}`));
  writeFileSync(file, lines.join('\n') + '\n');
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

test('UPDATED for frozen-window grace (Change 1): streak >=4 denies, the one free identical retry allows and REWRITES the marker as a grace snapshot (not deletion), and a third identical call on the still-unchanged transcript stays inside the frozen window (allow, not deny)', () => {
  const dir = mktmp();
  try {
    const file = mkTranscript(dir, [['Read'], ['Grep'], ['Glob'], ['Read']]);
    const payload = payloadFor(file);

    const r1 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r1.status, 2, 'first: denied, streak 4');
    assert.ok(existsSync(join(dir, MARKER)));

    const r2 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r2.status, 0, `retry should be allowed: ${r2.stderr}`);
    assert.deepEqual(JSON.parse(readFileSync(join(dir, MARKER), 'utf8')),
      { session: 'sess-1', grace: true, calls: 4, streak: 4 },
      'the retry rewrites the marker as a grace snapshot instead of deleting it');

    // The transcript is UNCHANGED (delta 0 from the grace snapshot) — this is
    // the frozen in-flight-batch window the grace record exists for, so it
    // allows too, instead of the pre-fix behavior of denying again.
    const r3 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r3.status, 0, 'unchanged transcript stays inside the frozen grace window');
    assert.ok(existsSync(join(dir, MARKER)), 'grace marker persists through the frozen window');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('UPDATED for frozen-window grace (Change 1): growing transcript denies at streak 4, retry after the transcript GREW to 5 still allows (<=, not ==) and REWRITES the marker as a grace snapshot; one further growth step stays inside the frozen window (allow-grace); only once the window moves by 2 does it deny again — pinned decisions now extend to [deny, allow-after-deny, allow-grace, deny]', () => {
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
    assert.deepEqual(JSON.parse(readFileSync(join(dir, MARKER), 'utf8')),
      { session, grace: true, calls: 5, streak: 5 },
      'the retry rewrites the marker as a grace snapshot (frozen-window grace) instead of deleting it');

    // One more single-read append is still within the frozen window (delta 1
    // from the grace snapshot) — allow-grace, snapshot left unchanged. This is
    // the exact live-fire bounce (first read of a following in-flight batch).
    calls.push(['Read']);
    const file3 = mkTranscript(dir, calls);
    const r3 = gate(payloadFor(file3, session), { FLOWMAP_ROOT: dir });
    assert.equal(r3.status, 0, 'one more read is still inside the grace window');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, MARKER), 'utf8')),
      { session, grace: true, calls: 5, streak: 5 }, 'grace snapshot stays put while the window is frozen');

    const logPath = join(dir, LOG_REL);
    let lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.decision), ['deny', 'allow-after-deny', 'allow-grace']);

    // A further append moves the window by 2 from the grace snapshot (7-5) —
    // no longer frozen, so the grace marker is discarded and the gate re-arms.
    calls.push(['Read']);
    const file4 = mkTranscript(dir, calls);
    const r4 = gate(payloadFor(file4, session), { FLOWMAP_ROOT: dir });
    assert.equal(r4.status, 2, 'the window moved — the still-growing streak denies again');
    assert.ok(existsSync(join(dir, MARKER)));

    lines = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.decision), ['deny', 'allow-after-deny', 'allow-grace', 'deny']);
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

test('T1 bounce-repro: frozen-window grace absorbs the exact live-fire bounce (2026-07-04)', () => {
  const dir = mktmp();
  try {
    const session = 'sess-bounce';
    let calls = [['Read'], ['Grep'], ['Glob'], ['Read']]; // streak 4
    let file = mkTranscript(dir, calls);

    const r1 = gate(payloadFor(file, session), { FLOWMAP_ROOT: dir });
    assert.equal(r1.status, 2, 'deny at streak 4');
    assert.ok(existsSync(join(dir, MARKER)));

    // retry on the SAME (unchanged) transcript -> allow-after-deny, marker rewritten as grace
    const r2 = gate(payloadFor(file, session), { FLOWMAP_ROOT: dir });
    assert.equal(r2.status, 0, 'retry allows');
    assert.equal(JSON.parse(readFileSync(join(dir, MARKER), 'utf8')).grace, true,
      'marker is rewritten as a grace record, not deleted');

    // the persisted retry lands: transcript grows by the 5th lone read
    calls = [...calls, ['Read']];
    file = mkTranscript(dir, calls);

    // this is the EXACT live-fire bounce: first read of an in-flight batch —
    // pre-fix this denied a second time; post-fix it must allow via allow-grace.
    const r3 = gate(payloadFor(file, session), { FLOWMAP_ROOT: dir });
    assert.equal(r3.status, 0, 'bounce fixed: first read of the in-flight batch is allowed');

    // second read of the same still-unpersisted batch: transcript unchanged
    const r4 = gate(payloadFor(file, session), { FLOWMAP_ROOT: dir });
    assert.equal(r4.status, 0, 'second read of the frozen window also allowed');

    const logPath = join(dir, LOG_REL);
    const linesSoFar = readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(linesSoFar.map((l) => l.decision), ['deny', 'allow-after-deny', 'allow-grace', 'allow-grace']);

    // the batch message finally persists
    calls = [...calls, ['Read', 'Grep']];
    file = mkTranscript(dir, calls);
    const r5 = gate(payloadFor(file, session), { FLOWMAP_ROOT: dir });
    assert.equal(r5.status, 0, 'batch exempt');
    assert.ok(!existsSync(join(dir, MARKER)), 'stale grace marker is cleared once the batch persists');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('T2 defiant cadence: grace does not defeat the gate — a real further lone-read still denies', () => {
  const dir = mktmp();
  try {
    const session = 'sess-defiant';
    let calls = [['Read'], ['Grep'], ['Glob'], ['Read']]; // streak 4
    let file = mkTranscript(dir, calls);

    assert.equal(gate(payloadFor(file, session), { FLOWMAP_ROOT: dir }).status, 2, 'deny');

    const r2 = gate(payloadFor(file, session), { FLOWMAP_ROOT: dir }); // retry, same transcript
    assert.equal(r2.status, 0, 'allow-after-deny');

    calls = [...calls, ['Read']]; // 5th lone read
    file = mkTranscript(dir, calls);
    const r3 = gate(payloadFor(file, session), { FLOWMAP_ROOT: dir });
    assert.equal(r3.status, 0, 'allow-grace: still inside the frozen window (delta 1)');

    calls = [...calls, ['Read']]; // 6th lone read: window now moved by 2 from the grace snapshot
    file = mkTranscript(dir, calls);
    const r4 = gate(payloadFor(file, session), { FLOWMAP_ROOT: dir });
    assert.equal(r4.status, 2, 'the gate re-arms once the window moves — defiance does not get a free pass forever');

    const lines = readFileSync(join(dir, LOG_REL), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => l.decision), ['deny', 'allow-after-deny', 'allow-grace', 'deny']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('T3 sidechain binding: a subagent streak gates on its own sidechain transcript and marker, never the main session\'s', () => {
  const dir = mktmp();
  try {
    const sess = 'sess-side';
    const mainFile = join(dir, 'x', `${sess}.jsonl`);
    writeTranscriptAt(mainFile, [['Agent']]); // main transcript: no lone-read streak at all
    const sideFile = join(dir, 'x', sess, 'subagents', 'agent-A1.jsonl');
    writeTranscriptAt(sideFile, [['Read'], ['Grep'], ['Glob'], ['Read']]); // streak 4 in the sidechain

    const payload = {
      tool_name: 'Read', tool_input: {}, transcript_path: mainFile,
      session_id: sess, agent_id: 'A1', isSidechain: true,
    };

    const r1 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r1.status, 2, 'sidechain streak denies');
    assert.ok(existsSync(join(dir, '.flowmap-turn-gate-A1.json')), 'per-agent marker written');
    assert.ok(!existsSync(join(dir, MARKER)), 'the main-session marker must never be touched by a sidechain deny');

    const r2 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r2.status, 0, 'retry: allow-after-deny on the sidechain transcript');

    const lines = readFileSync(join(dir, LOG_REL), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    assert.deepEqual(lines.map((l) => ({ decision: l.decision, agent: l.agent })),
      [{ decision: 'deny', agent: 'A1' }, { decision: 'allow-after-deny', agent: 'A1' }]);

    // fail-open: sidechain file absent -> falls back to the main transcript,
    // which has no read streak at all.
    rmSync(sideFile);
    const r3 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r3.status, 0, 'sidechain file missing: fails open onto the main transcript');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('T3b sidechain trailing partial (LIVE failure shape): a trailing zero-tool assistant message in a sidechain is the in-flight partial, trimmed before judging — the 4-read streak beneath it still binds instead of silently allowing', () => {
  const dir = mktmp();
  try {
    const sess = 'sess-side-b';
    const mainFile = join(dir, 'x', `${sess}.jsonl`);
    writeTranscriptAt(mainFile, [['Agent']]); // main transcript exists, unrelated to the sidechain streak
    const sideFile = join(dir, 'x', sess, 'subagents', 'agent-A2.jsonl');
    writeTranscriptTrailingTextAt(sideFile, [['Read'], ['Read'], ['Read'], ['Read']]); // streak 4 + trailing in-flight partial

    const payload = { session_id: sess, transcript_path: mainFile, agent_id: 'A2', tool_name: 'Read', tool_input: {} };

    const r1 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r1.status, 2, 'pre-fix this silently allowed: the trailing zero-tool call read as the streak-breaking message');
    assert.ok(existsSync(join(dir, '.flowmap-turn-gate-A2.json')), 'per-agent marker written');

    const r2 = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r2.status, 0, `identical retry should allow-after-deny: ${r2.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('T3c main-thread contrast: the same trailing zero-tool assistant message on the MAIN thread is a genuine completed message, not an in-flight partial — trimming must not apply, so it is a real streak break', () => {
  const dir = mktmp();
  try {
    const file = mkTranscriptTrailingText(dir, [['Read'], ['Read'], ['Read'], ['Read']]);
    const payload = { tool_name: 'Read', tool_input: {}, transcript_path: file, session_id: 'sess-main-c' }; // no agent_id: main thread

    const r = gate(payload, { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, 'a completed text-only message on the main thread genuinely breaks the streak');
    assert.ok(!existsSync(join(dir, MARKER)), 'no marker written: the streak never reached threshold');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('T4 stale-marker cleanup: a leftover deny/grace marker is dropped once the streak breaks', () => {
  const dir = mktmp();
  try {
    writeFileSync(join(dir, MARKER), JSON.stringify({ session: 'stale-sess', streak: 4 }));
    const batched = mkTranscript(dir, [['Read'], ['Read'], ['Read', 'Grep']]);
    const r1 = gate(payloadFor(batched, 'new-sess'), { FLOWMAP_ROOT: dir });
    assert.equal(r1.status, 0);
    assert.ok(!existsSync(join(dir, MARKER)), 'stale marker cleaned up on the batch-exempt path');

    writeFileSync(join(dir, MARKER), JSON.stringify({ session: 'stale-sess', streak: 4 }));
    const subThreshold = mkTranscript(dir, [['Read'], ['Grep'], ['Glob']]); // streak 3 < THRESHOLD
    const r2 = gate(payloadFor(subThreshold, 'new-sess'), { FLOWMAP_ROOT: dir });
    assert.equal(r2.status, 0);
    assert.ok(!existsSync(join(dir, MARKER)), 'stale marker cleaned up on the sub-threshold path');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
