/* verify-change.test.mjs — acceptance for the closed-form verdict (node #2).
   Proves: a real implemented+contracted change verdicts PASS (structural built
   AND behavioural green), a pending change verdicts FAIL, the verdict is
   data-only with a valid hash, and emission is byte-deterministic. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'flowmap', 'contract', 'verify-change.mjs');

// M2b: FLOWMAP_ROOT is the emitter seam only — verdict events from these runs
// land in a scratch sink, never in the repo's real metrics log.
const SINK = mkdtempSync(join(tmpdir(), 'verify-change-metrics-'));
process.on('exit', () => rmSync(SINK, { recursive: true, force: true }));
const SINK_LOG = join(SINK, 'docs', 'flowmap', 'metrics', 'session-log.jsonl');

function run(args) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    env: { ...process.env, FLOWMAP_ROOT: SINK },
  });
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

test('PASS_UNPROVEN exits 1 under --strict (JSON unchanged)', () => {
  const r = run(['--change', 'fit-clamp', '--json', '--strict']);
  assert.equal(r.status, 1);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'PASS_UNPROVEN');
});

test('PASS still exits 0 under --strict', () => {
  const r = run(['--change', 'frame-transform', '--json', '--strict']);
  assert.equal(r.status, 0);
  const v = JSON.parse(r.stdout);
  assert.equal(v.verdict, 'PASS');
});

test('M2b: each verdict is metered to the side log; the canonical stdout stays byte-identical', () => {
  const before = existsSync(SINK_LOG) ? readFileSync(SINK_LOG, 'utf8').split('\n').filter(Boolean).length : 0;
  const a = run(['--change', 'fit-clamp', '--json']).stdout;
  const b = run(['--change', 'fit-clamp', '--json', '--strict']).stdout;
  assert.equal(a, b, 'telemetry must not perturb the deterministic verdict bytes');
  const lines = readFileSync(SINK_LOG, 'utf8').split('\n').filter(Boolean).slice(before).map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.event, l.tool, l.verdict, l.strict]),
    [['verdict', 'verify-change', 'PASS_UNPROVEN', false], ['verdict', 'verify-change', 'PASS_UNPROVEN', true]]);
  assert.equal(lines[0].change, 'fit-clamp');
});
