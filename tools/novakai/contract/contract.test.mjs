/* contract.test.mjs — acceptance for the per-change packet emitter (node #1).
   Proves: routes real source+signature+acceptance+blast-radius into a packet,
   the packet is coherent and carries a valid content hash, byte-deterministic
   output, and a missing change id is a hard error. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'contract', 'contract.mjs');

function run(args) {
  const r = spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/* ---- fixture builder for the slice-completeness gate (WI-5) ----
   A tiny synthetic map + bodies.json + plan, independent of the real repo
   map, so the negative case (a called symbol excluded from the slice) is
   deterministic and doesn't depend on the real bundle ever having a gap. */
function makeFixture({ withOutOfScope = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'contract-gate-'));
  const mapPath = join(dir, 'fixture.mmd');
  const bodiesPath = join(dir, 'bodies.json');
  const planPath = join(dir, 'plan.json');

  // map: fx__target -down-> fx__included only. fx__excluded is NOT in the map
  // at all, so it can never land in the slice via map edges.
  writeFileSync(
    mapPath,
    ['flowchart LR', '  fx__target("target")', '  fx__included("included")', '  fx__target --> fx__included', ''].join('\n'),
  );

  writeFileSync(
    bodiesPath,
    JSON.stringify({
      fx__target: { kind: 'function', body: 'fx target body', calls: ['fx__included', 'fx__excluded'] },
      fx__included: { kind: 'function', body: 'fx included body', calls: [] },
    }),
  );

  const change = { id: 'fx-change', status: 'modify', target: { kind: 'node', ref: 'fx__target' }, phase: 1, risk: 'low' };
  if (withOutOfScope) change.outOfScope = ['fx__excluded'];
  writeFileSync(planPath, JSON.stringify({ changes: [change] }));

  return { dir, mapPath, bodiesPath, planPath };
}

function runFixture(fixture) {
  return run(['--change', 'fx-change', '--plan', fixture.planPath, '--map', fixture.mapPath, '--bodies', fixture.bodiesPath, '--json']);
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

test('slice-completeness gate (WI-5): a complete real cone passes (frame-transform)', () => {
  const r = run(['--change', 'frame-transform', '--json']);
  assert.equal(r.status, 0, `expected the real change's complete cone to pass the gate; stderr: ${r.stderr}`);
});

test('slice-completeness gate (WI-5): a called symbol excluded from the slice FAILS closed, named', () => {
  const fixture = makeFixture({ withOutOfScope: false });
  try {
    const r = runFixture(fixture);
    assert.notEqual(r.status, 0, 'gate must fail (non-zero exit) when a called symbol is missing from the slice');
    assert.match(r.stderr, /slice-completeness gate FAILED/);
    assert.match(r.stderr, /fx__excluded/, 'the missing symbol must be named in the output');
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('slice-completeness gate (WI-5): declaring the symbol outOfScope flips the gate back to passing', () => {
  const fixture = makeFixture({ withOutOfScope: true });
  try {
    const r = runFixture(fixture);
    assert.equal(r.status, 0, `outOfScope should flip the gate to passing; stderr: ${r.stderr}`);
    const p = JSON.parse(r.stdout);
    assert.equal(p.change.id, 'fx-change');
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});
