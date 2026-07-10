/* =====================================================================
   core-diff.test.ts — characterization tests for src/core/diff/diff.ts
   ---------------------------------------------------------------------
   Covers diffModels (added/removed/changed nodes, added/removed edges,
   no-change), edgeKey and the internal fmSig behavior (observed through
   changedNodes' before/after fm signature strings). expected values are
   observed behavior, not spec.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffModels, edgeKey } from '../../src/core/diff/diff.ts';

function mkN(id: string, label: string, extra: any = {}): any {
  return { id, label, shape: 'rect', color: null, x: 0, y: 0, 'w': 100, 'h': 50, ...extra };
}
function mkE(id: string, from: string, dest: string, style = 'solid'): any {
  return { id, from, 'to': dest, label: '', style, routing: 'straight' };
}

test('edgeKey: "from->to:style", volatile .id excluded', () => {
  assert.equal(edgeKey(mkE('e1', 'a', 'b', 'dotted')), 'a->b:dotted');
});

test('diffModels: identical before/after -> empty diff, full unchanged counts', () => {
  const before = { nodes: { 'a': mkN('a', 'A'), 'b': mkN('b', 'B') }, edges: [mkE('e1', 'a', 'b')] };
  const after = { nodes: { 'a': mkN('a', 'A'), 'b': mkN('b', 'B') }, edges: [mkE('e1', 'a', 'b')] };
  assert.deepEqual(diffModels(before, after), {
    addedNodes: [], removedNodes: [], changedNodes: [], addedEdges: [], removedEdges: [],
    counts: { nAdd: 0, nRem: 0, nChg: 0, eAdd: 0, eRem: 0, nUnchanged: 2, eUnchanged: 1 },
  });
});

test('diffModels: an added node is reported and does not affect unchanged counts', () => {
  const before = { nodes: { 'a': mkN('a', 'A'), 'b': mkN('b', 'B') }, edges: [mkE('e1', 'a', 'b')] };
  const after = {
    nodes: { 'a': mkN('a', 'A'), 'b': mkN('b', 'B'), 'c': mkN('c', 'C') },
    edges: [mkE('e1', 'a', 'b')],
  };
  const diff = diffModels(before, after);
  assert.deepEqual(diff.addedNodes, ['c']);
  assert.deepEqual(diff.counts, { nAdd: 1, nRem: 0, nChg: 0, eAdd: 0, eRem: 0, nUnchanged: 2, eUnchanged: 1 });
});

test('diffModels: a removed node also drops its incident edge as removed', () => {
  const before = { nodes: { 'a': mkN('a', 'A'), 'b': mkN('b', 'B') }, edges: [mkE('e1', 'a', 'b')] };
  const after = { nodes: { 'a': mkN('a', 'A') }, edges: [] };
  const diff = diffModels(before, after);
  assert.deepEqual(diff.removedNodes, ['b']);
  assert.deepEqual(diff.removedEdges, ['a->b:solid']);
});

test('diffModels: a changed label reports one changedNodes entry with field "label"', () => {
  const before = { nodes: { 'a': mkN('a', 'A'), 'b': mkN('b', 'B') }, edges: [mkE('e1', 'a', 'b')] };
  const after = { nodes: { 'a': mkN('a', 'A2'), 'b': mkN('b', 'B') }, edges: [mkE('e1', 'a', 'b')] };
  assert.deepEqual(diffModels(before, after).changedNodes, [{ id: 'a', field: 'label', before: 'A', after: 'A2' }]);
});

test('diffModels: an added edge is reported by its stable key', () => {
  const before = { nodes: { 'a': mkN('a', 'A'), 'b': mkN('b', 'B') }, edges: [mkE('e1', 'a', 'b')] };
  const after = { nodes: before.nodes, edges: [mkE('e1', 'a', 'b'), mkE('e2', 'b', 'a', 'dotted')] };
  assert.deepEqual(diffModels(before, after).addedEdges, ['b->a:dotted']);
});

test('diffModels: identical frontmatter -> no change reported', () => {
  const frontmatter = {
    name: 'X', description: 'd', state: ['s1'],
    interfaces: [{ name: 'i', accepts: ['a'], returns: ['b'] }],
  };
  const before = { nodes: { 'a': mkN('a', 'A', { 'fm': frontmatter }) }, edges: [] };
  const after = { nodes: { 'a': mkN('a', 'A', { 'fm': { ...frontmatter } }) }, edges: [] };
  assert.deepEqual(diffModels(before, after).changedNodes, []);
});

test('diffModels: a changed frontmatter description reports field "fm" with §-joined signatures', () => {
  const frontmatter = {
    name: 'X', description: 'd', state: ['s1'],
    interfaces: [{ name: 'i', accepts: ['a'], returns: ['b'] }],
  };
  const before = { nodes: { 'a': mkN('a', 'A', { 'fm': frontmatter }) }, edges: [] };
  const after = {
    nodes: { 'a': mkN('a', 'A', { 'fm': { ...frontmatter, description: 'd2' } }) },
    edges: [],
  };
  assert.deepEqual(diffModels(before, after).changedNodes, [{
    id: 'a', field: 'fm', before: 'X§d§s1§i(a)->(b)', after: 'X§d2§s1§i(a)->(b)',
  }]);
});

test('diffModels: position (x/y/w/h) differences alone are NOT reported as a change', () => {
  const before = { nodes: { 'a': mkN('a', 'A', { x: 0, y: 0 }) }, edges: [] };
  const after = { nodes: { 'a': mkN('a', 'A', { x: 999, y: 999 }) }, edges: [] };
  assert.deepEqual(diffModels(before, after).changedNodes, []);
});
