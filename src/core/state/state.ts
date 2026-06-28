/* =====================================================================
   state.ts — the model (single source of truth)
   ---------------------------------------------------------------------
   Responsibility: own the live diagram model — nodes, edges, the running
   id counters, and the selection. Provide pure-ish helpers that operate
   ONLY on the model + given inputs (snap, geometry, port positions,
   best-side picking). No DOM, no rendering, no history.

   Selection mutation here intentionally does NOT trigger re-render; the
   selection module composes these with render()/renderInspector().
   ===================================================================== */

import type { DiagramNode, PortSide, Point, FlowDir } from '../types/types';
import { SIDE_MULT, GRID } from '../config/config';

/** Gap between a node box and its frontmatter card (CSS .fmcard uses 6). */
export const CARD_GAP = 6;

/**
 * Last measured size of a node's frontmatter card (its own offsetWidth/
 * offsetHeight, unscaled by camera zoom). Written ONLY by render's post-paint
 * measure pass; read by footprint consumers (wires obstacles, avoid-router,
 * Tidy). This is the model's record of a derived-but-not-computable quantity:
 * the card wraps its content, so its size can't be derived from x/y/w/h alone.
 */
export interface MeasuredCard {
  cardW: number;
  cardH: number;
}

export interface StateStore {
  nodes: Record<string, DiagramNode>;
  edges: import('../types/types').DiagramEdge[];
  sel: Set<string>;
  selEdge: string | null;
  /** next node-id counter */
  nid: number;
  /** next edge-id counter */
  eid: number;
  /** auto-layout flow direction (from the Mermaid header) */
  dir: FlowDir;
  /** declared layout entry nodes (from `%% root` lines); drive Tidy's layer 0 */
  roots: string[];
  /**
   * Measured frontmatter-card sizes, keyed by node id. Populated by render's
   * post-paint measure pass; NOT serialised (re-measured on next render). An
   * absent entry means "no card / not yet measured" — readers fall back to the
   * node box (n.w/n.h), so geometry never reads from the DOM.
   */
  measured: Map<string, MeasuredCard>;
}

/** Create a fresh, empty model. */
export function createState(): StateStore {
  return {
    nodes: {}, edges: [], sel: new Set<string>(), selEdge: null,
    nid: 1, eid: 1, dir: 'TD', roots: [], measured: new Map<string, MeasuredCard>(),
  };
}

/* ---------- rendered footprint (box + frontmatter card) ---------- */

/** A node's on-canvas footprint rect in world pixels, card included. */
export interface Footprint { x: number; y: number; w: number; h: number; }

/**
 * Rendered footprint of a node, box plus frontmatter card, read from the
 * model alone (the card size comes from `state.measured`, populated by the
 * post-render measure pass — never read live from the DOM). The card hangs
 * below the box and is centred on it: width = max(box, card), height = box +
 * gap + card. When the card isn't shown or hasn't been measured yet, the
 * footprint is just the box, so callers always get finite numbers.
 */
export function nodeFootprint(state: StateStore, n: DiagramNode, showFrontmatter: boolean): Footprint {
  const m = showFrontmatter ? state.measured.get(n.id) : undefined;
  if (!m) return { x: n.x, y: n.y, w: n.w, h: n.h };
  const w = Math.max(n.w, m.cardW);
  const h = n.h + CARD_GAP + m.cardH;
  return { x: n.x - (w - n.w) / 2, y: n.y, w, h };
}

/* ---------- snap ---------- */

/** Snap a coordinate to the grid when `snap` is on. */
export function snapV(v: number, snap: boolean): number {
  return snap ? Math.round(v / GRID) * GRID : v;
}

/* ---------- geometry (pure) ---------- */

/** World-space position of a node's port on a given side. */
export function portPos(node: DiagramNode, side: PortSide): Point {
  const m = SIDE_MULT[side];
  return { x: node.x + node.w * m[0], y: node.y + node.h * m[1] };
}

/** Centre point of a node. */
export function nodeCenter(n: DiagramNode): { cx: number; cy: number } {
  return { cx: n.x + n.w / 2, cy: n.y + n.h / 2 };
}

/** Pick the nearest facing port sides for an edge between two nodes. */
export function bestSides(a: DiagramNode, b: DiagramNode): [PortSide, PortSide] {
  const ca = nodeCenter(a), cb = nodeCenter(b);
  const dx = cb.cx - ca.cx, dy = cb.cy - ca.cy;
  let sa: PortSide, sb: PortSide;
  if (Math.abs(dx) > Math.abs(dy)) {
    sa = dx > 0 ? 'pr' : 'pl'; sb = dx > 0 ? 'pl' : 'pr';
  } else {
    sa = dy > 0 ? 'pb' : 'pt'; sb = dy > 0 ? 'pt' : 'pb';
  }
  return [sa, sb];
}

