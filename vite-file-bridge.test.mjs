// vite-file-bridge.test.mjs — plain `node --test`. Pure-function coverage
// only: no dev server, no sockets, no disk writes.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { safeName, designPath } from './vite-file-bridge.mjs';

test('safeName accepts alphanumeric/underscore/hyphen names', () => {
  assert.equal(safeName('abc'), 'abc');
  assert.equal(safeName('a_b-1'), 'a_b-1');
});

test('safeName rejects everything else', () => {
  assert.equal(safeName(''), null);
  assert.equal(safeName('a/b'), null);
  assert.equal(safeName('a.b'), null);
  assert.equal(safeName('..'), null);
  assert.equal(safeName('/abs'), null);
  assert.equal(safeName('a b'), null);
  assert.equal(safeName(undefined), null);
  assert.equal(safeName(123), null);
});

const designsDir = resolve(process.cwd(), 'designs');

test('designPath resolves a valid name inside designsDir', () => {
  const p = designPath(designsDir, 'ok');
  assert.equal(p, resolve(designsDir, 'ok.design.mmd'));
  assert.ok(p.startsWith(designsDir + '/'));
});

test('designPath rejects traversal attempts', () => {
  assert.equal(designPath(designsDir, '..'), null);
  assert.equal(designPath(designsDir, '../evil'), null);
});

test('designPath rejects any name containing / or .. — a sibling like designs-evil is unreachable', () => {
  assert.equal(designPath(designsDir, '../designs-evil/x'), null);
  assert.equal(designPath(designsDir, 'a/../../designs-evil'), null);
  assert.equal(designPath(designsDir, 'a/b'), null);
});
