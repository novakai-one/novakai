/* canonical.test.mjs — the determinism primitive must itself be proven, since
   every "100->100" guarantee rests on it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalize, canonicalJSON, sha256hex, hashOf } from './lib/canonical.mjs';

test('canonicalJSON is key-order-independent (the core determinism property)', () => {
  const a = { b: 1, a: 2, c: { y: 1, x: 2 } };
  const b = { c: { x: 2, y: 1 }, a: 2, b: 1 };
  assert.equal(canonicalJSON(a), canonicalJSON(b));
  assert.equal(hashOf(a), hashOf(b));
});

test('arrays keep order (array order is data, not noise)', () => {
  assert.notEqual(canonicalJSON([1, 2, 3]), canonicalJSON([3, 2, 1]));
});

test('canonicalize is idempotent', () => {
  const v = { z: [{ b: 1, a: 2 }], a: 1 };
  assert.equal(canonicalJSON(canonicalize(v)), canonicalJSON(v));
});

test('different data -> different hash', () => {
  assert.notEqual(hashOf({ a: 1 }), hashOf({ a: 2 }));
});

test('sha256hex is stable and 64 hex chars', () => {
  const h = sha256hex('flowmap');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, sha256hex('flowmap'));
});
