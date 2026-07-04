/* reminder-hook.test.mjs — M10: PreToolUse advisory reminder injector.
   Same hermetic-FLOWMAP_ROOT spawnSync harness pattern as
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
const CLI = join('tools', 'flowmap', 'gates', 'reminder-hook.mjs');
const STATE_FILE = '.flowmap-reminders.json';

const MSG1 = 'high priority reminder: subagent use is high priority, 2-5x cheaper, only essential tasks in main agent.';
const MSG2 = 'high priority reminder: batch read and write activities to reduce turns, grep by lookup where appropriate.';

function hook(payload, env = {}) {
  const r = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function mktmp() { return mkdtempSync(join(tmpdir(), 'reminder-hook-')); }

const payloadFor = (session = 'sess-1', extra = {}) =>
  ({ tool_name: 'Bash', tool_input: { command: 'ls' }, session_id: session, ...extra });

test('default N=2: calls 2 and 4 fire, calls 1 and 3 are silent, all exit 0', () => {
  const dir = mktmp();
  try {
    const env = { FLOWMAP_ROOT: dir };
    const r1 = hook(payloadFor('s1'), env);
    const r2 = hook(payloadFor('s1'), env);
    const r3 = hook(payloadFor('s1'), env);
    const r4 = hook(payloadFor('s1'), env);
    for (const r of [r1, r2, r3, r4]) assert.equal(r.status, 0);
    assert.equal(r1.stdout, '');
    assert.notEqual(r2.stdout, '');
    assert.equal(r3.stdout, '');
    assert.notEqual(r4.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('rotation: call 2 and call 4 messages differ and are each one of the two known strings', () => {
  const dir = mktmp();
  try {
    const env = { FLOWMAP_ROOT: dir };
    hook(payloadFor('s1'), env);
    const r2 = hook(payloadFor('s1'), env);
    hook(payloadFor('s1'), env);
    const r4 = hook(payloadFor('s1'), env);

    const m2 = JSON.parse(r2.stdout).hookSpecificOutput.additionalContext;
    const m4 = JSON.parse(r4.stdout).hookSpecificOutput.additionalContext;
    assert.notEqual(m2, m4);
    assert.ok([MSG1, MSG2].includes(m2));
    assert.ok([MSG1, MSG2].includes(m4));
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('schema safety: every non-empty stdout line is exactly {hookSpecificOutput:{hookEventName,additionalContext}}, never decision/permissionDecision', () => {
  const dir = mktmp();
  try {
    const env = { FLOWMAP_ROOT: dir, FLOWMAP_REMINDER_EVERY: '1' };
    const outs = [hook(payloadFor('s1'), env).stdout, hook(payloadFor('s1'), env).stdout];
    for (const out of outs) {
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
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sidechain skip: isSidechain true exits 0, silent, and does not create/increment the counter file', () => {
  const dir = mktmp();
  try {
    const env = { FLOWMAP_ROOT: dir };
    const r = hook(payloadFor('sX', { isSidechain: true }), env);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.ok(!existsSync(join(dir, STATE_FILE)), 'sidechain call must not create the counter file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('sidechain skip: agent_id present exits 0, silent, and does not create/increment the counter file', () => {
  const dir = mktmp();
  try {
    const env = { FLOWMAP_ROOT: dir };
    const r = hook(payloadFor('sX', { agent_id: 'A1' }), env);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.ok(!existsSync(join(dir, STATE_FILE)), 'subagent call must not create the counter file');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed stdin: exits 0, silent', () => {
  const dir = mktmp();
  try {
    const r = hook('not json', { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('env knob FLOWMAP_REMINDER_EVERY=1 fires every call', () => {
  const dir = mktmp();
  try {
    const r1 = hook(payloadFor('s1'), { FLOWMAP_ROOT: dir, FLOWMAP_REMINDER_EVERY: '1' });
    assert.equal(r1.status, 0);
    assert.notEqual(r1.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('env knob FLOWMAP_REMINDER_EVERY=junk falls back to default N=2', () => {
  const dir = mktmp();
  try {
    const env = { FLOWMAP_ROOT: dir, FLOWMAP_REMINDER_EVERY: 'junk' };
    const r1 = hook(payloadFor('s1'), env);
    const r2 = hook(payloadFor('s1'), env);
    assert.equal(r1.stdout, '');
    assert.notEqual(r2.stdout, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('session reset: a fresh session in the same ROOT starts its own count from zero', () => {
  const dir = mktmp();
  try {
    const env = { FLOWMAP_ROOT: dir };
    const rA1 = hook(payloadFor('sA'), env);
    assert.equal(rA1.stdout, '', 'first call for sA, default N=2, must be silent');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')), { session: 'sA', count: 1 });

    const rB1 = hook(payloadFor('sB'), env);
    assert.equal(rB1.status, 0);
    assert.equal(rB1.stdout, '', 'first call for a NEW session must not fire — counter resets per session');
    assert.deepEqual(JSON.parse(readFileSync(join(dir, STATE_FILE), 'utf8')), { session: 'sB', count: 1 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
