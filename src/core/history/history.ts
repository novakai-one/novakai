/* =====================================================================
   history.ts — undo / redo
   ---------------------------------------------------------------------
   Responsibility: maintain a bounded stack of JSON model snapshots and
   provide push / undo / redo / restore. Restoring writes back into the
   model and triggers render + sync + inspector via hooks. It does NOT
   know how rendering works — only that those hooks exist.

   pushHistory() also fires persist() so autosave tracks undo points.
   ===================================================================== */

import type { AppContext } from '../context/context';

export interface History {
  stack: string[];
  i: number;
  max: number;
}

export interface HistoryApi {
  pushHistory: () => void;
  undo: () => void;
  redo: () => void;
  updateUndoButtons: () => void;
}

export function createHistory(): History {
  return { stack: [], i: -1, max: 80 };
}

export function initHistory(ctx: AppContext): HistoryApi {
  const { state, history } = ctx;
  const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
  const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement;

  function snapshot(): string {
    return JSON.stringify({ nodes: state.nodes, edges: state.edges, nid: state.nid, eid: state.eid, dir: state.dir, hier: state.hier });
  }

  function updateUndoButtons(): void {
    undoBtn.disabled = history.i <= 0;
    redoBtn.disabled = history.i >= history.stack.length - 1;
  }

  function pushHistory(): void {
    history.stack = history.stack.slice(0, history.i + 1);
    history.stack.push(snapshot());
    if (history.stack.length > history.max) history.stack.shift();
    history.i = history.stack.length - 1;
    updateUndoButtons();
    ctx.hooks.persist();
  }

  function restore(snap: string): void {
    const s = JSON.parse(snap);
    state.nodes = s.nodes; state.edges = s.edges; state.nid = s.nid; state.eid = s.eid;
    state.dir = s.dir || 'TD';
    state.hier = s.hier ?? { groups: {}, memberOf: {} };
    state.sel.clear(); state.selEdge = null;
    ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.renderInspector();
  }

  function undo(): void {
    if (history.i <= 0) return;
    history.i--; restore(history.stack[history.i]);
    updateUndoButtons(); ctx.hooks.persist(); ctx.hooks.toast('Undo');
  }

  function redo(): void {
    if (history.i >= history.stack.length - 1) return;
    history.i++; restore(history.stack[history.i]);
    updateUndoButtons(); ctx.hooks.persist(); ctx.hooks.toast('Redo');
  }

  return { pushHistory, undo, redo, updateUndoButtons };
}
