/* =====================================================================
   slice-core.test.mjs — node --test suite for slice-core.mjs
   Run: node --test tools/buildspec/core/slice-core.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseMmd, toMmd } from './mmd-parse.mjs';
import { sliceModel, filterBodies } from './slice-core.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BUNDLE = join(HERE, '..', '..', '..', 'docs', 'novakai', '_bundle.mmd');

// ---- fixtures -----------------------------------------------------------

/**
 * Minimal inline model for deterministic unit tests.
 * Nodes: A --solid--> B --solid--> C, A -.dotted.-> D, unrelated E
 * Expected: sliceModel(['A'], {down:true}) = {A, B, C}; refs adds D.
 */
const INLINE_MMD = `flowchart TD
%% root A
%% kind A function
%% kind B function
%% kind C function
%% kind D function
%% kind E function
  A["A"]
  B["B"]
  C["C"]
  D["D"]
  E["E"]
  A --> B
  B --> C
  A -.-> D
`;

// ---- unit tests (inline fixture) ----------------------------------------

test('sliceModel: seed only (no opts) returns exactly the seed', () => {
  const model = parseMmd(INLINE_MMD);
  const slice = sliceModel(model, ['A']);
  assert.deepEqual(Object.keys(slice.nodes).sort(), ['A']);
  assert.equal(slice.edges.length, 0);
});

test('sliceModel: down traverses solid edges transitively', () => {
  const model = parseMmd(INLINE_MMD);
  const slice = sliceModel(model, ['A'], { down: true });
  assert.deepEqual(Object.keys(slice.nodes).sort(), ['A', 'B', 'C']);
  // All solid edges between A,B,C are kept
  assert.equal(slice.edges.length, 2);
  assert.ok(slice.edges.every((e) => e.style === 'solid'));
});

test('sliceModel: up traverses solid edges to ancestors', () => {
  const model = parseMmd(INLINE_MMD);
  const slice = sliceModel(model, ['C'], { up: true });
  assert.deepEqual(Object.keys(slice.nodes).sort(), ['A', 'B', 'C']);
});

test('sliceModel: refs adds 1-hop dotted neighbours of seed, not their descendants', () => {
  const model = parseMmd(INLINE_MMD);
  const slice = sliceModel(model, ['A'], { refs: true });
  // seed=A, refs→D (dotted neighbour). No solid walk.
  assert.deepEqual(Object.keys(slice.nodes).sort(), ['A', 'D']);
});

test('sliceModel: down + refs combines correctly', () => {
  const model = parseMmd(INLINE_MMD);
  const slice = sliceModel(model, ['A'], { down: true, refs: true });
  assert.deepEqual(Object.keys(slice.nodes).sort(), ['A', 'B', 'C', 'D']);
});

test('sliceModel: unrelated node E is always excluded', () => {
  const model = parseMmd(INLINE_MMD);
  for (const opts of [{}, { down: true }, { up: true }, { refs: true }, { down: true, refs: true }]) {
    const slice = sliceModel(model, ['A'], opts);
    assert.ok(!slice.nodes['E'], `E should not appear with opts ${JSON.stringify(opts)}`);
  }
});

test('sliceModel: no edge references a node absent from keep set', () => {
  const model = parseMmd(INLINE_MMD);
  for (const opts of [{}, { down: true }, { up: true }, { refs: true }, { down: true, refs: true }]) {
    const slice = sliceModel(model, ['A'], opts);
    const ids = new Set(Object.keys(slice.nodes));
    for (const e of slice.edges) {
      assert.ok(ids.has(e.from), `edge from ${e.from} not in keep set`);
      assert.ok(ids.has(e.to), `edge to ${e.to} not in keep set`);
    }
  }
});

test('sliceModel: round-trip parseMmd(toMmd(slice)) equals slice', () => {
  const model = parseMmd(INLINE_MMD);
  const slice = sliceModel(model, ['A'], { down: true, refs: true });
  const rt = parseMmd(toMmd(slice));
  // nodes, edges and fm should survive the round-trip
  assert.deepEqual(Object.keys(rt.nodes).sort(), Object.keys(slice.nodes).sort());
  assert.equal(rt.edges.length, slice.edges.length);
});

