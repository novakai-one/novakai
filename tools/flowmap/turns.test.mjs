/* turns.test.mjs — M10 MEASURE: turn-discipline metrics over session
   transcripts, via the real spawned CLI against hermetic tmp fixtures
   (the metrics.mjs/gate-test pattern: --dir / FLOWMAP_ROOT test seams,
   never the live ~/.claude/projects data). Locks the parsing contract
   (dedupe by message.id — a transcript re-emits the same id per content
   block), the batchRatio/tokensToFirstSrcEdit math, malformed-line
   tolerance, and the n/a-on-absent-dir / check pass-fail exit contract. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const CLI = join('tools', 'flowmap', 'turns.mjs');

function cli(args, env = {}) {
  const r = spawnSync('node', [CLI, ...args], {
    cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env },
  });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

let n = 0;
function toolUse(name, input) { return { type: 'tool_use', id: `toolu_${n++}`, name, input: input ?? {} }; }
function usage({ input = 0, cacheRead = 0, cacheCreate = 0, output = 0 } = {}) {
  return { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate, output_tokens: output };
}
function assistantLine(id, u, content) {
  return JSON.stringify({ type: 'assistant', message: { id, usage: u, content } });
}

function mkfile(dir, name, lines) {
  writeFileSync(join(dir, name), lines.join('\n') + '\n');
}
function mktmp() { return mkdtempSync(join(tmpdir(), 'turns-')); }

test('dedupe by message.id: 3 lines, same id, 1 tool_use each (distinct tool ids) => 1 apiCall, 3 toolUses', () => {
  const dir = mktmp();
  try {
    const u = usage({ cacheRead: 100 });
    const file = join(dir, 't.jsonl');
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', u, [toolUse('Read', { file_path: 'a.ts' })]),
      assistantLine('msg_1', u, [toolUse('Read', { file_path: 'b.ts' })]),
      assistantLine('msg_1', u, [toolUse('Read', { file_path: 'c.ts' })]),
    ]);
    const r = cli(['check', '--file', file, '--json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metrics.apiCalls, 1);
    assert.equal(out.metrics.toolCalls, 3);
    assert.equal(out.metrics.callsWithTools, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('batchRatio math: toolCalls / callsWithTools, 2dp', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', usage(), [toolUse('Read', { file_path: 'a.ts' })]),
      assistantLine('msg_2', usage(), [toolUse('Read', {}), toolUse('Grep', {}), toolUse('Glob', {})]),
    ]);
    const r = cli(['check', '--file', file, '--json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metrics.toolCalls, 4);
    assert.equal(out.metrics.callsWithTools, 2);
    assert.equal(out.metrics.batchRatio, 2.0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('subagent_tokens: sums every /subagent_tokens: (\\d+)/ match anywhere in the raw lines', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', usage(), [toolUse('Agent', {})]),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'subagent_tokens: 22017 done' }] } }),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'subagent_tokens: 883 done' }] } }),
    ]);
    const r = cli(['check', '--file', file, '--json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metrics.subagentTokens, 22017 + 883);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('subagent_tokens XML task-notification form: <subagent_tokens>N</subagent_tokens> counts', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    const notification = (id, tokens) =>
      `<task-notification>\n<task-id>t1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n` +
      `<result>done</result>\n<usage><subagent_tokens>${tokens}</subagent_tokens><tool_uses>2</tool_uses></usage>\n</task-notification>`;
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', usage(), [toolUse('Read', {})]),
      JSON.stringify({ type: 'user', message: { content: notification('toolu_a', 1000) } }),
    ]);
    const r = cli(['check', '--file', file, '--json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metrics.subagentTokens, 1000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('subagent_tokens XML form: the harness writes the same notification twice (enqueue + delivery) — counted once', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    const notification = (id, tokens) =>
      `<task-notification>\n<task-id>t1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>completed</status>\n` +
      `<result>done</result>\n<usage><subagent_tokens>${tokens}</subagent_tokens><tool_uses>2</tool_uses></usage>\n</task-notification>`;
    mkfile(dir, 't.jsonl', [
      JSON.stringify({ type: 'queue-operation', operation: 'enqueue', content: notification('toolu_a', 36422) }),
      JSON.stringify({ type: 'user', message: { content: notification('toolu_a', 36422) } }),
      // a second, distinct spawn must still add on top of the deduped first one
      JSON.stringify({ type: 'user', message: { content: notification('toolu_b', 29143) } }),
    ]);
    const r = cli(['check', '--file', file, '--json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metrics.subagentTokens, 36422 + 29143);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('subagent_tokens: legacy colon form still counts (back-compat with pre-2026-07 transcripts)', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', usage(), [toolUse('Agent', {})]),
      JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', content: 'subagent_tokens: 500 done' }] } }),
    ]);
    const r = cli(['check', '--file', file, '--json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metrics.subagentTokens, 500);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tokensToFirstSrcEdit: cumulative context tokens through the call that first Edits a /src/ path', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    // call1: no edit, context = 10 (input) + 20 (cacheRead) + 5 (cacheCreate) = 35
    // call2: Edits /src/ -> context = 3 + 40 + 7 = 50 -> cumulative 85
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', usage({ input: 10, cacheRead: 20, cacheCreate: 5 }), [toolUse('Read', { file_path: 'docs/x.md' })]),
      assistantLine('msg_2', usage({ input: 3, cacheRead: 40, cacheCreate: 7 }), [toolUse('Edit', { file_path: '/repo/src/main.ts' })]),
      assistantLine('msg_3', usage({ input: 999, cacheRead: 999, cacheCreate: 999 }), [toolUse('Read', { file_path: 'docs/y.md' })]),
    ]);
    const r = cli(['check', '--file', file, '--json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metrics.tokensToFirstSrcEdit, 35 + 50);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('tokensToFirstSrcEdit is null when no call ever edits a /src/ path', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', usage({ input: 1 }), [toolUse('Read', { file_path: 'docs/x.md' })]),
      assistantLine('msg_2', usage({ input: 1 }), [toolUse('Edit', { file_path: 'docs/notes.md' })]),
    ]);
    const r = cli(['check', '--file', file, '--json']);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metrics.tokensToFirstSrcEdit, null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('malformed lines are skipped and counted, never fatal', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', usage(), [toolUse('Read', {})]),
      '{"torn line that never finishes',
      'not json at all',
      assistantLine('msg_2', usage(), [toolUse('Read', {}), toolUse('Grep', {}), toolUse('Glob', {})]),
    ]);
    const r = cli(['check', '--file', file, '--json']);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.metrics.malformed, 2);
    assert.equal(out.metrics.apiCalls, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('summary: absent transcript dir => n/a, exit 0', () => {
  const dir = mktmp();
  try {
    const missing = join(dir, 'nope');
    const r = cli(['summary', '--json', '--dir', missing]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.absent, true);
    assert.equal(out.sessions.length, 0);
    const human = cli(['summary', '--dir', missing]);
    assert.equal(human.status, 0);
    assert.match(human.stdout, /n\/a/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('summary: a real transcript dir produces a session row + medians', () => {
  const dir = mktmp();
  try {
    mkfile(dir, 'sess-abc123.jsonl', [
      assistantLine('msg_1', usage({ cacheRead: 100 }), [toolUse('Read', {}), toolUse('Grep', {})]),
    ]);
    const r = cli(['summary', '--json', '--dir', dir]);
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.sessions.length, 1);
    assert.equal(out.sessions[0].batchRatio, 2);
    assert.equal(out.medians.batchRatio, 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check: exit 0 on a passing fixture (batchRatio >= 2.0)', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', usage(), [toolUse('Read', {}), toolUse('Grep', {})]),
    ]);
    const r = cli(['check', '--file', file]);
    assert.equal(r.status, 0, r.stdout + r.stderr);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check: exit 1 on a failing fixture, and the failing metric is named in output', () => {
  const dir = mktmp();
  try {
    const file = join(dir, 't.jsonl');
    mkfile(dir, 't.jsonl', [
      assistantLine('msg_1', usage(), [toolUse('Read', {})]), // batchRatio 1.0 < 2.0
    ]);
    const r = cli(['check', '--file', file]);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /batch ratio/i);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
