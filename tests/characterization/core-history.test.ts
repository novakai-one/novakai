/* =====================================================================
   core-history.test.ts — characterization tests for
   src/core/history/history.ts
   ---------------------------------------------------------------------
   initHistory() reads document.getElementById('undoBtn'/'redoBtn') at
   call time (real DOM elements it toggles .disabled on) — there is no
   `document` global under plain `node --import tsx`, so this file installs
   a minimal fake (`{ getElementById: () => ({ disabled: false }) }`)
   before importing, exactly like the fake ctx/hooks below stand in for
   the rest of the DOM. snapshot() itself is a private closure (not
   exported); its behavior — a deep-copy JSON string with a stable shape —
   is observed indirectly through pushHistory(), the only way it's
   reachable from outside the module. expected values are observed
   behavior, not spec.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';

(globalThis as any).document = { getElementById: () => ({ disabled: false }) };
const { createHistory, initHistory } = await import('../../src/core/history/history.ts');

function mkCtx(state: any): { ctx: any; calls: string[] } {
  const calls: string[] = [];
  const ctx: any = {
    state,
    history: createHistory(),
    hooks: {
      persist: () => calls.push('persist'),
      render: () => calls.push('render'),
      sync: () => calls.push('sync'),
      renderInspector: () => calls.push('renderInspector'),
      toast: (msg: string) => calls.push('toast:' + msg),
    },
  };
  return { ctx, calls };
}

function mkState(): any {
  return {
    nodes: { 'a': { id: 'a', label: 'A', shape: 'rect', color: null, x: 0, y: 0, 'w': 100, 'h': 50 } },
    edges: [], nid: 2, eid: 1, dir: 'TD', hier: { groups: {}, memberOf: {} },
    sel: new Set(), selEdge: null,
  };
}

test('pushHistory: snapshot has the stable {nodes,edges,nid,eid,dir,hier} JSON shape', () => {
  const { ctx } = mkCtx(mkState());
  const api = initHistory(ctx);
  api.pushHistory();
  const snap = JSON.parse(ctx.history.stack[0]);
  assert.deepEqual(Object.keys(snap), ['nodes', 'edges', 'nid', 'eid', 'dir', 'hier']);
  assert.deepEqual(snap.nodes, ctx.state.nodes);
});

test('pushHistory: fires ctx.hooks.persist()', () => {
  const { ctx, calls } = mkCtx(mkState());
  const api = initHistory(ctx);
  api.pushHistory();
  assert.deepEqual(calls, ['persist']);
});

test('pushHistory: the pushed snapshot is a deep copy — later mutating live state does not alter it', () => {
  const state = mkState();
  const { ctx } = mkCtx(state);
  const api = initHistory(ctx);
  api.pushHistory();
  state.nodes.a.label = 'MUTATED';
  assert.equal(JSON.parse(ctx.history.stack[0]).nodes.a.label, 'A');
});

test('undo: restores the previous snapshot into ctx.state and fires render/sync/renderInspector/persist/toast', () => {
  const state = mkState();
  const { ctx, calls } = mkCtx(state);
  const api = initHistory(ctx);
  api.pushHistory();
  state.nodes.a.label = 'CHANGED';
  api.pushHistory();
  calls.length = 0;
  api.undo();
  assert.equal(ctx.state.nodes.a.label, 'A');
  assert.deepEqual(calls, ['render', 'sync', 'renderInspector', 'persist', 'toast:Undo']);
});

test('undo: at the oldest snapshot (i<=0) is a no-op — no hooks fire', () => {
  const { ctx, calls } = mkCtx(mkState());
  const api = initHistory(ctx);
  api.pushHistory();
  calls.length = 0;
  api.undo();
  assert.deepEqual(calls, []);
});
