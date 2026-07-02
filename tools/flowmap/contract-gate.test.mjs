/* contract-gate.test.mjs — offline acceptance for the PreToolUse spawn-gate.
   Proves the allow/deny logic by piping synthetic PreToolUse payloads on
   stdin, independent of how the live harness wires the hook. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join('tools', 'flowmap', 'contract-gate.mjs');

function gate(payload) {
  const r = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('ALLOW: spawn with no contract sentinel passes through (exit 0)', () => {
  const r = gate({ tool_name: 'Agent', tool_input: { prompt: 'go read the codebase and summarise' } });
  assert.equal(r.status, 0);
});

test('ALLOW: spawn carrying a VALID, coherent contract id (exit 0)', () => {
  const r = gate({ tool_name: 'Agent', tool_input: { prompt: 'Implement this. FLOWMAP-CONTRACT:frame-transform' } });
  assert.equal(r.status, 0);
});

test('DENY: sentinel with an unresolvable contract id (exit 2), from the PRIMARY deny branch', () => {
  const r = gate({ tool_name: 'Agent', tool_input: { prompt: 'Implement. FLOWMAP-CONTRACT:no-such-change-xyz' } });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"deny"/);
  // AUD3 M2a: the primary branch was individually dead-code-able because the
  // unparseable-output fallback masked it. Pin the primary reason text so both
  // deny paths stay live.
  assert.match(r.stdout, /no valid contract resolves/);
});

test('DENY (fail-closed, F-01): malformed stdin cannot be verified, so it blocks (exit 2)', () => {
  // The hook matcher is Agent|Task — every payload reaching this gate IS an
  // agent spawn. Unparseable input means the gate cannot check the prompt.
  const r = gate('not json at all');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"deny"/);
});

test('DENY (F-01): near-miss sentinel FLOWMAP_CONTRACT (underscore typo) blocks (exit 2)', () => {
  const r = gate({ tool_name: 'Agent', tool_input: { prompt: 'Implement this. FLOWMAP_CONTRACT: frame-transform' } });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /near-miss/);
});

test('DENY (F-01): near-miss sentinel in the wrong case blocks (exit 2)', () => {
  const r = gate({ tool_name: 'Agent', tool_input: { prompt: 'Implement this. flowmap-contract:frame-transform' } });
  assert.equal(r.status, 2);
});

test('DENY (F-01): correct-cased sentinel with no id blocks (exit 2)', () => {
  const r = gate({ tool_name: 'Agent', tool_input: { prompt: 'Implement per FLOWMAP-CONTRACT protocol' } });
  assert.equal(r.status, 2);
});

test('ALLOW: prose "flowmap contract" (space-separated words) is not a near-miss (exit 0)', () => {
  const r = gate({ tool_name: 'Agent', tool_input: { prompt: 'read how the flowmap contract loop works and report' } });
  assert.equal(r.status, 0);
});

test('ALLOW: non-agent tool is never gated (exit 0)', () => {
  const r = gate({ tool_name: 'Bash', tool_input: { command: 'echo hello' } });
  assert.equal(r.status, 0);
});

test('ALLOW: missing tool_input.prompt carries no sentinel (exit 0)', () => {
  const r = gate({ tool_name: 'Agent', tool_input: {} });
  assert.equal(r.status, 0);
});
