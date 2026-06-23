/* =====================================================================
   avoidRouter.ts — obstacle-avoiding reference-edge routing (libavoid)
   ---------------------------------------------------------------------
   Responsibility: compute orthogonal, node-avoiding polylines for the
   diagram's reference edges (routing === 'ortho') with the libavoid WASM
   router, and cache them by edge id for wires.ts to draw.

   Spine edges are NOT routed here; they stay straight. Only reference
   edges go to libavoid. Node obstacle rects include the frontmatter card
   footprint, so a wire never crosses a card.

   Coordinates are absolute world space, matching the SVG #wires layer.
   ===================================================================== */

import { init, routeEdges } from '@mr_mint/elkjs-libavoid';
import type { ElkGraph, ElkNode, ElkEdge } from '@mr_mint/elkjs-libavoid';
import type { AppContext } from '../core/context';
import type { Point, DiagramNode } from '../core/types';
import wasmUrl from './libavoid.wasm?url';

/** One cached route plus the endpoint geometry it was computed for. */
interface CachedRoute {
  poly: Point[];
  basis: string; // endpoint signature; a moved endpoint drops the route
}

/** edge id -> last good route. Replaced wholesale on each Tidy. */
const routeCache = new Map<string, CachedRoute>();

/** Padding libavoid keeps between a wire and any node rect. */
const SHAPE_BUFFER = 14;
/** Spacing libavoid keeps between parallel wire segments. */
const NUDGE_GAP = 16;
/** Box-to-card vertical gap (CSS uses 6). */
const CARD_GAP = 6;

let wasmReady: Promise<void> | null = null;

/** Load the WASM router once; later calls reuse the same promise. */
function ensureRouter(): Promise<void> {
  if (!wasmReady) wasmReady = init(wasmUrl);
  return wasmReady;
}

/** Endpoint signature: a route is stale if either endpoint box changed. */
function basisOf(a: DiagramNode, b: DiagramNode): string {
  return `${a.x},${a.y},${a.w},${a.h}|${b.x},${b.y},${b.w},${b.h}`;
}

/** Rendered footprint rect of a node, including its frontmatter card. */
function footprintRect(ctx: AppContext, n: DiagramNode, id: string): ElkNode {
  const el = ctx.dom.world.querySelector<HTMLElement>(`.node[data-id="${id}"]`);
  const card = ctx.prefs.showFrontmatter && el
    ? el.querySelector<HTMLElement>('.fmcard')
    : null;
  const w = card ? Math.max(n.w, card.offsetWidth) : n.w;
  const h = card ? n.h + CARD_GAP + card.offsetHeight : n.h;
  return { id, x: n.x - (w - n.w) / 2, y: n.y, width: w, height: h };
}

/** Every non-group edge is routed: spine edges too, so straight lines never
 *  cross a sibling card. A clear channel still yields a straight path. */
function routableEdges(ctx: AppContext): ElkEdge[] {
  const out: ElkEdge[] = [];
  for (const e of ctx.state.edges) {
    const a = ctx.state.nodes[e.from], b = ctx.state.nodes[e.to];
    if (!a || !b) continue;
    if (a.shape === 'group' || b.shape === 'group') continue;
    if (e.bend) continue; // manually bent wires are user-controlled, not auto-routed
    out.push({ id: e.id, source: e.from, target: e.to });
  }
  return out;
}

/**
 * Route every reference edge around the node footprints and cache the
 * result by edge id. Call after node positions are final, before render.
 * On any failure the cache is cleared and wires.ts falls back to the
 * naive elbow path, so a routing error never blanks the diagram.
 */
export async function routeReferences(ctx: AppContext): Promise<void> {
  const edges = routableEdges(ctx);
  routeCache.clear();
  if (!edges.length) return;

  // every non-group node is an obstacle, even ones with no reference edge
  const children: ElkNode[] = [];
  for (const id in ctx.state.nodes) {
    const n = ctx.state.nodes[id];
    if (n.shape === 'group') continue;
    children.push(footprintRect(ctx, n, id));
  }
  const graph: ElkGraph = { id: 'root', children, edges };

  try {
    await ensureRouter();
    const routes = await routeEdges(graph, {
      routingType: 'orthogonal',
      shapeBufferDistance: SHAPE_BUFFER,
      idealNudgingDistance: NUDGE_GAP,
      nudgeOrthogonalSegmentsConnectedToShapes: true,
    });
    for (const [id, r] of routes) {
      const e = ctx.state.edges.find((x) => x.id === id);
      if (!e) continue;
      const a = ctx.state.nodes[e.from], b = ctx.state.nodes[e.to];
      if (!a || !b) continue;
      const poly: Point[] = [r.sourcePoint, ...r.bendPoints, r.targetPoint];
      routeCache.set(id, { poly, basis: basisOf(a, b) });
    }
  } catch (err) {
    routeCache.clear();
    console.warn('[avoidRouter] routing failed; using fallback elbows', err);
  }
}

/**
 * Cached polyline for an edge, or null when none is valid. A route is
 * dropped if either endpoint box moved since it was computed, so a dragged
 * node never shows a wire frozen through empty space.
 */
export function routeFor(id: string, a: DiagramNode, b: DiagramNode): Point[] | null {
  const hit = routeCache.get(id);
  if (!hit) return null;
  if (hit.basis !== basisOf(a, b)) { routeCache.delete(id); return null; }
  return hit.poly;
}
