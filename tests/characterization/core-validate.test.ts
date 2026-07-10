/* =====================================================================
   core-validate.test.ts — characterization tests for
   src/core/validate/validate.ts
   ---------------------------------------------------------------------
   Covers validateModel (structural integrity errors), semanticDiff
   (round-trip invariant: identical -> clean, renumbered edge ids ->
   still clean, a real semantic change -> a violation) and edgeIdentities
   (stable content-derived edge identity, incl. parallel-duplicate
   disambiguation). expected values are observed behavior, not spec.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateModel, semanticDiff, edgeIdentities } from '../../src/core/validate/validate.ts';

function mkN(id: string, extra: any = {}): any {
  return { id, label: id, shape: 'rect', color: null, x: 0, y: 0, 'w': 100, 'h': 50, ...extra };
}
function mkE(id: string, from: string, dst: string, style = 'solid'): any {
  return { id, from, 'to': dst, label: '', style, routing: 'straight' };
}

// ---------------------------------------------------------------------
// validateModel
// ---------------------------------------------------------------------

test('validateModel: a well-formed model reports no issues', () => {
  assert.deepEqual(validateModel({ 'a': mkN('a'), 'b': mkN('b') }, [mkE('e1', 'a', 'b')]), []);
});

test('validateModel: a node that is its own parent -> self-parent error', () => {
  assert.deepEqual(validateModel({ 'a': mkN('a', { parent: 'a' }) }, []), [
    { level: 'error', code: 'self-parent', message: '"a" is its own parent', ids: ['a'] },
  ]);
});

test('validateModel: a parent pointing at a missing node -> dangling-parent error', () => {
  assert.deepEqual(validateModel({ 'a': mkN('a', { parent: 'ghost' }) }, []), [
    { level: 'error', code: 'dangling-parent', message: '"a" points to a missing parent "ghost"', ids: ['a'] },
  ]);
});

test('validateModel: a<->b parent cycle -> one parent-cycle error per node in the cycle', () => {
  const issues = validateModel({ 'a': mkN('a', { parent: 'b' }), 'b': mkN('b', { parent: 'a' }) }, []);
  assert.deepEqual(issues, [
    { level: 'error', code: 'parent-cycle', message: '"a" sits in a containment cycle', ids: ['a'] },
    { level: 'error', code: 'parent-cycle', message: '"b" sits in a containment cycle', ids: ['b'] },
  ]);
});

test('validateModel: an edge pointing at a missing node -> orphan-edge error', () => {
  assert.deepEqual(validateModel({ 'a': mkN('a') }, [mkE('e1', 'a', 'ghost')]), [
    { level: 'error', code: 'orphan-edge', message: 'edge "e1" ends at a missing node "ghost"', ids: ['ghost'] },
  ]);
});

// ---------------------------------------------------------------------
// edgeIdentities
// ---------------------------------------------------------------------

test('edgeIdentities: parallel duplicates (same from/to/style) get an occurrence-index suffix', () => {
  const ids = edgeIdentities([mkE('e1', 'a', 'b'), mkE('e2', 'a', 'b'), mkE('e3', 'a', 'b', 'dotted')]);
  assert.deepEqual([...ids.entries()], [
    ['e1', 'a␞b␞solid'],
    ['e2', 'a␞b␞solid␞1'],
    ['e3', 'a␞b␞dotted'],
  ]);
});

// ---------------------------------------------------------------------
// semanticDiff
// ---------------------------------------------------------------------

test('semanticDiff: identical model against itself -> clean', () => {
  const model = { nodes: { 'a': mkN('a') }, edges: [mkE('e1', 'a', 'a')] };
  assert.deepEqual(semanticDiff(model, model), []);
});

test('semanticDiff: edge .id renumbered but same from/to/style -> still clean (id is volatile)', () => {
  const before = { nodes: { 'a': mkN('a') }, edges: [mkE('e1', 'a', 'a')] };
  const after = { nodes: { 'a': mkN('a') }, edges: [mkE('eXX', 'a', 'a')] };
  assert.deepEqual(semanticDiff(before, after), []);
});

test('semanticDiff: a changed label -> rt-label violation', () => {
  const before = { nodes: { 'a': mkN('a') }, edges: [mkE('e1', 'a', 'a')] };
  const after = { nodes: { 'a': mkN('a', { label: 'CHANGED' }) }, edges: [mkE('e1', 'a', 'a')] };
  assert.deepEqual(semanticDiff(before, after), [
    { level: 'error', code: 'rt-label', message: '"a" label changed on round-trip', ids: ['a'] },
  ]);
});

test('semanticDiff: a node dropped on round-trip -> rt-node-dropped + its incident edge rt-edge-dropped', () => {
  const before = { nodes: { 'a': mkN('a') }, edges: [mkE('e1', 'a', 'a')] };
  const after = { nodes: {}, edges: [] };
  assert.deepEqual(semanticDiff(before, after), [
    { level: 'error', code: 'rt-node-dropped', message: 'node "a" lost on round-trip', ids: ['a'] },
    { level: 'error', code: 'rt-edge-dropped', message: 'edge [a a solid] lost on round-trip' },
  ]);
});

test('semanticDiff: a node that appears only in "after" -> rt-node-added', () => {
  const before = { nodes: {}, edges: [] };
  const after = { nodes: { 'a': mkN('a') }, edges: [] };
  assert.deepEqual(semanticDiff(before, after), [
    { level: 'error', code: 'rt-node-added', message: 'node "a" appeared on round-trip', ids: ['a'] },
  ]);
});
