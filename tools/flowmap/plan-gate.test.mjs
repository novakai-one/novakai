/* plan-gate.test.mjs — offline acceptance for the M2 ExitPlanMode plan-gate.
   Proves the allow/deny logic by piping synthetic PreToolUse payloads on
   stdin against fixture checkouts (FLOWMAP_ROOT seam). Same harness pattern
   as contract-gate.test / edit-gate.test. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join('tools', 'flowmap', 'plan-gate.mjs');

function gate(payload, env = {}) {
  const r = spawnSync('node', [CLI], {
    cwd: ROOT, input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** Fixture checkout: the real map's bytes, and optionally an in-flight
    public/plan.json — 'none' | 'coherent' | 'incoherent'. */
function mkroot({ plan = 'none' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'plan-gate-'));
  mkdirSync(join(dir, 'docs', 'flowmap'), { recursive: true });
  mkdirSync(join(dir, 'public'), { recursive: true });
  writeFileSync(join(dir, 'docs', 'flowmap', '_bundle.mmd'),
    readFileSync(join(ROOT, 'docs', 'flowmap', '_bundle.mmd')));
  if (plan !== 'none') {
    const changes = plan === 'coherent' ? [] : [
      { id: 'ghost', target: { kind: 'node', ref: 'no_such__node_xyz' }, status: 'modify' },
    ];
    writeFileSync(join(dir, 'public', 'plan.json'), JSON.stringify({ changes }) + '\n');
  }
  return dir;
}

test('ALLOW: a non-ExitPlanMode tool is never gated (exit 0)', () => {
  const r = gate({ tool_name: 'Bash', tool_input: { command: 'echo hi' } });
  assert.equal(r.status, 0);
});

test('DENY (fail-closed): malformed stdin cannot be verified, so it blocks (exit 2)', () => {
  const r = gate('not json at all');
  assert.equal(r.status, 2);
  assert.match(r.stdout, /"decision":"deny"/);
});

test('ALLOW: no sentinel and no in-flight plan — nothing to check (exit 0)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    const r = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'refactor the widget' } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: no sentinel, in-flight public/plan.json is coherent (exit 0)', () => {
  const dir = mkroot({ plan: 'coherent' });
  try {
    const r = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'ship the feature' } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: no sentinel, in-flight public/plan.json is INCOHERENT (exit 2)', () => {
  const dir = mkroot({ plan: 'incoherent' });
  try {
    const r = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'ship the feature' } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /"decision":"deny"/);
    assert.match(r.stdout, /coheren|plan-check/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: FLOWMAP-PLAN sentinel with an unresolvable path (exit 2)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    const r = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'Build per FLOWMAP-PLAN:docs/flowmap/plans/no-such.plan.json' } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: FLOWMAP-PLAN sentinel pointing at a coherent plan (exit 0)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    writeFileSync(join(dir, 'the.plan.json'), JSON.stringify({ changes: [] }) + '\n');
    const r = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'Build per FLOWMAP-PLAN:the.plan.json' } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('DENY: near-miss sentinel FLOWMAP_PLAN (underscore typo) blocks (exit 2)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    const r = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'Build per FLOWMAP_PLAN: the.plan.json' } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 2);
    assert.match(r.stdout, /near-miss/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('ALLOW: prose "flowmap plan" (space-separated words) is not a near-miss (exit 0)', () => {
  const dir = mkroot({ plan: 'none' });
  try {
    const r = gate({ tool_name: 'ExitPlanMode', tool_input: { plan: 'discuss how the flowmap plan loop works' } },
      { FLOWMAP_ROOT: dir });
    assert.equal(r.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
