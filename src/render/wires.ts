/* =====================================================================
   wires.ts — edge rendering + path geometry
   ---------------------------------------------------------------------
   Responsibility: draw all edges into the #wires SVG (visible path + fat
   invisible hit-path + optional midpoint label), and provide the path
   geometry helpers orthoPath() and midOf() that are reused by export.

   Reads: ctx.state. Writes: only #wires and edge-label DOM under #world.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { Point, DiagramEdge, DiagramNode } from '../core/types/types';
import { portPos, bestSides, containerOf, childIdsOf, nodeFootprint, type StateStore } from '../core/state/state';
import { nodeUsesType } from '../core/frontmatter/frontmatter';
import { routeFor, obstacleSignature, ensureRoutes } from './avoidRouter';
import { orthoPath, polyPath, midOf, labelAnchor } from './wires-geom';

// path/geometry helpers moved to wires-geom.ts; re-exported so importers
// (export.ts, unfold-wires.ts) keep resolving them from './wires'.
export { orthoPath, polyPath, midOf, labelAnchor } from './wires-geom';

const SVG_NS = 'http://www.w3.org/2000/svg';
const ATTR_STROKE_WIDTH = 'stroke-width';

/** Rectangle a node occupies on canvas, including its frontmatter card. */
interface Obstacle { x: number; y: number; width: number; height: number; }

// Stroke colour for an edge: selection > incidence > trace > default.
function edgeStrokeColor(sel: boolean, incident: boolean, onTrace: boolean): string {
  if (sel) return 'var(--edge-sel)';
  if (incident) return 'var(--accent-2)';
  if (onTrace) return 'var(--accent)';
  return 'var(--edge)';
}

// Stroke width for an edge: selection > thick style > incidence/trace > default.
function edgeStrokeWidth(sel: boolean, incident: boolean, onTrace: boolean, thick: boolean): string {
  if (sel) return '3.4';
  if (thick) return '3';
  if (incident || onTrace) return '2.6';
  return '1.7';
}

// Arrowhead marker for an edge: selection > incidence > default.
function edgeMarkerUrl(sel: boolean, incident: boolean): string {
  if (sel) return 'url(#arrowSel)';
  if (incident) return 'url(#arrowInc)';
  return 'url(#arrow)';
}

// Selected edge: a soft wide halo underneath so the bright core reads clearly
// against nodes and the grid — the single-select equivalent of the
// multi-select highlight's impact.
function drawEdgeHalo(wires: SVGSVGElement, pathD: string): void {
  const halo = document.createElementNS(SVG_NS, 'path');
  halo.setAttribute('d', pathD);
  halo.setAttribute('stroke', 'var(--edge-sel)');
  halo.setAttribute(ATTR_STROKE_WIDTH, '11');
  halo.setAttribute('stroke-linejoin', 'round');
  halo.setAttribute('stroke-linecap', 'round');
  halo.setAttribute('fill', 'none');
  halo.setAttribute('opacity', '0.22');
  wires.appendChild(halo);
}

// One edge's draw-time state, shared by drawEdgeMainPath's helpers below.
interface EdgeDrawState { edge: DiagramEdge; pathD: string; sel: boolean; dimmed: boolean; }
// Precomputed stroke colour/width/marker for one edge's main path.
interface EdgeVisual { strokeColor: string; strokeWidth: string; markerUrl: string; }

// The edge's visible stroked path (colour/width/marker/dash/opacity by state).
function drawEdgeMainPath(wires: SVGSVGElement, draw: EdgeDrawState, visual: EdgeVisual): void {
  const { edge, pathD, sel, dimmed } = draw;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', pathD);
  path.dataset.eid = edge.id;   // lets the live-drag updater re-path in place
  path.setAttribute('stroke', visual.strokeColor);
  path.setAttribute(ATTR_STROKE_WIDTH, visual.strokeWidth);
  path.setAttribute('stroke-dasharray', edge.style === 'dotted' && !sel ? '5 5' : '0');
  path.setAttribute('fill', 'none');
  path.setAttribute('marker-end', visual.markerUrl);
  path.setAttribute('stroke-linejoin', 'round');
  if (dimmed) path.setAttribute('opacity', '0.18');
  wires.appendChild(path);
}

