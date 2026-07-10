/* =====================================================================
   pointer.ts — direct-manipulation on the canvas
   ---------------------------------------------------------------------
   Responsibility: all pointer-driven editing on the stage — node drag
   (carrying group children + alignment guides), marquee select, pan,
   resize, and port-drag linking. Owns the transient `mode` interaction
   state machine and the live ghost/guide DOM it creates and tears down.

   Depends on camera (toWorld), selection, and nodes (makeEdge), plus the
   link-mode setter shared with the keyboard/toolbar. Writes runtime flags
   (linkSrc) so render can highlight the link source.

   The gesture starters live in pointer-gestures.ts and the pure/DOM
   helpers in pointer-helpers.ts — both are factories this file wires up
   over the shared `mode` machine. The route/handler functions below close
   over a `PointerRuntime` bundle instead of nesting inside initPointer, so
   initPointer itself stays a thin wiring point; the pointer-event
   listeners are attached there.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { SelectionApi } from './selection';
import type { NodesApi } from './nodes';
import type { PortSide, Point } from '../core/types/types';
import { portPos, snapV, containerOf, sliceIds } from '../core/state/state';
import { createPointerHelpers } from './pointer-helpers';
import { createPointerStarters } from './pointer-gestures';

export interface DragItem { id: string; ox: number; oy: number; }
export interface Mode {
  drag: { sx: number; sy: number; items: DragItem[]; groupExtras: DragItem[]; moved: boolean } | null;
  marquee: { x0: number; y0: number; el: HTMLElement; add: boolean; base: Set<string> } | null;
  pan: { sx: number; sy: number; cx: number; cy: number } | null;
  resize: { id: string; corner: string; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number } | null;
  link: { from: string; side: PortSide; ghost: SVGPathElement } | null;
  labelDrag: { eid: string; ox: number; oy: number; moved: boolean } | null;
  bendDrag: { eid: string; moved: boolean } | null;
}

export interface PointerApi {
  setLinkMode: (on: boolean) => void;
  isLinkMode: () => boolean;
  isSpaceDown: () => boolean;
  setSpaceDown: (v: boolean) => void;
}

// mutable session flags shared by the route/handler functions below:
// link-mode toggle, space-pan toggle, and the type-chip double-click de-dupe
interface PointerSession {
  linkMode: boolean;
  spaceDown: boolean;
  lastTrace: { type: string; atMs: number };
}

// the bundle every route/handler function below closes over, built once by
// initPointer and passed through instead of nesting these inside it
interface PointerRuntime {
  ctx: AppContext;
  camera: CameraApi;
  selection: SelectionApi;
  nodes: NodesApi;
  mode: Mode;
  session: PointerSession;
  setLinkMode: (enabled: boolean) => void;
  starters: ReturnType<typeof createPointerStarters>;
  helpers: ReturnType<typeof createPointerHelpers>;
}

interface PointerHitTargets {
  target: HTMLElement;
  port: HTMLElement | null;
  rsz: HTMLElement | null;
  node: HTMLElement | null;
  elab: HTMLElement | null;
  hit: SVGElement | null;
  bendHandle: SVGElement | null;
}

function resolvePointerHitTargets(event: PointerEvent): PointerHitTargets {
  const target = event.target as HTMLElement;
  return {
    target,
    port: target.closest('.port') as HTMLElement | null,
    rsz: target.closest('.rsz') as HTMLElement | null,
    node: target.closest('.node') as HTMLElement | null,
    elab: target.closest('.edgelabel') as HTMLElement | null,
    hit: target.closest('path.hit') as SVGElement | null,
    bendHandle: target.closest('.bendhandle') as SVGElement | null,
  };
}

// single-click a type chip -> trace every instance of that type. Handled
// here (not via dblclick) so the card-rebuild on select can't swallow the
// gesture. De-dupes the 2nd click of a double-click (350ms) so a trace
// toggles once.
function traceTypeChip(deps: PointerRuntime, chip: HTMLElement): void {
  const type = chip.dataset.type || '';
  const now = performance.now();
  const isRepeatClick = type === deps.session.lastTrace.type && now - deps.session.lastTrace.atMs < 350;
  if (!isRepeatClick) {
    deps.ctx.runtime.tracedType = deps.ctx.runtime.tracedType === type ? null : (type || null);
    deps.ctx.hooks.render();
  }
  deps.session.lastTrace.type = type;
  deps.session.lastTrace.atMs = now;
}

// link-mode click on a node: complete the pending link, or start one here
function handleLinkModeClick(deps: PointerRuntime, id: string): void {
  if (deps.ctx.runtime.linkSrc && deps.ctx.runtime.linkSrc !== id) {
    deps.nodes.makeEdge(deps.ctx.runtime.linkSrc, id);
    deps.ctx.runtime.linkSrc = null;
    deps.setLinkMode(false);
  } else {
    deps.ctx.runtime.linkSrc = id;
    deps.ctx.hooks.render();
  }
}

// plain click on a node (not chip/card/link/alt): apply modifier-key
// selection semantics (additive toggle vs. select-only)
function selectNodeForClick(deps: PointerRuntime, id: string, event: PointerEvent): void {
  if (deps.helpers.isAdditiveClick(event)) deps.selection.toggleSel(id);
  else if (!deps.ctx.state.sel.has(id)) deps.selection.selectOnly(id);
}

// each route tries one click-target case (type-chip trace, card-only select,
// link-mode wiring, alt-click focus-spine) and reports whether it handled it
type NodeClickRoute = (deps: PointerRuntime, target: HTMLElement, event: PointerEvent, id: string) => boolean;

const nodeClickRoutes: NodeClickRoute[] = [
  (deps, target) => {
    const chip = target.closest('.fmtype') as HTMLElement | null;
    if (!chip) return false;
    traceTypeChip(deps, chip);
    return true;
  },
  // clicking the rest of the card selects the node but never drags it
  (deps, target, _event, id) => {
    if (!target.closest('.fmcard')) return false;
    deps.selection.selectOnly(id);
    return true;
  },
  (deps, _target, _event, id) => {
    if (!deps.session.linkMode) return false;
    handleLinkModeClick(deps, id);
    return true;
  },
  // alt-click: toggle focus mode on the clicked node's call spine
  (deps, _target, event, id) => {
    if (!event.altKey) return false;
    event.preventDefault();
    deps.ctx.runtime.focusSpine = deps.ctx.runtime.focusSpine ? null : sliceIds(deps.ctx.state, id);
    deps.ctx.hooks.render();
    return true;
  },
];

// full click-target routing for a node hit, then falls through to
// selection + drag-start once none of the special-case routes matched
function handleNodePointerDown(
  deps: PointerRuntime,
  node: HTMLElement,
  target: HTMLElement,
  event: PointerEvent,
): void {
  const id = node.dataset.id as string;
  if (node.classList.contains('editing')) return;
  if (nodeClickRoutes.some((route) => route(deps, target, event, id))) return;

  selectNodeForClick(deps, id, event);
  if (deps.helpers.isAdditiveClick(event) && !deps.ctx.state.sel.has(id)) return;
  deps.starters.startDrag(event);
}

function clearTraceState(deps: PointerRuntime): void {
  if (deps.ctx.runtime.tracedType || deps.ctx.runtime.focusSpine) {
    deps.ctx.runtime.tracedType = null;
    deps.ctx.runtime.focusSpine = null;
    deps.ctx.hooks.render();
  }
}

/* ---------------- pointer down ---------------- */
// each route claims one stage hit-target (bend handle, label, edge hit,
// resize handle, port, node) and starts its gesture
type PointerDownRoute = (deps: PointerRuntime, hits: PointerHitTargets, event: PointerEvent) => boolean;

