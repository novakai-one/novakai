/* =====================================================================
   history.ts — undo / redo
   ---------------------------------------------------------------------
   Responsibility: maintain a bounded stack of JSON model snapshots and
   provide push / undo / redo / restore. Restoring writes back into the
   model and triggers render + sync + inspector via hooks. It does NOT
   know how rendering works — only that those hooks exist.

   pushHistory() also fires persist() so autosave tracks undo points.
   ===================================================================== */

import type { AppContext } from './context';

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

// @flowmap-node history kind=module
export function createHistory(): History {
  return { stack: [], i: -1, max: 80 };
}

export function initHistory(ctx: AppContext): HistoryApi {
  const { state, history } = ctx;
  const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
  const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement;

  // @flowmap-node history__snapshot kind=function parent=history
  function snapshot(): string {
    return JSON.stringify({ nodes: state.nodes, edges: state.edges, nid: state.nid, eid: state.eid, dir: state.dir });
  }

  // @flowmap-node history__updateUndoButtons kind=function parent=history
  function updateUndoButtons(): void {
    undoBtn.disabled = history.i <= 0;
    redoBtn.disabled = history.i >= history.stack.length - 1;
  }

  // @flowmap-node history__pushHistory kind=function parent=history
  function pushHistory(): void {
    history.stack = history.stack.slice(0, history.i + 1);
    history.stack.push(snapshot());
    if (history.stack.length > history.max) history.stack.shift();
    history.i = history.stack.length - 1;
    updateUndoButtons();
    ctx.hooks.persist();
  }

  // @flowmap-node history__restore kind=function parent=history
  function restore(snap: string): void {
    const s = JSON.parse(snap);
    state.nodes = s.nodes; state.edges = s.edges; state.nid = s.nid; state.eid = s.eid;
    state.dir = s.dir || 'TD';
    state.sel.clear(); state.selEdge = null;
    ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.renderInspector();
  }

  // @flowmap-node history__undo kind=function parent=history
  function undo(): void {
    if (history.i <= 0) return;
    history.i--; restore(history.stack[history.i]);
    updateUndoButtons(); ctx.hooks.persist(); ctx.hooks.toast('Undo');
  }

  // @flowmap-node history__redo kind=function parent=history
  function redo(): void {
    if (history.i >= history.stack.length - 1) return;
    history.i++; restore(history.stack[history.i]);
    updateUndoButtons(); ctx.hooks.persist(); ctx.hooks.toast('Redo');
  }

  return { pushHistory, undo, redo, updateUndoButtons };
}
