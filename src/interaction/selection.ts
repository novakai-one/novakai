/* =====================================================================
   selection.ts — selection operations
   ---------------------------------------------------------------------
   Responsibility: the user-facing selection verbs (selectOnly, toggleSel,
   selectEdge, clearSel, selectAll). Each mutates state.sel / state.selEdge
   then triggers render + inspector so the UI reflects the change. These
   compose the pure model with the render/inspector hooks.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import { childIdsOf } from '../core/state/state';

export interface SelectionApi {
  selectOnly: (id: string | null) => void;
  toggleSel: (id: string) => void;
  selectEdge: (eid: string) => void;
  clearSel: () => void;
  selectAll: () => void;
}

/** Post-mutation refresh shared by the selection verbs that touch the node set. */
function refreshSelection(ctx: AppContext): void {
  ctx.hooks.render();
  ctx.hooks.renderInspector();
  ctx.hooks.renderSlice();
}

function applySelectOnly(ctx: AppContext, id: string | null): void {
  ctx.state.sel.clear();
  if (id) ctx.state.sel.add(id);
  ctx.state.selEdge = null;
  refreshSelection(ctx);
}

function applyToggleSel(ctx: AppContext, id: string): void {
  if (ctx.state.sel.has(id)) {
    ctx.state.sel.delete(id);
  } else {
    ctx.state.sel.add(id);
  }
  ctx.state.selEdge = null;
  refreshSelection(ctx);
}

function applySelectEdge(ctx: AppContext, eid: string): void {
  ctx.state.sel.clear();
  ctx.state.selEdge = eid;
  ctx.hooks.render();
  ctx.hooks.renderInspector();
  ctx.hooks.showTab('insp');
}

function applyClearSel(ctx: AppContext): void {
  ctx.state.sel.clear();
  ctx.state.selEdge = null;
  refreshSelection(ctx);
}

function applySelectAll(ctx: AppContext): void {
  ctx.state.sel = new Set(childIdsOf(ctx.state, ctx.view.container));
  ctx.state.selEdge = null;
  refreshSelection(ctx);
}

export function initSelection(ctx: AppContext): SelectionApi {
  function selectOnly(id: string | null): void {
    applySelectOnly(ctx, id);
  }

  function toggleSel(id: string): void {
    applyToggleSel(ctx, id);
  }

  function selectEdge(eid: string): void {
    applySelectEdge(ctx, eid);
  }

  function clearSel(): void {
    applyClearSel(ctx);
  }

  function selectAll(): void {
    applySelectAll(ctx);
  }

  return { selectOnly, toggleSel, selectEdge, clearSel, selectAll };
}
