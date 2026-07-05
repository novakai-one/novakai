/* contract.test.mjs — acceptance for the per-change packet emitter (node #1).
   Proves: routes real source+signature+acceptance+blast-radius into a packet,
   the packet is coherent and carries a valid content hash, byte-deterministic
   output, and a missing change id is a hard error. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'contract', 'contract.mjs');

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

test('packet carries a scoped subMap + dependency-cone slicedBodies (WI-4)', () => {
  const r = run(['--change', 'frame-transform', '--json']);
  const p = JSON.parse(r.stdout);

  // subMap contains the target node.
  assert.ok(p.subMap.nodes['state__frameTransform'], 'subMap must contain the target node');

  // slicedBodies is a strict subset of the full bodies.json...
  const full = JSON.parse(readFileSync(join(ROOT, 'public', 'bodies.json'), 'utf8'));
  const fullKeys = new Set(Object.keys(full));
  const slicedKeys = Object.keys(p.slicedBodies);
  assert.ok(slicedKeys.length > 0, 'slicedBodies must be non-empty');
  for (const k of slicedKeys) assert.ok(fullKeys.has(k), `slicedBodies key "${k}" must exist in bodies.json`);
  assert.ok(slicedKeys.length < fullKeys.size, 'slicedBodies must be a STRICT subset (smaller than full)');

  // ...and contains the target's map-derived callees (subMap descendants minus the target itself).
  for (const id of Object.keys(p.subMap.nodes)) {
    if (id === 'state__frameTransform') continue;
    assert.ok(slicedKeys.includes(id), `slicedBodies must include callee "${id}"`);
  }

  // size << full (much smaller, e.g. less than half).
  assert.ok(slicedKeys.length < fullKeys.size / 2, 'slicedBodies must be much smaller than the full bodies.json');
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
