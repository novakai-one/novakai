/* =====================================================================
   core-plan.test.ts — characterization tests for src/core/plan/plan.ts
   ---------------------------------------------------------------------
   Covers applyPlan, planFromDiff, blastRadius, downstreamCone and
   coherenceWarnings. Pure module, plain import. expected values are
   observed behavior, not spec.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyPlan, planFromDiff, blastRadius, downstreamCone, coherenceWarnings, type Plan } from '../../src/core/plan/plan.ts';

function mkN(id: string, extra: any = {}): any {
  return { id, label: id, shape: 'rect', color: null, x: 0, y: 0, w: 100, h: 50, ...extra };
}
function mkE(id: string, from: string, to: string, style = 'solid'): any {
  return { id, from, to, label: '', style, routing: 'straight' };
}

// ---------------------------------------------------------------------
// blastRadius
// ---------------------------------------------------------------------

test('blastRadius: consumers = edges INTO ref, dependencies = edges OUT OF ref, both sorted', () => {
  const edges = [mkE('e1', 'a', 'b'), mkE('e2', 'c', 'b'), mkE('e3', 'b', 'd')];
  assert.deepEqual(blastRadius(edges, 'b'), { consumers: ['a', 'c'], dependencies: ['d'] });
});

test('blastRadius: a ref with no edges -> both lists empty', () => {
  const edges = [mkE('e1', 'a', 'b')];
  assert.deepEqual(blastRadius(edges, 'zzz'), { consumers: [], dependencies: [] });
});

// ---------------------------------------------------------------------
// downstreamCone
// ---------------------------------------------------------------------

test('downstreamCone: BFS outward over "who consumes ref", nearest-first, sorted within a depth', () => {
  const edges = [mkE('e1', 'x', 'core'), mkE('e2', 'y', 'x'), mkE('e3', 'z', 'core')];
  assert.deepEqual(downstreamCone(edges, 'core'), {
    affected: [{ id: 'x', depth: 1 }, { id: 'z', depth: 1 }, { id: 'y', depth: 2 }],
    entryPoints: [], maxDepth: 2,
  });
});

test('downstreamCone: entryPoints lists affected nodes that are also declared roots', () => {
  const edges = [mkE('e1', 'x', 'core'), mkE('e2', 'y', 'x'), mkE('e3', 'z', 'core')];
  const cone = downstreamCone(edges, 'core', { roots: ['y'] });
  assert.deepEqual(cone.entryPoints, ['y']);
});

test('downstreamCone: maxDepth truncates the walk', () => {
  const edges = [mkE('e1', 'x', 'core'), mkE('e2', 'y', 'x'), mkE('e3', 'z', 'core')];
  const cone = downstreamCone(edges, 'core', { maxDepth: 1 });
  assert.deepEqual(cone.affected, [{ id: 'x', depth: 1 }, { id: 'z', depth: 1 }]);
  assert.equal(cone.maxDepth, 1);
});

// ---------------------------------------------------------------------
// coherenceWarnings
// ---------------------------------------------------------------------

test('coherenceWarnings: an accepted change depending on an accepted change -> no warning', () => {
  const plan: Plan = {
    base: '', phases: [], changes: [
      { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'a' }, intent: { problem: '', approach: '' }, dependsOn: ['c2'] },
      { id: 'c2', status: 'modify', target: { kind: 'node', ref: 'b' }, intent: { problem: '', approach: '' } },
    ],
  };
  assert.deepEqual(coherenceWarnings(plan, { c1: 'accept', c2: 'accept' }), []);
});

test('coherenceWarnings: an accepted change depending on a rejected change -> one warning', () => {
  const plan: Plan = {
    base: '', phases: [], changes: [
      { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'a' }, intent: { problem: '', approach: '' }, dependsOn: ['c2'] },
      { id: 'c2', status: 'modify', target: { kind: 'node', ref: 'b' }, intent: { problem: '', approach: '' } },
    ],
  };
  assert.deepEqual(coherenceWarnings(plan, { c1: 'accept', c2: 'reject' }), [
    { changeId: 'c1', message: 'accepted, but depends on "c2" which is rejected' },
  ]);
});

// ---------------------------------------------------------------------
// planFromDiff
// ---------------------------------------------------------------------

test('planFromDiff: derives add/modify/edge-add changes from a before/after diff', () => {
  const before = { nodes: { a: mkN('a') }, edges: [] };
  const after = { nodes: { a: mkN('a', { label: 'A2' }), b: mkN('b') }, edges: [mkE('e1', 'a', 'b')] };
  const plan = planFromDiff(before, after);
  assert.equal(plan.base, 'pasted proposal');
  assert.deepEqual(plan.changes.map((c) => c.id), ['add-b', 'mod-a', 'eadd-a-b']);
  assert.deepEqual(plan.changes[0], {
    id: 'add-b', status: 'add', target: { kind: 'node', ref: 'b' },
    newNode: { label: 'b', kind: 'module', parent: null },
    fm: undefined,
    intent: { problem: 'not present in the base map', approach: 'add node "b"' },
  });
  assert.deepEqual(plan.changes[1], {
    id: 'mod-a', status: 'modify', target: { kind: 'node', ref: 'a' }, fm: undefined,
    intent: { problem: 'differs from the base map (label)', approach: 'update label of "a"' },
  });
  assert.deepEqual(plan.changes[2], {
    id: 'eadd-a-b', status: 'add', target: { kind: 'edge', ref: 'a->b:solid' },
    newEdge: { from: 'a', to: 'b', style: 'solid' },
    intent: { problem: 'dependency not in the base map', approach: 'add edge a → b' },
  });
});

// ---------------------------------------------------------------------
// applyPlan
// ---------------------------------------------------------------------

const base = { nodes: { a: mkN('a'), b: mkN('b') }, edges: [mkE('e1', 'a', 'b')] };
const plan2: Plan = {
  base: '', changes: [
    { id: 'add1', status: 'add', target: { kind: 'node', ref: 'c' }, newNode: { label: 'C' }, intent: { problem: '', approach: '' } },
    { id: 'rem1', status: 'remove', target: { kind: 'node', ref: 'b' }, intent: { problem: '', approach: '' } },
    { id: 'eadd1', status: 'add', target: { kind: 'edge', ref: 'a->c:solid' }, newEdge: { from: 'a', to: 'c' }, intent: { problem: '', approach: '' } },
  ],
};

test('applyPlan: all changes accepted -> adds "c", removes "b" (+ its edge), adds a->c edge', () => {
  const result = applyPlan(base, plan2, () => true);
  assert.deepEqual(Object.keys(result.nodes).sort(), ['a', 'c']);
  assert.deepEqual(result.nodes.c, { id: 'c', label: 'C', shape: 'rect', kind: 'module', color: null, x: 0, y: 0, w: 180, h: 54, parent: null, fm: undefined });
  assert.deepEqual(result.edges, [{ id: 'eP1', from: 'a', to: 'c', label: '', style: 'solid', routing: 'straight' }]);
});

test('applyPlan: no changes accepted -> base returned unchanged (deep-cloned)', () => {
  const result = applyPlan(base, plan2, () => false);
  assert.deepEqual(result, base);
  assert.notEqual(result.nodes, base.nodes);
});
