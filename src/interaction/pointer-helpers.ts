/* =====================================================================
   pointer-helpers.ts — pure/DOM helpers for canvas pointer editing
   ---------------------------------------------------------------------
   The stateless-ish helpers behind pointer.ts's interaction handlers:
   incident-edge scoping, group-child collection, alignment guides,
   selection-class refresh, and the drag DOM helpers (hide edge decor,
   pin base positions, apply the transform delta). Split out of
   pointer.ts as a factory closing over the shared ctx / mode / guides.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { DiagramNode } from '../core/types/types';
import { containerOf } from '../core/state/state';
import type { DragItem, Mode } from './pointer';

// edges with at least one endpoint in the moved-node set (for scoped reroute)
function incidentEdgeIds(state: AppContext['state'], nodeIds: Set<string>): Set<string> {
  const ids = new Set<string>();
  for (const edge of state.edges) {
    if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) ids.add(edge.id);
  }
  return ids;
}

function clearGuides(guides: HTMLElement[]): void {
  guides.forEach((guide) => guide.remove());
  guides.length = 0;
}

// nodes fully contained within a dragged group node get carried along with it
function collectGroupExtras(ctx: AppContext, grp: DiagramNode): DragItem[] {
  const { state } = ctx;
  const extras: DragItem[] = [];
  for (const oid in state.nodes) {
    if (state.sel.has(oid)) continue;
    if (containerOf(state, oid) !== ctx.view.container) continue;
    const child = state.nodes[oid];
    const fitsInGroup =
      child.x >= grp.x && child.y >= grp.y && child.x + child.w <= grp.x + grp.w && child.y + child.h <= grp.y + grp.h;
    // quoted keys: frozen DragItem field names sit below the id-length floor (io convention)
    if (fitsInGroup) extras.push({ id: oid, 'ox': child.x, 'oy': child.y });
  }
  return extras;
}

// hide ONLY the moved node's own edge labels + boundary stubs (and their
// stub arrow paths), tagged by edge id. They sit off the node and would
// strand; every other node's labels stay put.
function hideIncidentEdgeDecor(world: HTMLElement, state: AppContext['state'], movers: DragItem[]): void {
  const incident = incidentEdgeIds(state, new Set(movers.map((item) => item.id)));
  for (const eid of incident) {
    const selector = [
      `.edgelabel[data-eid="${eid}"]`,
      `.boundary-stub[data-eid="${eid}"]`,
      `path.stubline[data-eid="${eid}"]`,
    ].join(', ');
    world.querySelectorAll(selector).forEach((el) => {
      (el as HTMLElement).style.display = 'none';
    });
  }
}

function pinMoverBasePosition(world: HTMLElement, movers: DragItem[]): void {
  for (const item of movers) {
    const el = world.querySelector<HTMLElement>(`.node[data-id="${item.id}"]`);
    if (el) {
      el.style.left = item.ox + 'px';
      el.style.top = item.oy + 'px';
      el.style.willChange = 'transform';
    }
  }
}

// move the dragged elements by transform only — base left/top stays put,
// the delta rides on transform, so no layout/paint of the world layer
function applyDragTransform(world: HTMLElement, movers: DragItem[], dx: number, dy: number): void {
  for (const item of movers) {
    const el = world.querySelector<HTMLElement>(`.node[data-id="${item.id}"]`);
    if (el) el.style.transform = `translate(${dx}px, ${dy}px)`;
  }
}

function isAdditiveClick(event: PointerEvent): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

// shared half of addGuidesAgainst: adds a guide for every pair that's
// within threshold of each other along one axis
function applyGuidePairs(
  pairs: [number, number][],
  threshold: number,
  dir: 'v' | 'h',
  addGuide: (dir: 'v' | 'h', pos: number) => void,
): void {
  pairs.forEach(([selfPos, otherPos]) => {
    if (Math.abs(selfPos - otherPos) <= threshold) addGuide(dir, otherPos);
  });
}

// the per-neighbour half of showAlignGuides: adds a v/h guide wherever node
// and other share a center or edge position within threshold
function addGuidesAgainst(
  node: { x: number; y: number; w: number; h: number },
  other: { x: number; y: number; w: number; h: number },
  threshold: number,
  addGuide: (dir: 'v' | 'h', pos: number) => void,
): void {
  const centerX = node.x + node.w / 2, otherCenterX = other.x + other.w / 2;
  const centerY = node.y + node.h / 2, otherCenterY = other.y + other.h / 2;
  applyGuidePairs(
    [[centerX, otherCenterX], [node.x, other.x], [node.x + node.w, other.x + other.w]],
    threshold, 'v', addGuide,
  );
  applyGuidePairs(
    [[centerY, otherCenterY], [node.y, other.y], [node.y + node.h, other.y + other.h]],
    threshold, 'h', addGuide,
  );
}

/* ---------------- guides ---------------- */
function appendGuide(world: HTMLElement, guides: HTMLElement[], dir: 'v' | 'h', pos: number): void {
  const guide = document.createElement('div');
  guide.className = 'guide ' + dir;
  if (dir === 'v') {
    guide.style.left = pos + 'px';
    guide.style.top = '-4000px';
    guide.style.height = '8000px';
  } else {
    guide.style.top = pos + 'px';
    guide.style.left = '-4000px';
    guide.style.width = '8000px';
  }
  world.appendChild(guide);
  guides.push(guide);
}

