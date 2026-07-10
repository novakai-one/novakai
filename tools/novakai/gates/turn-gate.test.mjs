/* turn-gate.test.mjs — M10 FORCE: PreToolUse gate on Read|Grep|Glob that
   denies a streak of unbatched single-read turns. Synthetic transcript
   fixtures + PreToolUse payloads on stdin, hermetic NOVAKAI_ROOT tmp dirs
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
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'gates', 'turn-gate.mjs');
const MARKER = '.novakai-turn-gate.json';
const LOG_REL = join('docs', 'novakai', 'metrics', 'session-log.jsonl');
const ALLOW_AFTER_DENY = 'allow-after-deny';
const ALLOW_GRACE = 'allow-grace';

function gate(payload, env = {}) {
  const run = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

let toolUseSeq = 0;
function toolUse(name) {
  return { type: 'tool_use', id: `toolu_${toolUseSeq++}`, name, input: {} };
}
function assistantLine(id, tools) {
  return JSON.stringify({ type: 'assistant', message: { id, usage: {}, content: tools.map(toolUse) } });
}
function mktmp() {
  return mkdtempSync(join(tmpdir(), 'turn-gate-'));
}
/** Writes a transcript at an exact path (also used for sidechain fixtures). */
function writeTranscriptAt(file, calls) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, calls.map((names, i) => assistantLine(`msg_${i}`, names)).join('\n') + '\n');
  return file;
}
/** calls: array of tool-name arrays, one per assistant turn, in order. */
function mkTranscript(dir, calls) {
  return writeTranscriptAt(join(dir, 'transcript.jsonl'), calls);
}
/** A completed assistant message with ZERO tool_use blocks — message.content
    holds only a text block, distinct message.id. assistantLine(id, []) can't
    express this: tools.map(toolUse) on [] yields content: [], not a text
    block, so this is a sibling helper (see turn-gate.mjs header: sidechain
    persistence timing pins the trailing-zero-tool-call case). */
function textOnlyLine(id) {
  return JSON.stringify({
    type: 'assistant', message: { id, usage: {}, content: [{ type: 'text', text: 'thinking...' }] },
  });
}
/** Same as writeTranscriptAt PLUS one trailing zero-tool-use assistant message. */
function writeTranscriptTrailingTextAt(file, calls) {
  mkdirSync(dirname(file), { recursive: true });
  const lines = calls.map((names, i) => assistantLine(`msg_${i}`, names));
  lines.push(textOnlyLine(`msg_${calls.length}`));
  writeFileSync(file, lines.join('\n') + '\n');
  return file;
}
/** calls (as mkTranscript) PLUS one trailing zero-tool-use assistant message. */
function mkTranscriptTrailingText(dir, calls) {
  return writeTranscriptTrailingTextAt(join(dir, 'transcript.jsonl'), calls);
}
const payloadFor = (file, session = 'sess-1') =>
  ({ tool_name: 'Read', tool_input: { file_path: 'x.ts' }, transcript_path: file, session_id: session });

function runGate(dir, file, session) {
  return gate(payloadFor(file, session), { NOVAKAI_ROOT: dir });
}
function readMarker(dir, name = MARKER) {
  return JSON.parse(readFileSync(join(dir, name), 'utf8'));
}
function loggedDecisions(dir) {
  return readFileSync(join(dir, LOG_REL), 'utf8').split('\n').filter(Boolean)
    .map((line) => JSON.parse(line));
}

