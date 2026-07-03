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
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { SelectionApi } from './selection';
import type { NodesApi } from './nodes';
import type { DiagramNode, PortSide, Point } from '../core/types/types';
import { portPos, snapV, containerOf, sliceIds } from '../core/state/state';

const SVG_NS = 'http://www.w3.org/2000/svg';

interface DragItem { id: string; ox: number; oy: number; }
interface Mode {
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

// wires up all direct-manipulation pointer handling for the stage (drag, marquee, pan, resize, link)
export function initPointer(
  ctx: AppContext,
  camera: CameraApi,
  selection: SelectionApi,
  nodes: NodesApi,
): PointerApi {
  const { stage, world } = ctx.dom;
  const { state, runtime, cam } = ctx;

  const mode: Mode = { drag: null, marquee: null, pan: null, resize: null, link: null, labelDrag: null, bendDrag: null };
  let linkMode = false;       // toolbar toggle
  let spaceDown = false;
  // de-dupes the 2nd click of a double-click so a type trace toggles once
  let lastTrace = { type: '', t: 0 };
  const linkBtn = document.getElementById('linkBtn') as HTMLElement;

  // edges with at least one endpoint in the moved-node set (for scoped reroute)
  const incidentEdgeIds = (nodeIds: Set<string>): Set<string> => {
    const ids = new Set<string>();
    for (const e of state.edges) {
      if (nodeIds.has(e.from) || nodeIds.has(e.to)) ids.add(e.id);
    }
    return ids;
  };

  const guides: HTMLElement[] = [];
  const clearGuides = (): void => { guides.forEach((g) => g.remove()); guides.length = 0; };

  /* ---------------- starters ---------------- */
  // nodes fully contained within a dragged group node get carried along with it
  function collectGroupExtras(grp: DiagramNode): DragItem[] {
    const extras: DragItem[] = [];
    for (const oid in state.nodes) {
      if (state.sel.has(oid)) continue;
      if (containerOf(state, oid) !== ctx.view.container) continue;
      const o = state.nodes[oid];
      if (o.x >= grp.x && o.y >= grp.y && o.x + o.w <= grp.x + grp.w && o.y + o.h <= grp.y + grp.h) {
        extras.push({ id: oid, ox: o.x, oy: o.y });
      }
    }
    return extras;
  }

  function startDrag(e: PointerEvent): void {
    const start = camera.toWorld(e.clientX, e.clientY);
    const items: DragItem[] = [...state.sel].map((id) => ({ id, ox: state.nodes[id].x, oy: state.nodes[id].y }));
    const groupExtras: DragItem[] = [];
    for (const id of state.sel) {
      const g = state.nodes[id];
      if (g.shape === 'group') groupExtras.push(...collectGroupExtras(g));
    }
    mode.drag = { sx: start.x, sy: start.y, items, groupExtras, moved: false };
    stage.setPointerCapture(e.pointerId);
  }

  function startResize(rsz: HTMLElement, e: PointerEvent): void {
    const id = rsz.dataset.id as string, n = state.nodes[id];
    const start = camera.toWorld(e.clientX, e.clientY);
    mode.resize = { id, corner: rsz.dataset.rsz as string, sx: start.x, sy: start.y, ox: n.x, oy: n.y, ow: n.w, oh: n.h };
    stage.setPointerCapture(e.pointerId);
  }

  function startMarquee(e: PointerEvent): void {
    const w = camera.toWorld(e.clientX, e.clientY);
    const add = e.shiftKey || e.metaKey || e.ctrlKey;
    if (!add) selection.clearSel();
    const el = document.createElement('div');
    el.className = 'marquee';
    world.appendChild(el);
    mode.marquee = { x0: w.x, y0: w.y, el, add, base: new Set(state.sel) };
    stage.setPointerCapture(e.pointerId);
  }

  function startPan(e: PointerEvent): void {
    mode.pan = { sx: e.clientX, sy: e.clientY, cx: cam.x, cy: cam.y };
    stage.classList.add('panning');
    stage.setPointerCapture(e.pointerId);
  }

  function startLink(fromId: string, side: PortSide, e: PointerEvent): void {
    const ghost = document.createElementNS(SVG_NS, 'path');
    ghost.setAttribute('stroke', 'var(--accent-2)');
    ghost.setAttribute('stroke-width', '2');
    ghost.setAttribute('stroke-dasharray', '4 4');
    ghost.setAttribute('fill', 'none');
    ctx.dom.wires.appendChild(ghost);
    mode.link = { from: fromId, side, ghost };
    stage.setPointerCapture(e.pointerId);
  }

  function startLabelDrag(elab: HTMLElement, e: PointerEvent): void {
    const eid = elab.dataset.eid as string;
    const w = camera.toWorld(e.clientX, e.clientY);
    // grab offset (label center is its left/top) so it doesn't jump to the cursor
    const lx = parseFloat(elab.style.left) || w.x;
    const ly = parseFloat(elab.style.top) || w.y;
    selection.selectEdge(eid);
    mode.labelDrag = { eid, ox: lx - w.x, oy: ly - w.y, moved: false };
    stage.setPointerCapture(e.pointerId);
  }

  function startBendDrag(eid: string, e: PointerEvent): void {
    selection.selectEdge(eid);
    mode.bendDrag = { eid, moved: false };
    stage.setPointerCapture(e.pointerId);
  }

  /* ---------------- guides ---------------- */
  function addGuide(dir: 'v' | 'h', at: number): void {
    const g = document.createElement('div');
    g.className = 'guide ' + dir;
    if (dir === 'v') { g.style.left = at + 'px'; g.style.top = '-4000px'; g.style.height = '8000px'; }
    else { g.style.top = at + 'px'; g.style.left = '-4000px'; g.style.width = '8000px'; }
    world.appendChild(g); guides.push(g);
  }

  function showAlignGuides(): void {
    clearGuides();
    if (!mode.drag || mode.drag.items.length !== 1) return;
    const id = mode.drag.items[0].id, n = state.nodes[id];
    const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
    const TH = 1;
    for (const oid in state.nodes) {
      if (oid === id || state.sel.has(oid)) continue;
      if (containerOf(state, oid) !== ctx.view.container) continue;
      const o = state.nodes[oid];
      const ocx = o.x + o.w / 2, ocy = o.y + o.h / 2;
      ([[cx, ocx], [n.x, o.x], [n.x + n.w, o.x + o.w]] as [number, number][]).forEach(([a, b]) => {
        if (Math.abs(a - b) <= TH) addGuide('v', b);
      });
      ([[cy, ocy], [n.y, o.y], [n.y + n.h, o.y + o.h]] as [number, number][]).forEach(([a, b]) => {
        if (Math.abs(a - b) <= TH) addGuide('h', b);
      });
    }
  }

  function refreshSelClasses(): void {
    world.querySelectorAll('.node').forEach((el) => {
      (el as HTMLElement).classList.toggle('selected', state.sel.has((el as HTMLElement).dataset.id as string));
    });
    const statusEl = document.getElementById('status');
    if (statusEl) {
      const nc = Object.keys(state.nodes).length, ec = state.edges.length;
      let s = `${nc} node${nc !== 1 ? 's' : ''} · ${ec} edge${ec !== 1 ? 's' : ''}`;
      if (state.sel.size) s += ` · ${state.sel.size} selected`;
      statusEl.textContent = s;
    }
  }

  /* ---------------- link mode ---------------- */
  function setLinkMode(on: boolean): void {
    linkMode = on;
    if (!on) runtime.linkSrc = null;
    linkBtn.classList.toggle('active', on);
    stage.classList.toggle('linking', on);
    ctx.hooks.render();
  }

  // single-click a type chip -> trace every instance of that type. Handled
  // here (not via dblclick) so the card-rebuild on select can't swallow the
  // gesture. De-dupes the 2nd click of a double-click (350ms) so a trace
  // toggles once.
  function traceTypeChip(chip: HTMLElement): void {
    const type = chip.dataset.type || '';
    const now = performance.now();
    const isRepeatClick = type === lastTrace.type && now - lastTrace.t < 350;
    if (!isRepeatClick) {
      runtime.tracedType = runtime.tracedType === type ? null : (type || null);
      ctx.hooks.render();
    }
    lastTrace = { type, t: now };
  }

  // link-mode click on a node: complete the pending link, or start one here
  function handleLinkModeClick(id: string): void {
    if (runtime.linkSrc && runtime.linkSrc !== id) {
      nodes.makeEdge(runtime.linkSrc, id);
      runtime.linkSrc = null;
      setLinkMode(false);
    } else {
      runtime.linkSrc = id;
      ctx.hooks.render();
    }
  }

  const isAdditiveClick = (pev: PointerEvent): boolean => pev.shiftKey || pev.metaKey || pev.ctrlKey;

  // plain click on a node (not chip/card/link/alt): apply modifier-key
  // selection semantics (additive toggle vs. select-only)
  function selectNodeForClick(id: string, pev: PointerEvent): void {
    if (isAdditiveClick(pev)) selection.toggleSel(id);
    else if (!state.sel.has(id)) selection.selectOnly(id);
  }

  // full click-target routing for a node hit: type-chip trace, card-only
  // select, link-mode wiring, alt-click focus-spine, and drag-start
  function handleNodePointerDown(node: HTMLElement, target: HTMLElement, pev: PointerEvent): void {
    const id = node.dataset.id as string;
    if (node.classList.contains('editing')) return;

    const chip = target.closest('.fmtype') as HTMLElement | null;
    if (chip) { traceTypeChip(chip); return; }

    // clicking the rest of the card selects the node but never drags it
    if (target.closest('.fmcard')) { selection.selectOnly(id); return; }

    if (linkMode) { handleLinkModeClick(id); return; }

    // alt-click: toggle focus mode on the clicked node's call spine
    if (pev.altKey) {
      pev.preventDefault();
      runtime.focusSpine = runtime.focusSpine ? null : sliceIds(state, id);
      ctx.hooks.render();
      return;
    }

    selectNodeForClick(id, pev);
    if (isAdditiveClick(pev) && !state.sel.has(id)) return;
    startDrag(pev);
  }

  /* ---------------- pointer down ---------------- */
  stage.addEventListener('pointerdown', (e) => {
    if (e.button === 1) { startPan(e); return; }
    if (spaceDown) { startPan(e); return; }

    const t = e.target as HTMLElement;
    const port = t.closest('.port') as HTMLElement | null;
    const rsz = t.closest('.rsz') as HTMLElement | null;
    const node = t.closest('.node') as HTMLElement | null;
    const elab = t.closest('.edgelabel') as HTMLElement | null;
    const hit = t.closest('path.hit') as SVGElement | null;
    const bendh = t.closest('.bendhandle') as SVGElement | null;

    if (bendh) { startBendDrag((bendh as unknown as HTMLElement).dataset.eid as string, e); return; }
    if (elab) { startLabelDrag(elab, e); return; }
    if (hit) { selection.selectEdge((hit as unknown as HTMLElement).dataset.eid as string); return; }
    if (rsz) { startResize(rsz, e); return; }
    if (port) { startLink(port.dataset.port as string, port.dataset.side as PortSide, e); return; }

    if (node) { handleNodePointerDown(node, t, e); return; }

    if (!linkMode) startMarquee(e);
    else selection.clearSel();
    if (runtime.tracedType || runtime.focusSpine) {
      runtime.tracedType = null; runtime.focusSpine = null; ctx.hooks.render();
    }
  });

  /* ---------------- pointer move ---------------- */
  function handleLabelDragMove(pt: Point): boolean {
    if (!mode.labelDrag) return false;
    const ed = state.edges.find((x) => x.id === mode.labelDrag!.eid);
    if (ed) { ed.labelPos = { x: pt.x + mode.labelDrag.ox, y: pt.y + mode.labelDrag.oy }; mode.labelDrag.moved = true; ctx.hooks.render(); }
    return true;
  }

  function handleBendDragMove(pt: Point): boolean {
    if (!mode.bendDrag) return false;
    const ed = state.edges.find((x) => x.id === mode.bendDrag!.eid);
    if (ed) { ed.bend = { x: pt.x, y: pt.y }; mode.bendDrag.moved = true; ctx.hooks.render(); }
    return true;
  }

  function handlePanMove(ev: PointerEvent): boolean {
    if (!mode.pan) return false;
    cam.x = mode.pan.cx + (ev.clientX - mode.pan.sx);
    cam.y = mode.pan.cy + (ev.clientY - mode.pan.sy);
    camera.applyCam();
    return true;
  }

  // hide ONLY the moved node's own edge labels + boundary stubs (and their
  // stub arrow paths), tagged by edge id. They sit off the node and would
  // strand; every other node's labels stay put.
  function hideIncidentEdgeDecor(movers: DragItem[]): void {
    const inc = incidentEdgeIds(new Set(movers.map((it) => it.id)));
    for (const eid of inc) {
      world.querySelectorAll(`.edgelabel[data-eid="${eid}"], .boundary-stub[data-eid="${eid}"], path.stubline[data-eid="${eid}"]`)
        .forEach((el) => { (el as HTMLElement).style.display = 'none'; });
    }
  }

  function pinMoverBasePosition(movers: DragItem[]): void {
    for (const it of movers) {
      const el = world.querySelector<HTMLElement>(`.node[data-id="${it.id}"]`);
      if (el) { el.style.left = it.ox + 'px'; el.style.top = it.oy + 'px'; el.style.willChange = 'transform'; }
    }
  }

  // move the dragged elements by transform only — base left/top stays put,
  // the delta rides on transform, so no layout/paint of the world layer
  function applyDragTransform(movers: DragItem[], dx: number, dy: number): void {
    for (const it of movers) {
      const el = world.querySelector<HTMLElement>(`.node[data-id="${it.id}"]`);
      if (el) el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
  }

  function handleNodeDragMove(pt: Point): boolean {
    if (!mode.drag) return false;
    let dx = pt.x - mode.drag.sx, dy = pt.y - mode.drag.sy;
    const movers = [...mode.drag.items, ...mode.drag.groupExtras];
    // first move of a real drag: (a) hide edge labels + boundary stubs (they
    // sit off the moved node, can't follow a scoped update, and would strand);
    // (b) pin each mover's base left/top and promote it to its own layer so
    // the per-frame move can ride on transform (composite-only) instead of
    // mutating left/top (which relayouts + repaints the whole world layer —
    // the shimmer, worst with frontmatter cards). Baked back on drop.
    if (!mode.drag.moved) {
      hideIncidentEdgeDecor(movers);
      pinMoverBasePosition(movers);
    }
    mode.drag.moved = true;
    const prim = mode.drag.items[0];
    if (prim) {
      const nx = snapV(prim.ox + dx, ctx.snap), ny = snapV(prim.oy + dy, ctx.snap);
      dx = nx - prim.ox; dy = ny - prim.oy;
    }
    movers.forEach((it) => { const n = state.nodes[it.id]; n.x = it.ox + dx; n.y = it.oy + dy; });
    applyDragTransform(movers, dx, dy);
    showAlignGuides();
    // re-path only the moved node's incident edges, in place
    ctx.hooks.redrawWiresFor(new Set(movers.map((it) => it.id)));
    return true;
  }

  function handleResizeMove(pt: Point): boolean {
    if (!mode.resize) return false;
    const r = mode.resize, n = state.nodes[r.id];
    const dx = pt.x - r.sx, dy = pt.y - r.sy;
    let nx = r.ox, ny = r.oy, nw = r.ow, nh = r.oh;
    if (r.corner.includes('e')) nw = r.ow + dx;
    if (r.corner.includes('s')) nh = r.oh + dy;
    if (r.corner.includes('w')) { nw = r.ow - dx; }
    if (r.corner.includes('n')) { nh = r.oh - dy; }
    nw = Math.max(40, snapV(nw, ctx.snap)); nh = Math.max(30, snapV(nh, ctx.snap));
    if (r.corner.includes('w')) nx = r.ox + (r.ow - nw);
    if (r.corner.includes('n')) ny = r.oy + (r.oh - nh);
    n.x = nx; n.y = ny; n.w = nw; n.h = nh;
    ctx.hooks.render();
    return true;
  }

  function handleMarqueeMove(pt: Point): boolean {
    if (!mode.marquee) return false;
    const m = mode.marquee;
    const x = Math.min(m.x0, pt.x), y = Math.min(m.y0, pt.y);
    const ww = Math.abs(pt.x - m.x0), hh = Math.abs(pt.y - m.y0);
    m.el.style.left = x + 'px'; m.el.style.top = y + 'px';
    m.el.style.width = ww + 'px'; m.el.style.height = hh + 'px';
    const next = new Set(m.add ? m.base : []);
    for (const id in state.nodes) {
      if (containerOf(state, id) !== ctx.view.container) continue;
      const n = state.nodes[id];
      if (n.x + n.w >= x && n.x <= x + ww && n.y + n.h >= y && n.y <= y + hh) next.add(id);
    }
    state.sel = next;
    refreshSelClasses();
    return true;
  }

  function handleLinkMove(pt: Point, ev: PointerEvent): boolean {
    if (!mode.link) return false;
    const a = state.nodes[mode.link.from];
    const p = portPos(a, mode.link.side);
    mode.link.ghost.setAttribute('d', `M ${p.x} ${p.y} L ${pt.x} ${pt.y}`);
    const drop = document.elementFromPoint(ev.clientX, ev.clientY);
    const tgt = drop ? (drop as HTMLElement).closest('.node') as HTMLElement | null : null;
    document.querySelectorAll('.node').forEach((n) => {
      if ((n as HTMLElement).dataset.id !== mode.link!.from) (n as HTMLElement).style.borderColor = '';
    });
    if (tgt && tgt.dataset.id !== mode.link.from) tgt.style.borderColor = 'var(--accent)';
    return true;
  }

  stage.addEventListener('pointermove', (e) => {
    const w = camera.toWorld(e.clientX, e.clientY);
    ctx.lastMouseWorld = w;

    if (handleLabelDragMove(w)) return;
    if (handleBendDragMove(w)) return;
    if (handlePanMove(e)) return;
    if (handleNodeDragMove(w)) return;
    if (handleResizeMove(w)) return;
    if (handleMarqueeMove(w)) return;
    handleLinkMove(w, e);
  });

  // bake the drag delta into committed left/top, sync + push history, then
  // rebuild edge decor at the final position (sync) and refine routes (async)
  function finishNodeDrag(): void {
    const drag = mode.drag!;
    clearGuides();
    if (drag.moved) {
      const moved = new Set<string>([
        ...drag.items.map((it) => it.id),
        ...drag.groupExtras.map((it) => it.id),
      ]);
      // bake the transform delta back into left/top and drop the layer hint,
      // so the committed DOM is correct independent of the async render below
      for (const id of moved) {
        const el = world.querySelector<HTMLElement>(`.node[data-id="${id}"]`);
        if (el) { el.style.transform = ''; el.style.willChange = ''; el.style.left = state.nodes[id].x + 'px'; el.style.top = state.nodes[id].y + 'px'; }
      }
      ctx.hooks.sync(); ctx.hooks.pushHistory();
      ctx.hooks.redrawWires();                         // rebuild labels/stubs at the final position (sync, un-hides them)
      ctx.hooks.rerouteEdges(incidentEdgeIds(moved));  // then refine avoid-routes (async)
    }
    mode.drag = null;
  }

  // resolve a link drag drop: wire an edge to the target node (if any), then
  // clear the ghost path and hover highlight
  function finishLinkDrop(pev: PointerEvent): void {
    const link = mode.link!;
    const drop = document.elementFromPoint(pev.clientX, pev.clientY);
    const tgt = drop ? (drop as HTMLElement).closest('.node') as HTMLElement | null : null;
    document.querySelectorAll('.node').forEach((n) => { (n as HTMLElement).style.borderColor = ''; });
    if (tgt && tgt.dataset.id !== link.from) nodes.makeEdge(link.from, tgt.dataset.id as string);
    link.ghost.remove();
    mode.link = null;
    ctx.hooks.render();
  }

  /* ---------------- pointer up ---------------- */
  stage.addEventListener('pointerup', (e) => {
    if (mode.labelDrag) { const m = mode.labelDrag; mode.labelDrag = null; if (m.moved) ctx.hooks.pushHistory(); return; }
    if (mode.bendDrag) { const m = mode.bendDrag; mode.bendDrag = null; if (m.moved) ctx.hooks.pushHistory(); return; }
    if (mode.pan) { mode.pan = null; stage.classList.remove('panning'); ctx.hooks.persist(); return; }
    if (mode.drag) { finishNodeDrag(); return; }

    if (mode.resize) {
      const moved = new Set<string>([mode.resize.id]);
      mode.resize = null;
      ctx.hooks.sync(); ctx.hooks.renderInspector(); ctx.hooks.pushHistory();
      ctx.hooks.rerouteEdges(incidentEdgeIds(moved));
      return;
    }

    if (mode.marquee) {
      mode.marquee.el.remove();
      mode.marquee = null;
      ctx.hooks.render(); ctx.hooks.renderInspector();
      return;
    }

    if (mode.link) { finishLinkDrop(e); return; }
  });

  return {
    setLinkMode,
    isLinkMode: () => linkMode,
    isSpaceDown: () => spaceDown,
    setSpaceDown: (v: boolean) => { spaceDown = v; },
  };
}
