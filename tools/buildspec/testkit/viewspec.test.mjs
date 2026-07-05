/* viewspec.test.mjs — properties of the M3 ViewSpec contract too fiddly for
   the plan's JSON acceptance cases (design contract: docs/novakai/m3-viewspec-design.md).
   Locks: normalizer idempotence on a valid spec, the reducer's never-mutates-
   frozen-input guarantee, select toggle round-trip, hide-clears-sel.
   Run via: node tools/buildspec/testkit/run-bundled-test.mjs tools/buildspec/testkit/viewspec.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyViewSpec, normalizeViewSpec, reduceView } from '../../../src/core/viewspec/viewspec.ts';

const MODEL = {
  parents: { g: null, a: 'g', b: 'g', r2: null },
  children: { g: ['a', 'b'], a: [], b: [], r2: [] },
  roots: ['g', 'r2'],
};

const freeze = (o) => {
  Object.freeze(o);
  for (const v of Object.values(o)) if (v && typeof v === 'object') freeze(v);
  return o;
};

test('normalizeViewSpec is idempotent on a valid spec', () => {
  const s = {
    ...emptyViewSpec(),
    expanded: ['g'], hidden: ['b'], sel: 'a',
    selWire: { a: 'a', b: 'b' }, query: 'x', stage: 'g', focusType: 'T', fmOpen: true,
  };
  const once = normalizeViewSpec(s, null);
  const twice = normalizeViewSpec(once, null);
  assert.deepEqual(twice, once);
  assert.deepEqual(once, s);
});

test('reduceView never mutates its (frozen) input', () => {
  const before = freeze({ ...emptyViewSpec(), sel: 'a', expanded: ['g'] });
  const snapshot = JSON.parse(JSON.stringify(before));
  for (const action of [
    { type: 'toggleExpand', id: 'g' },
    { type: 'reveal', id: 'b' },
    { type: 'hide', id: 'a' },
    { type: 'select', id: 'b' },
    { type: 'selectWire', a: 'a', b: 'b' },
    { type: 'focusType', t: 'T' },
    { type: 'setStage', id: 'g' },
    { type: 'toggleLayer', key: 'deps' },
    { type: 'setQuery', q: 'zz' },
    { type: 'setFmOpen', open: true },
    { type: 'foldAll' },
  ]) {
    const out = reduceView(before, action, MODEL);
    assert.notEqual(out, before, `${action.type} must return a new object`);
    assert.deepEqual(before, snapshot, `${action.type} must not mutate the input`);
  }
});

test('select toggles: same id selects then deselects', () => {
  const s1 = reduceView(emptyViewSpec(), { type: 'select', id: 'a' }, MODEL);
  assert.equal(s1.sel, 'a');
  const s2 = reduceView(s1, { type: 'select', id: 'a' }, MODEL);
  assert.equal(s2.sel, null);
});

test('hide clears the selection when it hides the selected id (non-last root)', () => {
  const s1 = reduceView({ ...emptyViewSpec(), sel: 'r2' }, { type: 'hide', id: 'r2' }, MODEL);
  assert.deepEqual(s1.hidden, ['r2']);
  assert.equal(s1.sel, null);
});

test('setStage on an unknown id normalizes to null (the stageMode guard)', () => {
  const s1 = reduceView(emptyViewSpec(), { type: 'setStage', id: 'ghost' }, MODEL);
  assert.equal(s1.stage, null);
});
