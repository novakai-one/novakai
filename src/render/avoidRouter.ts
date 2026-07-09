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
     allocation. See NOVAKAI_PERF_FIXES.md.
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

   This file was split for size (< 400 lines): the implementation now lives
   in avoidRouter-obstacles.ts (obstacle/footprint building),
   avoidRouter-worker.ts (Worker setup + reply handling), and
   avoidRouter-core.ts (core routing, cache, shared state). This module
   re-exports the public surface so importers are unchanged.
   ===================================================================== */

export { obstacleSignature } from './avoidRouter-obstacles';
export {
  ensureRoutes,
  routeReferences,
  routeGraph,
  routeFor,
} from './avoidRouter-core';
export type { RouteOptions, AdhocRect, AdhocEdge } from './avoidRouter-core';
