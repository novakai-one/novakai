/* =====================================================================
   state.ts — the model (single source of truth)
   ---------------------------------------------------------------------
   Responsibility: own the live diagram model — nodes, edges, the running
   id counters, and the selection. Provide pure-ish helpers that operate
   ONLY on the model + given inputs (snap, geometry, port positions,
   best-side picking). No DOM, no rendering, no history.

   Selection mutation here intentionally does NOT trigger re-render; the
   selection module composes these with render()/renderInspector().
   ===================================================================== */
import { SIDE_MULT, GRID } from './config';
/** Create a fresh, empty model. */
export function createState() {
    return { nodes: {}, edges: [], sel: new Set(), selEdge: null, nid: 1, eid: 1, dir: 'TD', roots: [] };
}
/* ---------- snap ---------- */
/** Snap a coordinate to the grid when `snap` is on. */
export function snapV(v, snap) {
    return snap ? Math.round(v / GRID) * GRID : v;
}
/* ---------- geometry (pure) ---------- */
/** World-space position of a node's port on a given side. */
export function portPos(node, side) {
    const m = SIDE_MULT[side];
    return { x: node.x + node.w * m[0], y: node.y + node.h * m[1] };
}
/** Centre point of a node. */
export function nodeCenter(n) {
    return { cx: n.x + n.w / 2, cy: n.y + n.h / 2 };
}
/** Pick the nearest facing port sides for an edge between two nodes. */
export function bestSides(a, b) {
    const ca = nodeCenter(a), cb = nodeCenter(b);
    const dx = cb.cx - ca.cx, dy = cb.cy - ca.cy;
    let sa, sb;
    if (Math.abs(dx) > Math.abs(dy)) {
        sa = dx > 0 ? 'pr' : 'pl';
        sb = dx > 0 ? 'pl' : 'pr';
    }
    else {
        sa = dy > 0 ? 'pb' : 'pt';
        sb = dy > 0 ? 'pt' : 'pb';
    }
    return [sa, sb];
}
/**
 * Topmost node whose box contains a world point. Groups are only
 * returned if nothing else is hit (they're containers, low priority).
 */
export function nodeAtPoint(state, wx, wy) {
    const ids = Object.keys(state.nodes);
    let groupHit = null;
    for (let i = ids.length - 1; i >= 0; i--) {
        const n = state.nodes[ids[i]];
        if (wx >= n.x && wx <= n.x + n.w && wy >= n.y && wy <= n.y + n.h) {
            if (n.shape === 'group') {
                groupHit = groupHit || ids[i];
                continue;
            }
            return ids[i];
        }
    }
    return groupHit;
}
/** Bounding box of all nodes, or null when empty. */
export function worldBounds(state) {
    const ids = Object.keys(state.nodes);
    if (!ids.length)
        return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of ids) {
        const n = state.nodes[id];
        minX = Math.min(minX, n.x);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x + n.w);
        maxY = Math.max(maxY, n.y + n.h);
    }
    return { minX, minY, maxX, maxY };
}
