/* canonical.test.mjs — the determinism primitive must itself be proven, since
   every "100->100" guarantee rests on it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, canonicalJSON, sha256hex, hashOf } from './canonical.mjs';

test('canonicalJSON is key-order-independent (the core determinism property)', () => {
  const orderOne = { beta: 1, alpha: 2, gamma: { y: 1, x: 2 } };
  const orderTwo = { gamma: { x: 2, y: 1 }, alpha: 2, beta: 1 };
  assert.equal(canonicalJSON(orderOne), canonicalJSON(orderTwo));
  assert.equal(hashOf(orderOne), hashOf(orderTwo));
});

test('arrays keep order (array order is data, not noise)', () => {
  assert.notEqual(canonicalJSON([1, 2, 3]), canonicalJSON([3, 2, 1]));
});

test('canonicalize is idempotent', () => {
  const sample = { list: [{ first: 1, second: 2 }], count: 1 };
  assert.equal(canonicalJSON(canonicalize(sample)), canonicalJSON(sample));
});

test('different data -> different hash', () => {
  assert.notEqual(hashOf({ num: 1 }), hashOf({ num: 2 }));
});

test('sha256hex is stable and 64 hex chars', () => {
  const digest = sha256hex('novakai');
  assert.match(digest, /^[0-9a-f]{64}$/);
  assert.equal(digest, sha256hex('novakai'));
});
