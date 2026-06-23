/* =====================================================================
   clipboard.ts — copy / paste / duplicate
   ---------------------------------------------------------------------
   Responsibility: hold the in-memory clipboard and implement copySel,
   pasteClip (with id remapping + optional cursor anchoring) and
   duplicateSel. Mutates the model, re-renders, pushes history.
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { DiagramNode, DiagramEdge, Point } from '../core/types';
import { snapV } from '../core/state';

export interface Clipboard {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface ClipboardApi {
  copySel: () => void;
  pasteClip: (atWorld?: Point | null) => void;
  duplicateSel: () => void;
}

export function initClipboard(ctx: AppContext): ClipboardApi {
  const { state } = ctx;

  function copySel(): void {
    if (!state.sel.size) return;
    const nodes = [...state.sel].map((id) => ({ ...state.nodes[id] }));
    const idset = new Set(state.sel);
    const edges = state.edges
      .filter((e) => idset.has(e.from) && idset.has(e.to))
      .map((e) => ({ ...e }));
    ctx.clipboard = { nodes, edges };
    ctx.hooks.toast(`Copied ${nodes.length}`);
  }

  function pasteClip(atWorld?: Point | null): void {
    const clip = ctx.clipboard;
    if (!clip.nodes.length) return;
    const map: Record<string, string> = {};
    const off = 24;
    state.sel.clear(); state.selEdge = null;
    let dx = off, dy = off;
    if (atWorld) {
      const minX = Math.min(...clip.nodes.map((n) => n.x));
      const minY = Math.min(...clip.nodes.map((n) => n.y));
      dx = snapV(atWorld.x, ctx.snap) - minX; dy = snapV(atWorld.y, ctx.snap) - minY;
    }
    for (const n of clip.nodes) {
      const id = 'n' + (state.nid++);
      map[n.id] = id;
      state.nodes[id] = { ...n, id, x: n.x + dx, y: n.y + dy };
      state.sel.add(id);
    }
    // re-parent: keep containment internal to the pasted set; otherwise drop
    // the paste into the current drill level
    for (const n of clip.nodes) {
      const nn = state.nodes[map[n.id]];
      nn.parent = (n.parent && map[n.parent]) ? map[n.parent] : ctx.view.container;
    }
    for (const e of clip.edges) {
      state.edges.push({ ...e, id: 'e' + (state.eid++), from: map[e.from], to: map[e.to] });
    }
    ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.renderInspector(); ctx.hooks.pushHistory();
  }

  function duplicateSel(): void {
    if (!state.sel.size) return;
    copySel(); pasteClip(); ctx.hooks.toast('Duplicated');
  }

  return { copySel, pasteClip, duplicateSel };
}