test('ALLOW: a batched last turn (>=2 tool_use blocks) passes regardless of prior streak', () => {
  const dir = mktmp();
  try {
    const file = mkTranscript(dir, [['Read'], ['Read'], ['Read'], ['Read', 'Grep']]);
    const result = runGate(dir, file);
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: a streak of 3 single-read turns is under threshold', () => {
  const dir = mktmp();
  try {
    const file = mkTranscript(dir, [['Read'], ['Grep'], ['Glob']]);
    const result = runGate(dir, file);
    assert.equal(result.status, 0, result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: a streak of 4 single-read turns blocks, names the streak, and writes the marker', () => {
  const dir = mktmp();
  try {
    const file = mkTranscript(dir, [['Read'], ['Grep'], ['Glob'], ['Read']]);
    const result = runGate(dir, file);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /4 consecutive single-read turns/);
    assert.match(result.stdout, /"decision":"block"/);
    assert.ok(existsSync(join(dir, MARKER)), 'the deny arms the one-free-retry marker');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** Third identical call on the still-unchanged transcript: frozen window -> allow. */
function expectFrozenWindowAllow(dir, payload) {
  const result = gate(payload, { NOVAKAI_ROOT: dir });
  assert.equal(result.status, 0, 'unchanged transcript stays inside the frozen grace window');
  assert.ok(existsSync(join(dir, MARKER)), 'grace marker persists through the frozen window');
}

test('UPDATED for frozen-window grace (Change 1): streak >=4 denies, the one free identical retry '
  + 'allows and REWRITES the marker as a grace snapshot (not deletion), and a third identical call '
  + 'on the still-unchanged transcript stays inside the frozen window (allow, not deny)', () => {
  const dir = mktmp();
  try {
    const file = mkTranscript(dir, [['Read'], ['Grep'], ['Glob'], ['Read']]);
    const payload = payloadFor(file);

    const first = gate(payload, { NOVAKAI_ROOT: dir });
    assert.equal(first.status, 2, 'first: denied, streak 4');
    assert.ok(existsSync(join(dir, MARKER)));

    const retry = gate(payload, { NOVAKAI_ROOT: dir });
    assert.equal(retry.status, 0, `retry should be allowed: ${retry.stderr}`);
    assert.deepEqual(readMarker(dir),
      { session: 'sess-1', grace: true, calls: 4, streak: 4 },
      'the retry rewrites the marker as a grace snapshot instead of deleting it');

    // The transcript is UNCHANGED (delta 0 from the grace snapshot) — this is
    // the frozen in-flight-batch window the grace record exists for, so it
    // allows too, instead of the pre-fix behavior of denying again.
    expectFrozenWindowAllow(dir, payload);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- growing-transcript grace scenario, phase helpers (one per gate call) ---- */

function growingDenyAtFour(dir, session, calls) {
  const file = mkTranscript(dir, calls);
  const result = runGate(dir, file, session);
  assert.equal(result.status, 2, 'first: denied at streak 4, marker written');
  assert.ok(existsSync(join(dir, MARKER)));
  assert.deepEqual(readMarker(dir), { session, streak: 4 });
}

// Simulates the live-fire finding: the in-flight call's own message was NOT
// yet in the transcript when the hook ran, so the retry's transcript has
// grown by one more single-read line since the marker was written — streak
// is now 5, not 4. The marker's streak (4) must still satisfy <= 5.
function growingRetryAfterGrowth(dir, session, calls) {
  calls.push(['Read']);
  const file = mkTranscript(dir, calls);
  const result = runGate(dir, file, session);
  assert.equal(result.status, 0, `retry should be allowed even though the streak grew: ${result.stderr}`);
  assert.deepEqual(readMarker(dir), { session, grace: true, calls: 5, streak: 5 },
    'the retry rewrites the marker as a grace snapshot (frozen-window grace) instead of deleting it');
}

// One more single-read append is still within the frozen window (delta 1
// from the grace snapshot) — allow-grace, snapshot left unchanged. This is
// the exact live-fire bounce (first read of a following in-flight batch).
function growingGraceWithinWindow(dir, session, calls) {
  calls.push(['Read']);
  const file = mkTranscript(dir, calls);
  const result = runGate(dir, file, session);
  assert.equal(result.status, 0, 'one more read is still inside the grace window');
  assert.deepEqual(readMarker(dir), { session, grace: true, calls: 5, streak: 5 },
    'grace snapshot stays put while the window is frozen');
  assert.deepEqual(loggedDecisions(dir).map((line) => line.decision),
    ['deny', ALLOW_AFTER_DENY, ALLOW_GRACE]);
}

// A further append moves the window by 2 from the grace snapshot (7-5) —
// no longer frozen, so the grace marker is discarded and the gate re-arms.
function growingReArmOnWindowMove(dir, session, calls) {
  calls.push(['Read']);
  const file = mkTranscript(dir, calls);
  const result = runGate(dir, file, session);
  assert.equal(result.status, 2, 'the window moved — the still-growing streak denies again');
  assert.ok(existsSync(join(dir, MARKER)));
  assert.deepEqual(loggedDecisions(dir).map((line) => line.decision),
    ['deny', ALLOW_AFTER_DENY, ALLOW_GRACE, 'deny']);
}

test('UPDATED for frozen-window grace (Change 1): growing transcript denies at streak 4, retry after '
  + 'the transcript GREW to 5 still allows (<=, not ==) and REWRITES the marker as a grace snapshot; '
  + 'one further growth step stays inside the frozen window (allow-grace); only once the window moves '
  + 'by 2 does it deny again — pinned decisions now extend to [deny, allow-after-deny, allow-grace, deny]', () => {
  const dir = mktmp();
  try {
    const session = 'sess-growing';
    const calls = [['Read'], ['Grep'], ['Glob'], ['Read']]; // streak 4 == THRESHOLD
    growingDenyAtFour(dir, session, calls);
    growingRetryAfterGrowth(dir, session, calls);
    growingGraceWithinWindow(dir, session, calls);
    growingReArmOnWindowMove(dir, session, calls);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW (never wedge): malformed stdin exits 0', () => {
  const dir = mktmp();
  const result = gate('not json at all', { NOVAKAI_ROOT: dir });
  assert.equal(result.status, 0);
  rmSync(dir, { recursive: true, force: true });
});

test('ALLOW (never wedge): missing/unreadable transcript_path exits 0', () => {
  const dir = mktmp();
  try {
    const result = runGate(dir, join(dir, 'does-not-exist.jsonl'));
    assert.equal(result.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function expectSingleDenyLogged(dir) {
  const lines = loggedDecisions(dir);
  assert.equal(lines.length, 1);
  assert.deepEqual({ event: lines[0].event, gate: lines[0].gate, decision: lines[0].decision },
    { event: 'gate', gate: 'turns', decision: 'deny' });
}

test('telemetry: deny is recorded in session-log.jsonl; a plain allow is NEVER recorded', () => {
  const dir = mktmp();
  try {
    const batched = mkTranscript(dir, [['Read'], ['Read'], ['Read', 'Grep']]);
    const allowed = runGate(dir, batched, 's1');
    assert.equal(allowed.status, 0);
    assert.ok(!existsSync(join(dir, LOG_REL)),
      'a plain allow must not write to the log at all (this hook fires on every read)');

    const denyFile = mkTranscript(dir, [['Read'], ['Grep'], ['Glob'], ['Read']]);
    const denied = runGate(dir, denyFile, 's2');
    assert.equal(denied.status, 2);
    expectSingleDenyLogged(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- T1 bounce-repro scenario, phase helpers ---- */

function bounceDenyThenGraceRetry(dir, session, calls) {
  const file = mkTranscript(dir, calls);
  const first = runGate(dir, file, session);
  assert.equal(first.status, 2, 'deny at streak 4');
  assert.ok(existsSync(join(dir, MARKER)));
  // retry on the SAME (unchanged) transcript -> allow-after-deny, marker rewritten as grace
  const retry = runGate(dir, file, session);
  assert.equal(retry.status, 0, 'retry allows');
  assert.equal(readMarker(dir).grace, true, 'marker is rewritten as a grace record, not deleted');
}

function bounceInFlightBatchReads(dir, session, calls) {
  // the persisted retry lands: transcript grows by the 5th lone read
  calls.push(['Read']);
  const file = mkTranscript(dir, calls);
  // this is the EXACT live-fire bounce: first read of an in-flight batch —
  // pre-fix this denied a second time; post-fix it must allow via allow-grace.
  const firstRead = runGate(dir, file, session);
  assert.equal(firstRead.status, 0, 'bounce fixed: first read of the in-flight batch is allowed');
  // second read of the same still-unpersisted batch: transcript unchanged
  const secondRead = runGate(dir, file, session);
  assert.equal(secondRead.status, 0, 'second read of the frozen window also allowed');
  assert.deepEqual(loggedDecisions(dir).map((line) => line.decision),
    ['deny', ALLOW_AFTER_DENY, ALLOW_GRACE, ALLOW_GRACE]);
}

function bounceBatchFinallyPersists(dir, session, calls) {
  calls.push(['Read', 'Grep']);
  const file = mkTranscript(dir, calls);
  const result = runGate(dir, file, session);
  assert.equal(result.status, 0, 'batch exempt');
  assert.ok(!existsSync(join(dir, MARKER)), 'stale grace marker is cleared once the batch persists');
}

test('T1 bounce-repro: frozen-window grace absorbs the exact live-fire bounce (2026-07-04)', () => {
  const dir = mktmp();
  try {
    const session = 'sess-bounce';
    const calls = [['Read'], ['Grep'], ['Glob'], ['Read']]; // streak 4
    bounceDenyThenGraceRetry(dir, session, calls);
    bounceInFlightBatchReads(dir, session, calls);
    bounceBatchFinallyPersists(dir, session, calls);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- T2 defiant-cadence scenario, phase helpers ---- */

function defiantDenyThenRetry(dir, session, calls) {
  const file = mkTranscript(dir, calls);
  assert.equal(runGate(dir, file, session).status, 2, 'deny');
  const retry = runGate(dir, file, session); // retry, same transcript
  assert.equal(retry.status, 0, ALLOW_AFTER_DENY);
}

function defiantReArms(dir, session, calls) {
  calls.push(['Read']); // 5th lone read
  const inWindow = runGate(dir, mkTranscript(dir, calls), session);
  assert.equal(inWindow.status, 0, `${ALLOW_GRACE}: still inside the frozen window (delta 1)`);
  calls.push(['Read']); // 6th lone read: window now moved by 2 from the grace snapshot
  const moved = runGate(dir, mkTranscript(dir, calls), session);
  assert.equal(moved.status, 2, 'the gate re-arms once the window moves — defiance does not get a free pass forever');
  assert.deepEqual(loggedDecisions(dir).map((line) => line.decision),
    ['deny', ALLOW_AFTER_DENY, ALLOW_GRACE, 'deny']);
}

test('T2 defiant cadence: grace does not defeat the gate — a real further lone-read still denies', () => {
  const dir = mktmp();
  try {
    const session = 'sess-defiant';
    const calls = [['Read'], ['Grep'], ['Glob'], ['Read']]; // streak 4
    defiantDenyThenRetry(dir, session, calls);
    defiantReArms(dir, session, calls);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---- T3 sidechain-binding scenario, phase helpers ---- */

function sidechainDenyThenRetry(dir, payload) {
  const first = gate(payload, { NOVAKAI_ROOT: dir });
  assert.equal(first.status, 2, 'sidechain streak denies');
  assert.ok(existsSync(join(dir, '.novakai-turn-gate-A1.json')), 'per-agent marker written');
  assert.ok(!existsSync(join(dir, MARKER)), 'the main-session marker must never be touched by a sidechain deny');
  const retry = gate(payload, { NOVAKAI_ROOT: dir });
  assert.equal(retry.status, 0, 'retry: allow-after-deny on the sidechain transcript');
  assert.deepEqual(loggedDecisions(dir).map((line) => ({ decision: line.decision, agent: line.agent })),
    [{ decision: 'deny', agent: 'A1' }, { decision: ALLOW_AFTER_DENY, agent: 'A1' }]);
}

// fail-open: sidechain file absent -> falls back to the main transcript,
// which has no read streak at all.
function sidechainFailsOpen(dir, payload, sideFile) {
  rmSync(sideFile);
  const result = gate(payload, { NOVAKAI_ROOT: dir });
  assert.equal(result.status, 0, 'sidechain file missing: fails open onto the main transcript');
}

test('T3 sidechain binding: a subagent streak gates on its own sidechain transcript and marker, '
  + 'never the main session\'s', () => {
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
    sidechainDenyThenRetry(dir, payload);
    sidechainFailsOpen(dir, payload, sideFile);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('T3b sidechain trailing partial (LIVE failure shape): a trailing zero-tool assistant message in a '
  + 'sidechain is the in-flight partial, trimmed before judging — the 4-read streak beneath it still '
  + 'binds instead of silently allowing', () => {
  const dir = mktmp();
  try {
    const sess = 'sess-side-b';
    const mainFile = join(dir, 'x', `${sess}.jsonl`);
    writeTranscriptAt(mainFile, [['Agent']]); // main transcript exists, unrelated to the sidechain streak
    const sideFile = join(dir, 'x', sess, 'subagents', 'agent-A2.jsonl');
    // streak 4 + trailing in-flight partial
    writeTranscriptTrailingTextAt(sideFile, [['Read'], ['Read'], ['Read'], ['Read']]);
    const payload = { session_id: sess, transcript_path: mainFile, agent_id: 'A2', tool_name: 'Read', tool_input: {} };
    expectTrailingPartialDenyThenRetry(dir, payload);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function expectTrailingPartialDenyThenRetry(dir, payload) {
  const first = gate(payload, { NOVAKAI_ROOT: dir });
  assert.equal(first.status, 2,
    'pre-fix this silently allowed: the trailing zero-tool call read as the streak-breaking message');
  assert.ok(existsSync(join(dir, '.novakai-turn-gate-A2.json')), 'per-agent marker written');
  const retry = gate(payload, { NOVAKAI_ROOT: dir });
  assert.equal(retry.status, 0, `identical retry should allow-after-deny: ${retry.stderr}`);
}

test('T3c main-thread contrast: the same trailing zero-tool assistant message on the MAIN thread is a '
  + 'genuine completed message, not an in-flight partial — trimming must not apply, so it is a real '
  + 'streak break', () => {
  const dir = mktmp();
  try {
    const file = mkTranscriptTrailingText(dir, [['Read'], ['Read'], ['Read'], ['Read']]);
    // no agent_id: main thread
    const payload = { tool_name: 'Read', tool_input: {}, transcript_path: file, session_id: 'sess-main-c' };

    const result = gate(payload, { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0, 'a completed text-only message on the main thread genuinely breaks the streak');
    assert.ok(!existsSync(join(dir, MARKER)), 'no marker written: the streak never reached threshold');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

function expectStaleMarkerDropped(dir, calls, note) {
  writeFileSync(join(dir, MARKER), JSON.stringify({ session: 'stale-sess', streak: 4 }));
  const result = runGate(dir, mkTranscript(dir, calls), 'new-sess');
  assert.equal(result.status, 0);
  assert.ok(!existsSync(join(dir, MARKER)), note);
}

test('T4 stale-marker cleanup: a leftover deny/grace marker is dropped once the streak breaks', () => {
  const dir = mktmp();
  try {
    expectStaleMarkerDropped(dir, [['Read'], ['Read'], ['Read', 'Grep']],
      'stale marker cleaned up on the batch-exempt path');
    // streak 3 < THRESHOLD
    expectStaleMarkerDropped(dir, [['Read'], ['Grep'], ['Glob']],
      'stale marker cleaned up on the sub-threshold path');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
