/* waves.test.mjs — node:test suite for the execution-wave scheduler.
   Proves: pure topology, built-dep passthrough, byte-determinism,
   cycle detection, and wavesHash integrity. */
import { test }                    from 'node:test';
import assert                      from 'node:assert/strict';
import { spawnSync }               from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { dirname, join }           from 'node:path';
import { fileURLToPath }           from 'node:url';
import os                          from 'node:os';
import { hashOf }                  from './lib/canonical.mjs';

const HERE        = dirname(fileURLToPath(import.meta.url));
const ROOT        = join(HERE, '..', '..');
const CLI         = join('tools', 'flowmap', 'waves.mjs');
const REAL_MAP    = join(ROOT, 'docs', 'flowmap', '_bundle.mmd');
const REAL_TSCONFIG = join(ROOT, 'tsconfig.json');
const REAL_PLAN   = join(ROOT, 'public', 'plan.json');

function run(args) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

function writeTempPlan(obj) {
  const dir = mkdtempSync(join(os.tmpdir(), 'waves-test-'));
  const p   = join(dir, 'plan.json');
  writeFileSync(p, JSON.stringify(obj), 'utf8');
  return p;
}

// ── Test 1: pure topology A → B → C (all pending, fake refs not in code) ────
test('topology: linear A->B->C produces waves [[A],[B],[C]]', () => {
  const planPath = writeTempPlan({
    base: 'test-topology',
    changes: [
      { id: 'A', status: 'add', target: { kind: 'node', ref: 'fakeRef_A_waves_test_xyz' } },
      { id: 'B', status: 'add', target: { kind: 'node', ref: 'fakeRef_B_waves_test_xyz' }, dependsOn: ['A'] },
      { id: 'C', status: 'add', target: { kind: 'node', ref: 'fakeRef_C_waves_test_xyz' }, dependsOn: ['B'] },
    ],
  });
  const r = run(['--plan', planPath, '--map', REAL_MAP, '--tsconfig', REAL_TSCONFIG, '--json']);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr: ${r.stderr.slice(0, 400)}`);
  const out = JSON.parse(r.stdout);
  assert.deepEqual(out.waves,  [['A'], ['B'], ['C']], 'waves must be [[A],[B],[C]]');
  assert.deepEqual(out.done,   [], 'no changes are built yet');
  assert.deepEqual(out.cyclic, [], 'no cycles');
});

// ── Test 2: a built dep (frame-transform) does not appear in any wave ────────
test('built dep does not block: frame-transform in done, not in waves', () => {
  const r = run(['--plan', REAL_PLAN, '--map', REAL_MAP, '--tsconfig', REAL_TSCONFIG, '--json']);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr: ${r.stderr.slice(0, 400)}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.done.includes('frame-transform'), '"frame-transform" must be in done (it is built)');
  const inWaves = out.waves.some((w) => w.includes('frame-transform'));
  assert.equal(inWaves, false, '"frame-transform" must not appear in any wave');
});

// ── Test 3: byte-identical determinism across two runs ───────────────────────
test('determinism: two runs on real plan produce byte-identical stdout', () => {
  const args = ['--plan', REAL_PLAN, '--map', REAL_MAP, '--tsconfig', REAL_TSCONFIG, '--json'];
  const a    = run(args).stdout;
  const b    = run(args).stdout;
  assert.equal(a, b, 'stdout must be byte-identical across runs');
});

// ── Test 4: cycle detection — A ↔ B excluded from waves ─────────────────────
test('cycle detection: A<->B produces cyclic=[A,B], neither in waves', () => {
  const planPath = writeTempPlan({
    base: 'test-cycle',
    changes: [
      { id: 'A', status: 'add', target: { kind: 'node', ref: 'fakeRef_cycleA_waves_test_xyz' }, dependsOn: ['B'] },
      { id: 'B', status: 'add', target: { kind: 'node', ref: 'fakeRef_cycleB_waves_test_xyz' }, dependsOn: ['A'] },
    ],
  });
  const r = run(['--plan', planPath, '--map', REAL_MAP, '--tsconfig', REAL_TSCONFIG, '--json']);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr: ${r.stderr.slice(0, 400)}`);
  const out = JSON.parse(r.stdout);
  assert.ok(out.cyclic.includes('A'), '"A" must be in cyclic');
  assert.ok(out.cyclic.includes('B'), '"B" must be in cyclic');
  const inWaves = out.waves.some((w) => w.includes('A') || w.includes('B'));
  assert.equal(inWaves, false, 'cyclic ids must not appear in any wave');
});

// ── AUD5/F-18: --strict makes a cycle a BLOCKING exit, not just data ─────────
test('F-18 --strict: a dependency cycle exits 1; without the flag it stays data-only (exit 0)', () => {
  const planPath = writeTempPlan({
    base: 'test-cycle-strict',
    changes: [
      { id: 'A', status: 'add', target: { kind: 'node', ref: 'fakeRef_cycleA_strict_xyz' }, dependsOn: ['B'] },
      { id: 'B', status: 'add', target: { kind: 'node', ref: 'fakeRef_cycleB_strict_xyz' }, dependsOn: ['A'] },
    ],
  });
  const strict = run(['--plan', planPath, '--map', REAL_MAP, '--tsconfig', REAL_TSCONFIG, '--json', '--strict']);
  assert.equal(strict.status, 1, `--strict must exit 1 on a cyclic plan, got ${strict.status}`);
  assert.ok(JSON.parse(strict.stdout).cyclic.length >= 2, 'the report still carries the cyclic ids');
  const lax = run(['--plan', planPath, '--map', REAL_MAP, '--tsconfig', REAL_TSCONFIG, '--json']);
  assert.equal(lax.status, 0, 'without --strict the cycle stays reported data (documented)');
});

test('F-18 --strict: a cycle-free plan still exits 0 under --strict', () => {
  const planPath = writeTempPlan({
    base: 'test-nocycle-strict',
    changes: [
      { id: 'A', status: 'add', target: { kind: 'node', ref: 'fakeRef_nocycleA_strict_xyz' } },
    ],
  });
  const r = run(['--plan', planPath, '--map', REAL_MAP, '--tsconfig', REAL_TSCONFIG, '--json', '--strict']);
  assert.equal(r.status, 0, `cycle-free --strict must exit 0, got ${r.status}; ${r.stderr.slice(0, 300)}`);
});

// ── Test 5: wavesHash integrity ──────────────────────────────────────────────
test('wavesHash integrity: hashOf(body-without-wavesHash) === wavesHash', () => {
  const r = run(['--plan', REAL_PLAN, '--map', REAL_MAP, '--tsconfig', REAL_TSCONFIG, '--json']);
  assert.equal(r.status, 0, `expected exit 0, got ${r.status}; stderr: ${r.stderr.slice(0, 400)}`);
  const out              = JSON.parse(r.stdout);
  const { wavesHash, ...body } = out;
  assert.equal(typeof wavesHash, 'string', 'wavesHash must be a string');
  assert.equal(hashOf(body), wavesHash, 'hashOf(body without wavesHash) must equal the embedded wavesHash');
});
