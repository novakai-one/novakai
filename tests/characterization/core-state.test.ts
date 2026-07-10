/* =====================================================================
   core-state.test.ts — characterization tests for src/core/state/state.ts
   ---------------------------------------------------------------------
   Covers the pure geometry/containment helpers: portPos, nodeCenter,
   bestSides, nodeFootprint, frameTransform, worldBounds, levelBounds,
   containerOf, childIdsOf, nodeAtPoint, sliceIds, snapV. expected values
   are observed behavior, not spec — each was produced by running the real
   function once against a literal state and pasting its output.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createState, portPos, nodeCenter, bestSides, nodeFootprint, frameTransform,
  worldBounds, levelBounds, containerOf, childIdsOf, nodeAtPoint, sliceIds, snapV,
} from '../../src/core/state/state.ts';

function mkNode(id: string, x: number, y: number, w = 160, h = 56, extra: any = {}): any {
  return { id, label: id, shape: 'rect', color: null, x, y, w, h, ...extra };
}

// ---------------------------------------------------------------------
// portPos / nodeCenter
// ---------------------------------------------------------------------

test('portPos: pt/pb/pl/pr on a 100x50 node at (10,20)', () => {
  const n = mkNode('n1', 10, 20, 100, 50);
  assert.deepEqual(portPos(n, 'pt'), { x: 60, y: 20 });
  assert.deepEqual(portPos(n, 'pb'), { x: 60, y: 70 });
  assert.deepEqual(portPos(n, 'pl'), { x: 10, y: 45 });
  assert.deepEqual(portPos(n, 'pr'), { x: 110, y: 45 });
});

test('nodeCenter: centre of a 100x50 node at (10,20)', () => {
  assert.deepEqual(nodeCenter(mkNode('n1', 10, 20, 100, 50)), { cx: 60, cy: 45 });
});

// ---------------------------------------------------------------------
// bestSides
// ---------------------------------------------------------------------

test('bestSides: a left of b (dx dominant, positive) -> [pr, pl]', () => {
  assert.deepEqual(bestSides(mkNode('a', 0, 0, 100, 50), mkNode('b', 300, 0, 100, 50)), ['pr', 'pl']);
});

test('bestSides: a right of b (dx dominant, negative) -> [pl, pr]', () => {
  assert.deepEqual(bestSides(mkNode('a', 300, 0, 100, 50), mkNode('b', 0, 0, 100, 50)), ['pl', 'pr']);
});

test('bestSides: a above b (dy dominant, positive) -> [pb, pt]', () => {
  assert.deepEqual(bestSides(mkNode('a', 0, 0, 100, 50), mkNode('b', 0, 300, 100, 50)), ['pb', 'pt']);
});

test('bestSides: a below b (dy dominant, negative) -> [pt, pb]', () => {
  assert.deepEqual(bestSides(mkNode('a', 0, 300, 100, 50), mkNode('b', 0, 0, 100, 50)), ['pt', 'pb']);
});

test('bestSides: identical centres (dx=dy=0) -> falls to the vertical branch [pt, pb]', () => {
  assert.deepEqual(bestSides(mkNode('a', 0, 0, 100, 50), mkNode('a', 0, 0, 100, 50)), ['pt', 'pb']);
});

// ---------------------------------------------------------------------
// nodeFootprint
// ---------------------------------------------------------------------

test('nodeFootprint: no measured card -> footprint is just the node box', () => {
  const st = createState();
  st.nodes.n1 = mkNode('n1', 10, 20, 100, 50);
  assert.deepEqual(nodeFootprint(st, st.nodes.n1, true), { x: 10, y: 20, w: 100, h: 50 });
});

test('nodeFootprint: measured card + showFrontmatter=true widens/heightens and re-centres x', () => {
  const st = createState();
  st.nodes.n1 = mkNode('n1', 10, 20, 100, 50);
  st.measured.set('n1', { cardW: 200, cardH: 30 });
  assert.deepEqual(nodeFootprint(st, st.nodes.n1, true), { x: -40, y: 20, w: 200, h: 86 });
});

test('nodeFootprint: measured card present but showFrontmatter=false -> still just the box', () => {
  const st = createState();
  st.nodes.n1 = mkNode('n1', 10, 20, 100, 50);
  st.measured.set('n1', { cardW: 200, cardH: 30 });
  assert.deepEqual(nodeFootprint(st, st.nodes.n1, false), { x: 10, y: 20, w: 100, h: 50 });
});

// ---------------------------------------------------------------------
// frameTransform
// ---------------------------------------------------------------------

test('frameTransform: wantZ within [zMin,zMax] -> used as-is, centres the node', () => {
  assert.deepEqual(frameTransform(mkNode('n1', 100, 100, 200, 100), 800, 600, 1, 0.2, 3), { x: 200, y: 150, z: 1 });
});

test('frameTransform: wantZ above zMax -> clamped to zMax', () => {
  assert.deepEqual(frameTransform(mkNode('n1', 100, 100, 200, 100), 800, 600, 5, 0.2, 3), { x: -200, y: -150, z: 3 });
});

test('frameTransform: wantZ below zMin -> clamped to zMin', () => {
  assert.deepEqual(frameTransform(mkNode('n1', 100, 100, 200, 100), 800, 600, 0.05, 0.2, 3), { x: 360, y: 270, z: 0.2 });
});

// ---------------------------------------------------------------------
// snapV
// ---------------------------------------------------------------------

test('snapV: snap=true rounds to the nearest grid step', () => {
  assert.equal(snapV(37, true), 32);
});

test('snapV: snap=false returns the value untouched', () => {
  assert.equal(snapV(37, false), 37);
});

// ---------------------------------------------------------------------
// worldBounds / levelBounds
// ---------------------------------------------------------------------

test('worldBounds: empty state -> null', () => {
  assert.equal(worldBounds(createState()), null);
});

test('worldBounds: bounding box across all nodes', () => {
  const st = createState();
  st.nodes.a = mkNode('a', 0, 0, 100, 50);
  st.nodes.b = mkNode('b', 200, 150, 100, 50);
  assert.deepEqual(worldBounds(st), { minX: 0, minY: 0, maxX: 300, maxY: 200 });
});

test('levelBounds: container with no children -> null', () => {
  const st = createState();
  st.nodes.a = mkNode('a', 0, 0, 100, 50);
  assert.equal(levelBounds(st, 'nope'), null);
});

test('levelBounds: top level (null container) -> bounding box of top-level nodes', () => {
  const st = createState();
  st.nodes.a = mkNode('a', 0, 0, 100, 50);
  st.nodes.b = mkNode('b', 200, 150, 100, 50);
  assert.deepEqual(levelBounds(st, null), { minX: 0, minY: 0, maxX: 300, maxY: 200 });
});

// ---------------------------------------------------------------------
// containerOf / childIdsOf — groups are transparent, only a non-group
// parent is a "level"
// ---------------------------------------------------------------------

function containmentState(): any {
  const st = createState();
  st.nodes.parent = mkNode('parent', 0, 0, 300, 300);
  st.nodes.g1 = mkNode('g1', 10, 10, 280, 280, { shape: 'group', parent: 'parent' });
  st.nodes.n1 = mkNode('n1', 20, 20, 100, 50, { parent: 'g1' });
  st.nodes.n2 = mkNode('n2', 500, 500, 100, 50);
  return st;
}

test('containerOf: a node whose parent is a group reports the group\'s own (non-group) container', () => {
  const st = containmentState();
  assert.equal(containerOf(st, 'n1'), 'parent');
});

test('containerOf: a group with a non-group parent reports that parent', () => {
  const st = containmentState();
  assert.equal(containerOf(st, 'g1'), 'parent');
});

test('containerOf: top-level nodes (rect or group parent) report null', () => {
  const st = containmentState();
  assert.equal(containerOf(st, 'parent'), null);
  assert.equal(containerOf(st, 'n2'), null);
});

test('childIdsOf: "parent" level includes the group and the node inside it (group is transparent)', () => {
  const st = containmentState();
  assert.deepEqual(childIdsOf(st, 'parent').sort(), ['g1', 'n1']);
});

test('childIdsOf: top level includes "parent" and "n2", not the nested nodes', () => {
  const st = containmentState();
  assert.deepEqual(childIdsOf(st, null).sort(), ['n2', 'parent']);
});

// ---------------------------------------------------------------------
// nodeAtPoint
// ---------------------------------------------------------------------

test('nodeAtPoint: hits a leaf node at the given drill level', () => {
  const st = containmentState();
  assert.equal(nodeAtPoint(st, 30, 30, 'parent'), 'n1');
});

test('nodeAtPoint: empty spot inside the group box -> falls back to the group (low priority)', () => {
  const st = containmentState();
  assert.equal(nodeAtPoint(st, 250, 250, 'parent'), 'g1');
});

test('nodeAtPoint: no node under the point -> null', () => {
  const st = containmentState();
  assert.equal(nodeAtPoint(st, 999, 999, 'parent'), null);
});

test('nodeAtPoint: top level, hits a plain top-level node', () => {
  const st = containmentState();
  assert.equal(nodeAtPoint(st, 520, 520, null), 'n2');
});

// ---------------------------------------------------------------------
// sliceIds
// ---------------------------------------------------------------------

test('sliceIds: solid edges pulled transitively downstream (a->b->c) and upstream, plus 1-hop dotted', () => {
  const st = createState();
  st.nodes.a = mkNode('a', 0, 0);
  st.nodes.b = mkNode('b', 0, 0);
  st.nodes.c = mkNode('c', 0, 0);
  st.nodes.d = mkNode('d', 0, 0);
  st.edges = [
    { id: 'e1', from: 'a', to: 'b', label: '', style: 'solid', routing: 'straight' },
    { id: 'e2', from: 'b', to: 'c', label: '', style: 'solid', routing: 'straight' },
    { id: 'e3', from: 'a', to: 'd', label: '', style: 'dotted', routing: 'straight' },
  ] as any;
  assert.deepEqual([...sliceIds(st, 'a')].sort(), ['a', 'b', 'c', 'd']);
  assert.deepEqual([...sliceIds(st, 'c')].sort(), ['a', 'b', 'c']);
});
