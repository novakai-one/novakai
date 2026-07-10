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

const makeNode = (id, over = {}) => (
  { id, label: id, shape: 'rect', color: null, x: 0, y: 0, 'w': 0, 'h': 0, ...over }
);
const makeEdge = (from, toId, style = 'solid') => (
  { id: `e_${from}_${toId}`, from, 'to': toId, label: '', style, routing: 'ortho' }
);
const makeModel = (nodes, edges) => ({ nodes: Object.fromEntries(nodes.map((node) => [node.id, node])), edges });

test('added + removed + changed nodes, added edge', () => {
  const before = makeModel([makeNode('A'), makeNode('B')], [makeEdge('A', 'B')]);
  const after = makeModel(
    [makeNode('A', { label: 'A2' }), makeNode('B'), makeNode('C')],
    [makeEdge('A', 'B'), makeEdge('B', 'C')],
  );
  const result = diffModels(before, after);
  assert.deepEqual(result.addedNodes, ['C']);
  assert.deepEqual(result.removedNodes, []);
  assert.deepEqual(result.changedNodes, [{ id: 'A', field: 'label', before: 'A', after: 'A2' }]);
  assert.deepEqual(result.addedEdges, ['B->C:solid']);
  assert.deepEqual(result.removedEdges, []);
  assert.equal(result.counts.nAdd, 1);
  assert.equal(result.counts.nChg, 1);
  assert.equal(result.counts.eAdd, 1);
});

test('removed node + removed edge', () => {
  const before = makeModel([makeNode('A'), makeNode('B'), makeNode('X')], [makeEdge('A', 'B'), makeEdge('X', 'A')]);
  const after = makeModel([makeNode('A'), makeNode('B')], [makeEdge('A', 'B')]);
  const result = diffModels(before, after);
  assert.deepEqual(result.removedNodes, ['X']);
  assert.deepEqual(result.removedEdges, ['X->A:solid']);
  assert.equal(result.counts.nRem, 1);
  assert.equal(result.counts.eRem, 1);
});

test('identical models = zero diff', () => {
  const model1 = makeModel([makeNode('A'), makeNode('B')], [makeEdge('A', 'B')]);
  const model2 = makeModel([makeNode('A'), makeNode('B')], [makeEdge('A', 'B')]);
  const result = diffModels(model1, model2);
  assert.equal(result.counts.nAdd + result.counts.nRem + result.counts.nChg, 0);
  assert.equal(result.counts.eAdd + result.counts.eRem, 0);
  assert.equal(result.counts.nUnchanged, 2);
  assert.equal(result.counts.eUnchanged, 1);
});

test('edge style change = remove old + add new', () => {
  const before = makeModel([makeNode('A'), makeNode('B')], [makeEdge('A', 'B', 'solid')]);
  const after = makeModel([makeNode('A'), makeNode('B')], [makeEdge('A', 'B', 'dotted')]);
  const result = diffModels(before, after);
  assert.deepEqual(result.removedEdges, ['A->B:solid']);
  assert.deepEqual(result.addedEdges, ['A->B:dotted']);
});

test('shape + kind changes both reported', () => {
  const before = makeModel([makeNode('A', { shape: 'rect', kind: 'module' })], []);
  const after = makeModel([makeNode('A', { shape: 'round', kind: 'function' })], []);
  const result = diffModels(before, after);
  const fields = result.changedNodes.map((change) => change.field).sort();
  assert.deepEqual(fields, ['kind', 'shape']);
  assert.equal(result.counts.nChg, 1);  // one node, two field changes
});

test('edgeKey ignores volatile id', () => {
  assert.equal(edgeKey(makeEdge('A', 'B')), edgeKey({ ...makeEdge('A', 'B'), id: 'e_999' }));
});
