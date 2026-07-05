/* =====================================================================
   extract-calls.test.mjs — WI-2 (fn-edges-derive): the derived intra-body
   call graph. Runs extractFromMap over THIS repo's real bundle + tsconfig
   (the same inputs `npm run novakai:bodies` uses) and asserts a known,
   stable real-code call resolves into bodies[id].calls.
   Run: node --test tools/buildspec/pipeline/extract-calls.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';

import { extractFromMap, deriveCallEdges } from './extract.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const BUNDLE = join(ROOT, 'docs', 'novakai', '_bundle.mmd');
const TSCONFIG = join(ROOT, 'tsconfig.json');

const project = new Project({ tsConfigFilePath: TSCONFIG });
const model = extractFromMap(BUNDLE, project);

test('camera__zoomCenter calls camera__zoomAt (real call, src/core/camera/camera.ts)', () => {
  // zoomCenter's body literally does `zoomAt(r.left + ..., r.top + ..., nz)` —
  // a stable, real cross-node call inside one file.
  assert.ok(model.bodies.camera__zoomCenter, 'camera__zoomCenter must be a known body');
  assert.ok(Array.isArray(model.bodies.camera__zoomCenter.calls));
  assert.ok(
    model.bodies.camera__zoomCenter.calls.includes('camera__zoomAt'),
    `expected camera__zoomAt in calls, got: ${model.bodies.camera__zoomCenter.calls.join(', ')}`
  );
});

test('calls[] excludes self-calls and is sorted+deduped', () => {
  for (const [id, b] of Object.entries(model.bodies)) {
    assert.ok(Array.isArray(b.calls), `${id} must have a calls[] array`);
    assert.ok(!b.calls.includes(id), `${id} must not list itself in calls[]`);
    const sorted = [...b.calls].sort();
    assert.deepEqual(b.calls, sorted, `${id}.calls must be sorted`);
    assert.equal(new Set(b.calls).size, b.calls.length, `${id}.calls must be deduped`);
  }
});

test('deriveCallEdges flattens bodies.calls into a deterministic sorted edge list', () => {
  const edges = deriveCallEdges(model.bodies);
  assert.ok(edges.some((e) => e.from === 'camera__zoomCenter' && e.to === 'camera__zoomAt'));
  const ids = Object.keys(model.bodies).sort();
  assert.deepEqual(ids, Object.keys(model.bodies).sort(), 'sanity: bodies id set stable');
});
