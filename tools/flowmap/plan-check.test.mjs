#!/usr/bin/env node
/* plan-check.test.mjs — unit tests for C3: plan coherence checker */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkPlan } from './plan-check.mjs';

// A small fake base-map node id set — does NOT depend on public/plan.json
const BASE = new Set(['camera', 'render', 'navigator', 'inspector', 'types', 'state']);

// ── (a) fully coherent plan → 0 problems ──────────────────────────────────
test('(a) fully coherent plan → 0 problems', () => {
  const plan = {
    changes: [
      { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'camera' } },
      {
        id: 'c2', status: 'add',
        target: { kind: 'node', ref: 'newModule' },
        newNode: { label: 'newModule', kind: 'module', parent: null },
      },
      {
        id: 'c3', status: 'modify',
        target: { kind: 'node', ref: 'render' },
        dependsOn: ['c1'],
      },
      {
        id: 'e1', status: 'add',
        target: { kind: 'edge', ref: 'newModule->camera:dotted' },
        newEdge: { from: 'newModule', to: 'camera', style: 'dotted' },
        dependsOn: ['c2'],
      },
    ],
  };
  const { problems, stats } = checkPlan({ mapNodeIds: BASE, plan });
  assert.equal(problems.length, 0, `expected 0 problems, got: ${problems.join('; ')}`);
  assert.equal(stats.changes, 4);
  assert.equal(stats.depsChecked, 2);
});

// ── (b) modify targeting a missing node → REAL-IDS ────────────────────────
test('(b) modify targeting missing node → REAL-IDS problem', () => {
  const plan = {
    changes: [
      { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'nonexistent' } },
    ],
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(problems.length > 0, 'expected at least one problem');
  assert.ok(
    problems.some((p) => p.includes('REAL-IDS') && p.includes('nonexistent')),
    `expected REAL-IDS problem mentioning "nonexistent", got: ${problems.join('; ')}`,
  );
});

