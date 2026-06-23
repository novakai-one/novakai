/* =====================================================================
   selection.ts — selection operations
   ---------------------------------------------------------------------
   Responsibility: the user-facing selection verbs (selectOnly, toggleSel,
   selectEdge, clearSel, selectAll). Each mutates state.sel / state.selEdge
   then triggers render + inspector so the UI reflects the change. These
   compose the pure model with the render/inspector hooks.
   ===================================================================== */

import type { AppContext } from '../core/context';
import { childIdsOf } from '../core/state';

export interface SelectionApi {
  selectOnly: (id: string | null) => void;
  toggleSel: (id: string) => void;
  selectEdge: (eid: string) => void;
  clearSel: () => void;
  selectAll: () => void;
}

export function initSelection(ctx: AppContext): SelectionApi {
  const { state } = ctx;

  function selectOnly(id: string | null): void {
    state.sel.clear();
    if (id) state.sel.add(id);
    state.selEdge = null;
    ctx.hooks.render(); ctx.hooks.renderInspector();
  }

  function toggleSel(id: string): void {
    if (state.sel.has(id)) state.sel.delete(id); else state.sel.add(id);
    state.selEdge = null;
    ctx.hooks.render(); ctx.hooks.renderInspector();
  }

  function selectEdge(eid: string): void {
    state.sel.clear(); state.selEdge = eid;
    ctx.hooks.render(); ctx.hooks.renderInspector();
    ctx.hooks.showTab('insp');
  }

  function clearSel(): void {
    state.sel.clear(); state.selEdge = null;
    ctx.hooks.render(); ctx.hooks.renderInspector();
  }

  function selectAll(): void {
    state.sel = new Set(childIdsOf(state, ctx.view.container));
    state.selEdge = null;
    ctx.hooks.render(); ctx.hooks.renderInspector();
  }

  return { selectOnly, toggleSel, selectEdge, clearSel, selectAll };
}
