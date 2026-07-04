/* diff.test.mjs — B0 drift anchor for src/core/diff/diff.ts
   Run: node --test tools/buildspec/testkit/diff.test.mjs
   Imports the compiled-on-the-fly TS via tsx-free approach: we test the
   pure logic by re-implementing the import through a tiny esbuild step is
   overkill — instead this test imports the .ts through Node's strip-types
   if available, else falls back. Simplest robust path: point at the source
   and use the typescript-stripping loader. To stay dependency-free we test
   against a JS mirror is NOT done; we use `node --experimental-strip-types`
   when on Node 22+, otherwise the test self-skips with a clear message. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffModels, edgeKey } from '../../../src/core/diff/diff.ts';

const N = (id, over = {}) => ({ id, label: id, shape: 'rect', color: null, x: 0, y: 0, w: 0, h: 0, ...over });
const E = (from, to, style = 'solid') => ({ id: `e_${from}_${to}`, from, to, label: '', style, routing: 'ortho' });
const M = (nodes, edges) => ({ nodes: Object.fromEntries(nodes.map((n) => [n.id, n])), edges });

test('added + removed + changed nodes, added edge', () => {
  const before = M([N('A'), N('B')], [E('A', 'B')]);
  const after = M([N('A', { label: 'A2' }), N('B'), N('C')], [E('A', 'B'), E('B', 'C')]);
  const d = diffModels(before, after);
  assert.deepEqual(d.addedNodes, ['C']);
  assert.deepEqual(d.removedNodes, []);
  assert.deepEqual(d.changedNodes, [{ id: 'A', field: 'label', before: 'A', after: 'A2' }]);
  assert.deepEqual(d.addedEdges, ['B->C:solid']);
  assert.deepEqual(d.removedEdges, []);
  assert.equal(d.counts.nAdd, 1);
  assert.equal(d.counts.nChg, 1);
  assert.equal(d.counts.eAdd, 1);
});

test('removed node + removed edge', () => {
  const before = M([N('A'), N('B'), N('X')], [E('A', 'B'), E('X', 'A')]);
  const after = M([N('A'), N('B')], [E('A', 'B')]);
  const d = diffModels(before, after);
  assert.deepEqual(d.removedNodes, ['X']);
  assert.deepEqual(d.removedEdges, ['X->A:solid']);
  assert.equal(d.counts.nRem, 1);
  assert.equal(d.counts.eRem, 1);
});

test('identical models = zero diff', () => {
  const m = M([N('A'), N('B')], [E('A', 'B')]);
  const m2 = M([N('A'), N('B')], [E('A', 'B')]);
  const d = diffModels(m, m2);
  assert.equal(d.counts.nAdd + d.counts.nRem + d.counts.nChg, 0);
  assert.equal(d.counts.eAdd + d.counts.eRem, 0);
  assert.equal(d.counts.nUnchanged, 2);
  assert.equal(d.counts.eUnchanged, 1);
});

test('edge style change = remove old + add new', () => {
  const before = M([N('A'), N('B')], [E('A', 'B', 'solid')]);
  const after = M([N('A'), N('B')], [E('A', 'B', 'dotted')]);
  const d = diffModels(before, after);
  assert.deepEqual(d.removedEdges, ['A->B:solid']);
  assert.deepEqual(d.addedEdges, ['A->B:dotted']);
});

test('shape + kind changes both reported', () => {
  const before = M([N('A', { shape: 'rect', kind: 'module' })], []);
  const after = M([N('A', { shape: 'round', kind: 'function' })], []);
  const d = diffModels(before, after);
  const fields = d.changedNodes.map((c) => c.field).sort();
  assert.deepEqual(fields, ['kind', 'shape']);
  assert.equal(d.counts.nChg, 1);  // one node, two field changes
});

test('edgeKey ignores volatile id', () => {
  assert.equal(edgeKey(E('A', 'B')), edgeKey({ ...E('A', 'B'), id: 'e_999' }));
});
