// vite-agent-bridge.test.mjs — plain `node --test`. Pure-function coverage
// only: no spawned `claude`, no sockets, no dev server. Registry/session
// fixtures live under a tmp dir per node:test convention.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SPAWN_ARGS,
  slugFor,
  frameUserLine,
  parseSessionLines,
  validHistoryId,
  sessionIdsForCwd,
  appendSessionToRegistry,
} from './vite-agent-bridge.mjs';

test('SPAWN_ARGS carries the load-bearing flags', () => {
  assert.deepEqual(SPAWN_ARGS, [
    '-p',
    '--input-format', 'stream-json',
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
    '--permission-mode', 'acceptEdits',
  ]);
});

test('slugFor replaces every non-alphanumeric char with a hyphen', () => {
  assert.equal(slugFor('/Users/chris/Programming/novakai'), '-Users-chris-Programming-novakai');
  assert.equal(slugFor('C:\\repo'), 'C--repo');
});

test('frameUserLine emits one discrete JSON line, newline-terminated', () => {
  const line = frameUserLine('hello world');
  assert.ok(line.endsWith('\n'));
  const obj = JSON.parse(line.trimEnd());
  assert.deepEqual(obj, {
    type: 'user',
    message: { role: 'user', content: 'hello world' },
    parent_tool_use_id: null,
  });
});

test('validHistoryId only accepts an id present in the known list', () => {
  const known = ['abc-123', 'def-456'];
  assert.equal(validHistoryId('abc-123', known), true);
  assert.equal(validHistoryId('../../etc/passwd', known), false);
  assert.equal(validHistoryId('unknown-id', known), false);
  assert.equal(validHistoryId('', known), false);
  assert.equal(validHistoryId(undefined, known), false);
});

test('sessionIdsForCwd / appendSessionToRegistry filter by exact cwd key', () => {
  let reg = {};
  reg = appendSessionToRegistry(reg, '/repo/a', 's1');
  reg = appendSessionToRegistry(reg, '/repo/a', 's2');
  reg = appendSessionToRegistry(reg, '/repo/b', 's3');
  assert.deepEqual(sessionIdsForCwd(reg, '/repo/a'), ['s1', 's2']);
  assert.deepEqual(sessionIdsForCwd(reg, '/repo/b'), ['s3']);
  assert.deepEqual(sessionIdsForCwd(reg, '/repo/unknown'), []);
});

test('appendSessionToRegistry is idempotent for a repeat session id', () => {
  let reg = appendSessionToRegistry({}, '/repo/a', 's1');
  reg = appendSessionToRegistry(reg, '/repo/a', 's1');
  assert.deepEqual(sessionIdsForCwd(reg, '/repo/a'), ['s1']);
});

// --- parseSessionLines: fixture .jsonl files in a tmp dir -----------------

function withFixture(lines, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'novakai-bridge-test-'));
  const file = join(dir, 'session.jsonl');
  writeFileSync(file, lines.map((o) => JSON.stringify(o)).join('\n') + '\n');
  try {
    return fn(file);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('parseSessionLines takes title/ts from the first non-sidechain user line', () => {
  withFixture(
    [
      { type: 'summary' },
      { type: 'user', isSidechain: true, message: { role: 'user', content: 'orchestration noise' }, timestamp: 't0' },
      { type: 'user', isSidechain: false, message: { role: 'user', content: 'fix the bridge' }, timestamp: '2026-07-08T00:00:00Z' },
      { type: 'assistant', isSidechain: false, message: { role: 'assistant', content: [{ type: 'text', text: 'ok' }] }, timestamp: '2026-07-08T00:00:01Z' },
    ],
    (file) => {
      const { title, ts, messages } = parseSessionLines(readFile(file));
      assert.equal(title, 'fix the bridge');
      assert.equal(ts, '2026-07-08T00:00:00Z');
      assert.equal(messages.length, 2); // the sidechain line is dropped
      assert.equal(messages[0].content, 'fix the bridge');
      assert.deepEqual(messages[1].content, [{ type: 'text', text: 'ok' }]);
    },
  );
});

test('parseSessionLines ignores malformed lines and non-message types', () => {
  withFixture(
    [
      { type: 'mode' },
      { type: 'user', message: { role: 'user', content: 'hi' }, timestamp: 't1' },
    ],
    (file) => {
      const raw = readFile(file) + 'not json at all\n';
      const { title, messages } = parseSessionLines(raw);
      assert.equal(title, 'hi');
      assert.equal(messages.length, 1);
    },
  );
});

test('parseSessionLines with no user lines yields an empty title', () => {
  withFixture([{ type: 'summary' }], (file) => {
    const { title, ts, messages } = parseSessionLines(readFile(file));
    assert.equal(title, '');
    assert.equal(ts, '');
    assert.deepEqual(messages, []);
  });
});

function readFile(p) {
  return readFileSync(p, 'utf8');
}
