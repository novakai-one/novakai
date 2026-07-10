/* contract-gate.test.mjs — offline acceptance for the PreToolUse spawn-gate.
   Proves the allow/deny logic by piping synthetic PreToolUse payloads on
   stdin, independent of how the live harness wires the hook. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'gates', 'contract-gate.mjs');

// M2b: NOVAKAI_ROOT here is the EMITTER seam only (contract-gate itself does
// not read it) — fixture runs must not append to the repo's real metrics log.
const SINK = mkdtempSync(join(tmpdir(), 'contract-gate-metrics-'));
process.on('exit', () => rmSync(SINK, { recursive: true, force: true }));
const SINK_LOG = join(SINK, 'docs', 'novakai', 'metrics', 'session-log.jsonl');

function gate(payload) {
  const run = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, NOVAKAI_ROOT: SINK },
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

test('ALLOW: spawn with no contract sentinel passes through (exit 0)', () => {
  const result = gate({ tool_name: 'Agent', tool_input: { prompt: 'go read the codebase and summarise' } });
  assert.equal(result.status, 0);
});

test('ALLOW: spawn carrying a VALID, coherent contract id (exit 0)', () => {
  const result = gate({
    tool_name: 'Agent', tool_input: { prompt: 'Implement this. NOVAKAI-CONTRACT:frame-transform' },
  });
  assert.equal(result.status, 0);
});

test('DENY: sentinel with an unresolvable contract id (exit 2), from the PRIMARY deny branch', () => {
  const result = gate({ tool_name: 'Agent', tool_input: { prompt: 'Implement. NOVAKAI-CONTRACT:no-such-change-xyz' } });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /"decision":"block"/);
  // AUD3 M2a: the primary branch was individually dead-code-able because the
  // unparseable-output fallback masked it. Pin the primary reason text so both
  // deny paths stay live.
  assert.match(result.stdout, /no valid contract resolves/);
});

test('DENY (fail-closed, F-01): malformed stdin cannot be verified, so it blocks (exit 2)', () => {
  // The hook matcher is Agent|Task — every payload reaching this gate IS an
  // agent spawn. Unparseable input means the gate cannot check the prompt.
  const result = gate('not json at all');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /"decision":"block"/);
});

test('DENY (F-01): near-miss sentinel NOVAKAI_CONTRACT (underscore typo) blocks (exit 2)', () => {
  const result = gate({
    tool_name: 'Agent', tool_input: { prompt: 'Implement this. NOVAKAI_CONTRACT: frame-transform' },
  });
  assert.equal(result.status, 2);
  assert.match(result.stdout, /near-miss/);
});

test('DENY (F-01): near-miss sentinel in the wrong case blocks (exit 2)', () => {
  const result = gate({
    tool_name: 'Agent', tool_input: { prompt: 'Implement this. novakai-contract:frame-transform' },
  });
  assert.equal(result.status, 2);
});

test('DENY (F-01): correct-cased sentinel with no id blocks (exit 2)', () => {
  const result = gate({ tool_name: 'Agent', tool_input: { prompt: 'Implement per NOVAKAI-CONTRACT protocol' } });
  assert.equal(result.status, 2);
});

test('ALLOW: prose "novakai contract" (space-separated words) is not a near-miss (exit 0)', () => {
  const result = gate({
    tool_name: 'Agent', tool_input: { prompt: 'read how the novakai contract loop works and report' },
  });
  assert.equal(result.status, 0);
});

test('ALLOW: non-agent tool is never gated (exit 0)', () => {
  const result = gate({ tool_name: 'Bash', tool_input: { command: 'echo hello' } });
  assert.equal(result.status, 0);
});

test('ALLOW: missing tool_input.prompt carries no sentinel (exit 0)', () => {
  const result = gate({ tool_name: 'Agent', tool_input: {} });
  assert.equal(result.status, 0);
});

test('M2b: every decision is metered — deny/allow write gate events, exit codes unchanged', () => {
  // The sink starts fresh only relative to prior tests; count the delta.
  const before = existsSync(SINK_LOG) ? readFileSync(SINK_LOG, 'utf8').split('\n').filter(Boolean).length : 0;
  const denied = gate({ tool_name: 'Agent', tool_input: { prompt: 'Implement. NOVAKAI-CONTRACT:no-such-change-xyz' } });
  assert.equal(denied.status, 2, 'the deny exit code is untouched by telemetry');
  const allowed = gate({ tool_name: 'Agent', tool_input: { prompt: 'plain recon spawn' } });
  assert.equal(allowed.status, 0, 'the allow exit code is untouched by telemetry');
  const lines = readFileSync(SINK_LOG, 'utf8').split('\n')
    .filter(Boolean).slice(before).map((line) => JSON.parse(line));
  assert.equal(lines.length, 2, 'one gate event per decision');
  assert.deepEqual(lines.map((line) => [line.event, line.gate, line.decision]),
    [['gate', 'contract', 'deny'], ['gate', 'contract', 'allow']]);
});
