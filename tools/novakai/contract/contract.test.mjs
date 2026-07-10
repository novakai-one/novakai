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
import { FROZEN } from '../lib/scope.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CLI = join('tools', 'novakai', 'contract', 'contract.mjs');
const FRAME_TRANSFORM = 'frame-transform';

function run(args) {
  const res = spawnSync('node', [CLI, ...args], { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/* ---- fixture builder for the slice-completeness gate (WI-5) ----
   A tiny synthetic map + bodies.json + plan, independent of the real repo
   map, so the negative case (a called symbol excluded from the slice) is
   deterministic and doesn't depend on the real bundle ever having a gap. */
function writeFixtureMapAndBodies(dir) {
  const mapPath = join(dir, 'fixture.mmd');
  const bodiesPath = join(dir, 'bodies.json');

  // map: fx__target -down-> fx__included only. fx__excluded is NOT in the map
  // at all, so it can never land in the slice via map edges.
  writeFileSync(
    mapPath,
    ['flowchart LR', '  fx__target("target")', '  fx__included("included")', '  fx__target --> fx__included', '']
      .join('\n'),
  );

  writeFileSync(
    bodiesPath,
    JSON.stringify({
      fx__target: { kind: 'function', body: 'fx target body', calls: ['fx__included', 'fx__excluded'] },
      fx__included: { kind: 'function', body: 'fx included body', calls: [] },
    }),
  );

  return { mapPath, bodiesPath };
}

function makeFixture({ withOutOfScope = false, extra = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'contract-gate-'));
  const { mapPath, bodiesPath } = writeFixtureMapAndBodies(dir);
  const planPath = join(dir, 'plan.json');

  const change = {
    id: 'fx-change', status: 'modify', target: { kind: 'node', ref: 'fx__target' }, phase: 1, risk: 'low', ...extra,
  };
  if (withOutOfScope) change.outOfScope = ['fx__excluded'];
  writeFileSync(planPath, JSON.stringify({ changes: [change] }));

  return { dir, mapPath, bodiesPath, planPath };
}

function runFixture(fixture) {
  return run([
    '--change', 'fx-change', '--plan', fixture.planPath,
    '--map', fixture.mapPath, '--bodies', fixture.bodiesPath, '--json',
  ]);
}

test('emits a coherent packet for a real change, routing real source/signature/acceptance', () => {
  const res = run(['--change', FRAME_TRANSFORM, '--json']);
  assert.equal(res.status, 0);
  const packet = JSON.parse(res.stdout);
  assert.equal(packet.change.id, FRAME_TRANSFORM);
  assert.equal(packet.change.target.ref, 'state__frameTransform');
  assert.equal(packet.source.path, 'src/core/state/state.ts');
  assert.equal(packet.source.symbol, 'frameTransform');
  assert.equal(packet.signature.interfaces[0].name, 'frameTransform');
  assert.equal(packet.hasBehaviouralContract, true);
  assert.equal(packet.acceptance.cases.length, 3);
  assert.ok(packet.blastRadius, 'node change carries a blast radius object');
  assert.equal(packet.coherent, true);
});

function assertSlicedBodiesSubset(packet) {
  // slicedBodies is a strict subset of the full bodies.json...
  const full = JSON.parse(readFileSync(join(ROOT, 'public', 'bodies.json'), 'utf8'));
  const fullKeys = new Set(Object.keys(full));
  const slicedKeys = Object.keys(packet.slicedBodies);
  assert.ok(slicedKeys.length > 0, 'slicedBodies must be non-empty');
  for (const key of slicedKeys) assert.ok(fullKeys.has(key), `slicedBodies key "${key}" must exist in bodies.json`);
  assert.ok(slicedKeys.length < fullKeys.size, 'slicedBodies must be a STRICT subset (smaller than full)');

  // ...and contains the target's map-derived callees (subMap descendants minus the target itself).
  for (const id of Object.keys(packet.subMap.nodes)) {
    if (id === 'state__frameTransform') continue;
    assert.ok(slicedKeys.includes(id), `slicedBodies must include callee "${id}"`);
  }

  // size << full (much smaller, e.g. less than half).
  assert.ok(slicedKeys.length < fullKeys.size / 2, 'slicedBodies must be much smaller than the full bodies.json');
}

test('packet carries a scoped subMap + dependency-cone slicedBodies (WI-4)', () => {
  const res = run(['--change', FRAME_TRANSFORM, '--json']);
  const packet = JSON.parse(res.stdout);

  // subMap contains the target node.
  assert.ok(packet.subMap.nodes['state__frameTransform'], 'subMap must contain the target node');

  assertSlicedBodiesSubset(packet);
});

test('packet carries a VALID content hash (hash == hashOf(body without hash))', () => {
  const res = run(['--change', FRAME_TRANSFORM, '--json']);
  const packet = JSON.parse(res.stdout);
  const { contractHash, ...body } = packet;
  assert.equal(typeof contractHash, 'string');
  assert.equal(hashOf(body), contractHash, 'embedded hash must match a recompute over the body');
});

test('emission is byte-deterministic (same change -> identical bytes)', () => {
  const stdoutA = run(['--change', FRAME_TRANSFORM, '--json']).stdout;
  const stdoutB = run(['--change', FRAME_TRANSFORM, '--json']).stdout;
  assert.equal(stdoutA, stdoutB);
});

test('a missing change id is a hard error (exit 3)', () => {
  const res = run(['--change', 'no-such-change-xyz', '--json']);
  assert.equal(res.status, 3);
});

test('no --change is a usage error (exit 2)', () => {
  const res = run(['--json']);
  assert.equal(res.status, 2);
});

test('slice-completeness gate (WI-5): a complete real cone passes (frame-transform)', () => {
  const res = run(['--change', FRAME_TRANSFORM, '--json']);
  assert.equal(res.status, 0, `expected the real change's complete cone to pass the gate; stderr: ${res.stderr}`);
});

test('slice-completeness gate (WI-5): a called symbol excluded from the slice FAILS closed, named', () => {
  const fixture = makeFixture({ withOutOfScope: false });
  try {
    const res = runFixture(fixture);
    assert.notEqual(res.status, 0, 'gate must fail (non-zero exit) when a called symbol is missing from the slice');
    assert.match(res.stderr, /slice-completeness gate FAILED/);
    assert.match(res.stderr, /fx__excluded/, 'the missing symbol must be named in the output');
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('slice-completeness gate (WI-5): declaring the symbol outOfScope flips the gate back to passing', () => {
  const fixture = makeFixture({ withOutOfScope: true });
  try {
    const res = runFixture(fixture);
    assert.equal(res.status, 0, `outOfScope should flip the gate to passing; stderr: ${res.stderr}`);
    const packet = JSON.parse(res.stdout);
    assert.equal(packet.change.id, 'fx-change');
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

/* ---- C1: editScope ---- */

test('editScope (C1): a real change is scoped to its own module — never the blast-radius cone', () => {
  const res = run(['--change', FRAME_TRANSFORM, '--json']);
  const packet = JSON.parse(res.stdout);
  assert.deepEqual(packet.editScope.deny, FROZEN, 'deny is always the FROZEN wall');
  assert.ok(
    packet.editScope.allow.includes('src/core/state/state.ts'),
    'allow must include the target symbol\'s own source file',
  );
  assert.ok(
    packet.editScope.allow.includes('src/core/state/state.novakai.mmd'),
    'allow must include the colocated fragment',
  );
  // never the blast-radius cone: a sibling module's file must not appear.
  assert.ok(
    !packet.editScope.allow.some((allowPath) => allowPath.includes('camera')),
    'allow must not reach into an unrelated module',
  );
});

test('editScope (C1): change.touches globs are folded into allow', () => {
  const fixture = makeFixture({ withOutOfScope: true, extra: { touches: ['fx/extra/**'] } });
  try {
    const res = runFixture(fixture);
    assert.equal(res.status, 0, res.stderr);
    const packet = JSON.parse(res.stdout);
    assert.ok(packet.editScope.allow.includes('fx/extra/**'), 'declared touches globs must appear in allow');
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

/* ---- C5' packet side: verification / journeys ---- */

test('verification (C5\'): absent block defaults to kind "pure", no journeys — fully backwards compatible', () => {
  const res = run(['--change', FRAME_TRANSFORM, '--json']);
  const packet = JSON.parse(res.stdout);
  assert.deepEqual(packet.verification, { kind: 'pure', journeys: [] });
  assert.equal(packet.coherent, true);
});

test('verification (C5\'): kind dom/visual with NO journeys makes the packet incoherent', () => {
  const fixture = makeFixture({ withOutOfScope: true, extra: { verification: { kind: 'dom', journeys: [] } } });
  try {
    const res = runFixture(fixture);
    assert.equal(res.status, 0, res.stderr);
    const packet = JSON.parse(res.stdout);
    assert.equal(packet.coherent, false);
    assert.ok(packet.coherenceProblems.some((msg) => /verification\.kind="dom"/.test(msg) && /no journeys/.test(msg)));
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

test('verification (C5\'): kind visual WITH journeys passes through and stays coherent', () => {
  const journeys = [{ spec: 'tests/e2e/design.spec.ts', grep: 'frame transform' }];
  const fixture = makeFixture({ withOutOfScope: true, extra: { verification: { kind: 'visual', journeys } } });
  try {
    const res = runFixture(fixture);
    assert.equal(res.status, 0, res.stderr);
    const packet = JSON.parse(res.stdout);
    assert.deepEqual(packet.verification, { kind: 'visual', journeys });
    assert.equal(packet.coherent, true);
  } finally {
    rmSync(fixture.dir, { recursive: true, force: true });
  }
});

/* ---- C8': the spawn-prompt is the dispatch surface ---- */

test(
  'spawn-prompt (C8\'): the human (non --json) output carries a SPAWN PROMPT with the sentinel, '
  + 'regen command, editScope and done-criteria',
  () => {
    const res = run(['--change', FRAME_TRANSFORM]);
    assert.equal(res.status, 0);
    assert.match(res.stdout, /=== SPAWN PROMPT/);
    assert.match(res.stdout, /NOVAKAI-CONTRACT:frame-transform/);
    assert.match(res.stdout, /novakai:contract -- --change frame-transform --json/);
    assert.match(res.stdout, /editScope: allow/);
    assert.match(res.stdout, /Done-criteria: .*novakai:verify-change/);
  },
);
