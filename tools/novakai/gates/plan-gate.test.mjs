/* plan-gate.test.mjs — offline acceptance for the M2 ExitPlanMode plan-gate.
   Proves the allow/deny logic by piping synthetic PreToolUse payloads on
   stdin against fixture checkouts (NOVAKAI_ROOT seam). Same harness pattern
   as contract-gate.test / edit-gate.test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'gates', 'plan-gate.mjs');

// M2b: default metrics sink for calls that pass no fixture root, so fixture
// decisions never append to the repo's real metrics log.
const SINK = mkdtempSync(join(tmpdir(), 'plan-gate-metrics-'));
process.on('exit', () => rmSync(SINK, { recursive: true, force: true }));

function gate(payload, env = {}) {
  const run = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...process.env, NOVAKAI_ROOT: SINK, ...env },
  });
  return { status: run.status, stdout: run.stdout ?? '', stderr: run.stderr ?? '' };
}

/** Fixture checkout: the real map's bytes, and optionally an in-flight
    public/plan.json — 'none' | 'coherent' | 'incoherent'. */
function mkroot({ plan = 'none' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-gate-'));
  mkdirSync(join(dir, 'docs', 'novakai'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'novakai', '_bundle.mmd'),
    readFileSync(join(ROOT, 'docs', 'novakai', '_bundle.mmd')));
  if (plan !== 'none') {
    const changes = plan === 'coherent' ? [] : [
      { id: 'ghost', target: { kind: 'node', ref: 'no_such__node_xyz' }, status: 'modify' },
    ];
    writeFileSync(join(dir, 'public', 'plan.json'), JSON.stringify({ changes }) + '\n');
  }
  return dir;
}

test('ALLOW: a non-ExitPlanMode tool is never gated (exit 0)', () => {
  const result = gate({ tool_name: 'Bash', tool_input: { command: 'echo hi' } });
  assert.equal(result.status, 0);
});

test('DENY (fail-closed): malformed stdin cannot be verified, so it blocks (exit 2)', () => {
  const result = gate('not json at all');
  assert.equal(result.status, 2);
  assert.match(result.stdout, /"decision":"block"/);
});

test('ALLOW: no sentinel and no in-flight plan — nothing to check (exit 0)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    const result = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'refactor the widget' } },
      { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: no sentinel, in-flight public/plan.json is coherent (exit 0)', () => {
  const dir = mkroot({ plan: 'coherent' });
  try {
    const result = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'ship the feature' } },
      { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: no sentinel, in-flight public/plan.json is INCOHERENT (exit 2)', () => {
  const dir = mkroot({ plan: 'incoherent' });
  try {
    const result = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'ship the feature' } },
      { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /"decision":"block"/);
    assert.match(result.stdout, /coheren|plan-check/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: NOVAKAI-PLAN sentinel with an unresolvable path (exit 2)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    const result = gate({
      tool_name: 'ExitPlanMode',
      tool_input: { plan: 'Build per NOVAKAI-PLAN:docs/novakai/plans/no-such.plan.json' },
    }, { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: NOVAKAI-PLAN sentinel pointing at a coherent plan (exit 0)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    writeFileSync(join(dir, 'the.plan.json'), JSON.stringify({ changes: [] }) + '\n');
    const result = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'Build per NOVAKAI-PLAN:the.plan.json' } },
      { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0, result.stdout + result.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: near-miss sentinel NOVAKAI_PLAN (underscore typo) blocks (exit 2)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    const result = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'Build per NOVAKAI_PLAN: the.plan.json' } },
      { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /near-miss/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: prose "novakai plan" (space-separated words) is not a near-miss (exit 0)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    const result = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'discuss how the novakai plan loop works' } },
      { NOVAKAI_ROOT: dir });
    assert.equal(result.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M2b: decisions are metered into the fixture log — exit codes unchanged', () => {
  const dir = mkroot({ plan: 'incoherent' });
  try {
    const denied = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'ship the widget' } },
      { NOVAKAI_ROOT: dir });
    assert.equal(denied.status, 2, 'the deny exit code is untouched by telemetry');
    const allowed = gate({ tool_name: 'Bash', tool_input: { command: 'echo hi' } },
      { NOVAKAI_ROOT: dir });
    assert.equal(allowed.status, 0, 'the allow exit code is untouched by telemetry');
    const log = join(dir, 'docs', 'novakai', 'metrics', 'session-log.jsonl');
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((line) => [line.event, line.gate, line.decision]),
      [['gate', 'plan', 'deny'], ['gate', 'plan', 'allow']]);
    assert.match(lines[0].reason, /coherence/, 'the logged reason is the printed reason');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
