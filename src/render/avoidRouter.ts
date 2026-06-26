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
   - SHAPE_BUFFER was lowered 14 -> 4 (FIX 2B): dense frontmatter-card
     footprints made the buffered obstacle rects overlap, forcing libavoid
     down its expensive exception path. See the SHAPE_BUFFER comment.
   - Routing runs in a Web Worker (avoidWorker.ts, FIX 4) when one is
     available: routeReferences posts the graph and returns immediately, so
     the main thread never blocks. wires.ts draws elbows for moved edges
     while the worker computes; the reply fills the cache and re-renders the
     avoided routes. If the wasm cannot init in a worker, the first reply is
     `fatal` and routing permanently falls back to the main thread — slower
     but never without collision avoidance.
   ===================================================================== */

import { init, routeEdges } from '@mr_mint/elkjs-libavoid';
import type { ElkGraph, ElkNode, ElkEdge, LibavoidRouterOptions } from '@mr_mint/elkjs-libavoid';
import type { AppContext } from '../core/context';
import type { Point, DiagramNode } from '../core/types';
import type { RouteReq, RouteRes } from './avoidWorker';
import wasmUrl from './libavoid.wasm?url';

/** One cached route plus the endpoint geometry it was computed for. */
interface CachedRoute {
  poly: Point[];
  basis: string; // endpoint signature; a moved endpoint drops the route
}

/** edge id -> last good route. Replaced wholesale on each Tidy. */
const routeCache = new Map<string, CachedRoute>();

/**
 * Padding libavoid keeps between a wire and any node rect.
 * Lowered 14 -> 4 (FIX 2B): with frontmatter cards on, the inflated card
 * footprints are densely packed; a 14px buffer made the *buffered* rects
 * overlap heavily (85 overlapping pairs on the Novakai graph), which forced
 * libavoid through its expensive orthogonal-exception path (~1.6s vs ~0.11s
 * measured on the real graph). 4px keeps the full card as an obstacle — so
 * wires still avoid every card — while removing the buffered-rect overlap
 * that triggered the throws. Do not raise back above ~6 (timing cliff).
 */
const SHAPE_BUFFER = 4;
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

/** libavoid options shared by the worker and the main-thread fallback. */
const ROUTER_OPTIONS: LibavoidRouterOptions = {
  routingType: 'orthogonal',
  shapeBufferDistance: SHAPE_BUFFER,
  idealNudgingDistance: NUDGE_GAP,
  nudgeOrthogonalSegmentsConnectedToShapes: true,
};

/* ---------------------------------------------------------------------
   Worker plumbing (FIX 4) — route off the main thread when possible.
   --------------------------------------------------------------------- */

/** One in-flight worker request awaiting its reply. */
interface Pending {
  ctx: AppContext;
  isFull: boolean;
  gen: number;                 // routeGen at request time
  basis: Map<string, string>;  // edge id -> endpoint signature, snapshotted now
  graph: ElkGraph;             // retained so a fatal reply can re-route on main
}

const pending = new Map<number, Pending>();
let reqSeq = 0;
/** Bumped on every FULL reroute; a reply from an older generation is dropped. */
let routeGen = 0;

let worker: Worker | null = null;
let workerBroken = false;

