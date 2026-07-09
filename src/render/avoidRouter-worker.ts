/* =====================================================================
   avoidRouter-worker.ts — routing Worker setup + reply handling (FIX 4)
   ---------------------------------------------------------------------
   Split out of avoidRouter.ts (unchanged logic): lazily creates the
   libavoid Worker and applies its replies to the shared caches that live
   in avoidRouter-core.ts. The `new Worker(new URL('./avoidWorker.ts', ...))`
   line MUST stay in src/render/ so the relative specifier resolves.
   ===================================================================== */

import type { RouteRes } from './avoidWorker';
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
