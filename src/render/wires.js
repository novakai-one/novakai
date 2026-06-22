/* =====================================================================
   wires.ts — edge rendering + path geometry
   ---------------------------------------------------------------------
   Responsibility: draw all edges into the #wires SVG (visible path + fat
   invisible hit-path + optional midpoint label), and provide the path
   geometry helpers orthoPath() and midOf() that are reused by export.

   Reads: ctx.state. Writes: only #wires and edge-label DOM under #world.
   ===================================================================== */
import { portPos, bestSides } from '../core/state';
import { routeFor } from './avoidRouter';
const SVG_NS = 'http://www.w3.org/2000/svg';
/** Orthogonal elbow path between two ports given their sides. */
export function orthoPath(p, sa, q, sb) {
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    const aH = sa === 'pl' || sa === 'pr';
    const bH = sb === 'pl' || sb === 'pr';
    if (aH && bH)
        return `M ${p.x} ${p.y} L ${mx} ${p.y} L ${mx} ${q.y} L ${q.x} ${q.y}`;
    if (!aH && !bH)
        return `M ${p.x} ${p.y} L ${p.x} ${my} L ${q.x} ${my} L ${q.x} ${q.y}`;
    if (aH && !bH)
        return `M ${p.x} ${p.y} L ${q.x} ${p.y} L ${q.x} ${q.y}`;
    return `M ${p.x} ${p.y} L ${p.x} ${q.y} L ${q.x} ${q.y}`;
}
/** Build an "M ... L ..." path from an ortho polyline (libavoid output). */
function polyPath(pts) {
    return pts.map((pt, i) => `${i ? 'L' : 'M'} ${pt.x} ${pt.y}`).join(' ');
}
/** Rough midpoint of an "M ... L ..." command list (for label placement). */
export function midOf(d) {
    const matched = d.match(/-?\d+(\.\d+)?/g);
    const pts = (matched || []).map(Number);
    const coords = [];
    for (let i = 0; i < pts.length; i += 2)
        coords.push({ x: pts[i], y: pts[i + 1] });
    if (coords.length === 2) {
        return { x: (coords[0].x + coords[1].x) / 2, y: (coords[0].y + coords[1].y) / 2 };
    }
    return coords[Math.floor(coords.length / 2)];
}
/** Parse an "M ... L ..." path into its corner points. */
function pathPoints(d) {
    const nums = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
    const pts = [];
    for (let i = 0; i + 1 < nums.length; i += 2)
        pts.push({ x: nums[i], y: nums[i + 1] });
    return pts;
}
/**
 * Best clear spot for an edge label: the midpoint of the path's longest
 * straight segment. On an elbow route that is the long gutter run, which
 * sits away from the node boxes — unlike the geometric midpoint, which on a
 * diagonal lands on a card.
 */
export function labelAnchor(d) {
    const pts = pathPoints(d);
    if (pts.length < 2)
        return pts[0] || { x: 0, y: 0 };
    let best = 0, bestLen = -1;
    for (let i = 0; i + 1 < pts.length; i++) {
        const len = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
        if (len > bestLen) {
            bestLen = len;
            best = i;
        }
    }
    const a = pts[best], b = pts[best + 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}
export function initWires(ctx) {
    const { wires, world } = ctx.dom;
    function drawWires() {
        const { state } = ctx;
        const placedLabels = [];
        // node footprints (box + frontmatter card) used to keep labels off nodes
        const obstacles = [];
        for (const id in state.nodes) {
            const n = state.nodes[id];
            const card = ctx.prefs.showFrontmatter
                ? world.querySelector(`.node[data-id="${id}"] .fmcard`)
                : null;
            const w = Math.max(n.w, card ? card.offsetWidth : n.w);
            const h = card ? n.h + 6 + card.offsetHeight : n.h;
            obstacles.push({ x: n.x - (w - n.w) / 2, y: n.y, w, h });
        }
        const overNode = (x, y) => obstacles.some((o) => x > o.x - 28 && x < o.x + o.w + 28 && y > o.y - 10 && y < o.y + o.h + 10);
        wires.innerHTML = `<defs>
      <marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L7,3 L0,6 Z" fill="var(--edge)"/>
      </marker>
      <marker id="arrowSel" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L7,3 L0,6 Z" fill="var(--sel)"/>
      </marker>
    </defs>`;
        for (const e of state.edges) {
            const a = state.nodes[e.from], b = state.nodes[e.to];
            if (!a || !b)
                continue;
            const [sa, sb] = bestSides(a, b);
            const p = portPos(a, sa), q = portPos(b, sb);
            const sel = state.selEdge === e.id;
            const routed = routeFor(e.id, a, b);
            const d = routed
                ? polyPath(routed)
                : (e.routing === 'ortho')
                    ? orthoPath(p, sa, q, sb)
                    : `M ${p.x} ${p.y} L ${q.x} ${q.y}`;
            // invisible fat hit-path for easy clicking
            const hit = document.createElementNS(SVG_NS, 'path');
            hit.setAttribute('d', d);
            hit.setAttribute('stroke', 'transparent');
            hit.setAttribute('stroke-width', '14');
            hit.setAttribute('fill', 'none');
            hit.setAttribute('class', 'hit');
            hit.dataset.eid = e.id;
            wires.appendChild(hit);
            const path = document.createElementNS(SVG_NS, 'path');
            path.setAttribute('d', d);
            path.setAttribute('stroke', sel ? 'var(--sel)' : 'var(--edge)');
            path.setAttribute('stroke-width', String(e.style === 'thick' ? 3 : 1.7));
            path.setAttribute('stroke-dasharray', e.style === 'dotted' ? '5 5' : '0');
            path.setAttribute('fill', 'none');
            path.setAttribute('marker-end', sel ? 'url(#arrowSel)' : 'url(#arrow)');
            path.setAttribute('stroke-linejoin', 'round');
            wires.appendChild(path);
            if (e.label) {
                const anchor = labelAnchor(d);
                // float the label off any node footprint or nearby label
                let ly = anchor.y, step = 0;
                const nearLabel = (yy) => placedLabels.some((p) => Math.abs(p.x - anchor.x) < 60 && Math.abs(p.y - yy) < 16);
                while ((overNode(anchor.x, ly) || nearLabel(ly)) && step < 12) {
                    step++;
                    ly = anchor.y + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 18;
                }
                placedLabels.push({ x: anchor.x, y: ly });
                const lab = document.createElement('div');
                lab.className = 'edgelabel' + (sel ? ' selected' : '');
                lab.dataset.eid = e.id;
                lab.textContent = e.label;
                lab.style.left = anchor.x + 'px';
                lab.style.top = ly + 'px';
                world.appendChild(lab);
            }
        }
    }
    return { drawWires };
}
