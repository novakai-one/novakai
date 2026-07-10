/* =====================================================================
   ide-contracts.test.ts — characterization tests for
   src/ide/contracts/contract-record.ts (createRecord, nextStatus,
   advance, isValidId, isRecord)
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createRecord,
  nextStatus,
  advance,
  isValidId,
  isRecord,
} from '../../src/ide/contracts/contract-record.ts';
import type { ContractRecord, ContractStatus } from '../../src/ide/contracts/contract-record.ts';

// quoted: 'at'/'to' are short but frozen by the bridge schema (see contract-record.ts
// advance()) — id-length would flag bare keys.
function assertAdvanced(
  record: ContractRecord,
  status: ContractStatus,
  historyLength: number,
  lastEntry: { 'at': string; from: ContractStatus; 'to': ContractStatus },
): void {
  assert.strictEqual(record.status, status);
  assert.strictEqual(record.history.length, historyLength);
  assert.deepStrictEqual(record.history[historyLength - 1], lastEntry);
}

// ---------------------------------------------------------------------
// createRecord
// ---------------------------------------------------------------------

test('createRecord: defaults to draft status, v 1, empty history, refs all null', () => {
  const record = createRecord('c-1', 'My Contract');
  assert.strictEqual(record.v, 1);
  assert.strictEqual(record.id, 'c-1');
  assert.strictEqual(record.title, 'My Contract');
  assert.strictEqual(record.status, 'draft');
  assert.deepStrictEqual(record.history, []);
  assert.deepStrictEqual(record.refs, {
    plan: null, packet: null, verdict: null, design: null, sessionId: null, decision: null,
  });
});

test('createRecord: created and updated stamps match and are valid ISO', () => {
  const record = createRecord('c-2', 'Another');
  assert.strictEqual(record.created, record.updated);
  assert.strictEqual(new Date(record.created).toISOString(), record.created);
});

test('createRecord: partial refs are merged over the null defaults', () => {
  const record = createRecord('c-3', 'Partial', { plan: 'plan.json', decision: 'go' });
  assert.deepStrictEqual(record.refs, {
    plan: 'plan.json', packet: null, verdict: null, design: null, sessionId: null, decision: 'go',
  });
});

// ---------------------------------------------------------------------
// nextStatus — full chain
// ---------------------------------------------------------------------

test('nextStatus: draft -> active', () => {
  assert.strictEqual(nextStatus('draft'), 'active');
});

test('nextStatus: active -> review', () => {
  assert.strictEqual(nextStatus('active'), 'review');
});

test('nextStatus: review -> completed', () => {
  assert.strictEqual(nextStatus('review'), 'completed');
});

test('nextStatus: completed -> null (terminal)', () => {
  assert.strictEqual(nextStatus('completed'), null);
});

// ---------------------------------------------------------------------
// advance
// ---------------------------------------------------------------------

test('advance: walks draft -> active -> review -> completed, appending history each step', () => {
  const draft = createRecord('c-4', 'Chain');
  const active = advance(draft);
  const review = advance(active);
  const completed = advance(review);

  assertAdvanced(active, 'active', 1, { 'at': active.updated, from: 'draft', 'to': 'active' });
  assertAdvanced(review, 'review', 2, { 'at': review.updated, from: 'active', 'to': 'review' });
  assertAdvanced(completed, 'completed', 3, { 'at': completed.updated, from: 'review', 'to': 'completed' });
});

test('advance: does not mutate the original record', () => {
  const draft = createRecord('c-5', 'Immutable');
  const snapshot = JSON.parse(JSON.stringify(draft));
  advance(draft);
  assert.deepStrictEqual(draft, snapshot);
});

test('advance: restamps `updated` on the new record', () => {
  const draft = createRecord('c-6', 'Restamp');
  const active = advance(draft);
  assert.strictEqual(active.updated, active.history[0].at);
  assert.strictEqual(active.created, draft.created);
});

test('advance: throws on a completed contract', () => {
  const draft = createRecord('c-7', 'Terminal');
  const active = advance(draft);
  const review = advance(active);
  const completed = advance(review);
  assert.throws(() => advance(completed), /cannot advance a completed contract \(c-7\)/);
});

// ---------------------------------------------------------------------
// isValidId
// ---------------------------------------------------------------------

test('isValidId: accepts lowercase alphanumeric slugs with hyphens', () => {
  assert.strictEqual(isValidId('c-1'), true);
  assert.strictEqual(isValidId('abc'), true);
  assert.strictEqual(isValidId('9x'), true);
  assert.strictEqual(isValidId('a1-b2-c3'), true);
});

test('isValidId: rejects empty string, leading hyphen, uppercase, and spaces', () => {
  assert.strictEqual(isValidId(''), false);
  assert.strictEqual(isValidId('-abc'), false);
  assert.strictEqual(isValidId('ABC'), false);
  assert.strictEqual(isValidId('a b'), false);
  assert.strictEqual(isValidId('a_b'), false);
});

// ---------------------------------------------------------------------
// isRecord
// ---------------------------------------------------------------------

test('isRecord: accepts a record produced by createRecord', () => {
  assert.strictEqual(isRecord(createRecord('c-8', 'Valid')), true);
});

test('isRecord: accepts a record produced by advance', () => {
  assert.strictEqual(isRecord(advance(createRecord('c-9', 'Advanced'))), true);
});

test('isRecord: rejects non-object values', () => {
  assert.strictEqual(isRecord(null), false);
  assert.strictEqual(isRecord(undefined), false);
  assert.strictEqual(isRecord('c-1'), false);
  assert.strictEqual(isRecord(42), false);
});

test('isRecord: rejects wrong v', () => {
  const record = createRecord('c-10', 'BadV');
  assert.strictEqual(isRecord({ ...record, 'v': 2 }), false);
});

test('isRecord: rejects bad id', () => {
  const record = createRecord('c-11', 'BadId');
  assert.strictEqual(isRecord({ ...record, id: 'Bad Id!' }), false);
});

test('isRecord: rejects bad status', () => {
  const record = createRecord('c-12', 'BadStatus');
  assert.strictEqual(isRecord({ ...record, status: 'archived' }), false);
});

test('isRecord: rejects missing refs', () => {
  const record = createRecord('c-13', 'NoRefs') as Record<string, unknown>;
  const { refs, ...rest } = record;
  assert.strictEqual(isRecord(rest), false);
});

test('isRecord: rejects non-array history', () => {
  const record = createRecord('c-14', 'BadHistory');
  assert.strictEqual(isRecord({ ...record, history: {} }), false);
});