const pointerDownRoutes: PointerDownRoute[] = [
  (deps, hits, event) => {
    if (!hits.bendHandle) return false;
    deps.starters.startBendDrag((hits.bendHandle as unknown as HTMLElement).dataset.eid as string, event);
    return true;
  },
  (deps, hits, event) => {
    if (!hits.elab) return false;
    deps.starters.startLabelDrag(hits.elab, event);
    return true;
  },
  (deps, hits) => {
    if (!hits.hit) return false;
    deps.selection.selectEdge((hits.hit as unknown as HTMLElement).dataset.eid as string);
    return true;
  },
  (deps, hits, event) => {
    if (!hits.rsz) return false;
    deps.starters.startResize(hits.rsz, event);
    return true;
  },
  (deps, hits, event) => {
    if (!hits.port) return false;
    deps.starters.startLink(hits.port.dataset.port as string, hits.port.dataset.side as PortSide, event);
    return true;
  },
  (deps, hits, event) => {
    if (!hits.node) return false;
    handleNodePointerDown(deps, hits.node, hits.target, event);
    return true;
  },
];

function routePointerDown(deps: PointerRuntime, event: PointerEvent): void {
  if (event.button === 1 || deps.session.spaceDown) {
    deps.starters.startPan(event);
    return;
  }

  const hits = resolvePointerHitTargets(event);
  if (pointerDownRoutes.some((route) => route(deps, hits, event))) return;

  if (!deps.session.linkMode) deps.starters.startMarquee(event);
  else deps.selection.clearSel();
  clearTraceState(deps);
}

