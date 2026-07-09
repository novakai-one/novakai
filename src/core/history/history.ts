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

function snapshotState(state: AppContext['state']): string {
  return JSON.stringify({
    nodes: state.nodes, edges: state.edges, nid: state.nid, eid: state.eid, dir: state.dir, hier: state.hier,
  });
}

function applySnapshotFields(state: AppContext['state'], parsed: any): void {
  state.nodes = parsed.nodes;
  state.edges = parsed.edges;
  state.nid = parsed.nid;
  state.eid = parsed.eid;
  state.dir = parsed.dir || 'TD';
  state.hier = parsed.hier ?? { groups: {}, memberOf: {} };
  state.sel.clear();
  state.selEdge = null;
}

function restoreState(ctx: AppContext, snap: string): void {
  applySnapshotFields(ctx.state, JSON.parse(snap));
  ctx.hooks.render();
  ctx.hooks.sync();
  ctx.hooks.renderInspector();
}

function updateUndoButtons(history: History, undoBtn: HTMLButtonElement, redoBtn: HTMLButtonElement): void {
  undoBtn.disabled = history.i <= 0;
  redoBtn.disabled = history.i >= history.stack.length - 1;
}

function pushHistory(ctx: AppContext, undoBtn: HTMLButtonElement, redoBtn: HTMLButtonElement): void {
  const { history, state } = ctx;
  history.stack = history.stack.slice(0, history.i + 1);
  history.stack.push(snapshotState(state));
  if (history.stack.length > history.max) history.stack.shift();
  history.i = history.stack.length - 1;
  updateUndoButtons(history, undoBtn, redoBtn);
  ctx.hooks.persist();
}

function stepHistory(ctx: AppContext, undoBtn: HTMLButtonElement, redoBtn: HTMLButtonElement, delta: 1 | -1): void {
  const { history } = ctx;
  const next = history.i + delta;
  if (next < 0 || next > history.stack.length - 1) return;
  history.i = next;
  restoreState(ctx, history.stack[history.i]);
  updateUndoButtons(history, undoBtn, redoBtn);
  ctx.hooks.persist();
  ctx.hooks.toast(delta === -1 ? 'Undo' : 'Redo');
}

export function initHistory(ctx: AppContext): HistoryApi {
  const undoBtn = document.getElementById('undoBtn') as HTMLButtonElement;
  const redoBtn = document.getElementById('redoBtn') as HTMLButtonElement;
  return {
    pushHistory: () => pushHistory(ctx, undoBtn, redoBtn),
    undo: () => stepHistory(ctx, undoBtn, redoBtn, -1),
    redo: () => stepHistory(ctx, undoBtn, redoBtn, 1),
    updateUndoButtons: () => updateUndoButtons(ctx.history, undoBtn, redoBtn),
  };
}
