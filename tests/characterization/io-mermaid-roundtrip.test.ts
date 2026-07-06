/* =====================================================================
   io-mermaid-roundtrip.test.ts — property test for src/io/mermaid.ts
   ---------------------------------------------------------------------
   Oracle-based (not observed-value characterization): for each literal
   model below, toMermaid() -> fromMermaid() -> semanticDiff(original,
   round-tripped) must report zero issues (src/core/validate/validate.ts's
   own definition of a lossless round-trip). makeCtx copies io-mermaid.
   test.ts's fake-ctx pattern.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initMermaid, fromMermaid } from '../../src/io/mermaid.ts';
import { semanticDiff } from '../../src/core/validate/validate.ts';

function makeCtx(state: any): any {
  return { state, dom: { mmd: { value: '' } }, hooks: { toast() {}, render() {}, pushHistory() {} } };
}
const selection = { clearSel: () => {} } as any;

function assertRoundtripsClean(state: any): void {
  const api = initMermaid(makeCtx(state), selection);
  const after = fromMermaid(api.toMermaid());
  assert.deepEqual(semanticDiff(state, after), []);
}

test('roundtrip: plain nodes + labelled edge', () => {
  assertRoundtripsClean({
    dir: 'TD',
    nodes: {
      n1: { id: 'n1', label: 'One', shape: 'rect', color: null, x: 10, y: 20, w: 160, h: 56 },
      n2: { id: 'n2', label: 'Two', shape: 'round', color: null, x: 200, y: 20, w: 160, h: 56 },
    },
    edges: [{ id: 'e1', from: 'n1', to: 'n2', label: 'goes', style: 'solid', routing: 'straight' }],
    roots: [], hier: { groups: {}, memberOf: {} },
  });
});

test('roundtrip: group/subgraph containment + ortho edge with bend/labelPos', () => {
  assertRoundtripsClean({
    dir: 'TD',
    nodes: {
      g1: { id: 'g1', label: 'Group', shape: 'group', color: null, x: 0, y: 0, w: 300, h: 200 },
      n1: { id: 'n1', label: 'Child', shape: 'rect', color: null, x: 10, y: 10, w: 100, h: 40, parent: 'g1' },
      n2: { id: 'n2', label: 'Outside', shape: 'diamond', color: null, x: 400, y: 10, w: 150, h: 88 },
    },
    edges: [{
      id: 'e1', from: 'n1', to: 'n2', label: '', style: 'dotted', routing: 'ortho',
      bend: { x: 1, y: 2 }, labelPos: { x: 3, y: 4 },
    }],
    roots: [], hier: { groups: { g1: { id: 'g1', label: 'Group', parent: null } }, memberOf: { n1: 'g1' } },
  });
});

test('roundtrip: frontmatter-rich node (name/desc/state/interface) + declared root', () => {
  assertRoundtripsClean({
    dir: 'TD',
    nodes: {
      n1: {
        id: 'n1', label: 'Store', shape: 'rect', color: null, x: 0, y: 0, w: 160, h: 56,
        fm: {
          name: 'Store', description: 'central store', state: ['count: number'],
          interfaces: [{ name: 'dispatch', accepts: ['action: Action'], returns: ['void'] }],
        },
      },
    },
    edges: [], roots: ['n1'], hier: { groups: {}, memberOf: {} },
  });
});

test('roundtrip: LR direction + thick edge style', () => {
  assertRoundtripsClean({
    dir: 'LR',
    nodes: {
      n1: { id: 'n1', label: 'A', shape: 'rect', color: null, x: 0, y: 0, w: 160, h: 56 },
      n2: { id: 'n2', label: 'B', shape: 'rect', color: null, x: 300, y: 0, w: 160, h: 56 },
    },
    edges: [{ id: 'e1', from: 'n1', to: 'n2', label: '', style: 'thick', routing: 'straight' }],
    roots: [], hier: { groups: {}, memberOf: {} },
  });
});

test('roundtrip: semantic kind + custom color survive (fm-independent node fields)', () => {
  assertRoundtripsClean({
    dir: 'TD',
    nodes: {
      n1: { id: 'n1', label: 'Svc', shape: 'hex', color: '#ff8800', kind: 'service', x: 0, y: 0, w: 160, h: 56 },
    },
    edges: [], roots: [], hier: { groups: {}, memberOf: {} },
  });
});
