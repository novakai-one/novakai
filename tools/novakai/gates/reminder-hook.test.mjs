/* reminder-hook.test.mjs — M10: PreToolUse advisory reminder injector.
   Same hermetic-NOVAKAI_ROOT spawnSync harness pattern as
   turn-gate.test.mjs, independent of any live session state. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'gates', 'reminder-hook.mjs');
const STATE_FILE = '.novakai-reminders.json';

const MSG1 = 'high priority reminder: subagent use is high priority, 2-5x cheaper, '
  + 'only essential tasks in main agent.';
const MSG2 = 'high priority reminder: batch read and write activities to reduce turns, '
  + 'grep by lookup where appropriate.';

function hook(payload, env = {}) {
  const run = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

function mktmp() {
  return mkdtempSync(join(tmpdir(), 'reminder-hook-'));
}

const payloadFor = (session = 'sess-1', extra = {}) =>
  ({ tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: session, ...extra });

/** Four consecutive same-session calls — the default-N=2 firing pattern. */
function runFour(env) {
  return [
    hook(payloadFor('s1'), env),
    hook(payloadFor('s1'), env),
    hook(payloadFor('s1'), env),
    hook(payloadFor('s1'), env),
  ];
}

/** The full M10 schema pin: advisory-only output, never a decision. */
function assertAdvisorySchema(out) {
  assert.notEqual(out, '');
  const parsed = JSON.parse(out);
  assert.deepEqual(Object.keys(parsed), ['hookSpecificOutput']);
  assert.deepEqual(Object.keys(parsed.hookSpecificOutput).sort(), ['additionalContext', 'hookEventName']);
  assert.equal(parsed.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(typeof parsed.hookSpecificOutput.additionalContext, 'string');
  assert.ok(parsed.hookSpecificOutput.additionalContext.length > 0);
  assert.ok(!('decision' in parsed));
  assert.ok(!('permissionDecision' in parsed));
  assert.ok(!('decision' in parsed.hookSpecificOutput));
  assert.ok(!('permissionDecision' in parsed.hookSpecificOutput));
}

test('default N=2: calls 2 and 4 fire, calls 1 and 3 are silent, all exit 0', () => {
  const dir = mktmp();
  try {
    const [first, second, third, fourth] = runFour({ NOVAKAI_ROOT: dir });
    for (const result of [first, second, third, fourth]) assert.equal(result.status, 0);
    assert.equal(first.stdout, '');
    assert.notEqual(second.stdout, '');
    assert.equal(third.stdout, '');
    assert.notEqual(fourth.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rotation: call 2 and call 4 messages differ and are each one of the two known strings', () => {
  const dir = mktmp();
  try {
    const [, second, , fourth] = runFour({ NOVAKAI_ROOT: dir });
    const message2 = JSON.parse(second.stdout).hookSpecificOutput.additionalContext;
    const message4 = JSON.parse(fourth.stdout).hookSpecificOutput.additionalContext;
    assert.notEqual(message2, message4);
    assert.ok([MSG1, MSG2].includes(message2));
    assert.ok([MSG1, MSG2].includes(message4));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('schema safety: every non-empty stdout line is exactly '
  + '{hookSpecificOutput:{hookEventName,additionalContext}}, never decision/permissionDecision', () => {
  const dir = mktmp();
  try {
    const env = { NOVAKAI_ROOT: dir, NOVAKAI_REMINDER_EVERY: '1' };
    const outs = [hook(payloadFor('s1'), env).stdout, hook(payloadFor('s1'), env).stdout];
    for (const out of outs) assertAdvisorySchema(out);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sidechain skip: isSidechain true exits 0, silent, and does not create/increment the counter file', () => {
  const dir = mktmp();
  try {
    const result = hook(payloadFor('sX', { isSidechain: true }), { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.ok(!existsSync(join(dir, STATE_FILE)), 'sidechain call must not create the counter file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sidechain skip: agent_id present exits 0, silent, and does not create/increment the counter file', () => {
  const dir = mktmp();
  try {
    const result = hook(payloadFor('sX', { agent_id: 'A1' }), { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
    assert.ok(!existsSync(join(dir, STATE_FILE)), 'subagent call must not create the counter file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed stdin: exits 0, silent', () => {
  const dir = mktmp();
  try {
    const result = hook('not json', { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('env knob NOVAKAI_REMINDER_EVERY=1 fires every call', () => {
  const dir = mktmp();
  try {
    const result = hook(payloadFor('s1'), { NOVAKAI_ROOT: dir, NOVAKAI_REMINDER_EVERY: '1' });
    assert.equal(result.status, 0);
    assert.notEqual(result.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('env knob NOVAKAI_REMINDER_EVERY=junk falls back to default N=2', () => {
  const dir = mktmp();
  try {
    const env = { NOVAKAI_ROOT: dir, NOVAKAI_REMINDER_EVERY: 'junk' };
    const result1 = hook(payloadFor('s1'), env);
    const result2 = hook(payloadFor('s1'), env);
    assert.equal(result1.stdout, '');
    assert.notEqual(result2.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('session reset: a fresh session in the same ROOT starts its own count from zero', () => {
  const dir = mktmp();
  try {
    const env = { NOVAKAI_ROOT: dir };
    const firstA = hook(payloadFor('sA'), env);
    assert.equal(firstA.stdout, '', 'first call for sA, default N=2, must be silent');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')), { session: 'sA', count: 1 });

    const firstB = hook(payloadFor('sB'), env);
    assert.equal(firstB.status, 0);
    assert.equal(firstB.stdout, '', 'first call for a NEW session must not fire — counter resets per session');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')), { session: 'sB', count: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
