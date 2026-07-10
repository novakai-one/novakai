/* viewspec.test.mjs — properties of the M3 ViewSpec contract too fiddly for
   the plan's JSON acceptance cases (design contract: docs/novakai/m3-viewspec-design.md).
   Locks: normalizer idempotence on a valid spec, the reducer's never-mutates-
   frozen-input guarantee, select toggle round-trip, hide-clears-sel.
   Run via: node tools/buildspec/testkit/run-bundled-test.mjs tools/buildspec/testkit/viewspec.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyViewSpec, normalizeViewSpec, reduceView } from '../../../src/core/viewspec/viewspec.ts';

const MODEL = {
  parents: { 'g': null, 'a': 'g', 'b': 'g', 'r2': null },
  children: { 'g': ['a', 'b'], 'a': [], 'b': [], 'r2': [] },
  roots: ['g', 'r2'],
};

const freeze = (obj) => {
  Object.freeze(obj);
  for (const val of Object.values(obj)) if (val && typeof val === 'object') freeze(val);
  return obj;
};

// module-scope so the mutation test stays under the per-function line budget
const MUTATION_ACTIONS = [
  { type: 'toggleExpand', id: 'g' },
  { type: 'reveal', id: 'b' },
  { type: 'hide', id: 'a' },
  { type: 'select', id: 'b' },
  { type: 'selectWire', 'a': 'a', 'b': 'b' },
  { type: 'focusType', 't': 'T' },
  { type: 'setStage', id: 'g' },
  { type: 'toggleLayer', key: 'deps' },
  { type: 'setQuery', 'q': 'zz' },
  { type: 'setFmOpen', open: true },
  { type: 'foldAll' },
];

function assertReduceIsPure(before, snapshot, action) {
  const out = reduceView(before, action, MODEL);
  assert.notEqual(out, before, `${action.type} must return a new object`);
  assert.deepEqual(before, snapshot, `${action.type} must not mutate the input`);
}

test('normalizeViewSpec is idempotent on a valid spec', () => {
  const spec = {
    ...emptyViewSpec(),
    expanded: ['g'], hidden: ['b'], sel: 'a',
    selWire: { 'a': 'a', 'b': 'b' }, query: 'x', stage: 'g', focusType: 'T', fmOpen: true,
  };
  const once = normalizeViewSpec(spec, null);
  const twice = normalizeViewSpec(once, null);
  assert.deepEqual(twice, once);
  assert.deepEqual(once, spec);
});

test('reduceView never mutates its (frozen) input', () => {
  const before = freeze({ ...emptyViewSpec(), sel: 'a', expanded: ['g'] });
  const snapshot = JSON.parse(JSON.stringify(before));
  for (const action of MUTATION_ACTIONS) assertReduceIsPure(before, snapshot, action);
});

test('select toggles: same id selects then deselects', () => {
  const selected = reduceView(emptyViewSpec(), { type: 'select', id: 'a' }, MODEL);
  assert.equal(selected.sel, 'a');
  const deselected = reduceView(selected, { type: 'select', id: 'a' }, MODEL);
  assert.equal(deselected.sel, null);
});

test('selectPeek toggles sel2 and never displaces the primary sel', () => {
  const peeked = reduceView({ ...emptyViewSpec(), sel: 'a' }, { type: 'selectPeek', id: 'b' }, MODEL);
  assert.equal(peeked.sel2, 'b');
  assert.equal(peeked.sel, 'a');
  const unpeeked = reduceView(peeked, { type: 'selectPeek', id: 'b' }, MODEL);
  assert.equal(unpeeked.sel2, null);
  assert.equal(unpeeked.sel, 'a');
});

test('hide clears the selection when it hides the selected id (non-last root)', () => {
  const afterHide = reduceView({ ...emptyViewSpec(), sel: 'r2' }, { type: 'hide', id: 'r2' }, MODEL);
  assert.deepEqual(afterHide.hidden, ['r2']);
  assert.equal(afterHide.sel, null);
});

test('setStage on an unknown id normalizes to null (the stageMode guard)', () => {
  const afterSetStage = reduceView(emptyViewSpec(), { type: 'setStage', id: 'ghost' }, MODEL);
  assert.equal(afterSetStage.stage, null);
});
