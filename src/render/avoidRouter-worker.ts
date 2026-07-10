/* =====================================================================
   avoidRouter-worker.ts — routing Worker setup + reply handling (FIX 4)
   ---------------------------------------------------------------------
   Split out of avoidRouter.ts (unchanged logic): lazily creates the
   libavoid Worker and applies its replies to the shared caches that live
   in avoidRouter-core.ts. The `new Worker(new URL('./avoidWorker.ts', ...))`
   line MUST stay in src/render/ so the relative specifier resolves.
   ===================================================================== */

import type { RouteRes } from './avoidWorker';
import type { Pending } from './avoidRouter-core';
import {
  pending,
  adhoc,
  routeCache,
  routeGen,
  routeOnMain,
  routeAdhocOnMain,
} from './avoidRouter-core';

let worker: Worker | null = null;
let workerBroken = false;

/** Lazily create the routing worker; returns null once it has proven unusable. */
export function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./avoidWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<RouteRes>) => handleReply(e.data);
    worker.onerror = handleWorkerError;
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** Worker threw an uncaught error: mark it dead and re-route anything still
 *  in flight on the main thread so wires recover. */
function handleWorkerError(): void {
  workerBroken = true;
  worker = null;
  const stuck = [...pending.values()];
  pending.clear();
  for (const job of stuck) {
    const scope = job.isFull ? null : new Set((job.graph.edges ?? []).map((e) => e.id));
    void routeOnMain(job.graph, scope, job.sig).then(() => job.ctx.hooks.render());
  }
  const stuckAdhoc = [...adhoc.values()];
  adhoc.clear();
  for (const adh of stuckAdhoc) void routeAdhocOnMain(adh.graph).then(adh.resolve);
}

/** Worker died mid-reply: stop using it (caller re-routes on main). */
function tearDownWorker(): void {
  workerBroken = true;
  worker?.terminate();
  worker = null;
}

/** True if msg was an adhoc-routing reply (handled here); false if it belongs to `pending`. */
function handleAdhocReply(msg: RouteRes): boolean {
  const adh = adhoc.get(msg.reqId);
  if (!adh) return false;
  adhoc.delete(msg.reqId);
  if (msg.success) {
    adh.resolve(msg.routes);
    return true;
  }
  if (msg.fatal) tearDownWorker();
  void routeAdhocOnMain(adh.graph).then(adh.resolve);
  return true;
}

/** Apply a `pending` (ctx-bound) worker reply to the route cache, then repaint. */
function handlePendingReply(job: Pending, msg: RouteRes): void {
  if (!msg.success) {
    if (msg.fatal) {
      // wasm could not initialise in the worker: tear it down, re-route this
      // request on the main thread, and route on the main thread hereafter.
      tearDownWorker();
      const scope = job.isFull ? null : new Set((job.graph.edges ?? []).map((e) => e.id));
      void routeOnMain(job.graph, scope, job.sig).then(() => job.ctx.hooks.render());
    } else {
      // non-fatal routing error: the affected edges have no cache entry, so
      // wires.ts already draws elbows. Just repaint.
      job.ctx.hooks.render();
    }
    return;
  }

  if (job.gen !== routeGen) return; // a newer full reroute superseded this one
  if (job.isFull) routeCache.clear();
  for (const route of msg.routes) routeCache.set(route.id, { poly: route.poly, sig: job.sig });
  job.ctx.hooks.render();
}

/** Apply a worker reply to the cache (newest generation only), then repaint. */
function handleReply(msg: RouteRes): void {
  if (handleAdhocReply(msg)) return;
  const job = pending.get(msg.reqId);
  pending.delete(msg.reqId);
  if (job) handlePendingReply(job, msg);
}