test('sliceModel: non-existent seed ids are silently ignored', () => {
  const model = parseMmd(INLINE_MMD);
  const slice = sliceModel(model, ['NONEXISTENT', 'A'], { down: true });
  // Should behave as if seed is just ['A']
  assert.ok('A' in slice.nodes);
  assert.ok(!('NONEXISTENT' in slice.nodes));
});

// ---- filterBodies -------------------------------------------------------

test('filterBodies: keeps only entries in keepIds', () => {
  const bodies = new Map([
    ['camera__zoomToFit', { kind: 'function', body: 'fn body' }],
    ['render__render', { kind: 'function', body: 'render body' }],
    ['history__undo', { kind: 'function', body: 'undo body' }],
  ]);
  const keep = new Set(['camera__zoomToFit', 'history__undo']);
  const out = filterBodies(bodies, keep);
  assert.equal(out.size, 2);
  assert.ok(out.has('camera__zoomToFit'));
  assert.ok(out.has('history__undo'));
  assert.ok(!out.has('render__render'));
});

test('filterBodies: empty keepIds returns empty map', () => {
  const bodies = new Map([['a', {}], ['b', {}]]);
  assert.equal(filterBodies(bodies, new Set()).size, 0);
});

// ---- bundle integration tests -------------------------------------------

test('bundle: sliceModel on _bundle.mmd produces valid keep set for history__undo (down)', () => {
  const model = parseMmd(readFileSync(BUNDLE, 'utf8'));
  // history__undo --solid--> history__restore, history__undo --solid--> history__updateUndoButtons
  const slice = sliceModel(model, ['history__undo'], { down: true });
  const ids = Object.keys(slice.nodes);
  assert.ok(ids.includes('history__undo'), 'seed must be in keep');
  assert.ok(ids.includes('history__restore'), 'solid child restore must be in keep');
  assert.ok(ids.includes('history__updateUndoButtons'), 'solid child updateUndoButtons must be in keep');
  // Unrelated nodes excluded
  assert.ok(!ids.includes('render__render'), 'unrelated node must be excluded');
  assert.ok(!ids.includes('camera__zoomToFit'), 'unrelated node must be excluded');
});

test('bundle: edge integrity holds on real bundle slice', () => {
  const model = parseMmd(readFileSync(BUNDLE, 'utf8'));
  const slice = sliceModel(model, ['history__undo'], { down: true, up: true, refs: true });
  const ids = new Set(Object.keys(slice.nodes));
  for (const e of slice.edges) {
    assert.ok(ids.has(e.from), `edge from ${e.from} missing from keep`);
    assert.ok(ids.has(e.to), `edge to ${e.to} missing from keep`);
  }
});

test('bundle: token budget — slice of one node + down is well under 4k tokens', () => {
  const model = parseMmd(readFileSync(BUNDLE, 'utf8'));
  const slice = sliceModel(model, ['history__undo'], { down: true });
  const text = toMmd(slice);
  // 4k tokens ≈ 16000 chars (4 chars/token conservative estimate)
  assert.ok(text.length < 16000, `slice text ${text.length} chars exceeds 16k`);
  // Tighter: serialized text of a tiny subgraph should be tiny
  assert.ok(text.length < 2000, `expected < 2000 chars, got ${text.length}`);
});

test('bundle: round-trip on real bundle slice is lossless', () => {
  const model = parseMmd(readFileSync(BUNDLE, 'utf8'));
  const slice = sliceModel(model, ['history__undo'], { down: true, refs: true });
  const rt = parseMmd(toMmd(slice));
  assert.deepEqual(Object.keys(rt.nodes).sort(), Object.keys(slice.nodes).sort());
  assert.equal(rt.edges.length, slice.edges.length);
});