// Draggable bend handle on the selected edge; drag sets/updates edge.bend.
function drawEdgeBendHandle(wires: SVGSVGElement, edge: DiagramEdge, pathD: string): void {
  const bendPt = edge.bend ?? midOf(pathD);
  const handle = document.createElementNS(SVG_NS, 'circle');
  handle.setAttribute('cx', String(bendPt.x));
  handle.setAttribute('cy', String(bendPt.y));
  handle.setAttribute('r', '5');
  handle.setAttribute('class', 'bendhandle');
  handle.dataset.eid = edge.id;
  wires.appendChild(handle);
}

// Float an edge label off any node footprint or nearby label, walking
// outward from the path's anchor point.
function placeEdgeLabel(
  pathD: string,
  overNode: (x: number, y: number) => boolean,
  placedLabels: Point[],
): Point {
  const anchor = labelAnchor(pathD);
  const alx = anchor.x;
  let aly = anchor.y;
  let step = 0;
  const nearLabel = (checkY: number): boolean =>
    placedLabels.some((placed) => Math.abs(placed.x - alx) < 72 && Math.abs(placed.y - checkY) < 20);
  while ((overNode(alx, aly) || nearLabel(aly)) && step < 18) {
    step++;
    aly = anchor.y + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 20;
  }
  return { x: alx, y: aly };
}

// Explicit labelPos wins; otherwise place it and remember it so the next
// edge's label steers clear of this one.
function edgeLabelPosition(
  edge: DiagramEdge,
  pathD: string,
  overNode: (x: number, y: number) => boolean,
  placedLabels: Point[],
): Point {
  if (edge.labelPos) return { x: edge.labelPos.x, y: edge.labelPos.y };
  const pos = placeEdgeLabel(pathD, overNode, placedLabels);
  placedLabels.push(pos);
  return pos;
}

// CSS class for an edge label: base + selected/incident + dimmed.
function edgeLabelClassName(sel: boolean, incident: boolean, dimmed: boolean): string {
  return 'edgelabel' + (sel ? ' selected' : incident ? ' incident' : '') + (dimmed ? ' dimmed' : '');
}

// Geometry for one edge (manual bend > cached avoid-route > elbow).
// Shared by drawWiresImpl's drawEdge and by the live-drag scoped updater below.
function edgePath(e: DiagramEdge, nodeA: DiagramNode, nodeB: DiagramNode, sig: string): string {
  const [sideA, sideB] = bestSides(nodeA, nodeB);
  const portA = portPos(nodeA, sideA), portB = portPos(nodeB, sideB);
  if (e.bend) return `M ${portA.x} ${portA.y} L ${e.bend.x} ${e.bend.y} L ${portB.x} ${portB.y}`;
  const routed = routeFor(e.id, sig);
  return routed ? polyPath(routed) : orthoPath(portA, sideA, portB, sideB);
}

// Off-level connector stub geometry: box size, gap from the node, vertical
// step between stacked stubs when several stubs land on the same node.
const STUB_W = 96, STUB_H = 22, STUB_GAP = 40, STUB_STEP = 28;

