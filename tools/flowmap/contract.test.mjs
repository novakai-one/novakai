/* contract.test.mjs — acceptance for the per-change packet emitter (node #1).
   Proves: routes real source+signature+acceptance+blast-radius into a packet,
   the packet is coherent and carries a valid content hash, byte-deterministic
   output, and a missing change id is a hard error. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from './lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join('tools', 'flowmap', 'contract.mjs');

function run(args) {
  const r = spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('emits a coherent packet for a real change, routing real source/signature/acceptance', () => {
  const r = run(['--change', 'frame-transform', '--json']);
  assert.equal(r.status, 0);
  const p = JSON.parse(r.stdout);
  assert.equal(p.change.id, 'frame-transform');
  assert.equal(p.change.target.ref, 'state__frameTransform');
  assert.equal(p.source.path, 'src/core/state/state.ts');
  assert.equal(p.source.symbol, 'frameTransform');
  assert.equal(p.signature.interfaces[0].name, 'frameTransform');
  assert.equal(p.hasBehaviouralContract, true);
  assert.equal(p.acceptance.cases.length, 3);
  assert.ok(p.blastRadius, 'node change carries a blast radius object');
  assert.equal(p.coherent, true);
});

test('packet carries a VALID content hash (hash == hashOf(body without hash))', () => {
  const r = run(['--change', 'frame-transform', '--json']);
  const p = JSON.parse(r.stdout);
  const { contractHash, ...body } = p;
  assert.equal(typeof contractHash, 'string');
  assert.equal(hashOf(body), contractHash, 'embedded hash must match a recompute over the body');
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

test('no --change is a usage error (exit 2)', () => {
  const r = run(['--json']);
  assert.equal(r.status, 2);
});
