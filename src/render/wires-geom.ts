/* =====================================================================
   wires-geom.ts — edge path geometry helpers
   ---------------------------------------------------------------------
   Split out of wires.ts (unchanged logic): the pure path/geometry helpers
   that build and inspect "M ... L ..." command lists. Reused by wires.ts
   (re-exported from it) and by export.
   ===================================================================== */

import type { PortSide, Point } from '../core/types/types';

/** Orthogonal elbow path between two ports given their sides. */
export function orthoPath(ptA: Point, sideA: PortSide, ptB: Point, sideB: PortSide): string {
  const midX = (ptA.x + ptB.x) / 2;
  const midY = (ptA.y + ptB.y) / 2;
  const horizA = sideA === 'pl' || sideA === 'pr';
  const horizB = sideB === 'pl' || sideB === 'pr';
  if (horizA && horizB) return `M ${ptA.x} ${ptA.y} L ${midX} ${ptA.y} L ${midX} ${ptB.y} L ${ptB.x} ${ptB.y}`;
  if (!horizA && !horizB) return `M ${ptA.x} ${ptA.y} L ${ptA.x} ${midY} L ${ptB.x} ${midY} L ${ptB.x} ${ptB.y}`;
  if (horizA && !horizB) return `M ${ptA.x} ${ptA.y} L ${ptB.x} ${ptA.y} L ${ptB.x} ${ptB.y}`;
  return `M ${ptA.x} ${ptA.y} L ${ptA.x} ${ptB.y} L ${ptB.x} ${ptB.y}`;
}

/** Build an "M ... L ..." path from an ortho polyline (libavoid output). */
export function polyPath(pts: Point[]): string {
  return pts.map((pnt, idx) => `${idx ? 'L' : 'M'} ${pnt.x} ${pnt.y}`).join(' ');
}

/** Rough midpoint of an "M ... L ..." command list (for label placement). */
export function midOf(pathD: string): Point {
  const matched = pathD.match(/-?\d+(\.\d+)?/g);
  const nums = (matched || []).map(Number);
  const coords: Point[] = [];
  for (let idx = 0; idx < nums.length; idx += 2) coords.push({ x: nums[idx], y: nums[idx + 1] });
  if (coords.length === 2) {
    return { x: (coords[0].x + coords[1].x) / 2, y: (coords[0].y + coords[1].y) / 2 };
  }
  return coords[Math.floor(coords.length / 2)];
}

/** Parse an "M ... L ..." path into its corner points. */
function pathPoints(pathD: string): Point[] {
  const nums = (pathD.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const pts: Point[] = [];
  for (let idx = 0; idx + 1 < nums.length; idx += 2) pts.push({ x: nums[idx], y: nums[idx + 1] });
  return pts;
}

/**
 * Best clear spot for an edge label: the midpoint of the path's longest
 * straight segment. On an elbow route that is the long gutter run, which
 * sits away from the node boxes — unlike the geometric midpoint, which on a
 * diagonal lands on a card.
 */
export function labelAnchor(pathD: string): Point {
  const pts = pathPoints(pathD);
  if (pts.length < 2) return pts[0] || { x: 0, y: 0 };
  let bestIdx = 0;
  let bestLen = -1;
  for (let idx = 0; idx + 1 < pts.length; idx++) {
    const len = Math.abs(pts[idx + 1].x - pts[idx].x) + Math.abs(pts[idx + 1].y - pts[idx].y);
    if (len > bestLen) {
      bestLen = len;
      bestIdx = idx;
    }
  }
  const pointA = pts[bestIdx], pointB = pts[bestIdx + 1];
  return { x: (pointA.x + pointB.x) / 2, y: (pointA.y + pointB.y) / 2 };
}
