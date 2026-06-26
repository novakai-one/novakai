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

   PERF NOTES (2026-06):
   - libavoid is Emscripten-compiled and captures a full JS stack trace on
     every internal C++ exception. On dense graphs that trace construction
     dominated routing time (~70% in profiling). routeReferences() now
     suppresses Error.stackTraceLimit around the wasm call (save/restore in
     finally). This changes NO routing output — it only stops the trace
     allocation. See FLOWMAP_PERF_FIXES.md.
   - Obstacle rects are sanitised (finite, integer, min 1x1) before they
     reach libavoid; zero-area / NaN rects made the router throw.
   - routeReferences(ctx, { onlyEdgeIds }) routes a subset of edges while
     still using every node as an obstacle. Callers re-routing after a
     single drag/resize pass only the incident edge ids, so they route a
     handful of connectors instead of all of them.
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

/**
 * Force a rect to finite, integer, strictly-positive dimensions. libavoid's
 * orthogonal router throws on zero-area or non-finite obstacles, and each
 * throw is expensive (see file header), so every rect is clamped before it
 * reaches the router. Integer coords also keep libavoid's geometry stable.
 */
function sanitizeRect(id: string, x: number, y: number, w: number, h: number): ElkNode {
  const fx = Number.isFinite(x) ? Math.round(x) : 0;
  const fy = Number.isFinite(y) ? Math.round(y) : 0;
  const fw = Number.isFinite(w) ? Math.max(1, Math.round(w)) : 1;
  const fh = Number.isFinite(h) ? Math.max(1, Math.round(h)) : 1;
  return { id, x: fx, y: fy, width: fw, height: fh };
}

/** Rendered footprint rect of a node, including its frontmatter card. */
function footprintRect(ctx: AppContext, n: DiagramNode, id: string): ElkNode {
  const el = ctx.dom.world.querySelector<HTMLElement>(`.node[data-id="${id}"]`);
  const card = ctx.prefs.showFrontmatter && el
    ? el.querySelector<HTMLElement>('.fmcard')
    : null;
  const w = card ? Math.max(n.w, card.offsetWidth) : n.w;
  const h = card ? n.h + CARD_GAP + card.offsetHeight : n.h;
  return sanitizeRect(id, n.x - (w - n.w) / 2, n.y, w, h);
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

/** Options for routeReferences. */
export interface RouteOptions {
  /**
   * When set, only these edge ids are routed (all nodes still act as
   * obstacles). Used after a single drag/resize so we route a few
   * connectors instead of the whole graph. Cached routes for edges NOT in
   * the set are kept as-is.
   */
  onlyEdgeIds?: Set<string>;
}

/**
 * Route reference edges around the node footprints and cache the result by
 * edge id. Call after node positions are final, before render.
 *
 * Full graph (no opts): clears the cache and routes every routable edge.
 * Scoped (opts.onlyEdgeIds): drops + re-routes only those edges, keeps the
 * rest of the cache. Obstacles are ALWAYS every non-group node, so scoped
 * routes still avoid every box.
 *
 * On any failure the affected cache entries are cleared and wires.ts falls
 * back to the naive elbow path, so a routing error never blanks the diagram.
 */
export async function routeReferences(ctx: AppContext, opts?: RouteOptions): Promise<void> {
  const scope = opts?.onlyEdgeIds ?? null;

  let edges = routableEdges(ctx);
  if (scope) {
    edges = edges.filter((e) => scope.has(e.id));
    for (const id of scope) routeCache.delete(id); // re-route just these
  } else {
    routeCache.clear();
  }
  if (!edges.length) return;

  // every non-group node is an obstacle, even ones with no reference edge
  const children: ElkNode[] = [];
  for (const id in ctx.state.nodes) {
    const n = ctx.state.nodes[id];
    if (n.shape === 'group') continue;
    children.push(footprintRect(ctx, n, id));
  }
  const graph: ElkGraph = { id: 'root', children, edges };

  // libavoid throws-and-captures a full JS stack trace per internal C++
  // exception; on dense graphs that trace construction was ~70% of route
  // time. Dropping the trace depth around the wasm call removes that cost
  // and changes no routing output. Restored in finally so the rest of the
  // app keeps normal error traces.
  const prevStackLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 0;
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
    // a scoped failure only drops the scoped edges (already deleted above);
    // a full failure clears everything so nothing renders a stale route.
    if (!scope) routeCache.clear();
    console.warn('[avoidRouter] routing failed; using fallback elbows', err);
  } finally {
    Error.stackTraceLimit = prevStackLimit;
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
