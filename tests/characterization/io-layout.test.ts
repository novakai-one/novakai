/* =====================================================================
   io-layout.test.ts — characterization tests for src/io/layout.ts
   ---------------------------------------------------------------------
   M6 pass: snapshot CURRENT observed behavior of the module's one export,
   `initLayout` (-> { autoLayout }). No behavior judgments — assertions
   mirror what the code actually returns/mutates today.

   `layout.ts` imports `routeReferences` from `render/avoidRouter.ts`,
   which pulls in a Vite-only `?url` wasm asset import that crashes at
   module-load time under the plain `node --import tsx` test runtime (see
   stub-avoid-router-loader.mjs for the exact error and rationale). A
   loader hook replaces ONLY that external collaborator with a no-op; the
   real, unmodified `layout.ts` executes for every test below.
   ===================================================================== */

import { register } from 'node:module';
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Static `import` specifiers resolve before any top-level code in this file
// runs, so the loader hook must be registered and awaited via a *dynamic*
// import — a static `import { initLayout } from '../../src/io/layout.ts'`
// would resolve (and crash on the wasm asset) before register() below ever
// executes.
register('./stub-avoid-router-loader.mjs', import.meta.url);
const { initLayout } = await import('../../src/io/layout.ts');

function mkNode(id: string, width = 160, height = 56, opts: { shape?: string; extra?: any } = {}): any {
  const { shape = 'rect', extra = {} } = opts;
  return { id, label: id, shape, color: null, x: 0, y: 0, 'w': width, 'h': height, ...extra };
}

/** A group-box node (10x10 default footprint, grown by wrapGroups). */
function groupBox(id: string): any {
  return mkNode(id, 10, 10, { shape: 'group' });
}

/** A rect node structurally parented into a group. */
function groupMember(id: string, parent: string): any {
  return mkNode(id, 160, 56, { shape: 'rect', extra: { parent } });
}

/** A TD-direction state with empty roots and (by default) no groups. */
function tdState(nodes: Record<string, any>, edges: any[], hier: any = { groups: {}, memberOf: {} }): any {
  return { dir: 'TD', nodes, edges, roots: [], hier };
}

function mkCtx(state: any, opts: { snap?: boolean; showFrontmatter?: boolean } = {}): { ctx: any; calls: string[] } {
  const calls: string[] = [];
  const ctx: any = {
    state,
    prefs: { showFrontmatter: opts.showFrontmatter ?? false },
    snap: opts.snap ?? false,
    hooks: {
      render: () => calls.push('render'),
      sync: () => calls.push('sync'),
      pushHistory: () => calls.push('pushHistory'),
      toast: (msg: string) => calls.push('toast:' + msg),
    },
  };
  return { ctx, calls };
}

function positions(state: any): Record<string, { x: number; y: number; w: number; h: number }> {
  const out: Record<string, any> = {};
  for (const id in state.nodes) {
    const node = state.nodes[id];
    out[id] = { x: node.x, y: node.y, 'w': node.w, 'h': node.h };
  }
  return out;
}

test('autoLayout: empty node set -> returns immediately, no hooks/camera fired', async () => {
  const state = { dir: 'TD', nodes: {}, edges: [], roots: [], hier: { groups: {}, memberOf: {} } };
  const { ctx, calls } = mkCtx(state);
  const camCalls: string[] = [];
  const api = initLayout(ctx, { zoomToFit: () => camCalls.push('zoomToFit') } as any);
  await api.autoLayout();
  assert.deepEqual(calls, []);
  assert.deepEqual(camCalls, []);
});

