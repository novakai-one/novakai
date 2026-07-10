/* =====================================================================
   pointer-gestures.ts — gesture starters for canvas pointer editing
   ---------------------------------------------------------------------
   The "start*" handlers that open each interaction mode on the stage:
   node drag (carrying group children), resize, marquee select, pan,
   port-drag linking, edge-label drag, and edge-bend drag. Each stamps
   the shared `mode` machine and captures the pointer. Split out of
   pointer.ts as a factory over ctx + camera + selection + mode; the
   factory's start* functions are thin delegates over the module-scope
   begin* helpers below.

   Note: the frozen Mode/DragItem field names (sx, oy, x0, ...) sit
   below the id-length floor; quoted keys keep the frozen shape without
   a rename — same convention as src/io.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { SelectionApi } from './selection';
import type { DiagramNode, PortSide } from '../core/types/types';
import type { DragItem, Mode } from './pointer';

const SVG_NS = 'http://www.w3.org/2000/svg';

// everything the gesture starters need, regrouped as one options object
interface StarterDeps {
  ctx: AppContext;
  camera: CameraApi;
  selection: SelectionApi;
  mode: Mode;
  collectGroupExtras: (grp: DiagramNode) => DragItem[];
}

function beginDrag(deps: StarterDeps, event: PointerEvent): void {
  const { state } = deps.ctx;
  const start = deps.camera.toWorld(event.clientX, event.clientY);
  const items: DragItem[] = [...state.sel].map((id) => ({ id, 'ox': state.nodes[id].x, 'oy': state.nodes[id].y }));
  const groupExtras: DragItem[] = [];
  for (const id of state.sel) {
    const grp = state.nodes[id];
    if (grp.shape === 'group') groupExtras.push(...deps.collectGroupExtras(grp));
  }
  deps.mode.drag = { 'sx': start.x, 'sy': start.y, items, groupExtras, moved: false };
  deps.ctx.dom.stage.setPointerCapture(event.pointerId);
}

function beginResize(deps: StarterDeps, rsz: HTMLElement, event: PointerEvent): void {
  const node = deps.ctx.state.nodes[rsz.dataset.id as string];
  const start = deps.camera.toWorld(event.clientX, event.clientY);
  deps.mode.resize = {
    id: rsz.dataset.id as string,
    corner: rsz.dataset.rsz as string,
    'sx': start.x,
    'sy': start.y,
    'ox': node.x,
    'oy': node.y,
    'ow': node.w,
    'oh': node.h,
  };
  deps.ctx.dom.stage.setPointerCapture(event.pointerId);
}

function beginMarquee(deps: StarterDeps, event: PointerEvent): void {
  const point = deps.camera.toWorld(event.clientX, event.clientY);
  const add = event.shiftKey || event.metaKey || event.ctrlKey;
  if (!add) deps.selection.clearSel();
  const el = document.createElement('div');
  el.className = 'marquee';
  deps.ctx.dom.world.appendChild(el);
  deps.mode.marquee = { 'x0': point.x, 'y0': point.y, el, add, base: new Set(deps.ctx.state.sel) };
  deps.ctx.dom.stage.setPointerCapture(event.pointerId);
}

function beginPan(deps: StarterDeps, event: PointerEvent): void {
  deps.mode.pan = { 'sx': event.clientX, 'sy': event.clientY, 'cx': deps.ctx.cam.x, 'cy': deps.ctx.cam.y };
  deps.ctx.dom.stage.classList.add('panning');
  deps.ctx.dom.stage.setPointerCapture(event.pointerId);
}

function beginLink(deps: StarterDeps, fromId: string, side: PortSide, event: PointerEvent): void {
  const ghost = document.createElementNS(SVG_NS, 'path');
  ghost.setAttribute('stroke', 'var(--accent-2)');
  ghost.setAttribute('stroke-width', '2');
  ghost.setAttribute('stroke-dasharray', '4 4');
  ghost.setAttribute('fill', 'none');
  deps.ctx.dom.wires.appendChild(ghost);
  deps.mode.link = { from: fromId, side, ghost };
  deps.ctx.dom.stage.setPointerCapture(event.pointerId);
}

function beginLabelDrag(deps: StarterDeps, elab: HTMLElement, event: PointerEvent): void {
  const eid = elab.dataset.eid as string;
  const point = deps.camera.toWorld(event.clientX, event.clientY);
  // grab offset (label center is its left/top) so it doesn't jump to the cursor
  const labelX = parseFloat(elab.style.left) || point.x;
  const labelY = parseFloat(elab.style.top) || point.y;
  deps.selection.selectEdge(eid);
  deps.mode.labelDrag = { eid, 'ox': labelX - point.x, 'oy': labelY - point.y, moved: false };
  deps.ctx.dom.stage.setPointerCapture(event.pointerId);
}

function beginBendDrag(deps: StarterDeps, eid: string, event: PointerEvent): void {
  deps.selection.selectEdge(eid);
  deps.mode.bendDrag = { eid, moved: false };
  deps.ctx.dom.stage.setPointerCapture(event.pointerId);
}

// factory: builds the gesture starters over the shared ctx, camera, selection and mode machine.
// collectGroupExtras is supplied by pointer-helpers (a dragged group carries its contained children).
export function createPointerStarters(deps: StarterDeps) {
  function startDrag(event: PointerEvent): void {
    beginDrag(deps, event); }
  function startResize(rsz: HTMLElement, event: PointerEvent): void {
    beginResize(deps, rsz, event); }
  function startMarquee(event: PointerEvent): void {
    beginMarquee(deps, event); }
  function startPan(event: PointerEvent): void {
    beginPan(deps, event); }
  function startLink(fromId: string, side: PortSide, event: PointerEvent): void {
    beginLink(deps, fromId, side, event); }
  function startLabelDrag(elab: HTMLElement, event: PointerEvent): void {
    beginLabelDrag(deps, elab, event); }
  function startBendDrag(eid: string, event: PointerEvent): void {
    beginBendDrag(deps, eid, event); }
  return { startDrag, startResize, startMarquee, startPan, startLink, startLabelDrag, startBendDrag };
}