/* ---------------- pointer move ---------------- */
function handleLabelDragMove(deps: PointerRuntime, point: Point): boolean {
  if (!deps.mode.labelDrag) return false;
  const label = deps.mode.labelDrag;
  const edge = deps.ctx.state.edges.find((candidate) => candidate.id === label.eid);
  if (edge) {
    edge.labelPos = { x: point.x + label.ox, y: point.y + label.oy };
    label.moved = true;
    deps.ctx.hooks.render();
  }
  return true;
}

function handleBendDragMove(deps: PointerRuntime, point: Point): boolean {
  if (!deps.mode.bendDrag) return false;
  const bend = deps.mode.bendDrag;
  const edge = deps.ctx.state.edges.find((candidate) => candidate.id === bend.eid);
  if (edge) {
    edge.bend = { x: point.x, y: point.y };
    bend.moved = true;
    deps.ctx.hooks.render();
  }
  return true;
}

function handlePanMove(deps: PointerRuntime, event: PointerEvent): boolean {
  if (!deps.mode.pan) return false;
  deps.ctx.cam.x = deps.mode.pan.cx + (event.clientX - deps.mode.pan.sx);
  deps.ctx.cam.y = deps.mode.pan.cy + (event.clientY - deps.mode.pan.sy);
  deps.camera.applyCam();
  return true;
}

// first move of a real drag: (a) hide edge labels + boundary stubs (they sit
// off the moved node, can't follow a scoped update, and would strand); (b)
// pin each mover's base left/top and promote it to its own layer so the
// per-frame move can ride on transform (composite-only) instead of mutating
// left/top (which relayouts + repaints the whole world layer — the shimmer,
// worst with frontmatter cards). Baked back on drop, see finishNodeDrag.
function primeDragMove(deps: PointerRuntime, drag: NonNullable<Mode['drag']>, movers: DragItem[]): void {
  if (!drag.moved) {
    deps.helpers.hideIncidentEdgeDecor(movers);
    deps.helpers.pinMoverBasePosition(movers);
  }
  drag.moved = true;
}

function snapDragDelta(primary: DragItem, dx: number, dy: number, snap: boolean): { dx: number; dy: number } {
  const snappedX = snapV(primary.ox + dx, snap);
  const snappedY = snapV(primary.oy + dy, snap);
  return { dx: snappedX - primary.ox, dy: snappedY - primary.oy };
}

// snaps the delta to the primary mover (if any), then writes every mover's
// new world position
function applyDragDelta(
  deps: PointerRuntime,
  drag: NonNullable<Mode['drag']>,
  movers: DragItem[],
  rawDelta: { dx: number; dy: number },
): { dx: number; dy: number } {
  const primary = drag.items[0];
  const delta = primary ? snapDragDelta(primary, rawDelta.dx, rawDelta.dy, deps.ctx.snap) : rawDelta;
  movers.forEach((item) => {
    const node = deps.ctx.state.nodes[item.id];
    node.x = item.ox + delta.dx;
    node.y = item.oy + delta.dy;
  });
  return delta;
}