test('autoLayout: linear TD chain layers top-to-bottom, one node per layer', async () => {
  const nodes = { 'n1': mkNode('n1'), 'n2': mkNode('n2'), 'n3': mkNode('n3') };
  const edges = [
    { id: 'e1', from: 'n1', 'to': 'n2', label: '', style: 'solid', routing: 'straight' },
    { id: 'e2', from: 'n2', 'to': 'n3', label: '', style: 'solid', routing: 'straight' },
  ];
  const state = tdState(nodes, edges);
  const { ctx, calls } = mkCtx(state);
  const camCalls: string[] = [];
  const api = initLayout(ctx, { zoomToFit: () => camCalls.push('zoomToFit') } as any);
  await api.autoLayout();
  assert.deepEqual(positions(state), {
    'n1': { x: 80, y: 80, 'w': 160, 'h': 56 },
    'n2': { x: 80, y: 336, 'w': 160, 'h': 56 },
    'n3': { x: 80, y: 592, 'w': 160, 'h': 56 },
  });
  assert.deepEqual(calls, ['render', 'sync', 'pushHistory', 'toast:Tidied · TD']);
  assert.deepEqual(camCalls, ['zoomToFit']);
});

test('autoLayout: A<->B cycle + declared root "a" -> back-edge cut, root stays layer 0', async () => {
  const state = {
    dir: 'TD',
    nodes: { 'a': mkNode('a'), 'b': mkNode('b'), 'c': mkNode('c') },
    edges: [
      { id: 'e1', from: 'a', 'to': 'b', label: '', style: 'solid', routing: 'straight' },
      { id: 'e2', from: 'b', 'to': 'a', label: '', style: 'solid', routing: 'straight' },
      { id: 'e3', from: 'b', 'to': 'c', label: '', style: 'solid', routing: 'straight' },
    ],
    roots: ['a'], hier: { groups: {}, memberOf: {} },
  };
  const { ctx } = mkCtx(state);
  const api = initLayout(ctx, { zoomToFit: () => {} } as any);
  await api.autoLayout();
  assert.deepEqual(positions(state), {
    'a': { x: 80, y: 80, 'w': 160, 'h': 56 },
    'b': { x: 80, y: 336, 'w': 160, 'h': 56 },
    'c': { x: 80, y: 592, 'w': 160, 'h': 56 },
  });
});

test('autoLayout: dotted reference edge -> satellite parked off-spine, routing forced to ortho', async () => {
  const state = {
    dir: 'TD',
    nodes: { 'n1': mkNode('n1'), 'n2': mkNode('n2'), sat: mkNode('sat') },
    edges: [
      { id: 'e1', from: 'n1', 'to': 'n2', label: '', style: 'solid', routing: 'straight' },
      { id: 'e2', from: 'n1', 'to': 'sat', label: '', style: 'dotted', routing: 'straight' },
    ],
    roots: [], hier: { groups: {}, memberOf: {} },
  };
  const { ctx } = mkCtx(state);
  const api = initLayout(ctx, { zoomToFit: () => {} } as any);
  await api.autoLayout();
  assert.deepEqual(positions(state), {
    'n1': { x: 80, y: 80, 'w': 160, 'h': 56 },
    'n2': { x: 80, y: 336, 'w': 160, 'h': 56 },
    sat: { x: 440, y: 80, 'w': 160, 'h': 56 },
  });
  assert.deepEqual(state.edges.map((e: any) => e.routing), ['straight', 'ortho']);
});

test('autoLayout: all-spine group box grows to wrap its members (pad + label pad)', async () => {
  const state = {
    dir: 'TD',
    nodes: { 'g1': groupBox('g1'), 'n1': groupMember('n1', 'g1'), 'n2': groupMember('n2', 'g1') },
    edges: [{ id: 'e1', from: 'n1', 'to': 'n2', label: '', style: 'solid', routing: 'straight' }],
    roots: [], hier: { groups: { 'g1': { id: 'g1', label: 'G1', parent: null } }, memberOf: {} },
  };
  const { ctx } = mkCtx(state);
  const api = initLayout(ctx, { zoomToFit: () => {} } as any);
  await api.autoLayout();
  assert.deepEqual(state.nodes.g1, { ...groupBox('g1'), x: 46, y: 20, 'w': 228, 'h': 406 });
});

