/* scope.test.mjs — the editScope decision primitive: match table (allow/warn/
   deny incl. FROZEN precedence over allow), normalization. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FROZEN, matchScope } from './scope.mjs';

const editScope = { allow: ['src/core/state/state.ts', 'tools/novakai/lib/scope.mjs'], deny: FROZEN };

test('a file inside allow -> allow', () => {
  assert.equal(matchScope('src/core/state/state.ts', editScope), 'allow');
});

test('a file outside allow and outside deny -> warn (not block)', () => {
  assert.equal(matchScope('src/core/camera/camera.ts', editScope), 'warn');
});

test('a file matching a FROZEN glob -> deny', () => {
  assert.equal(matchScope('tools/novakai/gates/edit-gate.mjs', editScope), 'deny');
});

test('an exact FROZEN path -> deny', () => {
  assert.equal(matchScope('.claude/settings.json', editScope), 'deny');
  assert.equal(matchScope('src/main.ts', editScope), 'deny');
});

test('FROZEN wins even when the same path is also in allow (deny beats allow)', () => {
  const scope = { allow: ['src/main.ts'], deny: FROZEN };
  assert.equal(matchScope('src/main.ts', scope), 'deny');
});

test('paths are normalized: leading ./, backslashes, and leading / all match the same', () => {
  assert.equal(matchScope('./src/core/state/state.ts', editScope), 'allow');
  assert.equal(matchScope('src\\core\\state\\state.ts', editScope), 'allow');
  assert.equal(matchScope('/src/core/state/state.ts', editScope), 'allow');
});

test('missing allow/deny arrays default to warn, not a throw', () => {
  assert.equal(matchScope('anything.ts', {}), 'warn');
  assert.equal(matchScope('anything.ts', undefined), 'warn');
});

test('empty editScope with no allow entries still denies FROZEN', () => {
  assert.equal(matchScope('src/ide/shell.ts', { allow: [], deny: FROZEN }), 'deny');
});
