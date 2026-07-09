/* =====================================================================
   avoidRouter-core.ts — core routing, cache, and shared router state
   ---------------------------------------------------------------------
   Split out of avoidRouter.ts (unchanged logic): the route cache and its
   obstacle-signature invalidation, the wasm init, the reroute coalescer,
   the ad-hoc/main-thread routing paths, and the shared mutable state
   (route generation, request sequence, in-flight maps) the Worker in
   avoidRouter-worker.ts reads. See avoidRouter.ts for the file header.
   ===================================================================== */

import { init, routeEdges } from '@mr_mint/elkjs-libavoid';
import type { ElkGraph, ElkNode, ElkEdge, LibavoidRouterOptions } from '@mr_mint/elkjs-libavoid';
import type { AppContext } from '../core/context/context';
import type { Point } from '../core/types/types';
import type { RouteReq, RoutedPoly } from './avoidWorker';
import wasmUrl from './libavoid.wasm?url';
import { obstacleSignature, footprintRect, routableEdges, sanitizeRect } from './avoidRouter-obstacles';
import { getWorker } from './avoidRouter-worker';

/** One cached route plus the obstacle-field signature it was computed for. */
interface CachedRoute {
  poly: Point[];
  sig: string; // obstacle-field signature; ANY obstacle change drops the route
}

/** edge id -> last good route. Replaced wholesale on each Tidy. */
export const routeCache = new Map<string, CachedRoute>();

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
    for (const [id, route] of routes) {
      out.push({ id, poly: [route.sourcePoint, ...route.bendPoints, route.targetPoint] });
    }
  }
  return out;
}

/* ---------------------------------------------------------------------
   Worker plumbing (FIX 4) — route off the main thread when possible.
   --------------------------------------------------------------------- */

/** One in-flight worker request awaiting its reply. */
export interface Pending {
  ctx: AppContext;
  isFull: boolean;
  gen: number;                 // routeGen at request time
  sig: string;                 // obstacle-field signature, snapshotted at request
  graph: ElkGraph;             // retained so a fatal reply can re-route on main
}

export const pending = new Map<number, Pending>();
let reqSeq = 0;
/** Bumped on every FULL reroute; a reply from an older generation is dropped. */
export let routeGen = 0;

/* ---------------------------------------------------------------------
   Ad-hoc routing for OTHER surfaces (reading mode): the same worker and
   wasm instance, but promise-based and outside the ctx-bound route cache.
   --------------------------------------------------------------------- */

/** Obstacle rect for an ad-hoc routing request (any coordinate space). */
export interface AdhocRect { id: string; x: number; y: number; width: number; height: number }
/** Edge for an ad-hoc routing request; endpoints reference AdhocRect ids. */
export interface AdhocEdge { id: string; source: string; target: string }

export const adhoc = new Map<number, { graph: ElkGraph; resolve: (r: RoutedPoly[]) => void }>();

export async function routeAdhocOnMain(graph: ElkGraph): Promise<RoutedPoly[]> {
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
  const children: ElkNode[] = rects.map((rect) =>
    sanitizeRect(rect.id, { x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
  const graph: ElkGraph = { id: 'root', children, edges: edges.map((e) => ({ ...e })) };
  const worker = getWorker();
  if (worker) {
    return new Promise((resolve) => {
      const reqId = ++reqSeq;
      adhoc.set(reqId, { graph, resolve });
      const req: RouteReq = { reqId, graph, options: ROUTER_OPTIONS };
      worker.postMessage(req);
    });
  }
  return routeAdhocOnMain(graph);
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
/**
 * Scope `edges` to `scope` (if set) and evict their stale cache entries.
 * Returns null when there is nothing left to route (and, for a full reroute,
 * clears the whole cache — mirrors the old inline early-return).
 */
function scopedRoutableEdges(ctx: AppContext, scope: Set<string> | null): ElkEdge[] | null {
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
    return null;
  }
  return edges;
}

/** Every non-group node is an obstacle, even ones with no reference edge. */
function buildObstacleChildren(ctx: AppContext): ElkNode[] {
  const children: ElkNode[] = [];
  for (const id in ctx.state.nodes) {
    const node = ctx.state.nodes[id];
    if (node.shape === 'group') continue;
    children.push(footprintRect(ctx, node, id));
  }
  return children;
}

/** Hand a routing request off to the shared worker (non-blocking). */
function dispatchToWorker(
  worker: Worker,
  req: { graph: ElkGraph; ctx: AppContext; scope: Set<string> | null; sig: string },
): void {
  const reqId = ++reqSeq;
  const gen = req.scope ? routeGen : ++routeGen; // a full reroute advances the generation
  pending.set(reqId, { ctx: req.ctx, isFull: !req.scope, gen, sig: req.sig, graph: req.graph });
  const msg: RouteReq = { reqId, graph: req.graph, options: ROUTER_OPTIONS };
  worker.postMessage(msg);
}

export async function routeReferences(ctx: AppContext, opts?: RouteOptions): Promise<void> {
  const scope = opts?.onlyEdgeIds ?? null;
  const edges = scopedRoutableEdges(ctx, scope);
  if (!edges) return;

  const graph: ElkGraph = { id: 'root', children: buildObstacleChildren(ctx), edges };

  // snapshot the obstacle-field signature NOW; a reply that lands after any
  // obstacle moved again is dropped by routeFor() because the signature won't
  // match. One signature covers the whole request (every edge shares it).
  const reqSig = obstacleSignature(ctx);

  const worker = getWorker();
  if (worker) {
    dispatchToWorker(worker, { graph, ctx, scope, sig: reqSig });
    return; // non-blocking: caller paints elbows now, the worker reply upgrades them
  }

  // no worker: route on the main thread (already fast post-FIX-2B).
  if (!scope) routeGen++; // keep gen monotonic so any stray worker reply is dropped
  await routeOnMain(graph, scope, reqSig);
}

/** Run fn() with V8's stack-trace capture disabled (FIX 1): libavoid throws
 *  internally per obstacle overlap, and capturing a full JS stack per throw
 *  is the expensive part, not the throw itself. Error.stackTraceLimit is a
 *  V8 extension not in the standard lib types. */
async function withSuppressedStackTrace<T>(run: () => Promise<T>): Promise<T> {
  const ErrV8 = Error as { stackTraceLimit?: number };
  const prevStackLimit = ErrV8.stackTraceLimit;
  ErrV8.stackTraceLimit = 0;
  try {
    return await run();
  } finally {
    ErrV8.stackTraceLimit = prevStackLimit;
  }
}

/**
 * Synchronous (main-thread) routing fallback, used when no Worker is available
 * or the worker reported it could not initialise. Tags every filled route with
 * the request-time obstacle signature, so a route whose obstacle field changed
 * during the await is dropped by routeFor() rather than shown frozen.
 */
export async function routeOnMain(
  graph: ElkGraph,
  scope: Set<string> | null,
  sig: string,
): Promise<void> {
  try {
    const routes = await withSuppressedStackTrace(async () => {
      await ensureRouter();
      return routeGraphBatched(graph);
    });
    if (!scope) routeCache.clear();
    for (const route of routes) routeCache.set(route.id, { poly: route.poly, sig });
  } catch (err) {
    if (!scope) routeCache.clear();
    console.warn('[avoidRouter] routing failed; using fallback elbows', err);
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
  if (hit.sig !== sig) {
    routeCache.delete(id);
    return null;
  }
  return hit.poly;
}
