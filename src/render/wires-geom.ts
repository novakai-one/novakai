/* =====================================================================
   wires-geom.ts — edge path geometry helpers
   ---------------------------------------------------------------------
   Split out of wires.ts (unchanged logic): the pure path/geometry helpers
   that build and inspect "M ... L ..." command lists. Reused by wires.ts
   (re-exported from it) and by export.
   ===================================================================== */

import type { PortSide, Point } from '../core/types/types';

/** Orthogonal elbow path between two ports given their sides. */
export function orthoPath(p: Point, sa: PortSide, q: Point, sb: PortSide): string {
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const aH = sa === 'pl' || sa === 'pr';
  const bH = sb === 'pl' || sb === 'pr';
  if (aH && bH) return `M ${p.x} ${p.y} L ${mx} ${p.y} L ${mx} ${q.y} L ${q.x} ${q.y}`;
  if (!aH && !bH) return `M ${p.x} ${p.y} L ${p.x} ${my} L ${q.x} ${my} L ${q.x} ${q.y}`;
  if (aH && !bH) return `M ${p.x} ${p.y} L ${q.x} ${p.y} L ${q.x} ${q.y}`;
  return `M ${p.x} ${p.y} L ${p.x} ${q.y} L ${q.x} ${q.y}`;
}

/** Build an "M ... L ..." path from an ortho polyline (libavoid output). */
export function polyPath(pts: Point[]): string {
  return pts.map((pt, i) => `${i ? 'L' : 'M'} ${pt.x} ${pt.y}`).join(' ');
}

/** Rough midpoint of an "M ... L ..." command list (for label placement). */
export function midOf(d: string): Point {
  const matched = d.match(/-?\d+(\.\d+)?/g);
  const pts = (matched || []).map(Number);
  const coords: Point[] = [];
  for (let i = 0; i < pts.length; i += 2) coords.push({ x: pts[i], y: pts[i + 1] });
  if (coords.length === 2) {
    return { x: (coords[0].x + coords[1].x) / 2, y: (coords[0].y + coords[1].y) / 2 };
  }
  return coords[Math.floor(coords.length / 2)];
}

/** Parse an "M ... L ..." path into its corner points. */
function pathPoints(d: string): Point[] {
  const nums = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

/**
 * Best clear spot for an edge label: the midpoint of the path's longest
 * straight segment. On an elbow route that is the long gutter run, which
 * sits away from the node boxes — unlike the geometric midpoint, which on a
 * diagonal lands on a card.
 */
export function labelAnchor(d: string): Point {
  const pts = pathPoints(d);
  if (pts.length < 2) return pts[0] || { x: 0, y: 0 };
  let best = 0, bestLen = -1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  const pointA = pts[best], pointB = pts[best + 1];
  return { x: (pointA.x + pointB.x) / 2, y: (pointA.y + pointB.y) / 2 };
}
