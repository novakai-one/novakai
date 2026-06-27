/* =====================================================================
   wires.ts — edge rendering + path geometry
   ---------------------------------------------------------------------
   Responsibility: draw all edges into the #wires SVG (visible path + fat
   invisible hit-path + optional midpoint label), and provide the path
   geometry helpers orthoPath() and midOf() that are reused by export.

   Reads: ctx.state. Writes: only #wires and edge-label DOM under #world.
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { PortSide, Point, DiagramEdge, DiagramNode } from '../core/types';
import { portPos, bestSides, containerOf, childIdsOf, nodeFootprint } from '../core/state';
import { nodeUsesType } from '../core/frontmatter';
import { routeFor, obstacleSignature, ensureRoutes } from './avoidRouter';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Orthogonal elbow path between two ports given their sides. */
export function orthoPath(p: Point, sa: PortSide, q: Point, sb: PortSide): string {
  const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
  const aH = sa === 'pl' || sa === 'pr';
  const bH = sb === 'pl' || sb === 'pr';
  if (aH && bH) return `M ${p.x} ${p.y} L ${mx} ${p.y} L ${mx} ${q.y} L ${q.x} ${q.y}`;
  if (!aH && !bH) return `M ${p.x} ${p.y} L ${p.x} ${my} L ${q.x} ${my} L ${q.x} ${q.y}`;
  if (aH && !bH) return `M ${p.x} ${p.y} L ${q.x} ${p.y} L ${q.x} ${q.y}`;
  return `M ${p.x} ${p.y} L ${p.x} ${q.y} L ${q.x} ${q.y}`;
}

/** Build an "M ... L ..." path from an ortho polyline (libavoid output). */
function polyPath(pts: Point[]): string {
  return pts.map((pt, i) => `${i ? 'L' : 'M'} ${pt.x} ${pt.y}`).join(' ');
}

/** Rough midpoint of an "M ... L ..." command list (for label placement). */
export function midOf(d: string): Point {
  const matched = d.match(/-?\d+(\.\d+)?/g);
  const pts = (matched || []).map(Number);
  const coords: Point[] = [];
  for (let i = 0; i < pts.length; i += 2) coords.push({ x: pts[i], y: pts[i + 1] });
  if (coords.length === 2) {
    return { x: (coords[0].x + coords[1].x) / 2, y: (coords[0].y + coords[1].y) / 2 };
  }
  return coords[Math.floor(coords.length / 2)];
}

/** Parse an "M ... L ..." path into its corner points. */
function pathPoints(d: string): Point[] {
  const nums = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number);
  const pts: Point[] = [];
  for (let i = 0; i + 1 < nums.length; i += 2) pts.push({ x: nums[i], y: nums[i + 1] });
  return pts;
}

/**
 * Best clear spot for an edge label: the midpoint of the path's longest
 * straight segment. On an elbow route that is the long gutter run, which
 * sits away from the node boxes — unlike the geometric midpoint, which on a
 * diagonal lands on a card.
 */