// Arrowhead marker defs shared by every wire in a repaint.
const WIRES_DEFS_MARKUP = `<defs>
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

// Shared read-only context for one repaint's nested edge-drawing helpers
// below (drawEdge, boundaryStub), so their own signatures stay untouched.
interface EdgePaintCtx {
  wires: SVGSVGElement;
  world: HTMLElement;
  state: StateStore;
  sig: string;
  tracedActive: boolean;
  incidentMode: boolean;
  isIncident: (e: DiagramEdge) => boolean;
  bothMatch: (e: DiagramEdge) => boolean;
  overNode: (x: number, y: number) => boolean;
  placedLabels: Point[];
  stubCounts: Map<string, number>;
  container: string | null;
}

// One repaint's edge-drawing state, set by paintVisibleEdges below just
// before it walks state.edges. drawEdge/boundaryStub read it rather than
// taking it as an extra parameter, so their own signatures — tracked by the
// novakai map — stay byte-identical to before this file's functions were
// pulled out of drawWiresImpl (e/a/b and e/inner/outer/innerIsFrom).
let paintCtx: EdgePaintCtx;

// Pure geometry for one off-level connector stub: its box origin and the
// line endpoints connecting it to the inner node. Split out of
// boundaryStub so that function fits the file's line/statement budget.
interface StubGeom { stubX: number; stubY: number; lineFrom: Point; lineTo: Point; }

function stubGeometry(inner: DiagramNode, innerIsFrom: boolean, idx: number): StubGeom {
  const centerY = inner.y + inner.h / 2;
  const stubY = centerY - STUB_H / 2 + (idx % 2 ? 1 : -1) * Math.ceil(idx / 2) * STUB_STEP;
  const stubX = innerIsFrom ? inner.x + inner.w + STUB_GAP : inner.x - STUB_GAP - STUB_W;
  const lineFrom = innerIsFrom
    ? { x: inner.x + inner.w, y: centerY }
    : { x: stubX + STUB_W, y: stubY + STUB_H / 2 };
  const lineTo = innerIsFrom
    ? { x: stubX, y: stubY + STUB_H / 2 }
    : { x: inner.x, y: centerY };
  return { stubX, stubY, lineFrom, lineTo };
}

// The stub's connecting line into #wires.
function drawStubLine(e: DiagramEdge, geom: StubGeom): void {
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', `M ${geom.lineFrom.x} ${geom.lineFrom.y} L ${geom.lineTo.x} ${geom.lineTo.y}`);
  path.dataset.eid = e.id;              // tag so a drag can hide this stub's arrow
  path.setAttribute('class', 'stubline');
  path.setAttribute('stroke', 'var(--edge)');
  path.setAttribute(ATTR_STROKE_WIDTH, '1.5');
  path.setAttribute('stroke-dasharray', e.style === 'dotted' ? '5 5' : '2 4');
  path.setAttribute('fill', 'none');
  path.setAttribute('marker-end', 'url(#arrow)');
  path.setAttribute('opacity', '0.7');
  paintCtx.wires.appendChild(path);
}

// The stub's labelled box under #world.
function drawStubBox(e: DiagramEdge, outer: DiagramNode, geom: StubGeom, innerIsFrom: boolean): void {
  const stub = document.createElement('div');
  stub.className = 'boundary-stub';
  stub.dataset.eid = e.id;
  stub.style.left = geom.stubX + 'px';
  stub.style.top = geom.stubY + 'px';
  stub.style.width = STUB_W + 'px';
  stub.style.height = STUB_H + 'px';
  stub.innerHTML = `<span class="bs-dir">${innerIsFrom ? '↗' : '↘'}</span><span class="bs-label"></span>`;
  (stub.querySelector('.bs-label') as HTMLElement).textContent = outer.label + (e.label ? ` · ${e.label}` : '');
  paintCtx.world.appendChild(stub);
}

// off-level connector stub: a crossing edge has one endpoint at this level
// (`inner`) and one elsewhere (`outer`). Draw a short labelled marker by
// the inner node instead of a wire that would run off into hidden nodes.
function boundaryStub(e: DiagramEdge, inner: DiagramNode, outer: DiagramNode, innerIsFrom: boolean): void {
  const idx = paintCtx.stubCounts.get(inner.id) || 0;
  paintCtx.stubCounts.set(inner.id, idx + 1);
  const geom = stubGeometry(inner, innerIsFrom, idx);
  drawStubLine(e, geom);
  drawStubBox(e, outer, geom, innerIsFrom);
}

// The edge's invisible fat hit-path, for easy clicking.
function drawHitPath(e: DiagramEdge, pathD: string): void {
  const hit = document.createElementNS(SVG_NS, 'path');
  hit.setAttribute('d', pathD);
  hit.setAttribute('stroke', 'transparent');
  hit.setAttribute(ATTR_STROKE_WIDTH, '14');
  hit.setAttribute('fill', 'none');
  hit.setAttribute('class', 'hit');
  hit.dataset.eid = e.id;
  paintCtx.wires.appendChild(hit);
}

// The edge's midpoint label, if it has one.
interface EdgeLabelFlags { sel: boolean; incident: boolean; dimmed: boolean; }

function drawEdgeLabelIfAny(e: DiagramEdge, pathD: string, flags: EdgeLabelFlags): void {
  if (!e.label) return;
  const { x: labelX, y: labelY } = edgeLabelPosition(e, pathD, paintCtx.overNode, paintCtx.placedLabels);
  const lab = document.createElement('div');
  lab.className = edgeLabelClassName(flags.sel, flags.incident, flags.dimmed);
  lab.dataset.eid = e.id;
  lab.textContent = e.label;
  lab.style.left = labelX + 'px';
  lab.style.top = labelY + 'px';
  paintCtx.world.appendChild(lab);
}

function drawEdge(e: DiagramEdge, nodeA: DiagramNode, nodeB: DiagramNode): void {
  const sel = paintCtx.state.selEdge === e.id;
  const onTrace = paintCtx.bothMatch(e);
  const incident = paintCtx.isIncident(e);
  const dimmed = (paintCtx.tracedActive && !onTrace) || (paintCtx.incidentMode && !incident);
  // path priority: manual bend > cached avoid-route > naive elbow/straight
  // (see edgePath() above, shared with the live-drag updater).
  const pathD = edgePath(e, nodeA, nodeB, paintCtx.sig);

  drawHitPath(e, pathD);
  if (sel) drawEdgeHalo(paintCtx.wires, pathD);

  drawEdgeMainPath(paintCtx.wires, { edge: e, pathD, sel, dimmed }, {
    strokeColor: edgeStrokeColor(sel, incident, onTrace),
    strokeWidth: edgeStrokeWidth(sel, incident, onTrace, e.style === 'thick'),
    markerUrl: edgeMarkerUrl(sel, incident),
  });

  if (sel) drawEdgeBendHandle(paintCtx.wires, e, pathD);
  drawEdgeLabelIfAny(e, pathD, { sel, incident, dimmed });
}

// Dispatch every edge visible at this level: drawn in full when both ends
// are in-level, as a boundary stub when only one end is, skipped otherwise.
function paintVisibleEdges(next: EdgePaintCtx): void {
  paintCtx = next;
  // a node is "at this level" if it's a child here OR it's the container
  // itself (now drawn as a real node, the level anchor)
  const inLevel = (id: string): boolean =>
    id === paintCtx.container || containerOf(paintCtx.state, id) === paintCtx.container;
  for (const edge of paintCtx.state.edges) {
    const fromNode = paintCtx.state.nodes[edge.from], toNode = paintCtx.state.nodes[edge.to];
    if (!fromNode || !toNode) continue;
    const fromIn = inLevel(edge.from), toIn = inLevel(edge.to);
    if (!fromIn && !toIn) continue;
    if (fromIn !== toIn) {
      boundaryStub(edge, fromIn ? fromNode : toNode, fromIn ? toNode : fromNode, fromIn);
      continue;
    }
    drawEdge(edge, fromNode, toNode);
  }
}

// ids visible at this level: children plus the drilled container itself.
function memberIdsFor(state: StateStore, container: string | null): string[] {
  return container && state.nodes[container]
    ? [...childIdsOf(state, container), container]
    : childIdsOf(state, container);
}

// Node footprints (box + frontmatter card) used to keep labels off nodes.
// Sizes come from the model (state.measured, populated by render's measure
// pass) — never read live from the DOM, so labels can't desync from layout.
function buildObstacles(state: StateStore, memberIds: string[], showFrontmatter: boolean): Obstacle[] {
  const list: Obstacle[] = [];
  for (const id of memberIds) {
    const node = state.nodes[id];
    if (node.shape === 'group') continue;   // group fill is a backdrop, not an obstacle
    const foot = nodeFootprint(state, node, showFrontmatter);
    list.push({ x: foot.x, y: foot.y, width: foot.w, height: foot.h });
  }
  return list;
}

function makeOverNode(obstacles: Obstacle[]): (x: number, y: number) => boolean {
  return (x, y) => obstacles.some((obs) =>
    x > obs.x - 28 && x < obs.x + obs.width + 28 && y > obs.y - 10 && y < obs.y + obs.height + 10);
}

// Trace/incidence mode for one repaint: which edges dim, which highlight.
interface EdgeMode {
  traced: string | null;
  incidentMode: boolean;
  isIncident: (e: DiagramEdge) => boolean;
  bothMatch: (e: DiagramEdge) => boolean;
}

function edgeModeFor(ctx: AppContext): EdgeMode {
  const { state } = ctx;
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
  return { traced, incidentMode, isIncident, bothMatch };
}

// Full repaint of #wires: every edge visible at the current view level, as a
// path (+ hit-path + optional label) or a boundary stub. Split out of
// initWires so initWires itself stays a thin composition wrapper.
function drawWiresImpl(ctx: AppContext, wires: SVGSVGElement, world: HTMLElement): void {
    const { state } = ctx;
    // one obstacle signature for this whole paint; routeFor() drops any cached
    // route whose signature differs, so a node that moved into a wire's path
    // forces that wire to an elbow until the reroute lands.
    const sig = obstacleSignature(ctx), container = ctx.view.container;
    // Edge labels + boundary stubs are appended to #world (not #wires), so the
    // wires.innerHTML reset below does NOT remove them. render() clears them up
    // front, but the drag path calls drawWires directly via redrawWires and skips
    // that cleanup. Clear them here so drawWires owns its own DOM and repeated
    // redraws during a drag replace labels instead of stacking a smear trail.
    world.querySelectorAll('.edgelabel, .boundary-stub').forEach((e) => e.remove());
    const placedLabels: Point[] = [], stubCounts = new Map<string, number>();

    const memberIds = memberIdsFor(state, container);
    const obstacles = buildObstacles(state, memberIds, ctx.prefs.showFrontmatter);
    const overNode = makeOverNode(obstacles);
    wires.innerHTML = WIRES_DEFS_MARKUP;

    const mode = edgeModeFor(ctx);
    // dispatch every edge visible at this level: drawn in full when both ends
    // are in-level, as a boundary stub when only one end is, skipped otherwise
    // (drawEdge/boundaryStub/paintVisibleEdges above — pulled out of this
    // function so it fits the file's line-per-function budget).
    paintVisibleEdges({
      wires, world, state, sig, overNode, placedLabels, stubCounts, container,
      tracedActive: mode.traced != null, incidentMode: mode.incidentMode,
      isIncident: mode.isIncident, bothMatch: mode.bothMatch,
    });

    // Obstacles changed since the last route? Re-route now. This lives in
    // drawWires (not only render) because the drag-drop path calls redrawWires
    // -> drawWires directly and never render(); without this, a node dropped
    // into a wire's path would leave that wire as a straight elbow through it.
    // ensureRoutes dedupes on the obstacle signature and rAF-coalesces, so the
    // routing reply's own redraw doesn't loop and rapid edits don't spam.
    ensureRoutes(ctx);
}

// Live-drag update: re-path ONLY edges incident to the moved nodes, in
// place, leaving every other path and all labels untouched. A full
// drawWires per frame tears down and rebuilds every path + label, which
// shimmers; this touches just what moved. Full de-collision runs on drop.
// Split out of initWires so initWires's own body (which just wires the two
// closures to ctx) stays inside the file's line-per-function budget.
function updateWiresForImpl(ctx: AppContext, wires: SVGSVGElement, movedIds: Set<string>): void {
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
    const nodeA = state.nodes[e.from], nodeB = state.nodes[e.to];
    if (!nodeA || !nodeB) continue;
    if (!inLevel(e.from) || !inLevel(e.to)) continue; // off-level stubs fixed on drop
    const pathD = edgePath(e, nodeA, nodeB, sig);
    // labels + stubs are hidden during the drag (see pointer.ts), so only the
    // wire paths need to follow the moved node here.
    wires.querySelectorAll<SVGPathElement>(`path[data-eid="${e.id}"]`)
      .forEach((pathEl) => pathEl.setAttribute('d', pathD));
  }
}

export function initWires(ctx: AppContext): { drawWires: () => void; updateWiresFor: (movedIds: Set<string>) => void } {
  const { wires, world } = ctx.dom;

  function drawWires(): void {
    drawWiresImpl(ctx, wires, world);
  }

  function updateWiresFor(movedIds: Set<string>): void {
    updateWiresForImpl(ctx, wires, movedIds);
  }

  return { drawWires, updateWiresFor };
}