function handleNodeDragMove(deps: PointerRuntime, point: Point): boolean {
  if (!deps.mode.drag) return false;
  const drag = deps.mode.drag;
  const movers = [...drag.items, ...drag.groupExtras];
  primeDragMove(deps, drag, movers);
  const delta = applyDragDelta(deps, drag, movers, { dx: point.x - drag.sx, dy: point.y - drag.sy });
  deps.helpers.applyDragTransform(movers, delta.dx, delta.dy);
  deps.helpers.showAlignGuides();
  // re-path only the moved node's incident edges, in place
  deps.ctx.hooks.redrawWiresFor(new Set(movers.map((item) => item.id)));
  return true;
}

// pure geometry: the new node rect for a resize drag from corner + delta
function computeResizeRect(
  resize: { corner: string; ox: number; oy: number; ow: number; oh: number },
  dx: number,
  dy: number,
  snap: boolean,
): { x: number; y: number; width: number; height: number } {
  let x = resize.ox, y = resize.oy, width = resize.ow, height = resize.oh;
  if (resize.corner.includes('e')) width = resize.ow + dx;
  if (resize.corner.includes('s')) height = resize.oh + dy;
  if (resize.corner.includes('w')) width = resize.ow - dx;
  if (resize.corner.includes('n')) height = resize.oh - dy;
  width = Math.max(40, snapV(width, snap));
  height = Math.max(30, snapV(height, snap));
  if (resize.corner.includes('w')) x = resize.ox + (resize.ow - width);
  if (resize.corner.includes('n')) y = resize.oy + (resize.oh - height);
  return { x, y, width, height };
}

function handleResizeMove(deps: PointerRuntime, point: Point): boolean {
  if (!deps.mode.resize) return false;
  const resize = deps.mode.resize;
  const node = deps.ctx.state.nodes[resize.id];
  const rect = computeResizeRect(resize, point.x - resize.sx, point.y - resize.sy, deps.ctx.snap);
  node.x = rect.x;
  node.y = rect.y;
  // bracket writes: frozen DiagramNode field names sit below the id-length floor (io convention)
  node['w'] = rect.width;
  node['h'] = rect.height;
  deps.ctx.hooks.render();
  return true;
}

interface MarqueeRect { x: number; y: number; width: number; height: number; }

function setMarqueeRect(el: HTMLElement, rect: MarqueeRect): void {
  el.style.left = rect.x + 'px';
  el.style.top = rect.y + 'px';
  el.style.width = rect.width + 'px';
  el.style.height = rect.height + 'px';
}

// ids of nodes (in the active container) whose bounds intersect the marquee rect
function nodesInMarqueeRect(state: AppContext['state'], container: string | null, rect: MarqueeRect): Set<string> {
  const hits = new Set<string>();
  for (const id in state.nodes) {
    if (containerOf(state, id) !== container) continue;
    const node = state.nodes[id];
    const withinX = node.x + node.w >= rect.x && node.x <= rect.x + rect.width;
    const withinY = node.y + node.h >= rect.y && node.y <= rect.y + rect.height;
    if (withinX && withinY) hits.add(id);
  }
  return hits;
}

function handleMarqueeMove(deps: PointerRuntime, point: Point): boolean {
  if (!deps.mode.marquee) return false;
  const marquee = deps.mode.marquee;
  const rect: MarqueeRect = {
    x: Math.min(marquee.x0, point.x),
    y: Math.min(marquee.y0, point.y),
    width: Math.abs(point.x - marquee.x0),
    height: Math.abs(point.y - marquee.y0),
  };
  setMarqueeRect(marquee.el, rect);
  const hits = nodesInMarqueeRect(deps.ctx.state, deps.ctx.view.container, rect);
  deps.ctx.state.sel = marquee.add ? new Set([...marquee.base, ...hits]) : hits;
  deps.helpers.refreshSelClasses();
  return true;
}

function findNodeElementAt(clientX: number, clientY: number): HTMLElement | null {
  const dropTarget = document.elementFromPoint(clientX, clientY);
  return dropTarget ? (dropTarget as HTMLElement).closest('.node') as HTMLElement | null : null;
}