// remove targeting a missing node also triggers REAL-IDS
test('(b2) remove targeting missing node → REAL-IDS problem', () => {
  const plan = {
    changes: [
      { id: 'c1', status: 'remove', target: { kind: 'node', ref: 'ghost' } },
    ],
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(problems.some((p) => p.includes('REAL-IDS') && p.includes('ghost')));
});

// add targeting an existing node also triggers REAL-IDS
test('(b3) add targeting existing node → REAL-IDS problem', () => {
  const plan = {
    changes: [
      {
        id: 'c1', status: 'add',
        target: { kind: 'node', ref: 'camera' }, // camera already in BASE
        newNode: { label: 'camera', kind: 'module', parent: null },
      },
    ],
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(problems.some((p) => p.includes('REAL-IDS') && p.includes('camera')));
});

// ── (c) dangling dependsOn → DANGLING-DEP ─────────────────────────────────
test('(c) dangling dependsOn → DANGLING-DEP problem', () => {
  const plan = {
    changes: [
      {
        id: 'c1', status: 'modify',
        target: { kind: 'node', ref: 'camera' },
        dependsOn: ['ghost-id'],
      },
    ],
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(
    problems.some((p) => p.includes('DANGLING-DEP') && p.includes('ghost-id')),
    `expected DANGLING-DEP for ghost-id, got: ${problems.join('; ')}`,
  );
});

// ── (d) 2-cycle in dependsOn → ACYCLIC ────────────────────────────────────
test('(d) 2-cycle in dependsOn → ACYCLIC problem', () => {
  const plan = {
    changes: [
      {
        id: 'c1', status: 'modify',
        target: { kind: 'node', ref: 'camera' },
        dependsOn: ['c2'],
      },
      {
        id: 'c2', status: 'modify',
        target: { kind: 'node', ref: 'render' },
        dependsOn: ['c1'],
      },
    ],
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(
    problems.some((p) => p.includes('ACYCLIC')),
    `expected ACYCLIC problem, got: ${problems.join('; ')}`,
  );
  // The cycle must mention both participants
  const cycleProblem = problems.find((p) => p.includes('ACYCLIC'));
  assert.ok(cycleProblem.includes('c1') && cycleProblem.includes('c2'));
});

// 3-cycle for extra coverage
test('(d2) 3-cycle in dependsOn → ACYCLIC problem', () => {
  const plan = {
    changes: [
      { id: 'a', status: 'modify', target: { kind: 'node', ref: 'camera' }, dependsOn: ['b'] },
      { id: 'b', status: 'modify', target: { kind: 'node', ref: 'render' }, dependsOn: ['c'] },
      { id: 'c', status: 'modify', target: { kind: 'node', ref: 'navigator' }, dependsOn: ['a'] },
    ],
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(problems.some((p) => p.includes('ACYCLIC')));
});

// ── (e) accepted change depending on rejected → COHERENT-ACCEPTED ──────────
test('(e) accepted change with direct rejected dep → COHERENT-ACCEPTED', () => {
  const plan = {
    changes: [
      { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'camera' } },
      {
        id: 'c2', status: 'modify',
        target: { kind: 'node', ref: 'render' },
        dependsOn: ['c1'],
      },
    ],
    verdicts: { c1: 'reject', c2: 'accept' },
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(
    problems.some((p) => p.includes('COHERENT-ACCEPTED') && p.includes('c2') && p.includes('c1')),
    `expected COHERENT-ACCEPTED problem for c2/c1, got: ${problems.join('; ')}`,
  );
});

// transitive: c3 accepts, c2 accepts, c1 rejected — c3 transitively depends on c1
test('(e2) accepted change with transitive rejected dep → COHERENT-ACCEPTED', () => {
  const plan = {
    changes: [
      { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'camera' } },
      { id: 'c2', status: 'modify', target: { kind: 'node', ref: 'render' }, dependsOn: ['c1'] },
      { id: 'c3', status: 'modify', target: { kind: 'node', ref: 'navigator' }, dependsOn: ['c2'] },
    ],
    verdicts: { c1: 'reject', c2: 'accept', c3: 'accept' },
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  // c3 must be flagged (transitively depends on c1)
  assert.ok(
    problems.some((p) => p.includes('COHERENT-ACCEPTED') && p.includes('c3') && p.includes('c1')),
    `expected c3 flagged for transitive dep on c1, got: ${problems.join('; ')}`,
  );
});

// no verdicts → COHERENT-ACCEPTED check is skipped entirely
test('(e3) no verdicts → COHERENT-ACCEPTED check skipped', () => {
  const plan = {
    changes: [
      { id: 'c1', status: 'modify', target: { kind: 'node', ref: 'camera' } },
      { id: 'c2', status: 'modify', target: { kind: 'node', ref: 'render' }, dependsOn: ['c1'] },
    ],
    // no verdicts key at all
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(
    !problems.some((p) => p.includes('COHERENT-ACCEPTED')),
    'should not emit COHERENT-ACCEPTED when no verdicts present',
  );
});

// ── PARENT-EXISTS ──────────────────────────────────────────────────────────
test('PARENT-EXISTS: add with unknown parent → problem', () => {
  const plan = {
    changes: [
      {
        id: 'c1', status: 'add',
        target: { kind: 'node', ref: 'newFn' },
        newNode: { label: 'newFn', kind: 'function', parent: 'unknownParent' },
      },
    ],
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(
    problems.some((p) => p.includes('PARENT-EXISTS') && p.includes('unknownParent')),
    `expected PARENT-EXISTS problem, got: ${problems.join('; ')}`,
  );
});

test('PARENT-EXISTS: add whose parent is another add change → no problem', () => {
  const plan = {
    changes: [
      {
        id: 'newMod', status: 'add',
        target: { kind: 'node', ref: 'newMod' },
        newNode: { label: 'newMod', kind: 'module', parent: null },
      },
      {
        id: 'newFn', status: 'add',
        target: { kind: 'node', ref: 'newFn' },
        newNode: { label: 'newFn', kind: 'function', parent: 'newMod' }, // parent is another add
      },
    ],
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(
    !problems.some((p) => p.includes('PARENT-EXISTS')),
    `unexpected PARENT-EXISTS problem: ${problems.join('; ')}`,
  );
});

test('PARENT-EXISTS: add with null parent → no problem', () => {
  const plan = {
    changes: [
      {
        id: 'c1', status: 'add',
        target: { kind: 'node', ref: 'topLevel' },
        newNode: { label: 'topLevel', kind: 'module', parent: null },
      },
    ],
  };
  const { problems } = checkPlan({ mapNodeIds: BASE, plan });
  assert.ok(!problems.some((p) => p.includes('PARENT-EXISTS')));
});
