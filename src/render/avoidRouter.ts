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
import type { AppContext } from '../core/context/context';
import type { Point, DiagramNode } from '../core/types/types';
import { nodeFootprint } from '../core/state/state';
import type { RouteReq, RouteRes, RoutedPoly } from './avoidWorker';
import wasmUrl from './libavoid.wasm?url';

/** One cached route plus the obstacle-field signature it was computed for. */
interface CachedRoute {
  poly: Point[];
  sig: string; // obstacle-field signature; ANY obstacle change drops the route
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
/** Max connectors per libavoid solve. Larger batches go pathological on dense graphs. */
const EDGE_BATCH_SIZE = 20;

let wasmReady: Promise<void> | null = null;

/** Load the WASM router once; later calls reuse the same promise. */
function ensureRouter(): Promise<void> {
  if (!wasmReady) wasmReady = init(wasmUrl);
  return wasmReady;
}

/**
 * Signature of the WHOLE obstacle field: every non-group node's rendered
 * footprint (box + measured frontmatter card) plus the global frontmatter
 * toggle. A cached route stores the signature it was computed against, and
 * routeFor() drops it the moment the current signature differs — so a route is
 * stale if ANY obstacle moved, resized, appeared, or disappeared, not only its
 * two endpoints. This is what stops a wire from staying routed through a node
 * that moved into its path after the route was cached.
 */
export function obstacleSignature(ctx: AppContext): string {
  const { state } = ctx;
  const show = ctx.prefs.showFrontmatter;
  let s = show ? 'F1' : 'F0';
  for (const id of Object.keys(state.nodes).sort()) {
    const n = state.nodes[id];
    if (n.shape === 'group') continue;
    const f = nodeFootprint(state, n, show);
    s += `|${id}:${f.x},${f.y},${f.w},${f.h}`;
  }
  return s;
}

let lastRoutedSig: string | null = null;
let inFlightSig: string | null = null;
let rerouteRaf = 0;
/**
 * Re-route iff the obstacle field changed since the last route. Called at the
 * end of every render() and from the post-paint measure pass, so any geometry
 * or card-size mutation that repaints triggers a reroute — no individual call
 * site has to remember to. Deduped on the signature (unchanged obstacles = the
 * cached routes are still valid) and coalesced to one route per frame, so rapid
 * edits, and the routing reply's own re-render, neither loop nor spam the
 * worker.
 */
export function ensureRoutes(ctx: AppContext): void {
  const sig = obstacleSignature(ctx);
  if (sig === lastRoutedSig || sig === inFlightSig) return; // obstacles unchanged / already routing
  if (rerouteRaf) return;                                   // a reroute already queued
  rerouteRaf = requestAnimationFrame(() => {
    rerouteRaf = 0;
    inFlightSig = sig;                              // prevent duplicate requests while routing
    void routeReferences(ctx).then(() => {
      inFlightSig = null;
      lastRoutedSig = obstacleSignature(ctx);       // mark as routed so unchanged obstacles skip
      ctx.hooks.render();
    }).catch(() => {
      inFlightSig = null;                           // routing failed: allow retry on next render
    });
  });
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

/**
 * Rendered footprint rect of a node for ROUTING. Uses the full card HEIGHT
 * (so wires avoid the card vertically) but clips the WIDTH to the node box —
 * NOT the wider card width. The card hangs below the box and is centred, so
 * nodeFootprint widens the rect to max(box, cardW) and shifts it left. That
 * inflated rect overlaps neighbours on dense graphs, and the buffered-rect
 * overlap drives libavoid through its expensive exception path (measured
 * 730s vs 13s on a 186-obstacle graph). Clipping width to the box keeps
 * every wire clear of the card's vertical extent while eliminating the
 * horizontal spill that caused the overlap storm. A wire may occasionally
 * clip the far edge of a very wide card — acceptable vs a frozen tab.
 */
function footprintRect(ctx: AppContext, n: DiagramNode, id: string): ElkNode {
  const f = nodeFootprint(ctx.state, n, ctx.prefs.showFrontmatter);
  // clip width to the node box; keep full height (card included)
  return sanitizeRect(id, n.x, f.y, n.w, f.h);
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

async function routeGraphBatched(graph: ElkGraph): Promise<{ id: string; poly: Point[] }[]> {
  const out: { id: string; poly: Point[] }[] = [];
  const edges = graph.edges ?? [];
  for (let i = 0; i < edges.length; i += EDGE_BATCH_SIZE) {
    const chunk: ElkEdge[] = edges.slice(i, i + EDGE_BATCH_SIZE);
    const routes = await routeEdges({ ...graph, edges: chunk }, ROUTER_OPTIONS);
    for (const [id, r] of routes) {
      out.push({ id, poly: [r.sourcePoint, ...r.bendPoints, r.targetPoint] });
    }
  }
  return out;
}

/* ---------------------------------------------------------------------
   Worker plumbing (FIX 4) — route off the main thread when possible.
   --------------------------------------------------------------------- */

/** One in-flight worker request awaiting its reply. */
interface Pending {
  ctx: AppContext;
  isFull: boolean;
  gen: number;                 // routeGen at request time
  sig: string;                 // obstacle-field signature, snapshotted at request
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
        const scope = p.isFull ? null : new Set((p.graph.edges ?? []).map((e) => e.id));
        void routeOnMain(p.graph, scope, p.sig).then(() => p.ctx.hooks.render());
      }
      const stuckAdhoc = [...adhoc.values()];
      adhoc.clear();
      for (const a of stuckAdhoc) void routeAdhocOnMain(a.graph).then(a.resolve);
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/* ---------------------------------------------------------------------
   Ad-hoc routing for OTHER surfaces (reading mode): the same worker and
   wasm instance, but promise-based and outside the ctx-bound route cache.
   --------------------------------------------------------------------- */

/** Obstacle rect for an ad-hoc routing request (any coordinate space). */
export interface AdhocRect { id: string; x: number; y: number; width: number; height: number }
/** Edge for an ad-hoc routing request; endpoints reference AdhocRect ids. */
export interface AdhocEdge { id: string; source: string; target: string }

const adhoc = new Map<number, { graph: ElkGraph; resolve: (r: RoutedPoly[]) => void }>();

async function routeAdhocOnMain(graph: ElkGraph): Promise<RoutedPoly[]> {
  const ErrV8 = Error as { stackTraceLimit?: number };
  const prevStackLimit = ErrV8.stackTraceLimit;
  ErrV8.stackTraceLimit = 0;
  try {
    await ensureRouter();
    return await routeGraphBatched(graph);
  } catch {
    return []; // caller keeps its fallback elbows
  } finally {
    ErrV8.stackTraceLimit = prevStackLimit;
  }
}

/**
 * Route edges around obstacle rects and resolve with the polylines, in the
 * caller's coordinate space. Runs on the shared worker when available (off
 * the main thread), else on the main-thread wasm. Resolves [] on failure —
 * the caller's elbow fallback stays on screen, never a blank layer.
 */
export function routeGraph(rects: AdhocRect[], edges: AdhocEdge[]): Promise<RoutedPoly[]> {
  const children: ElkNode[] = rects.map((r) => sanitizeRect(r.id, r.x, r.y, r.width, r.height));
  const graph: ElkGraph = { id: 'root', children, edges: edges.map((e) => ({ ...e })) };
  const w = getWorker();
  if (w) {
    return new Promise((resolve) => {
      const reqId = ++reqSeq;
      adhoc.set(reqId, { graph, resolve });
      const req: RouteReq = { reqId, graph, options: ROUTER_OPTIONS };
      w.postMessage(req);
    });
  }
  return routeAdhocOnMain(graph);
}

/** Apply a worker reply to the cache (newest generation only), then repaint. */
function handleReply(msg: RouteRes): void {
  const ad = adhoc.get(msg.reqId);
  if (ad) {
    adhoc.delete(msg.reqId);
    if (msg.ok) { ad.resolve(msg.routes); return; }
    if (msg.fatal) { workerBroken = true; worker?.terminate(); worker = null; }
    void routeAdhocOnMain(ad.graph).then(ad.resolve);
    return;
  }
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
      const scope = p.isFull ? null : new Set((p.graph.edges ?? []).map((e) => e.id));
      void routeOnMain(p.graph, scope, p.sig).then(() => p.ctx.hooks.render());
    } else {
      // non-fatal routing error: the affected edges have no cache entry, so
      // wires.ts already draws elbows. Just repaint.
      p.ctx.hooks.render();
    }
    return;
  }

  if (p.gen !== routeGen) return; // a newer full reroute superseded this one
  if (p.isFull) routeCache.clear();
  for (const r of msg.routes) routeCache.set(r.id, { poly: r.poly, sig: p.sig });
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
  // routeFor()'s signature check draws elbows for any obstacle that moved.
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

  // snapshot the obstacle-field signature NOW; a reply that lands after any
  // obstacle moved again is dropped by routeFor() because the signature won't
  // match. One signature covers the whole request (every edge shares it).
  const reqSig = obstacleSignature(ctx);

  const w = getWorker();
  if (w) {
    const reqId = ++reqSeq;
    const gen = scope ? routeGen : ++routeGen; // a full reroute advances the generation
    pending.set(reqId, { ctx, isFull: !scope, gen, sig: reqSig, graph });
    const req: RouteReq = { reqId, graph, options: ROUTER_OPTIONS };
    w.postMessage(req);
    return; // non-blocking: caller paints elbows now, the worker reply upgrades them
  }

  // no worker: route on the main thread (already fast post-FIX-2B).
  if (!scope) routeGen++; // keep gen monotonic so any stray worker reply is dropped
  await routeOnMain(graph, scope, reqSig);
}

/**
 * Synchronous (main-thread) routing fallback, used when no Worker is available
 * or the worker reported it could not initialise. Tags every filled route with
 * the request-time obstacle signature, so a route whose obstacle field changed
 * during the await is dropped by routeFor() rather than shown frozen.
 */
async function routeOnMain(
  graph: ElkGraph,
  scope: Set<string> | null,
  sig: string,
): Promise<void> {
  // libavoid captures a full JS stack trace per internal C++ exception (FIX 1);
  // dropping the depth removes that cost and changes no routing output.
  // Error.stackTraceLimit is a V8 extension not in the standard lib types.
  const ErrV8 = Error as { stackTraceLimit?: number };
  const prevStackLimit = ErrV8.stackTraceLimit;
  ErrV8.stackTraceLimit = 0;
  try {
    await ensureRouter();
    const routes = await routeGraphBatched(graph);
    if (!scope) routeCache.clear();
    for (const r of routes) {
      routeCache.set(r.id, { poly: r.poly, sig });
    }
  } catch (err) {
    if (!scope) routeCache.clear();
    console.warn('[avoidRouter] routing failed; using fallback elbows', err);
  } finally {
    ErrV8.stackTraceLimit = prevStackLimit;
  }
}

/**
 * Cached polyline for an edge, or null when none is valid. A route is dropped
 * if the obstacle field changed since it was computed (the caller passes the
 * current signature), so a wire never shows frozen through a node that moved
 * into — or out of — its path.
 */
export function routeFor(id: string, sig: string): Point[] | null {
  const hit = routeCache.get(id);
  if (!hit) return null;
  if (hit.sig !== sig) { routeCache.delete(id); return null; }
  return hit.poly;
}