function clearNodeHoverBorders(exceptId: string | null): void {
  document.querySelectorAll('.node').forEach((nodeEl) => {
    if ((nodeEl as HTMLElement).dataset.id !== exceptId) (nodeEl as HTMLElement).style.borderColor = '';
  });
}

function handleLinkMove(deps: PointerRuntime, point: Point, event: PointerEvent): boolean {
  if (!deps.mode.link) return false;
  const link = deps.mode.link;
  const fromPort = portPos(deps.ctx.state.nodes[link.from], link.side);
  link.ghost.setAttribute('d', `M ${fromPort.x} ${fromPort.y} L ${point.x} ${point.y}`);
  const dropTarget = findNodeElementAt(event.clientX, event.clientY);
  clearNodeHoverBorders(link.from);
  if (dropTarget && dropTarget.dataset.id !== link.from) dropTarget.style.borderColor = 'var(--accent)';
  return true;
}

function routePointerMove(deps: PointerRuntime, event: PointerEvent): void {
  const point = deps.camera.toWorld(event.clientX, event.clientY);
  deps.ctx.lastMouseWorld = point;

  if (handleLabelDragMove(deps, point)) return;
  if (handleBendDragMove(deps, point)) return;
  if (handlePanMove(deps, event)) return;
  if (handleNodeDragMove(deps, point)) return;
  if (handleResizeMove(deps, point)) return;
  if (handleMarqueeMove(deps, point)) return;
  handleLinkMove(deps, point, event);
}

function bakeNodeDragPositions(ctx: AppContext, moved: Set<string>): void {
  for (const id of moved) {
    const el = ctx.dom.world.querySelector<HTMLElement>(`.node[data-id="${id}"]`);
    if (el) {
      el.style.transform = '';
      el.style.willChange = '';
      el.style.left = ctx.state.nodes[id].x + 'px';
      el.style.top = ctx.state.nodes[id].y + 'px';
    }
  }
}

// bake the drag delta into committed left/top, sync + push history, then
// rebuild edge decor at the final position (sync) and refine routes (async)
function finishNodeDrag(deps: PointerRuntime): void {
  const drag = deps.mode.drag!;
  deps.helpers.clearGuides();
  if (drag.moved) {
    const moved = new Set<string>([
      ...drag.items.map((item) => item.id),
      ...drag.groupExtras.map((item) => item.id),
    ]);
    // bake the transform delta back into left/top and drop the layer hint,
    // so the committed DOM is correct independent of the async render below
    bakeNodeDragPositions(deps.ctx, moved);
    deps.ctx.hooks.sync();
    deps.ctx.hooks.pushHistory();
    deps.ctx.hooks.redrawWires();                                       // rebuild labels/stubs at the final position
    deps.ctx.hooks.rerouteEdges(deps.helpers.incidentEdgeIds(moved));    // then refine avoid-routes (async)
  }
  deps.mode.drag = null;
}

// resolve a link drag drop: wire an edge to the target node (if any), then
// clear the ghost path and hover highlight
function finishLinkDrop(deps: PointerRuntime, event: PointerEvent): void {
  const link = deps.mode.link!;
  const dropTarget = findNodeElementAt(event.clientX, event.clientY);
  clearNodeHoverBorders(null);
  if (dropTarget && dropTarget.dataset.id !== link.from) {
    deps.nodes.makeEdge(link.from, dropTarget.dataset.id as string);
  }
  link.ghost.remove();
  deps.mode.link = null;
  deps.ctx.hooks.render();
}

function finishLabelDrag(deps: PointerRuntime): void {
  const label = deps.mode.labelDrag!;
  deps.mode.labelDrag = null;
  if (label.moved) deps.ctx.hooks.pushHistory();
}

function finishBendDrag(deps: PointerRuntime): void {
  const bend = deps.mode.bendDrag!;
  deps.mode.bendDrag = null;
  if (bend.moved) deps.ctx.hooks.pushHistory();
}

function finishPan(deps: PointerRuntime): void {
  deps.mode.pan = null;
  deps.ctx.dom.stage.classList.remove('panning');
  deps.ctx.hooks.persist();
}

