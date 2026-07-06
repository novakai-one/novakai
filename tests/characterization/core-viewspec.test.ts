/* =====================================================================
   core-viewspec.test.ts — characterization tests for
   src/core/viewspec/viewspec.ts
   ---------------------------------------------------------------------
   Covers normalizeViewSpec (null/legacy/idempotence/known-filtering) and
   reduceView per action type, incl. the hide->unhide identity case.
   Pure module, no DOM, plain static import. expected values are observed
   behavior, not spec.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeViewSpec, reduceView, emptyViewSpec, type ViewModelIndex } from '../../src/core/viewspec/viewspec.ts';

// ---------------------------------------------------------------------
// normalizeViewSpec
// ---------------------------------------------------------------------

test('normalizeViewSpec: null input -> the fresh-view default (calls layer on)', () => {
  assert.deepEqual(normalizeViewSpec(null), {
    v: 1, expanded: [], hidden: [],
    layers: { calls: true, deps: false, desc: false, iface: false, metrics: false, color: false, trust: false, blast: false },
    sel: null, selWire: null, query: '', stage: null, focusType: null, fmOpen: false,
  });
});

test('normalizeViewSpec: legacy {expanded,hidden,layers} shape migrates field-by-field', () => {
  const out = normalizeViewSpec({ expanded: ['a'], hidden: ['b'], layers: { calls: false, deps: true } });
  assert.deepEqual(out.expanded, ['a']);
  assert.deepEqual(out.hidden, ['b']);
  assert.equal(out.layers.calls, false);
  assert.equal(out.layers.deps, true);
});

test('normalizeViewSpec: is idempotent on a valid v1 spec', () => {
  const full = normalizeViewSpec({
    v: 1, expanded: ['a', 'a'], hidden: ['b'], layers: { calls: true },
    sel: 'a', selWire: { a: 'x', b: 'y' }, query: 'q', stage: 'a', focusType: 'T', fmOpen: true,
  });
  assert.deepEqual(full, {
    v: 1, expanded: ['a'], hidden: ['b'],
    layers: { calls: true, deps: false, desc: false, iface: false, metrics: false, color: false, trust: false, blast: false },
    sel: 'a', selWire: { a: 'x', b: 'y' }, query: 'q', stage: 'a', focusType: 'T', fmOpen: true,
  });
  assert.deepEqual(normalizeViewSpec(full), full);
});

test('normalizeViewSpec: `known` filters ids not in the real model (expanded/hidden/sel/stage/selWire)', () => {
  const out = normalizeViewSpec(
    { expanded: ['a', 'z'], hidden: ['b', 'z'], sel: 'z', stage: 'z', selWire: { a: 'a', b: 'z' } },
    ['a', 'b'],
  );
  assert.deepEqual(out.expanded, ['a']);
  assert.deepEqual(out.hidden, ['b']);
  assert.equal(out.sel, null);
  assert.equal(out.stage, null);
  assert.equal(out.selWire, null);
});

// ---------------------------------------------------------------------
// reduceView
// ---------------------------------------------------------------------

const model: ViewModelIndex = {
  parents: { a: null, b: 'a', c: 'a', d: 'b' },
  children: { a: ['b', 'c'], b: ['d'], c: [], d: [] },
  roots: ['a'],
};

test('reduceView toggleExpand: expanding a childless id (per model.children) is a no-op', () => {
  const s = reduceView(emptyViewSpec(), { type: 'toggleExpand', id: 'c' }, model);
  assert.deepEqual(s.expanded, []);
});

test('reduceView toggleExpand: expand then collapse folds all descendants back out', () => {
  let s = reduceView(emptyViewSpec(), { type: 'toggleExpand', id: 'a' }, model);
  s = reduceView(s, { type: 'toggleExpand', id: 'b' }, model);
  assert.deepEqual(s.expanded, ['a', 'b']);
  s = reduceView(s, { type: 'toggleExpand', id: 'a' }, model);
  assert.deepEqual(s.expanded, []);
});

test('reduceView reveal: unhides the ancestor chain and expands every ancestor above the target', () => {
  let s = reduceView(emptyViewSpec(), { type: 'hide', id: 'b' }, model);
  assert.deepEqual(s.hidden, ['b']);
  s = reduceView(s, { type: 'reveal', id: 'd' }, model);
  assert.deepEqual(s.hidden, []);
  assert.deepEqual(s.expanded, ['b', 'a']);
});

test('reduceView hide->reveal identity: a top-level non-root id round-trips to the original spec', () => {
  const flatModel: ViewModelIndex = { parents: { a: null, e: null }, children: { a: [], e: [] }, roots: ['a'] };
  const start = emptyViewSpec();
  const hidden = reduceView(start, { type: 'hide', id: 'e' }, flatModel);
  const revealed = reduceView(hidden, { type: 'reveal', id: 'e' }, flatModel);
  assert.deepEqual(revealed, start);
});

test('reduceView hide: the last visible root cannot be hidden (guard, no-op)', () => {
  const rootModel: ViewModelIndex = { parents: { r: null }, children: { r: [] }, roots: ['r'] };
  const s = reduceView(emptyViewSpec(), { type: 'hide', id: 'r' }, rootModel);
  assert.deepEqual(s.hidden, []);
});

test('reduceView select: selecting toggles off when the same id is selected again', () => {
  let s = reduceView(emptyViewSpec(), { type: 'select', id: 'a' }, model);
  assert.equal(s.sel, 'a');
  s = reduceView(s, { type: 'select', id: 'a' }, model);
  assert.equal(s.sel, null);
});

test('reduceView selectWire: selecting the same pair again toggles off; sel/focusType/fmOpen clear', () => {
  let s = reduceView(emptyViewSpec(), { type: 'selectWire', a: 'a', b: 'b' }, model);
  assert.deepEqual(s.selWire, { a: 'a', b: 'b' });
  s = reduceView(s, { type: 'selectWire', a: 'a', b: 'b' }, model);
  assert.equal(s.selWire, null);
});

test('reduceView focusType: setting a type clears sel/selWire', () => {
  let s = reduceView(emptyViewSpec(), { type: 'select', id: 'a' }, model);
  s = reduceView(s, { type: 'focusType', t: 'T' }, model);
  assert.equal(s.focusType, 'T');
  assert.equal(s.sel, null);
});

test('reduceView setStage: unknown/absent id in model.parents nulls the stage', () => {
  const s = reduceView(emptyViewSpec(), { type: 'setStage', id: 'not-in-model' }, model);
  assert.equal(s.stage, null);
});

test('reduceView setStage: a real id sets the stage and clears selWire', () => {
  let s = reduceView(emptyViewSpec(), { type: 'selectWire', a: 'a', b: 'b' }, model);
  s = reduceView(s, { type: 'setStage', id: 'a' }, model);
  assert.equal(s.stage, 'a');
  assert.equal(s.selWire, null);
});

test('reduceView toggleLayer: flips a known key, ignores an unknown key', () => {
  let s = reduceView(emptyViewSpec(), { type: 'toggleLayer', key: 'calls' }, model);
  assert.equal(s.layers.calls, false);
  const before = s.layers;
  s = reduceView(s, { type: 'toggleLayer', key: 'bogus' }, model);
  assert.deepEqual(s.layers, before);
});

test('reduceView setQuery / setFmOpen: set the field verbatim', () => {
  let s = reduceView(emptyViewSpec(), { type: 'setQuery', q: 'hello' }, model);
  assert.equal(s.query, 'hello');
  s = reduceView(s, { type: 'setFmOpen', open: true }, model);
  assert.equal(s.fmOpen, true);
});

test('reduceView foldAll: resets every field to the empty spec, even from a fully populated one', () => {
  let s = reduceView(emptyViewSpec(), { type: 'select', id: 'a' }, model);
  s = reduceView(s, { type: 'foldAll' }, model);
  assert.deepEqual(s, emptyViewSpec());
});

test('reduceView: never mutates the input spec (returns a distinct clone)', () => {
  const start = emptyViewSpec();
  const next = reduceView(start, { type: 'setQuery', q: 'x' }, model);
  assert.equal(start.query, '');
  assert.notEqual(next, start);
});