export function labelAnchor(d: string): Point {
  const pts = pathPoints(d);
  if (pts.length < 2) return pts[0] || { x: 0, y: 0 };
  let best = 0, bestLen = -1;
  for (let i = 0; i + 1 < pts.length; i++) {
    const len = Math.abs(pts[i + 1].x - pts[i].x) + Math.abs(pts[i + 1].y - pts[i].y);
    if (len > bestLen) { bestLen = len; best = i; }
  }
  const a = pts[best], b = pts[best + 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** Rectangle a node occupies on canvas, including its frontmatter card. */
interface Obstacle { x: number; y: number; w: number; h: number; }

export function initWires(ctx: AppContext): { drawWires: () => void; updateWiresFor: (movedIds: Set<string>) => void } {
  const { wires, world } = ctx.dom;

  function drawWires(): void {
    const { state } = ctx;
    // one obstacle signature for this whole paint; routeFor() drops any cached
    // route whose signature differs, so a node that moved into a wire's path
    // forces that wire to an elbow until the reroute lands.
    const sig = obstacleSignature(ctx);
    const container = ctx.view.container;
    // Edge labels + boundary stubs are appended to #world (not #wires), so the
    // wires.innerHTML reset below does NOT remove them. render() clears them up
    // front, but the drag path calls drawWires directly via redrawWires and skips
    // that cleanup. Clear them here so drawWires owns its own DOM and repeated
    // redraws during a drag replace labels instead of stacking a smear trail.
    world.querySelectorAll('.edgelabel, .boundary-stub').forEach((e) => e.remove());
    const placedLabels: Point[] = [];
    const stubCounts = new Map<string, number>();

    // ids visible at this level: children plus the drilled container itself
    const memberIds = container && state.nodes[container]
      ? [...childIdsOf(state, container), container]
      : childIdsOf(state, container);
    // node footprints (box + frontmatter card) used to keep labels off nodes.
    // Sizes come from the model (state.measured, populated by render's measure
    // pass) — never read live from the DOM, so labels can't desync from layout.
    const obstacles: Obstacle[] = [];
    for (const id of memberIds) {
      const n = state.nodes[id];
      if (n.shape === 'group') continue;   // group fill is a backdrop, not an obstacle
      const f = nodeFootprint(state, n, ctx.prefs.showFrontmatter);
      obstacles.push({ x: f.x, y: f.y, w: f.w, h: f.h });
    }
    const overNode = (x: number, y: number): boolean =>
      obstacles.some((o) => x > o.x - 28 && x < o.x + o.w + 28 && y > o.y - 10 && y < o.y + o.h + 10);
    wires.innerHTML = `<defs>
      <marker id="arrow" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L7,3 L0,6 Z" fill="var(--edge)"/>
      </marker>
      <marker id="arrowSel" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L7,3 L0,6 Z" fill="var(--edge-sel)"/>
      </marker>
      <marker id="arrowInc" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="strokeWidth">
        <path d="M0,0 L7,3 L0,6 Z" fill="var(--accent-2)"/>
      </marker>
    </defs>`;

    const traced = ctx.runtime.tracedType;
    // when node(s) are selected (and no single edge is), every edge in or out
    // of a selected node lights up and the rest dim — so a node's connections
    // read at a glance. Suppressed while tracing a type (that owns the colours).
    const incidentMode = traced == null && state.sel.size > 0 && state.selEdge == null;
    const isIncident = (e: DiagramEdge): boolean =>
      incidentMode && (state.sel.has(e.from) || state.sel.has(e.to));
    const bothMatch = (e: DiagramEdge): boolean =>
      traced != null
      && nodeUsesType(state.nodes[e.from]?.fm, traced)
      && nodeUsesType(state.nodes[e.to]?.fm, traced);

    // off-level connector stub: a crossing edge has one endpoint at this level
    // (`inner`) and one elsewhere (`outer`). Draw a short labelled marker by
    // the inner node instead of a wire that would run off into hidden nodes.
    const STUBW = 96, STUBH = 22, GAP = 40, STEP = 28;
    const boundaryStub = (e: DiagramEdge, inner: DiagramNode, outer: DiagramNode, innerIsFrom: boolean): void => {
      const cy = inner.y + inner.h / 2;
      const idx = stubCounts.get(inner.id) || 0;
      stubCounts.set(inner.id, idx + 1);
      const sy = cy - STUBH / 2 + (idx % 2 ? 1 : -1) * Math.ceil(idx / 2) * STEP;
      let sx: number, lineFrom: Point, lineTo: Point;
      if (innerIsFrom) {
        sx = inner.x + inner.w + GAP;
        lineFrom = { x: inner.x + inner.w, y: cy };
        lineTo = { x: sx, y: sy + STUBH / 2 };
      } else {
        sx = inner.x - GAP - STUBW;
        lineFrom = { x: sx + STUBW, y: sy + STUBH / 2 };
        lineTo = { x: inner.x, y: cy };
      }
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M ${lineFrom.x} ${lineFrom.y} L ${lineTo.x} ${lineTo.y}`);
      path.dataset.eid = e.id;              // tag so a drag can hide this stub's arrow
      path.setAttribute('class', 'stubline');
      path.setAttribute('stroke', 'var(--edge)');
      path.setAttribute('stroke-width', '1.5');
      path.setAttribute('stroke-dasharray', e.style === 'dotted' ? '5 5' : '2 4');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#arrow)');
      path.setAttribute('opacity', '0.7');
      wires.appendChild(path);
      const stub = document.createElement('div');
      stub.className = 'boundary-stub';
      stub.dataset.eid = e.id;
      stub.style.left = sx + 'px';
      stub.style.top = sy + 'px';
      stub.style.width = STUBW + 'px';
      stub.style.height = STUBH + 'px';
      stub.innerHTML = `<span class="bs-dir">${innerIsFrom ? '\u2197' : '\u2198'}</span><span class="bs-label"></span>`;
      (stub.querySelector('.bs-label') as HTMLElement).textContent = outer.label + (e.label ? ` \u00b7 ${e.label}` : '');
      world.appendChild(stub);
    };

    function drawEdge(e: DiagramEdge, a: DiagramNode, b: DiagramNode): void {
      const [sa, sb] = bestSides(a, b);
      const p = portPos(a, sa), q = portPos(b, sb);
      const sel = state.selEdge === e.id;
      const onTrace = bothMatch(e);
      const incident = isIncident(e);
      const dimmed = (traced != null && !onTrace) || (incidentMode && !incident);

      // path priority: manual bend > cached avoid-route > naive elbow/straight
      let d: string;
      if (e.bend) {
        d = `M ${p.x} ${p.y} L ${e.bend.x} ${e.bend.y} L ${q.x} ${q.y}`;
      } else {
        const routed = routeFor(e.id, sig);
        // With an avoided route from libavoid, use it. Otherwise draw an
        // orthogonal elbow for EVERY edge, spine included. Straight diagonal
        // spine lines crisscross badly once a graph is large enough that
        // libavoid is skipped; axis-aligned elbows read as flowchart lines.
        // Small graphs are unaffected — they get the avoided route above.
        d = routed ? polyPath(routed) : orthoPath(p, sa, q, sb);
      }

      // invisible fat hit-path for easy clicking
      const hit = document.createElementNS(SVG_NS, 'path');
      hit.setAttribute('d', d);
      hit.setAttribute('stroke', 'transparent');
      hit.setAttribute('stroke-width', '14');
      hit.setAttribute('fill', 'none');
      hit.setAttribute('class', 'hit');
      hit.dataset.eid = e.id;
      wires.appendChild(hit);

      // selected edge: a soft wide halo underneath so the bright core reads
      // clearly against nodes and the grid — the single-select equivalent of
      // the multi-select highlight's impact
      if (sel) {
        const halo = document.createElementNS(SVG_NS, 'path');
        halo.setAttribute('d', d);
        halo.setAttribute('stroke', 'var(--edge-sel)');
        halo.setAttribute('stroke-width', '11');
        halo.setAttribute('stroke-linejoin', 'round');
        halo.setAttribute('stroke-linecap', 'round');
        halo.setAttribute('fill', 'none');
        halo.setAttribute('opacity', '0.22');
        wires.appendChild(halo);
      }

      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', d);
      path.dataset.eid = e.id;   // lets the live-drag updater re-path in place
      path.setAttribute('stroke', sel ? 'var(--edge-sel)' : incident ? 'var(--accent-2)' : onTrace ? 'var(--accent)' : 'var(--edge)');
      path.setAttribute('stroke-width', String(sel ? 3.4 : e.style === 'thick' ? 3 : (incident || onTrace) ? 2.6 : 1.7));
      path.setAttribute('stroke-dasharray', e.style === 'dotted' && !sel ? '5 5' : '0');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', sel ? 'url(#arrowSel)' : incident ? 'url(#arrowInc)' : 'url(#arrow)');
      path.setAttribute('stroke-linejoin', 'round');
      if (dimmed) path.setAttribute('opacity', '0.18');
      wires.appendChild(path);

      // draggable bend handle on the selected edge; drag sets/updates e.bend
      if (sel) {
        const hb = e.bend ?? midOf(d);
        const handle = document.createElementNS(SVG_NS, 'circle');
        handle.setAttribute('cx', String(hb.x));
        handle.setAttribute('cy', String(hb.y));
        handle.setAttribute('r', '5');
        handle.setAttribute('class', 'bendhandle');
        handle.dataset.eid = e.id;
        wires.appendChild(handle);
      }

      if (e.label) {
        let lx: number, ly: number;
        if (e.labelPos) {
          lx = e.labelPos.x; ly = e.labelPos.y;
        } else {
          const anchor = labelAnchor(d);
          lx = anchor.x; ly = anchor.y;
          // float the label off any node footprint or nearby label
          let step = 0;
          const nearLabel = (yy: number): boolean =>
            placedLabels.some((pl) => Math.abs(pl.x - lx) < 72 && Math.abs(pl.y - yy) < 20);
          while ((overNode(lx, ly) || nearLabel(ly)) && step < 18) {
            step++; ly = anchor.y + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 20;
          }
          placedLabels.push({ x: lx, y: ly });
        }
        const lab = document.createElement('div');
        lab.className = 'edgelabel' + (sel ? ' selected' : incident ? ' incident' : '') + (dimmed ? ' dimmed' : '');
        lab.dataset.eid = e.id;
        lab.textContent = e.label;
        lab.style.left = lx + 'px';
        lab.style.top = ly + 'px';
        world.appendChild(lab);
      }
    }

    // a node is "at this level" if it's a child here OR it's the container
    // itself (now drawn as a real node, the level anchor)
    const inLevel = (id: string): boolean =>
      id === container || containerOf(state, id) === container;
    for (const e of state.edges) {
      const a0 = state.nodes[e.from], b0 = state.nodes[e.to];
      if (!a0 || !b0) continue;
      const aIn = inLevel(e.from), bIn = inLevel(e.to);
      if (!aIn && !bIn) continue;
      if (aIn !== bIn) { boundaryStub(e, aIn ? a0 : b0, aIn ? b0 : a0, aIn); continue; }
      drawEdge(e, a0, b0);
    }

    // Obstacles changed since the last route? Re-route now. This lives in
    // drawWires (not only render) because the drag-drop path calls redrawWires
    // -> drawWires directly and never render(); without this, a node dropped
    // into a wire's path would leave that wire as a straight elbow through it.
    // ensureRoutes dedupes on the obstacle signature and rAF-coalesces, so the
    // routing reply's own redraw doesn't loop and rapid edits don't spam.
    ensureRoutes(ctx);
  }

  // Geometry for one edge (manual bend > cached avoid-route > elbow).
  // Shared by the live-drag scoped updater below.
  function edgePath(e: DiagramEdge, a: DiagramNode, b: DiagramNode, sig: string): string {
    const [sa, sb] = bestSides(a, b);
    const p = portPos(a, sa), q = portPos(b, sb);
    if (e.bend) return `M ${p.x} ${p.y} L ${e.bend.x} ${e.bend.y} L ${q.x} ${q.y}`;
    const routed = routeFor(e.id, sig);
    return routed ? polyPath(routed) : orthoPath(p, sa, q, sb);
  }

  // Live-drag update: re-path ONLY edges incident to the moved nodes, in
  // place, leaving every other path and all labels untouched. A full
  // drawWires per frame tears down and rebuilds every path + label, which
  // shimmers; this touches just what moved. Full de-collision runs on drop.
  function updateWiresFor(movedIds: Set<string>): void {
    const { state } = ctx;
    // recomputed each drag frame: the moved node changes the signature, so its
    // incident edges' cached routes are rejected and fall to elbows mid-drag
    // (full reroute on drop restores avoided routes for every edge).
    const sig = obstacleSignature(ctx);
    const container = ctx.view.container;
    const inLevel = (id: string): boolean =>
      id === container || containerOf(state, id) === container;
    for (const e of state.edges) {
      if (!movedIds.has(e.from) && !movedIds.has(e.to)) continue;
      const a = state.nodes[e.from], b = state.nodes[e.to];
      if (!a || !b) continue;
      if (!inLevel(e.from) || !inLevel(e.to)) continue; // off-level stubs fixed on drop
      const d = edgePath(e, a, b, sig);
      // labels + stubs are hidden during the drag (see pointer.ts), so only the
      // wire paths need to follow the moved node here.
      wires.querySelectorAll<SVGPathElement>(`path[data-eid="${e.id}"]`)
        .forEach((p) => p.setAttribute('d', d));
    }
  }

  return { drawWires, updateWiresFor };
}
