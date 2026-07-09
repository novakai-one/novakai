/* =====================================================================
   pointer-gestures.ts — gesture starters for canvas pointer editing
   ---------------------------------------------------------------------
   The "start*" handlers that open each interaction mode on the stage:
   node drag (carrying group children), resize, marquee select, pan,
   port-drag linking, edge-label drag, and edge-bend drag. Each stamps
   the shared `mode` machine and captures the pointer. Split out of
   pointer.ts as a factory closing over ctx + camera + selection + mode.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { SelectionApi } from './selection';
import type { DiagramNode, PortSide } from '../core/types/types';
import type { DragItem, Mode } from './pointer';

const SVG_NS = 'http://www.w3.org/2000/svg';

// factory: builds the gesture starters over the shared ctx, camera, selection and mode machine.
// collectGroupExtras is supplied by pointer-helpers (a dragged group carries its contained children).
export function createPointerStarters(
  ctx: AppContext,
  camera: CameraApi,
  selection: SelectionApi,
  mode: Mode,
  collectGroupExtras: (grp: DiagramNode) => DragItem[],
) {
  const { stage, world } = ctx.dom;
  const { state, cam } = ctx;

  function startDrag(ev: PointerEvent): void {
    const start = camera.toWorld(ev.clientX, ev.clientY);
    const items: DragItem[] = [...state.sel].map((id) => ({ id, ox: state.nodes[id].x, oy: state.nodes[id].y }));
    const groupExtras: DragItem[] = [];
    for (const id of state.sel) {
      const grp = state.nodes[id];
      if (grp.shape === 'group') groupExtras.push(...collectGroupExtras(grp));
    }
    mode.drag = { sx: start.x, sy: start.y, items, groupExtras, moved: false };
    stage.setPointerCapture(ev.pointerId);
  }

  function startResize(rsz: HTMLElement, ev: PointerEvent): void {
    const id = rsz.dataset.id as string, node = state.nodes[id];
    const start = camera.toWorld(ev.clientX, ev.clientY);
    mode.resize = { id, corner: rsz.dataset.rsz as string, sx: start.x, sy: start.y, ox: node.x, oy: node.y, ow: node.w, oh: node.h };
    stage.setPointerCapture(ev.pointerId);
  }

  function startMarquee(ev: PointerEvent): void {
    const pt = camera.toWorld(ev.clientX, ev.clientY);
    const add = ev.shiftKey || ev.metaKey || ev.ctrlKey;
    if (!add) selection.clearSel();
    const el = document.createElement('div');
    el.className = 'marquee';
    world.appendChild(el);
    mode.marquee = { x0: pt.x, y0: pt.y, el, add, base: new Set(state.sel) };
    stage.setPointerCapture(ev.pointerId);
  }

  function startPan(ev: PointerEvent): void {
    mode.pan = { sx: ev.clientX, sy: ev.clientY, cx: cam.x, cy: cam.y };
    stage.classList.add('panning');
    stage.setPointerCapture(ev.pointerId);
  }

  function startLink(fromId: string, side: PortSide, ev: PointerEvent): void {
    const ghost = document.createElementNS(SVG_NS, 'path');
    ghost.setAttribute('stroke', 'var(--accent-2)');
    ghost.setAttribute('stroke-width', '2');
    ghost.setAttribute('stroke-dasharray', '4 4');
    ghost.setAttribute('fill', 'none');
    ctx.dom.wires.appendChild(ghost);
    mode.link = { from: fromId, side, ghost };
    stage.setPointerCapture(ev.pointerId);
  }

  function startLabelDrag(elab: HTMLElement, ev: PointerEvent): void {
    const eid = elab.dataset.eid as string;
    const pt = camera.toWorld(ev.clientX, ev.clientY);
    // grab offset (label center is its left/top) so it doesn't jump to the cursor
    const lx = parseFloat(elab.style.left) || pt.x;
    const ly = parseFloat(elab.style.top) || pt.y;
    selection.selectEdge(eid);
    mode.labelDrag = { eid, ox: lx - pt.x, oy: ly - pt.y, moved: false };
    stage.setPointerCapture(ev.pointerId);
  }

  function startBendDrag(eid: string, ev: PointerEvent): void {
    selection.selectEdge(eid);
    mode.bendDrag = { eid, moved: false };
    stage.setPointerCapture(ev.pointerId);
  }

  return { startDrag, startResize, startMarquee, startPan, startLink, startLabelDrag, startBendDrag };
}
