/* =====================================================================
   avoidRouter-obstacles.ts — obstacle / footprint building for routing
   ---------------------------------------------------------------------
   Split out of avoidRouter.ts (unchanged logic): the obstacle-field
   signature plus the rect helpers that turn nodes/edges into libavoid
   inputs. Consumed by avoidRouter-core.ts (and re-exported from the
   primary avoidRouter.ts).
   ===================================================================== */

import type { ElkNode, ElkEdge } from '@mr_mint/elkjs-libavoid';
import type { AppContext } from '../core/context/context';
import type { DiagramNode } from '../core/types/types';
import { nodeFootprint } from '../core/state/state';

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

/**
 * Force a rect to finite, integer, strictly-positive dimensions. libavoid's
 * orthogonal router throws on zero-area or non-finite obstacles, and each
 * throw is expensive (see file header), so every rect is clamped before it
 * reaches the router. Integer coords also keep libavoid's geometry stable.
 */
export function sanitizeRect(id: string, x: number, y: number, w: number, h: number): ElkNode {
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
export function footprintRect(ctx: AppContext, n: DiagramNode, id: string): ElkNode {
  const f = nodeFootprint(ctx.state, n, ctx.prefs.showFrontmatter);
  // clip width to the node box; keep full height (card included)
  return sanitizeRect(id, n.x, f.y, n.w, f.h);
}

/** Every non-group edge is routed: spine edges too, so straight lines never
 *  cross a sibling card. A clear channel still yields a straight path. */
export function routableEdges(ctx: AppContext): ElkEdge[] {
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