/** Lazily create the routing worker; returns null once it has proven unusable. */
function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./avoidWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<RouteRes>) => handleReply(e.data);
    worker.onerror = () => {
      workerBroken = true;
      worker = null;
      // re-route anything still in flight on the main thread so wires recover.
      const stuck = [...pending.values()];
      pending.clear();
      for (const p of stuck) {
        const scope = p.isFull ? null : new Set(p.basis.keys());
        void routeOnMain(p.graph, scope, p.basis).then(() => p.ctx.hooks.render());
      }
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** Apply a worker reply to the cache (newest generation only), then repaint. */
function handleReply(msg: RouteRes): void {
  const p = pending.get(msg.reqId);
  pending.delete(msg.reqId);
  if (!p) return;

  if (!msg.ok) {
    if (msg.fatal) {
      // wasm could not initialise in the worker: tear it down, re-route this
      // request on the main thread, and route on the main thread hereafter.
      workerBroken = true;
      worker?.terminate();
      worker = null;
      const scope = p.isFull ? null : new Set(p.basis.keys());
      void routeOnMain(p.graph, scope, p.basis).then(() => p.ctx.hooks.render());
    } else {
      // non-fatal routing error: the affected edges have no cache entry, so
      // wires.ts already draws elbows. Just repaint.
      p.ctx.hooks.render();
    }
    return;
  }

  if (p.gen !== routeGen) return; // a newer full reroute superseded this one
  if (p.isFull) routeCache.clear();
  for (const r of msg.routes) {
    const basis = p.basis.get(r.id);
    if (basis != null) routeCache.set(r.id, { poly: r.poly, basis });
  }
  p.ctx.hooks.render();
}

/**
 * Route reference edges around the node footprints and cache the result by
 * edge id. Call after node positions are final, before render.
 *
 * Full graph (no opts): re-routes every routable edge; the cache is replaced
 * when the routes are ready. Scoped (opts.onlyEdgeIds): drops + re-routes only
 * those edges and keeps the rest. Obstacles are ALWAYS every non-group node,
 * so scoped routes still avoid every box.
 *
 * When a routing Worker is available the heavy wasm work runs off the main
 * thread: this returns immediately (the caller's render draws elbows for any
 * moved edge) and the worker reply fills the cache and re-renders the avoided
 * routes. Without a worker it routes on the main thread and resolves once the
 * cache is filled. On failure the affected entries stay empty and wires.ts
 * falls back to elbows, so a routing error never blanks the diagram.
 */
export async function routeReferences(ctx: AppContext, opts?: RouteOptions): Promise<void> {
  const scope = opts?.onlyEdgeIds ?? null;

  let edges = routableEdges(ctx);
  if (scope) {
    edges = edges.filter((e) => scope.has(e.id));
    for (const id of scope) routeCache.delete(id); // re-route just these
  }
  // NOTE: a full reroute no longer clears the cache up front. The cache is
  // replaced when routes arrive (worker reply or main-thread fill); meanwhile
  // routeFor()'s basis check draws elbows for any node that moved.
  if (!edges.length) {
    if (!scope) routeCache.clear();
    return;
  }

  // every non-group node is an obstacle, even ones with no reference edge
  const children: ElkNode[] = [];
  for (const id in ctx.state.nodes) {
    const n = ctx.state.nodes[id];
    if (n.shape === 'group') continue;
    children.push(footprintRect(ctx, n, id));
  }
  const graph: ElkGraph = { id: 'root', children, edges };

  // snapshot each edge's endpoint signature NOW; a reply that lands after the
  // node moved again is dropped by routeFor() because the basis won't match.
  const basis = new Map<string, string>();
  for (const e of edges) {
    if (!e.source || !e.target) continue;
    const a = ctx.state.nodes[e.source], b = ctx.state.nodes[e.target];
    if (a && b) basis.set(e.id, basisOf(a, b));
  }

  const w = getWorker();
  if (w) {
    const reqId = ++reqSeq;
    const gen = scope ? routeGen : ++routeGen; // a full reroute advances the generation
    pending.set(reqId, { ctx, isFull: !scope, gen, basis, graph });
    const req: RouteReq = { reqId, graph, options: ROUTER_OPTIONS };
    w.postMessage(req);
    return; // non-blocking: caller paints elbows now, the worker reply upgrades them
  }

  // no worker: route on the main thread (already fast post-FIX-2B).
  if (!scope) routeGen++; // keep gen monotonic so any stray worker reply is dropped
  await routeOnMain(graph, scope, basis);
}

/**
 * Synchronous (main-thread) routing fallback, used when no Worker is available
 * or the worker reported it could not initialise. Fills the cache from the
 * request-time basis snapshot, so a node that moved during the await is dropped
 * by routeFor() rather than shown frozen.
 */
async function routeOnMain(
  graph: ElkGraph,
  scope: Set<string> | null,
  basis: Map<string, string>,
): Promise<void> {
  // libavoid captures a full JS stack trace per internal C++ exception (FIX 1);
  // dropping the depth removes that cost and changes no routing output.
  // Error.stackTraceLimit is a V8 extension not in the standard lib types.
  const ErrV8 = Error as { stackTraceLimit?: number };
  const prevStackLimit = ErrV8.stackTraceLimit;
  ErrV8.stackTraceLimit = 0;
  try {
    await ensureRouter();
    const routes = await routeEdges(graph, ROUTER_OPTIONS);
    if (!scope) routeCache.clear();
    for (const [id, r] of routes) {
      const b = basis.get(id);
      if (b == null) continue;
      routeCache.set(id, { poly: [r.sourcePoint, ...r.bendPoints, r.targetPoint], basis: b });
    }
  } catch (err) {
    if (!scope) routeCache.clear();
    console.warn('[avoidRouter] routing failed; using fallback elbows', err);
  } finally {
    ErrV8.stackTraceLimit = prevStackLimit;
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
