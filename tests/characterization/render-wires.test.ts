/* =====================================================================
   render-wires.test.ts — characterization tests for src/render/wires.ts
   ---------------------------------------------------------------------
   Covers the pure path-geometry helpers exported by wires.ts: orthoPath,
   polyPath, midOf, labelAnchor. expected values are observed behavior, not
   spec — each was produced by running the real function once and pasting
   its output (see the module comment in stub-avoid-router-loader.mjs for
   why the register() + dynamic-import dance below is required).

   `edgePath` is NOT exported by wires.ts (module-private) — skipped, it
   is unreachable from a test file (audit finding).
   ===================================================================== */

import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

register('./stub-avoid-router-loader.mjs', import.meta.url);
const { orthoPath, polyPath, midOf, labelAnchor } = await import('../../src/render/wires.ts');

const origin = { x: 10, y: 20 };
const dest = { x: 110, y: 220 };

// ---------------------------------------------------------------------
// orthoPath
// ---------------------------------------------------------------------

test('orthoPath: both ports horizontal (pr/pl) -> vertical elbow at x-midpoint', () => {
  assert.equal(orthoPath(origin, 'pr', dest, 'pl'), 'M 10 20 L 60 20 L 60 220 L 110 220');
});

test('orthoPath: both ports vertical (pt/pb) -> horizontal elbow at y-midpoint', () => {
  assert.equal(orthoPath(origin, 'pt', dest, 'pb'), 'M 10 20 L 10 120 L 110 120 L 110 220');
});

test('orthoPath: horizontal then vertical (pr, pt) -> single corner at (q.x, p.y)', () => {
  assert.equal(orthoPath(origin, 'pr', dest, 'pt'), 'M 10 20 L 110 20 L 110 220');
});

test('orthoPath: vertical then horizontal (pt, pl) -> single corner at (p.x, q.y)', () => {
  assert.equal(orthoPath(origin, 'pt', dest, 'pl'), 'M 10 20 L 10 220 L 110 220');
});

test('orthoPath: degenerate same-point endpoints collapse every corner to that point', () => {
  const same = { x: 5, y: 5 };
  assert.equal(orthoPath(same, 'pr', same, 'pl'), 'M 5 5 L 5 5 L 5 5 L 5 5');
});

// ---------------------------------------------------------------------
// polyPath
// ---------------------------------------------------------------------

test('polyPath: multi-point polyline -> "M x y L x y L x y"', () => {
  assert.equal(polyPath([{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 10 }]), 'M 0 0 L 5 0 L 5 10');
});

test('polyPath: single point -> just the "M"', () => {
  assert.equal(polyPath([{ x: 3, y: 4 }]), 'M 3 4');
});

test('polyPath: empty list -> empty string', () => {
  assert.equal(polyPath([]), '');
});

// ---------------------------------------------------------------------
// midOf
// ---------------------------------------------------------------------

test('midOf: 2-point straight path -> arithmetic midpoint', () => {
  assert.deepEqual(midOf('M 0 0 L 10 10'), { x: 5, y: 5 });
});

test('midOf: 4-point elbow path -> the point at index floor(4/2)=2, not a true midpoint', () => {
  assert.deepEqual(midOf('M 0 0 L 5 0 L 5 10 L 10 10'), { x: 5, y: 10 });
});

test('midOf: 3-point elbow path -> the point at index floor(3/2)=1', () => {
  assert.deepEqual(midOf('M 0 0 L 5 0 L 10 10'), { x: 5, y: 0 });
});

test('midOf: single-point path -> that point (coords.length !== 2 falls to the index pick)', () => {
  assert.deepEqual(midOf('M 5 5'), { x: 5, y: 5 });
});

// ---------------------------------------------------------------------
// labelAnchor
// ---------------------------------------------------------------------

test('labelAnchor: 2-point straight path -> its midpoint (only one segment)', () => {
  assert.deepEqual(labelAnchor('M 0 0 L 10 10'), { x: 5, y: 5 });
});

test('labelAnchor: elbow path -> midpoint of the LONGEST straight segment, not the geometric middle', () => {
  assert.deepEqual(labelAnchor('M 0 0 L 100 0 L 100 10'), { x: 50, y: 0 });
});

test('labelAnchor: single-point path -> that point (fewer than 2 points, no segment to measure)', () => {
  assert.deepEqual(labelAnchor('M 5 5'), { x: 5, y: 5 });
});

test('labelAnchor: empty path string -> {x:0,y:0} fallback', () => {
  assert.deepEqual(labelAnchor(''), { x: 0, y: 0 });
});
