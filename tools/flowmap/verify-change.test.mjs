/* verify-change.test.mjs — acceptance for the closed-form verdict (node #2).
   Proves: a real implemented+contracted change verdicts PASS (structural built
   AND behavioural green), a pending change verdicts FAIL, the verdict is
   data-only with a valid hash, and emission is byte-deterministic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from './lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join('tools', 'flowmap', 'verify-change.mjs');

function run(args) {
  const r = spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('an implemented + contracted change verdicts PASS (structural built AND behavioural green)', () => {
  const r = run(['--change', 'frame-transform', '--json']);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'PASS');
  assert.equal(v.structural.status, 'built');
  assert.equal(v.behavioural.hasContract, true);
  assert.equal(v.behavioural.passed, v.behavioural.total);
  assert.equal(v.behavioural.total, 3);
});

test('a built but UNCONTRACTED change verdicts PASS_UNPROVEN (never a bare PASS)', () => {
  // fit-clamp is a structure-only built change with no behavioural contract.
  const r = run(['--change', 'fit-clamp', '--json']);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'PASS_UNPROVEN');
  assert.equal(v.structural.status, 'built');
  assert.equal(v.behavioural.hasContract, false);
  assert.equal(v.behavioural.proven, false);
});

test('a pending (unimplemented) change verdicts FAIL with exit 1', () => {
  const r = run(['--change', 'frame-node', '--json']);
  assert.equal(r.status, 1);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'FAIL');
  assert.equal(v.structural.status, 'pending');
});

test('the verdict is data-only with a valid content hash', () => {
  const r = run(['--change', 'frame-transform', '--json']);
  const v = JSON.parse(r.stdout);
  const { verdictHash, ...body } = v;
  assert.equal(hashOf(body), verdictHash);
  // data-only: no free-text / path / time fields leaked into the verdict
  assert.equal(JSON.stringify(v).includes('/'), false, 'verdict must contain no paths');
});

test('emission is byte-deterministic (same change -> identical bytes)', () => {
  const a = run(['--change', 'frame-transform', '--json']).stdout;
  const b = run(['--change', 'frame-transform', '--json']).stdout;
  assert.equal(a, b);
});

test('a missing change id is a hard error (exit 3)', () => {
  const r = run(['--change', 'no-such-change-xyz', '--json']);
  assert.equal(r.status, 3);
});
