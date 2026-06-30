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

test('DENY: sentinel with an unresolvable contract id (exit 2)', () => {
  const r = gate({ tool_name: 'Agent', tool_input: { prompt: 'Implement. FLOWMAP-CONTRACT:no-such-change-xyz' } });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"deny"/);
});

test('ALLOW (fail-open): malformed stdin never blocks (exit 0)', () => {
  const r = gate('not json at all');
  assert.equal(r.status, 0);
});

test('ALLOW: non-agent tool is never gated (exit 0)', () => {
  const r = gate({ tool_name: 'Bash', tool_input: { command: 'echo FLOWMAP-CONTRACT:no-such-change' } });
  assert.equal(r.status, 0);
});

test('ALLOW (fail-open): missing tool_input.prompt never blocks (exit 0)', () => {
  const r = gate({ tool_name: 'Agent', tool_input: {} });
  assert.equal(r.status, 0);
});
