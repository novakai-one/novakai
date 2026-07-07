/* =====================================================================
   design-loop.test.ts — characterization tests for src/ide/design-loop.ts
   ---------------------------------------------------------------------
   Covers resolvePointer (incl. ~0/~1 unescaping, array indices),
   lintPointers, reviewGroups, groupOf (longest-prefix, segment
   boundary), reviewMark, carryForward, changesPayload, sealOutcome, and
   non-mutation of inputs. Expected values are the spec's acceptance
   cases, verified byte-exact where the spec says so.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePointer, lintPointers, reviewGroups, groupOf, reviewMark,
  carryForward, changesPayload, sealOutcome,
} from '../../src/ide/design-loop.ts';
import type { ReviewState } from '../../src/ide/design-loop.ts';

// ---- resolvePointer ---------------------------------------------------

test('resolvePointer: root pointer "" returns the whole document', () => {
  const doc = { a: 1 };
  assert.equal(resolvePointer(doc, ''), doc);
});

test('resolvePointer: nested object lookup', () => {
  assert.deepEqual(resolvePointer({ tokens: { color: { bg: '#0f1216' } } }, '/tokens/color'), { bg: '#0f1216' });
});

test('resolvePointer: missing leaf returns undefined', () => {
  assert.equal(resolvePointer({ tokens: { color: { bg: '#0f1216' } } }, '/missing/leaf'), undefined);
});

test('resolvePointer: ~1 unescapes to "/"', () => {
  assert.equal(resolvePointer({ 'a/b': 42 }, '/a~1b'), 42);
});

test('resolvePointer: ~0 unescapes to "~"', () => {
  assert.equal(resolvePointer({ 'a~b': 42 }, '/a~0b'), 42);
});

test('resolvePointer: array index resolution', () => {
  assert.equal(resolvePointer({ laws: ['a', 'b'] }, '/laws/1'), 'b');
});

test('resolvePointer: out-of-range array index is undefined', () => {
  assert.equal(resolvePointer({ laws: ['a', 'b'] }, '/laws/5'), undefined);
});

test('resolvePointer: descending into a scalar is undefined', () => {
  assert.equal(resolvePointer({ leaf: 1 }, '/leaf/deeper'), undefined);
});

// ---- lintPointers -------------------------------------------------------

test('lintPointers: returns unresolved subset, original order', () => {
  const contract = { tokens: { color: { bg: '#0f1216' } } };
  assert.deepEqual(lintPointers(['/tokens/color', '/missing/leaf'], contract), ['/missing/leaf']);
});

test('lintPointers: empty object resolves fine (no leaf required)', () => {
  const contract = { tokens: { color: {} } };
  assert.deepEqual(lintPointers(['/tokens/color'], contract), []);
});

// ---- reviewGroups ---------------------------------------------------

test('reviewGroups: second-level for objects, section-level for array/scalar', () => {
  const contract = { meta: { app: 'x' }, tokens: { color: {}, font: {} }, laws: ['a'] };
  assert.deepEqual(reviewGroups(contract), ['/meta/app', '/tokens/color', '/tokens/font', '/laws']);
});

// ---- groupOf ---------------------------------------------------------

test('groupOf: longest matching group wins', () => {
  const groups = ['/tokens', '/tokens/color'];
  assert.equal(groupOf('/tokens/color/bg', groups), '/tokens/color');
});

test('groupOf: exact match counts', () => {
  assert.equal(groupOf('/tokens/color', ['/tokens/color']), '/tokens/color');
});

test('groupOf: rejects same-string-prefix on a different segment', () => {
  assert.equal(groupOf('/tokens/colorX', ['/tokens/color']), null);
});

test('groupOf: null when nothing matches', () => {
  assert.equal(groupOf('/laws', ['/tokens/color']), null);
});

// ---- reviewMark -------------------------------------------------------

test('reviewMark: keep records { state: "kept" } with no comment field', () => {
  const result = reviewMark({}, '/tokens/color', 'keep', '');
  assert.deepEqual(result, { '/tokens/color': { state: 'kept' } });
  assert.equal(Object.hasOwn(result['/tokens/color'], 'comment'), false);
});

test('reviewMark: change with empty comment is a no-op', () => {
  assert.deepEqual(reviewMark({}, '/laws', 'change', ''), {});
});

test('reviewMark: change with a comment records it', () => {
  assert.deepEqual(reviewMark({}, '/laws', 'change', 'too loud'), { '/laws': { state: 'change', comment: 'too loud' } });
});

test('reviewMark: does not mutate the input state', () => {
  const before: ReviewState = { '/a': { state: 'kept' } };
  const snapshot = JSON.parse(JSON.stringify(before));
  reviewMark(before, '/b', 'keep', '');
  assert.deepEqual(before, snapshot);
});

// ---- carryForward -----------------------------------------------------

test('carryForward: kept entry survives an unrelated addition', () => {
  const prev: ReviewState = { '/tokens/color': { state: 'kept' } };
  const prevContract = { tokens: { color: { bg: 1 } } };
  const nextContract = { tokens: { color: { bg: 1 }, font: {} } };
  assert.deepEqual(carryForward(prev, prevContract, nextContract), { '/tokens/color': { state: 'kept' } });
});

test('carryForward: kept entry is dropped when its value changed', () => {
  const prev: ReviewState = { '/tokens/color': { state: 'kept' } };
  const prevContract = { tokens: { color: { bg: 1 } } };
  const nextContract = { tokens: { color: { bg: 2 } } };
  assert.deepEqual(carryForward(prev, prevContract, nextContract), {});
});

test('carryForward: change entries never carry forward', () => {
  const prev: ReviewState = { '/laws': { state: 'change', comment: 'x' } };
  const contract = { laws: ['a'] };
  assert.deepEqual(carryForward(prev, contract, contract), {});
});

test('carryForward: kept entry is dropped when its pointer vanishes', () => {
  const prev: ReviewState = { '/tokens/color': { state: 'kept' } };
  const prevContract = { tokens: { color: { bg: 1 } } };
  const nextContract = { tokens: {} };
  assert.deepEqual(carryForward(prev, prevContract, nextContract), {});
});

test('carryForward: does not mutate prev, prevContract, or nextContract', () => {
  const prev: ReviewState = { '/tokens/color': { state: 'kept' } };
  const prevContract = { tokens: { color: { bg: 1 } } };
  const nextContract = { tokens: { color: { bg: 1 } } };
  const prevSnap = JSON.parse(JSON.stringify(prev));
  const prevContractSnap = JSON.parse(JSON.stringify(prevContract));
  const nextContractSnap = JSON.parse(JSON.stringify(nextContract));
  carryForward(prev, prevContract, nextContract);
  assert.deepEqual(prev, prevSnap);
  assert.deepEqual(prevContract, prevContractSnap);
  assert.deepEqual(nextContract, nextContractSnap);
});

// ---- changesPayload -----------------------------------------------------

test('changesPayload: only change entries, insertion order', () => {
  const state: ReviewState = {
    '/a': { state: 'kept' },
    '/b': { state: 'change', comment: 'first' },
    '/c': { state: 'change', comment: 'second' },
  };
  assert.deepEqual(changesPayload(state), [{ pointer: '/b', comment: 'first' }, { pointer: '/c', comment: 'second' }]);
});

// ---- sealOutcome (byte-exact) -------------------------------------------

test('sealOutcome: kept subtree sorts first at each object level', () => {
  const contract = { tokens: { color: { bg: 1 }, font: { s: 2 } } };
  const result = sealOutcome(contract, ['/tokens/font']);
  assert.equal(result, '{"attested":["/tokens/font"],"tokens":{"font":{"s":2},"color":{"bg":1}}}');
});

test('sealOutcome: kept top-level array key sorts first, arrays serialized as-is', () => {
  const contract = { tokens: { color: { bg: 1 } }, laws: ['a', 'b'] };
  const result = sealOutcome(contract, ['/laws']);
  assert.equal(result, '{"attested":["/laws"],"laws":["a","b"],"tokens":{"color":{"bg":1}}}');
});

test('sealOutcome: does not mutate the input contract', () => {
  const contract = { tokens: { color: { bg: 1 }, font: { s: 2 } } };
  const snapshot = JSON.parse(JSON.stringify(contract));
  sealOutcome(contract, ['/tokens/font']);
  assert.deepEqual(contract, snapshot);
});
