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
  /** reading-mode grouping (`%% group` / `%% group-member` lines): hierarchy
      metadata ABOVE top-level nodes — no geometry, invisible to the canvas,
      consumed by the unfold surface and round-tripped by io/mermaid */
  hier: import('../types/types').Hier;
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
    nid: 1, eid: 1, dir: 'TD', roots: [], hier: { groups: {}, memberOf: {} },
    measured: new Map<string, MeasuredCard>(),
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
export function nodeFootprint(state: StateStore, node: DiagramNode, showFrontmatter: boolean): Footprint {
  const card = showFrontmatter ? state.measured.get(node.id) : undefined;
  if (!card) return { x: node.x, y: node.y, 'w': node.w, 'h': node.h };
  const width = Math.max(node.w, card.cardW);
  const height = node.h + CARD_GAP + card.cardH;
  return { x: node.x - (width - node.w) / 2, y: node.y, 'w': width, 'h': height };
}

/* ---------- snap ---------- */

/** Snap a coordinate to the grid when `snap` is on. */
export function snapV(value: number, snap: boolean): number {
  return snap ? Math.round(value / GRID) * GRID : value;
}

/* ---------- geometry (pure) ---------- */

/** World-space position of a node's port on a given side. */
export function portPos(node: DiagramNode, side: PortSide): Point {
  const mult = SIDE_MULT[side];
  return { x: node.x + node.w * mult[0], y: node.y + node.h * mult[1] };
}

/** Centre point of a node. */
export function nodeCenter(node: DiagramNode): { cx: number; cy: number } {
  return { 'cx': node.x + node.w / 2, 'cy': node.y + node.h / 2 };
}

/**
 * Pure camera transform: centre node `node` in a `viewport` at a readable zoom
 * `zoom.want`, clamped to [`zoom.min`, `zoom.max`]. Returns the camera {x, y, z}
 * a frame action should apply. The DOM-mutating camera method is a thin applier
 * over this.
 */
export function frameTransform(
  node: DiagramNode,
  viewport: { w: number; h: number },
  zoom: { want: number; min: number; max: number },
): { x: number; y: number; z: number } {
  const zoomLevel = Math.min(zoom.max, Math.max(zoom.min, zoom.want));
  const { cx: centerX, cy: centerY } = nodeCenter(node);
  return { x: viewport.w / 2 - centerX * zoomLevel, y: viewport.h / 2 - centerY * zoomLevel, 'z': zoomLevel };
}

/** Pick the nearest facing port sides for an edge between two nodes. */
export function bestSides(nodeA: DiagramNode, nodeB: DiagramNode): [PortSide, PortSide] {
  const centerA = nodeCenter(nodeA), centerB = nodeCenter(nodeB);
  const dx = centerB.cx - centerA.cx, dy = centerB.cy - centerA.cy;
  let sideA: PortSide, sideB: PortSide;
  if (Math.abs(dx) > Math.abs(dy)) {
    sideA = dx > 0 ? 'pr' : 'pl';
    sideB = dx > 0 ? 'pl' : 'pr';
  } else {
    sideA = dy > 0 ? 'pb' : 'pt';
    sideB = dy > 0 ? 'pt' : 'pb';
  }
  return [sideA, sideB];
}

/**
 * Topmost node whose box contains a world point, restricted to one drill
 * level (`container`, default root). Groups are only returned if nothing
 * else is hit (they're containers, low priority).
 */