/**
 * Topmost node whose box contains a world point, restricted to one drill
 * level (`container`, default root). Groups are only returned if nothing
 * else is hit (they're containers, low priority).
 */
export function nodeAtPoint(state: StateStore, wx: number, wy: number, container: string | null = null): string | null {
  const ids = Object.keys(state.nodes);
  let groupHit: string | null = null;
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    if (containerOf(state, id) !== container) continue;
    const n = state.nodes[id];
    if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) {
      if (n.shape === 'group') { groupHit = groupHit || id; continue; }
      return id;
    }
  }
  return groupHit;
}

/* ---------- containment / drill levels ---------- */

/**
 * The drill level a node lives at: its nearest NON-group ancestor, or null
 * for the top level. Group ancestors are transparent for leveling — a group
 * is an in-level visual container, not a separate level. So a node inside a
 * group inside SelectionManager still reports SelectionManager as its level.
 */
export function containerOf(state: StateStore, id: string): string | null {
  let cur = state.nodes[id]?.parent ?? null;
  const seen = new Set<string>();
  while (cur && state.nodes[cur] && !seen.has(cur)) {
    seen.add(cur);
    if (state.nodes[cur].shape !== 'group') return cur;
    cur = state.nodes[cur].parent ?? null;
  }
  return null;
}

/** Ids of every node that lives directly at `container`'s drill level. */
export function childIdsOf(state: StateStore, container: string | null): string[] {
  return Object.keys(state.nodes).filter((id) => containerOf(state, id) === container);
}

/** Root-first chain of non-group container ids enclosing `container` (inclusive). */
export function containerPath(state: StateStore, container: string | null): string[] {
  const path: string[] = [];
  let cur = container;
  const seen = new Set<string>();
  while (cur && state.nodes[cur] && !seen.has(cur)) {
    seen.add(cur); path.unshift(cur); cur = containerOf(state, cur);
  }
  return path;
}

/** Bounding box of just the nodes at `container`'s level, or null when empty. */
export function levelBounds(state: StateStore, container: string | null):
  { minX: number; minY: number; maxX: number; maxY: number } | null {
  const ids = childIdsOf(state, container);
  if (!ids.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const n = state.nodes[id];
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Read-only "root header" rect for a drilled level: where to draw the
 * container node itself, above its children. null at the top level. When the
 * level is empty the header is parked near the origin so the camera frames it.
 */
export function levelHeaderRect(state: StateStore, container: string | null):
  { x: number; y: number; w: number; h: number } | null {
  if (!container || !state.nodes[container]) return null;
  const c = state.nodes[container];
  const w = Math.max(120, c.w), h = c.h;
  const b = levelBounds(state, container); // children only
  if (!b) return { x: -w / 2, y: -h - 60, w, h };
  const cx = (b.minX + b.maxX) / 2;
  return { x: cx - w / 2, y: b.minY - 100 - h, w, h };
}

/** Bounds the camera should fit at a level: children plus the container node. */
export function levelFitBounds(state: StateStore, container: string | null):
  { minX: number; minY: number; maxX: number; maxY: number } | null {
  const b = levelBounds(state, container);
  if (!container || !state.nodes[container]) return b; // top level
  const c = state.nodes[container];
  const cb = { minX: c.x, minY: c.y, maxX: c.x + c.w, maxY: c.y + c.h };
  if (!b) return cb;
  return {
    minX: Math.min(b.minX, cb.minX), minY: Math.min(b.minY, cb.minY),
    maxX: Math.max(b.maxX, cb.maxX), maxY: Math.max(b.maxY, cb.maxY),
  };
}

/** True when `anc` sits somewhere on `node`'s parent chain (cycle guard). */
export function isAncestor(state: StateStore, anc: string, node: string): boolean {
  let cur = state.nodes[node]?.parent ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === anc) return true;
    seen.add(cur); cur = state.nodes[cur]?.parent ?? null;
  }
  return false;
}

/** Bounding box of all nodes, or null when empty. */
export function worldBounds(state: StateStore):
  { minX: number; minY: number; maxX: number; maxY: number } | null {
  const ids = Object.keys(state.nodes);
  if (!ids.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const n = state.nodes[id];
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n.w); maxY = Math.max(maxY, n.y + n.h);
  }
  return { minX, minY, maxX, maxY };
}
