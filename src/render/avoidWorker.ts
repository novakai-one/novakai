/* =====================================================================
   avoidWorker.ts — off-main-thread libavoid routing (FIX 4)
   ---------------------------------------------------------------------
   Runs the orthogonal obstacle-avoiding router in a dedicated module
   Worker so a full-graph route (Tidy) no longer blocks the main thread.
   It does NOT make routing faster — it relocates the ~0.1–2s of wasm work
   off the UI thread, so the canvas stays interactive while routes compute.

   Protocol:
     main -> worker : RouteReq  { reqId, graph, options }
     worker -> main : RouteRes  ok=true  { reqId, routes }       (success)
                                 ok=false { reqId, fatal, error } (failure)

   `fatal` is true only when the wasm module failed to initialise inside the
   worker (the documented risk for this package). avoidRouter.ts treats a
   fatal reply as "workers are unavailable here" and permanently falls back
   to main-thread routing, so collision avoidance is never lost.

   This module must stay self-contained: it imports ONLY the router package
   and the wasm url. Importing app code here would pull the whole app into
   the worker bundle.
   ===================================================================== */

import { init, routeEdges } from '@mr_mint/elkjs-libavoid';
import type { ElkGraph, LibavoidRouterOptions } from '@mr_mint/elkjs-libavoid';
import wasmUrl from './libavoid.wasm?url';

/** Request posted from the main thread. */
export interface RouteReq {
  reqId: number;
  graph: ElkGraph;
  options: LibavoidRouterOptions;
}

/** One routed polyline, keyed by edge id. Points are plain {x,y}. */
export interface RoutedPoly {
  id: string;
  poly: { x: number; y: number }[];
}

/** Reply posted back to the main thread. */
export type RouteRes =
  | { reqId: number; ok: true; routes: RoutedPoly[] }
  | { reqId: number; ok: false; fatal: boolean; error: string };

let wasmReady: Promise<void> | null = null;
function ensureRouter(): Promise<void> {
  if (!wasmReady) wasmReady = init(wasmUrl);
  return wasmReady;
}

// `self` typed minimally so this file needs no WebWorker lib in tsconfig.
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<RouteReq>) => void) | null;
  postMessage: (m: RouteRes) => void;
};

scope.onmessage = async (e) => {
  const { reqId, graph, options } = e.data;

  // Same trace-suppression as the main thread (FIX 1): libavoid captures a
  // full JS stack on every internal C++ exception; dropping the depth removes
  // that cost without changing routing output.
  const ErrV8 = Error as { stackTraceLimit?: number };
  const prevStackLimit = ErrV8.stackTraceLimit;
  ErrV8.stackTraceLimit = 0;

  let initialised = false;
  try {
    await ensureRouter();
    initialised = true;
    const routes = await routeEdges(graph, options);
    const out: RoutedPoly[] = [];
    for (const [id, r] of routes) {
      out.push({ id, poly: [r.sourcePoint, ...r.bendPoints, r.targetPoint] });
    }
    scope.postMessage({ reqId, ok: true, routes: out });
  } catch (err) {
    // fatal === the wasm never initialised => workers are unusable here.
    scope.postMessage({ reqId, ok: false, fatal: !initialised, error: String(err) });
  } finally {
    ErrV8.stackTraceLimit = prevStackLimit;
  }
};