function renderAlignGuides(ctx: AppContext, mode: Mode, guides: HTMLElement[]): void {
  const { state } = ctx;
  clearGuides(guides);
  if (!mode.drag || mode.drag.items.length !== 1) return;
  const id = mode.drag.items[0].id;
  const node = state.nodes[id];
  const threshold = 1;
  for (const oid in state.nodes) {
    if (oid === id || state.sel.has(oid)) continue;
    if (containerOf(state, oid) !== ctx.view.container) continue;
    addGuidesAgainst(node, state.nodes[oid], threshold, (dir, pos) => appendGuide(ctx.dom.world, guides, dir, pos));
  }
}

function refreshSelectionClasses(ctx: AppContext): void {
  const { state } = ctx;
  ctx.dom.world.querySelectorAll('.node').forEach((el) => {
    (el as HTMLElement).classList.toggle('selected', state.sel.has((el as HTMLElement).dataset.id as string));
  });
  const statusEl = document.getElementById('status');
  if (statusEl) {
    const nodeCount = Object.keys(state.nodes).length;
    const edgeCount = state.edges.length;
    let text = `${nodeCount} node${nodeCount !== 1 ? 's' : ''} · ${edgeCount} edge${edgeCount !== 1 ? 's' : ''}`;
    if (state.sel.size) text += ` · ${state.sel.size} selected`;
    statusEl.textContent = text;
  }
}

// the non-map-gated helper surface, bound once over ctx + guides
function bindHelperOps(ctx: AppContext, guides: HTMLElement[]) {
  const { world } = ctx.dom;
  return {
    incidentEdgeIds: (nodeIds: Set<string>) => incidentEdgeIds(ctx.state, nodeIds),
    clearGuides: () => clearGuides(guides),
    collectGroupExtras: (grp: DiagramNode) => collectGroupExtras(ctx, grp),
    hideIncidentEdgeDecor: (movers: DragItem[]) => hideIncidentEdgeDecor(world, ctx.state, movers),
    pinMoverBasePosition: (movers: DragItem[]) => pinMoverBasePosition(world, movers),
    applyDragTransform: (movers: DragItem[], dx: number, dy: number) => applyDragTransform(world, movers, dx, dy),
    isAdditiveClick,
  };
}

// factory: builds the pointer helpers over the shared ctx, mode machine and guide list
export function createPointerHelpers(ctx: AppContext, mode: Mode, guides: HTMLElement[]) {
  function addGuide(dir: 'v' | 'h', pos: number): void {
    appendGuide(ctx.dom.world, guides, dir, pos); }
  function showAlignGuides(): void {
    renderAlignGuides(ctx, mode, guides); }
  function refreshSelClasses(): void {
    refreshSelectionClasses(ctx); }
  return { ...bindHelperOps(ctx, guides), addGuide, showAlignGuides, refreshSelClasses };
}
