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

// factory: builds the pointer helpers over the shared ctx, mode machine and guide list
export function createPointerHelpers(ctx: AppContext, mode: Mode, guides: HTMLElement[]) {
  const { world } = ctx.dom;
  const { state } = ctx;

  // edges with at least one endpoint in the moved-node set (for scoped reroute)
  const incidentEdgeIds = (nodeIds: Set<string>): Set<string> => {
    const ids = new Set<string>();
    for (const edge of state.edges) {
      if (nodeIds.has(edge.from) || nodeIds.has(edge.to)) ids.add(edge.id);
    }
    return ids;
  };

  const clearGuides = (): void => { guides.forEach((guide) => guide.remove()); guides.length = 0; };

  /* ---------------- starters ---------------- */
  // nodes fully contained within a dragged group node get carried along with it
  function collectGroupExtras(grp: DiagramNode): DragItem[] {
    const extras: DragItem[] = [];
    for (const oid in state.nodes) {
      if (state.sel.has(oid)) continue;
      if (containerOf(state, oid) !== ctx.view.container) continue;
      const child = state.nodes[oid];
      if (child.x >= grp.x && child.y >= grp.y && child.x + child.w <= grp.x + grp.w && child.y + child.h <= grp.y + grp.h) {
        extras.push({ id: oid, ox: child.x, oy: child.y });
      }
    }
    return extras;
  }

  /* ---------------- guides ---------------- */
  function addGuide(dir: 'v' | 'h', at: number): void {
    const guide = document.createElement('div');
    guide.className = 'guide ' + dir;
    if (dir === 'v') { guide.style.left = at + 'px'; guide.style.top = '-4000px'; guide.style.height = '8000px'; }
    else { guide.style.top = at + 'px'; guide.style.left = '-4000px'; guide.style.width = '8000px'; }
    world.appendChild(guide); guides.push(guide);
  }

  function showAlignGuides(): void {
    clearGuides();
    if (!mode.drag || mode.drag.items.length !== 1) return;
    const id = mode.drag.items[0].id, node = state.nodes[id];
    const cx = node.x + node.w / 2, cy = node.y + node.h / 2;
    const TH = 1;
    for (const oid in state.nodes) {
      if (oid === id || state.sel.has(oid)) continue;
      if (containerOf(state, oid) !== ctx.view.container) continue;
      const other = state.nodes[oid];
      const ocx = other.x + other.w / 2, ocy = other.y + other.h / 2;
      ([[cx, ocx], [node.x, other.x], [node.x + node.w, other.x + other.w]] as [number, number][]).forEach(([selfPos, otherPos]) => {
        if (Math.abs(selfPos - otherPos) <= TH) addGuide('v', otherPos);
      });
      ([[cy, ocy], [node.y, other.y], [node.y + node.h, other.y + other.h]] as [number, number][]).forEach(([selfPos, otherPos]) => {
        if (Math.abs(selfPos - otherPos) <= TH) addGuide('h', otherPos);
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
      let text = `${nc} node${nc !== 1 ? 's' : ''} · ${ec} edge${ec !== 1 ? 's' : ''}`;
      if (state.sel.size) text += ` · ${state.sel.size} selected`;
      statusEl.textContent = text;
    }
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

  const isAdditiveClick = (pev: PointerEvent): boolean => pev.shiftKey || pev.metaKey || pev.ctrlKey;

  return {
    incidentEdgeIds, clearGuides, collectGroupExtras, addGuide, showAlignGuides,
    refreshSelClasses, hideIncidentEdgeDecor, pinMoverBasePosition, applyDragTransform, isAdditiveClick,
  };
}