function finishResize(deps: PointerRuntime): void {
  const moved = new Set<string>([deps.mode.resize!.id]);
  deps.mode.resize = null;
  deps.ctx.hooks.sync();
  deps.ctx.hooks.renderInspector();
  deps.ctx.hooks.pushHistory();
  deps.ctx.hooks.rerouteEdges(deps.helpers.incidentEdgeIds(moved));
}

function finishMarquee(deps: PointerRuntime): void {
  deps.mode.marquee!.el.remove();
  deps.mode.marquee = null;
  deps.ctx.hooks.render();
  deps.ctx.hooks.renderInspector();
}

/* ---------------- pointer up ---------------- */
// each route claims one active mode and finishes its gesture
type PointerUpRoute = (deps: PointerRuntime, event: PointerEvent) => boolean;

const pointerUpRoutes: PointerUpRoute[] = [
  (deps) => {
    if (!deps.mode.labelDrag) return false;
    finishLabelDrag(deps);
    return true;
  },
  (deps) => {
    if (!deps.mode.bendDrag) return false;
    finishBendDrag(deps);
    return true;
  },
  (deps) => {
    if (!deps.mode.pan) return false;
    finishPan(deps);
    return true;
  },
  (deps) => {
    if (!deps.mode.drag) return false;
    finishNodeDrag(deps);
    return true;
  },
  (deps) => {
    if (!deps.mode.resize) return false;
    finishResize(deps);
    return true;
  },
  (deps) => {
    if (!deps.mode.marquee) return false;
    finishMarquee(deps);
    return true;
  },
  (deps, event) => {
    if (!deps.mode.link) return false;
    finishLinkDrop(deps, event);
    return true;
  },
];

function routePointerUp(deps: PointerRuntime, event: PointerEvent): void {
  pointerUpRoutes.some((route) => route(deps, event));
}

function createInitialMode(): Mode {
  return { drag: null, marquee: null, pan: null, resize: null, link: null, labelDrag: null, bendDrag: null };
}

// the body of the frozen setLinkMode anchor (a thin delegate inside initPointer)
function applyLinkMode(ctx: AppContext, session: PointerSession, linkBtn: HTMLElement, enabled: boolean): void {
  session.linkMode = enabled;
  if (!enabled) ctx.runtime.linkSrc = null;
  linkBtn.classList.toggle('active', enabled);
  ctx.dom.stage.classList.toggle('linking', enabled);
  ctx.hooks.render();
}

function attachStageListeners(deps: PointerRuntime): void {
  const { stage } = deps.ctx.dom;
  stage.addEventListener('pointerdown', (event) => routePointerDown(deps, event));
  stage.addEventListener('pointermove', (event) => routePointerMove(deps, event));
  stage.addEventListener('pointerup', (event) => routePointerUp(deps, event));
}

function buildPointerApi(session: PointerSession, setLinkMode: (on: boolean) => void): PointerApi {
  return {
    setLinkMode,
    isLinkMode: () => session.linkMode,
    isSpaceDown: () => session.spaceDown,
    setSpaceDown: (flag: boolean) => { session.spaceDown = flag; },
  };
}

// wires up all direct-manipulation pointer handling for the stage (drag, marquee, pan, resize, link)
export function initPointer(ctx: AppContext, camera: CameraApi, selection: SelectionApi, nodes: NodesApi): PointerApi {
  const mode = createInitialMode();
  const session: PointerSession = { linkMode: false, spaceDown: false, lastTrace: { type: '', atMs: 0 } };
  const linkBtn = document.getElementById('linkBtn') as HTMLElement;
  const helpers = createPointerHelpers(ctx, mode, []);
  function setLinkMode(enabled: boolean): void {
    applyLinkMode(ctx, session, linkBtn, enabled); }
  const deps: PointerRuntime = {
    ctx, camera, selection, nodes, mode, session, setLinkMode, helpers,
    starters: createPointerStarters({ ctx, camera, selection, mode, collectGroupExtras: helpers.collectGroupExtras }),
  };
  attachStageListeners(deps);
  return buildPointerApi(session, setLinkMode);
}
