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
import wasmUrl from './libavoid.wasm?url';
/** edge id -> last good route. Replaced wholesale on each Tidy. */
const routeCache = new Map();
/** Padding libavoid keeps between a wire and any node rect. */
const SHAPE_BUFFER = 14;
/** Spacing libavoid keeps between parallel wire segments. */
const NUDGE_GAP = 16;
/** Box-to-card vertical gap (CSS uses 6). */
const CARD_GAP = 6;
let wasmReady = null;
/** Load the WASM router once; later calls reuse the same promise. */
function ensureRouter() {
    if (!wasmReady)
        wasmReady = init(wasmUrl);
    return wasmReady;
}
/** Endpoint signature: a route is stale if either endpoint box changed. */
function basisOf(a, b) {
    return `${a.x},${a.y},${a.w},${a.h}|${b.x},${b.y},${b.w},${b.h}`;
}
/** Rendered footprint rect of a node, including its frontmatter card. */
function footprintRect(ctx, n, id) {
    const el = ctx.dom.world.querySelector(`.node[data-id="${id}"]`);
    const card = ctx.prefs.showFrontmatter && el
        ? el.querySelector('.fmcard')
        : null;
    const w = card ? Math.max(n.w, card.offsetWidth) : n.w;
    const h = card ? n.h + CARD_GAP + card.offsetHeight : n.h;
    return { id, x: n.x - (w - n.w) / 2, y: n.y, width: w, height: h };
}
/** Every non-group edge is routed: spine edges too, so straight lines never
 *  cross a sibling card. A clear channel still yields a straight path. */
function routableEdges(ctx) {
    const out = [];
    for (const e of ctx.state.edges) {
        const a = ctx.state.nodes[e.from], b = ctx.state.nodes[e.to];
        if (!a || !b)
            continue;
        if (a.shape === 'group' || b.shape === 'group')
            continue;
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
export async function routeReferences(ctx) {
    const edges = routableEdges(ctx);
    routeCache.clear();
    if (!edges.length)
        return;
    // every non-group node is an obstacle, even ones with no reference edge
    const children = [];
    for (const id in ctx.state.nodes) {
        const n = ctx.state.nodes[id];
        if (n.shape === 'group')
            continue;
        children.push(footprintRect(ctx, n, id));
    }
    const graph = { id: 'root', children, edges };
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
            if (!e)
                continue;
            const a = ctx.state.nodes[e.from], b = ctx.state.nodes[e.to];
            if (!a || !b)
                continue;
            const poly = [r.sourcePoint, ...r.bendPoints, r.targetPoint];
            routeCache.set(id, { poly, basis: basisOf(a, b) });
        }
    }
    catch (err) {
        routeCache.clear();
        console.warn('[avoidRouter] routing failed; using fallback elbows', err);
    }
}
/**
 * Cached polyline for an edge, or null when none is valid. A route is
 * dropped if either endpoint box moved since it was computed, so a dragged
 * node never shows a wire frozen through empty space.
 */
export function routeFor(id, a, b) {
    const hit = routeCache.get(id);
    if (!hit)
        return null;
    if (hit.basis !== basisOf(a, b)) {
        routeCache.delete(id);
        return null;
    }
    return hit.poly;
}