export function nodeAtPoint(
  state: StateStore, worldX: number, worldY: number, container: string | null = null,
): string | null {
  const ids = Object.keys(state.nodes);
  let groupHit: string | null = null;
  for (let i = ids.length - 1; i >= 0; i--) {
    const id = ids[i];
    if (containerOf(state, id) !== container) continue;
    const node = state.nodes[id];
    if (worldX >= node.x && worldX <= node.x + node.w && worldY >= node.y && worldY <= node.y + node.h) {
      if (node.shape === 'group') {
        groupHit = groupHit || id;
        continue;
      }
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
    seen.add(cur);
    path.unshift(cur);
    cur = containerOf(state, cur);
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
    const node = state.nodes[id];
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
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
  const containerNode = state.nodes[container];
  const width = Math.max(120, containerNode.w), height = containerNode.h;
  const bounds = levelBounds(state, container); // children only
  if (!bounds) return { x: -width / 2, y: -height - 60, 'w': width, 'h': height };
  const centerX = (bounds.minX + bounds.maxX) / 2;
  return { x: centerX - width / 2, y: bounds.minY - 100 - height, 'w': width, 'h': height };
}

/** Bounds the camera should fit at a level: children plus the container node. */
export function levelFitBounds(state: StateStore, container: string | null):
  { minX: number; minY: number; maxX: number; maxY: number } | null {
  const bounds = levelBounds(state, container);
  if (!container || !state.nodes[container]) return bounds; // top level
  const containerNode = state.nodes[container];
  const containerBounds = {
    minX: containerNode.x, minY: containerNode.y,
    maxX: containerNode.x + containerNode.w, maxY: containerNode.y + containerNode.h,
  };
  if (!bounds) return containerBounds;
  return {
    minX: Math.min(bounds.minX, containerBounds.minX), minY: Math.min(bounds.minY, containerBounds.minY),
    maxX: Math.max(bounds.maxX, containerBounds.maxX), maxY: Math.max(bounds.maxY, containerBounds.maxY),
  };
}

/** True when `anc` sits somewhere on `node`'s parent chain (cycle guard). */
export function isAncestor(state: StateStore, anc: string, node: string): boolean {
  let cur = state.nodes[node]?.parent ?? null;
  const seen = new Set<string>();
  while (cur && !seen.has(cur)) {
    if (cur === anc) return true;
    seen.add(cur);
    cur = state.nodes[cur]?.parent ?? null;
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
    const node = state.nodes[id];
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
  }
  return { minX, minY, maxX, maxY };
}

/* ---------- slice (neighbourhood extraction) ---------- */

/** Walk solid edges from→to (transitive), adding reachable ids into `keep`. */
function collectDownstream(state: StateStore, id: string, keep: Set<string>): void {
  const queue = [id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const edge of state.edges) {
      if (edge.style !== 'solid') continue;
      if (edge.from !== cur || keep.has(edge.to)) continue;
      keep.add(edge.to);
      queue.push(edge.to);
    }
  }
}

/** Walk solid edges to→from (transitive), adding reachable ids into `keep`. */
function collectUpstream(state: StateStore, id: string, keep: Set<string>): void {
  const queue = [id];
  const seen = new Set<string>([id]);
  while (queue.length) {
    const cur = queue.shift()!;
    for (const edge of state.edges) {
      if (edge.style !== 'solid') continue;
      if (edge.to !== cur || seen.has(edge.from)) continue;
      seen.add(edge.from);
      keep.add(edge.from);
      queue.push(edge.from);
    }
  }
}

/** Add 1-hop dotted neighbours of `id` into `keep`. */
function collectDottedRefs(state: StateStore, id: string, keep: Set<string>): void {
  for (const edge of state.edges) {
    if (edge.style !== 'dotted') continue;
    if (edge.from === id) keep.add(edge.to);
    if (edge.to === id) keep.add(edge.from);
  }
}

/**
 * Compute the slice neighbourhood for a node: solid-edge ancestors + descendants
 * (transitive) plus 1-hop dotted neighbours. Pure — no DOM, no side effects.
 * Same algorithm as the former computeFocusSpine in pointer.ts (focus mode
 * calls this directly).
 */
export function sliceIds(state: StateStore, id: string): Set<string> {
  const keep = new Set<string>([id]);
  collectDownstream(state, id, keep);
  collectUpstream(state, id, keep);
  collectDottedRefs(state, id, keep);
  return keep;
}

/**
 * Compute boundary stubs: 1-hop neighbours of the keep set that aren't in it.
 * These give external connection context so a slice replacement can preserve
 * the seams (what the slice connects to on the outside).
 */
export function sliceStubs(state: StateStore, keep: Set<string>): Set<string> {
  const stubs = new Set<string>();
  for (const e of state.edges) {
    if (keep.has(e.from) && !keep.has(e.to) && state.nodes[e.to]) stubs.add(e.to);
    if (keep.has(e.to) && !keep.has(e.from) && state.nodes[e.from]) stubs.add(e.from);
  }
  return stubs;
}
