/* metrics-log.test.mjs — M2b: the emitter's three contract points.
   (1) append shape: one complete JSONL line per call, common fields stamped;
   (2) fail-silent: a broken destination NEVER throws into the caller — the
       gates' fail-open rule extended to telemetry (a metrics bug may not
       change a gate decision);
   (3) NOVAKAI_ROOT seam: the hermetic-fixture pattern every gate test uses
       works unchanged for the log destination. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { recordEvent } from './metrics-log.mjs';

const LOG_REL = join('docs', 'novakai', 'metrics', 'session-log.jsonl');

function readLines(root) {
  return readFileSync(join(root, LOG_REL), 'utf8').split('\n').filter(Boolean);
}

test('append shape: each call appends ONE complete JSONL line with v/ts stamped and fields preserved', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-log-'));
  try {
    recordEvent({ event: 'gate', source: 'edit-gate.mjs', gate: 'edit', decision: 'deny', reason: 'no quiz pass' }, dir);
    recordEvent({ event: 'quiz', source: 'quiz.mjs', cmd: 'check', pass: true, score: '12/12' }, dir);
    const lines = readLines(dir);
    assert.equal(lines.length, 2, 'two calls -> two lines');
    const first = JSON.parse(lines[0]);
    const second = JSON.parse(lines[1]);
    assert.equal(first.v, 1, 'schema version stamped');
    assert.match(first.ts, /^\d{4}-\d{2}-\d{2}T.*Z$/, 'UTC ISO timestamp stamped');
    assert.equal(first.event, 'gate');
    assert.equal(first.gate, 'edit');
    assert.equal(first.decision, 'deny');
    assert.equal(first.session, null, 'session defaults to null when the caller has none');
    assert.equal(second.event, 'quiz');
    assert.equal(second.pass, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('session passes through when the caller provides one (hook payload session_id)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-log-'));
  try {
    recordEvent({ event: 'gate', source: 'plan-gate.mjs', gate: 'plan', decision: 'allow', session: 'sess-abc' }, dir);
    assert.equal(JSON.parse(readLines(dir)[0]).session, 'sess-abc');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('fail-silent: an unwritable destination (docs is a FILE) never throws into the caller', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-log-'));
  try {
    writeFileSync(join(dir, 'docs'), 'a file where the dir should be');
    assert.doesNotThrow(() => {
      recordEvent({ event: 'gate', source: 'edit-gate.mjs', gate: 'edit', decision: 'allow' }, dir);
    }, 'the emitter invariant: logging may never change a gate decision or exit code');
    assert.ok(!existsSync(join(dir, LOG_REL)), 'nothing was written');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('NOVAKAI_ROOT seam: with no explicit root the emitter honors the env var', () => {
  const dir = mkdtempSync(join(tmpdir(), 'metrics-log-'));
  const prev = process.env.NOVAKAI_ROOT;
  try {
    process.env.NOVAKAI_ROOT = dir;
    recordEvent({ event: 'ship', source: 'metrics.mjs', phase: 'start' });
    const line = JSON.parse(readLines(dir)[0]);
    assert.equal(line.event, 'ship');
    assert.equal(line.phase, 'start');
  } finally {
    if (prev === undefined) delete process.env.NOVAKAI_ROOT; else process.env.NOVAKAI_ROOT = prev;
    rmSync(dir, { recursive: true, force: true });
  }
});
