/* =====================================================================
   nodes.ts — node + edge model operations
   ---------------------------------------------------------------------
   Responsibility: the create/modify/destroy verbs on the model that are
   not pure geometry: addNode, makeEdge, deleteSelection, alignNodes,
   wrapInGroup, bringToFront. Each mutates the model then re-renders,
   syncs, and pushes a history entry as appropriate.

   Depends on selection (to select new nodes) and camera.toWorld (to
   place a node at viewport centre), both injected at init.
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { ShapeKind } from '../core/types';
import type { SelectionApi } from './selection';
import type { CameraApi } from '../core/camera';
import { DEFAULTS, PALETTE } from '../core/config';
import { snapV, childIdsOf } from '../core/state';

export interface NodesApi {
  addNode: (shape: ShapeKind, wx?: number | null, wy?: number | null, opts?: { label?: string }) => string;
  makeEdge: (from: string, to: string) => void;
  deleteSelection: () => void;
  alignNodes: (mode: string) => void;
  wrapInGroup: () => void;
  bringToFront: (id: string) => void;
}

export function initNodes(ctx: AppContext, selection: SelectionApi, camera: CameraApi): NodesApi {
  const { state } = ctx;

  function addNode(shape: ShapeKind, wx?: number | null, wy?: number | null, opts: { label?: string } = {}): string {
    const id = 'n' + (state.nid++);
    const d = DEFAULTS[shape] || DEFAULTS.rect;
    const { stage } = ctx.dom;
    const container = ctx.view.container;
    if (wx == null || wy == null) {
      if (container && state.nodes[container]) {
        // inside a drilled level: stack new nodes under the container node
        const c = state.nodes[container];
        const sibs = childIdsOf(state, container).length;
        wx = c.x + (sibs % 3) * (d.w + 32);
        wy = c.y + c.h + 90 + Math.floor(sibs / 3) * (d.h + 44);
      } else {
        const c = camera.toWorld(stage.clientWidth / 2, stage.clientHeight / 2);
        const off = (Object.keys(state.nodes).length % 5) * 12;
        wx = c.x - d.w / 2 + off;
        wy = c.y - d.h / 2 + off;
      }
    }
    state.nodes[id] = {
      id, label: opts.label ?? d.label, shape,
      color: PALETTE[0],
      x: snapV(wx, ctx.snap), y: snapV(wy, ctx.snap), w: d.w, h: d.h,
      parent: container,
    };
    // auto-wire container -> new child so drill levels keep their graph.
    // skip group / note (structural, not interface nodes)
    if (container && state.nodes[container] && shape !== 'group' && shape !== 'note') {
      state.edges.push({
        id: 'e' + (state.eid++), from: container, to: id,
        label: '', style: 'solid', routing: ctx.prefs.route || 'straight',
      });
    }
    ctx.hooks.render(); ctx.hooks.sync();
    selection.selectOnly(id);
    ctx.hooks.pushHistory();
    return id;
  }

  function makeEdge(from: string, to: string): void {
    if (from === to) return;
    if (state.edges.some((e) => e.from === from && e.to === to)) { ctx.hooks.toast('Edge exists'); return; }
    state.edges.push({
      id: 'e' + (state.eid++), from, to, label: '', style: 'solid',
      routing: ctx.prefs.route || 'straight',
    });
    ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory();
  }

  function deleteSelection(): void {
    if (state.selEdge) {
      state.edges = state.edges.filter((x) => x.id !== state.selEdge);
      state.selEdge = null;
    } else if (state.sel.size) {
      for (const id of state.sel) {
        // promote children up to the deleted node's parent so they aren't orphaned
        const gp = state.nodes[id]?.parent ?? null;
        for (const cid in state.nodes) {
          if (state.nodes[cid].parent === id) state.nodes[cid].parent = gp;
        }
        delete state.nodes[id];
        state.edges = state.edges.filter((e) => e.from !== id && e.to !== id);
      }
      state.sel.clear();
    } else return;
    ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.renderInspector(); ctx.hooks.pushHistory();
  }

  function alignNodes(mode: string): void {
    const ns = [...state.sel].map((id) => state.nodes[id]);
    if (ns.length < 2) return;
    const xs = ns.map((n) => n.x), ys = ns.map((n) => n.y);
    const rs = ns.map((n) => n.x + n.w), bs = ns.map((n) => n.y + n.h);
    const minX = Math.min(...xs), maxR = Math.max(...rs);
    const minY = Math.min(...ys), maxB = Math.max(...bs);
    const cxAll = (minX + maxR) / 2, cyAll = (minY + maxB) / 2;

    if (mode === 'left') ns.forEach((n) => { n.x = minX; });
    if (mode === 'right') ns.forEach((n) => { n.x = maxR - n.w; });
    if (mode === 'top') ns.forEach((n) => { n.y = minY; });
    if (mode === 'bottom') ns.forEach((n) => { n.y = maxB - n.h; });
    if (mode === 'cx') ns.forEach((n) => { n.x = cxAll - n.w / 2; });
    if (mode === 'cy') ns.forEach((n) => { n.y = cyAll - n.h / 2; });

    if (mode === 'dh') {
      const sorted = [...ns].sort((a, b) => a.x - b.x);
      const span = (maxR - minX);
      const total = sorted.reduce((s, n) => s + n.w, 0);
      const gap = (span - total) / (sorted.length - 1);
      let cur = minX;
      sorted.forEach((n) => { n.x = cur; cur += n.w + gap; });
    }
    if (mode === 'dv') {
      const sorted = [...ns].sort((a, b) => a.y - b.y);
      const span = (maxB - minY);
      const total = sorted.reduce((s, n) => s + n.h, 0);
      const gap = (span - total) / (sorted.length - 1);
      let cur = minY;
      sorted.forEach((n) => { n.y = cur; cur += n.h + gap; });
    }
    ctx.hooks.render(); ctx.hooks.sync();
  }

  function wrapInGroup(): void {
    const childIds = [...state.sel];
    const ns = childIds.map((id) => state.nodes[id]);
    if (!ns.length) return;
    const pad = 28;
    const minX = Math.min(...ns.map((n) => n.x)) - pad;
    const minY = Math.min(...ns.map((n) => n.y)) - pad - 14;
    const maxR = Math.max(...ns.map((n) => n.x + n.w)) + pad;
    const maxB = Math.max(...ns.map((n) => n.y + n.h)) + pad;
    const id = 'n' + (state.nid++);
    state.nodes[id] = { id, label: 'Group', shape: 'group', color: PALETTE[0], x: minX, y: minY, w: maxR - minX, h: maxB - minY, parent: ctx.view.container };
    childIds.forEach((cid) => { if (state.nodes[cid]) state.nodes[cid].parent = id; });
    ctx.hooks.render(); ctx.hooks.sync(); selection.selectOnly(id); ctx.hooks.pushHistory();
  }

  function bringToFront(id: string): void {
    // re-insert node element last so it paints on top
    const n = state.nodes[id];
    delete state.nodes[id];
    state.nodes[id] = n;
    ctx.hooks.render();
  }

  return { addNode, makeEdge, deleteSelection, alignNodes, wrapInGroup, bringToFront };
}
