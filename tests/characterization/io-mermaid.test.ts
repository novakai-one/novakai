/* =====================================================================
   io-mermaid.test.ts — characterization tests for src/io/mermaid.ts
   ---------------------------------------------------------------------
   M6 pass: snapshot CURRENT observed behavior of every exported function
   (parseGroupDirective, fromMermaid, initMermaid). No behavior judgments —
   assertions mirror what the code actually returns today.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGroupDirective, fromMermaid, initMermaid } from '../../src/io/mermaid.ts';

// ---------------------------------------------------------------------
// parseGroupDirective
// ---------------------------------------------------------------------

test('parseGroupDirective: %% group line sets hier.groups, returns true', () => {
  const hier = { groups: {}, memberOf: {} } as any;
  const ok = parseGroupDirective('%% group g1 "Group Label"', hier);
  assert.equal(ok, true);
  assert.deepEqual(hier.groups, { g1: { id: 'g1', label: 'Group Label', parent: null } });
  assert.deepEqual(hier.memberOf, {});
});

test('parseGroupDirective: %% group line with parent captures parent id', () => {
  const hier = { groups: {}, memberOf: {} } as any;
  const ok = parseGroupDirective('%% group g2 "Sub" parent g1', hier);
  assert.equal(ok, true);
  assert.deepEqual(hier.groups, { g2: { id: 'g2', label: 'Sub', parent: 'g1' } });
});

test('parseGroupDirective: %% group-member line sets hier.memberOf, returns true', () => {
  const hier = { groups: {}, memberOf: {} } as any;
  const ok = parseGroupDirective('%% group-member g1 n1', hier);
  assert.equal(ok, true);
  assert.deepEqual(hier.memberOf, { n1: 'g1' });
  assert.deepEqual(hier.groups, {});
});

test('parseGroupDirective: non-matching line returns false, hier untouched', () => {
  const hier = { groups: {}, memberOf: {} } as any;
  const ok = parseGroupDirective('some other line', hier);
  assert.equal(ok, false);
  assert.deepEqual(hier, { groups: {}, memberOf: {} });
});

// ---------------------------------------------------------------------
// fromMermaid
// ---------------------------------------------------------------------

test('fromMermaid: empty text yields empty model with defaults', () => {
  const r = fromMermaid('');
  assert.deepEqual(r, { nodes: {}, edges: [], nextN: 1, nextE: 1, dir: 'TD', roots: [], hier: { groups: {}, memberOf: {} } });
});

test('fromMermaid: basic nodes + edge, auto-placed, dir LR', () => {
  const basic = `flowchart LR
n1["Hello"]
n2("World")
n1 --> n2
`;
  const r = fromMermaid(basic);
  assert.equal(r.dir, 'LR');
  assert.equal(r.nextN, 3);
  assert.equal(r.nextE, 2);
  assert.deepEqual(r.nodes.n1, { id: 'n1', label: 'Hello', shape: 'rect', color: null, x: 80, y: 80, w: 160, h: 56 });
  assert.deepEqual(r.nodes.n2, { id: 'n2', label: 'World', shape: 'round', color: null, x: 280, y: 80, w: 160, h: 56 });
  assert.deepEqual(r.edges, [{ id: 'e1', from: 'n1', to: 'n2', label: '', style: 'solid', routing: 'straight' }]);
});

test('fromMermaid: full metadata (fm, kind, parent, root, edge ortho/bend/labelpos, group)', () => {
  const full = `flowchart TB
%% fm n1 10 20 160 56 rect null
n1["Label A"]
%% kind n1 component
%% root n1
n2["Label B"]
%% parent n2 n1
n1 -->|edge label| n2
%% edge e1 ortho
%% edge e1 bend 5 6
%% edge e1 labelpos 7 8
%% group g1 "Group One"
%% group-member g1 n1
`;
  const r = fromMermaid(full);
  assert.equal(r.dir, 'TD'); // TB is normalized to TD
  assert.deepEqual(r.nodes.n1, { id: 'n1', label: 'Label A', shape: 'rect', color: null, x: 10, y: 20, w: 160, h: 56, kind: 'component' });
  assert.deepEqual(r.nodes.n2, { id: 'n2', label: 'Label B', shape: 'rect', color: null, x: 80, y: 80, w: 160, h: 56, parent: 'n1' });
  assert.deepEqual(r.edges, [{
    id: 'e1', from: 'n1', to: 'n2', label: 'edge label', style: 'solid', routing: 'ortho',
    bend: { x: 5, y: 6 }, labelPos: { x: 7, y: 8 },
  }]);
  assert.deepEqual(r.roots, ['n1']);
  assert.deepEqual(r.hier, { groups: { g1: { id: 'g1', label: 'Group One', parent: null } }, memberOf: { n1: 'g1' } });
});

test('fromMermaid: subgraph block sets group shape + child parent, "end" pops stack', () => {
  const sg = `flowchart TD
subgraph g1 ["My Group"]
  n1["Inside"]
end
n2["Outside"]
`;
  const r = fromMermaid(sg);
  assert.equal(r.nodes.g1.shape, 'group');
  assert.equal(r.nodes.n1.parent, 'g1');
  assert.equal(r.nodes.n2.parent, undefined);
});

test('fromMermaid: dangling group parent and dangling memberOf are pruned', () => {
  const dangling = `flowchart TD
%% group g1 "G1" parent ghost
%% group-member ghost2 n1
n1["A"]
`;
  const r = fromMermaid(dangling);
  // parent "ghost" was never declared -> nulled
  assert.equal(r.hier.groups.g1.parent, null);
  // group "ghost2" was never declared -> membership dropped
  assert.deepEqual(r.hier.memberOf, {});
});

test('fromMermaid: auto-placement wraps at 4 columns per row', () => {
  const auto = `flowchart TD
a["A"]
b["B"]
c["C"]
d["D"]
e["E"]
`;
  const r = fromMermaid(auto);
  assert.equal(r.nodes.a.x, 80); assert.equal(r.nodes.a.y, 80);
  assert.equal(r.nodes.d.x, 680); assert.equal(r.nodes.d.y, 80);
  assert.equal(r.nodes.e.x, 80); assert.equal(r.nodes.e.y, 210);
});

// ---------------------------------------------------------------------
// initMermaid — pure-logic surface only (fake ctx/selection; no real DOM)
// ---------------------------------------------------------------------

function makeCtx(state: any): { ctx: any; calls: string[] } {
  const calls: string[] = [];
  const ctx: any = {
    state,
    dom: { mmd: { value: '' } },
    hooks: {
      toast: (msg: string) => calls.push('toast:' + msg),
      render: () => calls.push('render'),
      pushHistory: () => calls.push('pushHistory'),
    },
  };
  return { ctx, calls };
}
const selection = { clearSel: () => {} } as any;

const state1 = {
  dir: 'TD',
  nodes: {
    n1: { id: 'n1', label: 'Node One', shape: 'rect', color: null, x: 10, y: 20, w: 160, h: 56 },
    n2: { id: 'n2', label: 'Node Two', shape: 'round', color: '#262c4a', x: 200, y: 20, w: 160, h: 56, parent: 'n1' },
  },
  edges: [{ id: 'e1', from: 'n1', to: 'n2', label: 'goes to', style: 'solid', routing: 'straight' }],
  roots: ['n1'],
  hier: { groups: {}, memberOf: {} },
};
const EXPECTED_BASIC = 'flowchart TD\n%% fm n1 10 20 160 56 rect null\n%% fm n2 200 20 160 56 round #262c4a\n'
  + '%% parent n2 n1\n%% root n1\n  n1["Node One"]\n  n2("Node Two")\n  n1 -->|goes to| n2\n';

test('initMermaid.toMermaid: emits fm/parent/root metadata then nodes then edges', () => {
  const { ctx } = makeCtx(state1);
  const api = initMermaid(ctx, selection);
  assert.equal(api.toMermaid(), EXPECTED_BASIC);
});

test('initMermaid.toMermaid: "only" filter restricts nodes/edges/metadata emitted', () => {
  const { ctx } = makeCtx(state1);
  const api = initMermaid(ctx, selection);
  const out = api.toMermaid({ only: new Set(['n1']) });
  assert.equal(out, 'flowchart TD\n%% fm n1 10 20 160 56 rect null\n%% root n1\n  n1["Node One"]\n');
});

test('initMermaid.toMermaid: group/subgraph + ortho edge with bend/labelPos', () => {
  const state2 = {
    dir: 'LR',
    nodes: {
      g1: { id: 'g1', label: 'Group', shape: 'group', color: null, x: 0, y: 0, w: 300, h: 200 },
      n1: { id: 'n1', label: 'Child', shape: 'rect', color: null, x: 10, y: 10, w: 100, h: 40, parent: 'g1' },
      n2: { id: 'n2', label: 'Outside', shape: 'diamond', color: null, x: 400, y: 10, w: 150, h: 88 },
    },
    edges: [{
      id: 'e1', from: 'n1', to: 'n2', label: '', style: 'dotted', routing: 'ortho',
      bend: { x: 1, y: 2 }, labelPos: { x: 3, y: 4 },
    }],
    roots: [],
    hier: { groups: { g1: { id: 'g1', label: 'Group', parent: null } }, memberOf: { n1: 'g1' } },
  };
  const { ctx } = makeCtx(state2);
  const api = initMermaid(ctx, selection);
  const expected = 'flowchart LR\n%% fm g1 0 0 300 200 group null\n%% fm n1 10 10 100 40 rect null\n'
    + '%% fm n2 400 10 150 88 diamond null\n%% edge e1 ortho\n%% edge e1 bend 1 2\n%% edge e1 labelpos 3 4\n'
    + '%% group g1 "Group"\n%% group-member g1 n1\n  subgraph g1 ["Group"]\n    n1["Child"]\n  end\n'
    + '  n2{"Outside"}\n  n1 -.-> n2\n';
  assert.equal(api.toMermaid(), expected);
});

test('initMermaid.sync: writes toMermaid() output into ctx.dom.mmd.value', () => {
  const { ctx } = makeCtx(state1);
  const api = initMermaid(ctx, selection);
  api.sync();
  assert.equal(ctx.dom.mmd.value, EXPECTED_BASIC);
});

test('initMermaid.applyText: parses text, replaces state, fires render/pushHistory/toast', () => {
  const { ctx, calls } = makeCtx({ nodes: {}, edges: {}, nid: 1, eid: 1, dir: 'TD', roots: [], hier: { groups: {}, memberOf: {} } });
  ctx.dom.mmd.value = 'flowchart TD\nn1["Hi"]\n';
  const api = initMermaid(ctx, selection);
  api.applyText();
  assert.deepEqual(ctx.state.nodes.n1, { id: 'n1', label: 'Hi', shape: 'rect', color: null, x: 80, y: 80, w: 160, h: 56 });
  assert.deepEqual(calls, ['render', 'pushHistory', 'toast:Applied']);
});

test('initMermaid.applyText: zero parsed nodes -> toast "No nodes parsed", state untouched', () => {
  const { ctx, calls } = makeCtx({ nodes: {}, edges: {}, nid: 1, eid: 1, dir: 'TD', roots: [], hier: { groups: {}, memberOf: {} } });
  ctx.dom.mmd.value = 'flowchart TD\n';
  const api = initMermaid(ctx, selection);
  api.applyText();
  assert.deepEqual(calls, ['toast:No nodes parsed']);
  assert.deepEqual(ctx.state.nodes, {});
});

test('initMermaid.applyText: a thrown parse error -> toast "Parse error"', () => {
  const { ctx, calls } = makeCtx({ nodes: {}, edges: {}, nid: 1, eid: 1, dir: 'TD', roots: [], hier: { groups: {}, memberOf: {} } });
  ctx.dom.mmd.value = undefined; // fromMermaid does text.split('\n') -> throws on undefined
  const api = initMermaid(ctx, selection);
  api.applyText();
  assert.deepEqual(calls, ['toast:Parse error']);
});