test('autoLayout: LR direction lays layers out along X instead of Y', async () => {
  const state = {
    dir: 'LR',
    nodes: { 'n1': mkNode('n1'), 'n2': mkNode('n2') },
    edges: [{ id: 'e1', from: 'n1', 'to': 'n2', label: '', style: 'solid', routing: 'straight' }],
    roots: [], hier: { groups: {}, memberOf: {} },
  };
  const { ctx, calls } = mkCtx(state);
  const api = initLayout(ctx, { zoomToFit: () => {} } as any);
  await api.autoLayout();
  assert.deepEqual(positions(state), {
    'n1': { x: 80, y: 80, 'w': 160, 'h': 56 },
    'n2': { x: 440, y: 80, 'w': 160, 'h': 56 },
  });
  assert.deepEqual(calls[3], 'toast:Tidied · LR');
});

test('autoLayout: no spine edges at all -> untagged fallback treats every node as spine', async () => {
  const state = {
    dir: 'TD',
    nodes: { 'n1': mkNode('n1'), 'n2': mkNode('n2') },
    edges: [], roots: [], hier: { groups: {}, memberOf: {} },
  };
  const { ctx } = mkCtx(state);
  const api = initLayout(ctx, { zoomToFit: () => {} } as any);
  await api.autoLayout();
  assert.deepEqual(positions(state), {
    'n1': { x: 80, y: 80, 'w': 160, 'h': 56 },
    'n2': { x: 390, y: 80, 'w': 160, 'h': 56 },
  });
});

test('autoLayout: mixed group (spine + satellite) inlines the satellite into the spine band', async () => {
  const nodes = {
    'g1': groupBox('g1'), 'n1': groupMember('n1', 'g1'),
    'n2': mkNode('n2'), 'sat': groupMember('sat', 'g1'),
  };
  const edges = [
    { id: 'e1', from: 'n1', 'to': 'n2', label: '', style: 'solid', routing: 'straight' },
    { id: 'e2', from: 'n1', 'to': 'sat', label: '', style: 'dotted', routing: 'straight' },
  ];
  const state = tdState(nodes, edges, { groups: { 'g1': { id: 'g1', label: 'G1', parent: null } }, memberOf: {} });
  const { ctx } = mkCtx(state);
  const api = initLayout(ctx, { zoomToFit: () => {} } as any);
  await api.autoLayout();
  assert.deepEqual(positions(state), {
    'g1': { x: 46, y: 20, 'w': 538, 'h': 150 },
    'n1': { x: 80, y: 80, 'w': 160, 'h': 56 },
    'n2': { x: 235, y: 336, 'w': 160, 'h': 56 },
    'sat': { x: 390, y: 80, 'w': 160, 'h': 56 },
  });
});

test('autoLayout: showFrontmatter + a measured card widens the footprint used for positioning', async () => {
  const state: any = {
    dir: 'TD',
    nodes: { 'n1': mkNode('n1'), 'n2': mkNode('n2') },
    edges: [{ id: 'e1', from: 'n1', 'to': 'n2', label: '', style: 'solid', routing: 'straight' }],
    roots: [], hier: { groups: {}, memberOf: {} },
    measured: new Map([['n1', { cardW: 200, cardH: 40 }]]),
  };
  const { ctx } = mkCtx(state, { showFrontmatter: true });
  const api = initLayout(ctx, { zoomToFit: () => {} } as any);
  await api.autoLayout();
  assert.deepEqual(positions(state), {
    'n1': { x: 100, y: 80, 'w': 160, 'h': 56 },
    'n2': { x: 100, y: 382, 'w': 160, 'h': 56 },
  });
});

test('autoLayout: ctx.snap=true rounds positions to the 16px grid', async () => {
  const state = {
    dir: 'TD',
    nodes: { 'n1': mkNode('n1'), 'n2': mkNode('n2') },
    edges: [{ id: 'e1', from: 'n1', 'to': 'n2', label: '', style: 'solid', routing: 'straight' }],
    roots: [], hier: { groups: {}, memberOf: {} },
  };
  const { ctx } = mkCtx(state, { snap: true });
  const api = initLayout(ctx, { zoomToFit: () => {} } as any);
  await api.autoLayout();
  assert.deepEqual(positions(state), {
    'n1': { x: 80, y: 80, 'w': 160, 'h': 56 },
    'n2': { x: 80, y: 336, 'w': 160, 'h': 56 },
  });
});
