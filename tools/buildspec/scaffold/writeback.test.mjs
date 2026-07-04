/* =====================================================================
   writeback.test.mjs — zero-dependency test suite (node --test).
   Covers: addFromPlan writes new nodes from an approved plan into a
   fragment .mmd file, is idempotent, and the result parses cleanly.
   Run: node --test tools/buildspec/scaffold/writeback.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addFromPlan } from './scaffold.mjs';
import { parseMmd } from '../core/mmd-parse.mjs';

// ─── Fixtures ─────────────────────────────────────────────────────────

const EXISTING_FRAGMENT = `flowchart LR
%% root myModule

%% kind existingNode module
%% fm:meta existingNode name=ExistingNode
%% fm:meta existingNode desc=an existing node

  existingNode["ExistingNode"]
`;

const PLAN_ONE_ADD = {
  base: 'test-base',
  changes: [
    {
      id: 'c1',
      status: 'add',
      target: { kind: 'node', ref: 'newFeature' },
      intent: { problem: 'missing feature', approach: 'add it' },
      newNode: { label: 'New Feature', kind: 'module', parent: 'myModule' },
      fm: {
        name: 'NewFeature',
        description: 'a brand new feature node',
        state: [],
        interfaces: [
          { name: 'init', accepts: ['ctx: AppContext'], returns: ['NewFeatureApi'] },
        ],
      },
    },
  ],
};

// ─── Tests ────────────────────────────────────────────────────────────

test('addFromPlan appends a new node from the plan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeback-'));
  try {
    const fragPath = join(dir, 'test.flowmap.mmd');
    const planPath = join(dir, 'plan.json');

    writeFileSync(fragPath, EXISTING_FRAGMENT);
    writeFileSync(planPath, JSON.stringify(PLAN_ONE_ADD));

    addFromPlan(planPath, fragPath, false);

    const result = readFileSync(fragPath, 'utf8');
    const model = parseMmd(result);

    // The new node must now appear
    assert.ok(model.nodes['newFeature'], 'newFeature node should be present in parsed model');
    assert.equal(model.nodes['newFeature'].kind, 'module', 'kind should be module');

    // The parent directive should have been written and resolved
    assert.equal(model.nodes['newFeature'].parent, 'myModule', 'parent should be myModule');

    // fm.name should match
    assert.ok(model.fm['newFeature'], 'fm entry should exist for newFeature');
    assert.equal(model.fm['newFeature'].name, 'NewFeature', 'fm.name should be NewFeature');
    assert.equal(model.fm['newFeature'].description, 'a brand new feature node', 'fm.desc should match');

    // Interface should be present
    assert.ok(model.fm['newFeature'].interfaces.length > 0, 'should have at least one interface');
    assert.equal(model.fm['newFeature'].interfaces[0].name, 'init', 'interface name should be init');
    assert.deepEqual(model.fm['newFeature'].interfaces[0].accepts, ['ctx: AppContext']);
    assert.deepEqual(model.fm['newFeature'].interfaces[0].returns, ['NewFeatureApi']);

    // Original node must still be present
    assert.ok(model.nodes['existingNode'], 'existing node must still be present');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addFromPlan is idempotent — running twice adds nothing the second time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeback-idem-'));
  try {
    const fragPath = join(dir, 'test.flowmap.mmd');
    const planPath = join(dir, 'plan.json');

    writeFileSync(fragPath, EXISTING_FRAGMENT);
    writeFileSync(planPath, JSON.stringify(PLAN_ONE_ADD));

    addFromPlan(planPath, fragPath, false);
    const afterFirst = readFileSync(fragPath, 'utf8');

    addFromPlan(planPath, fragPath, false);
    const afterSecond = readFileSync(fragPath, 'utf8');

    assert.equal(afterFirst, afterSecond, 'file must not change on second run');

    // And the model must still parse cleanly with exactly one newFeature
    const model = parseMmd(afterSecond);
    const newFeatureLines = afterSecond.split('\n').filter((l) => l.includes('newFeature'));
    // Count occurrences of the node-def line to confirm no duplicate
    const nodeDefLines = newFeatureLines.filter((l) => /^\s+newFeature[(\[]/.test(l));
    assert.equal(nodeDefLines.length, 1, 'node definition line must appear exactly once');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addFromPlan result still parses cleanly (no throw)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeback-parse-'));
  try {
    const fragPath = join(dir, 'test.flowmap.mmd');
    const planPath = join(dir, 'plan.json');

    writeFileSync(fragPath, EXISTING_FRAGMENT);
    writeFileSync(planPath, JSON.stringify(PLAN_ONE_ADD));

    addFromPlan(planPath, fragPath, false);

    const result = readFileSync(fragPath, 'utf8');
    let model;
    assert.doesNotThrow(() => { model = parseMmd(result); }, 'parseMmd must not throw');
    assert.ok(model && typeof model === 'object', 'parseMmd must return an object');
    assert.ok(model.nodes, 'model must have nodes');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('addFromPlan skips changes that are not add-node', () => {
  const dir = mkdtempSync(join(tmpdir(), 'writeback-skip-'));
  try {
    const fragPath = join(dir, 'test.flowmap.mmd');
    const planPath = join(dir, 'plan.json');

    writeFileSync(fragPath, EXISTING_FRAGMENT);

    const mixedPlan = {
      base: 'test-base',
      changes: [
        // modify — should be ignored
        {
          id: 'c2',
          status: 'modify',
          target: { kind: 'node', ref: 'existingNode' },
          intent: { problem: 'needs update', approach: 'update it' },
        },
        // add edge — should be ignored (target.kind !== 'node')
        {
          id: 'c3',
          status: 'add',
          target: { kind: 'edge', ref: 'existingNode->other:solid' },
          intent: { problem: 'need edge', approach: 'add edge' },
          newEdge: { from: 'existingNode', to: 'other', style: 'solid' },
        },
        // add node — should be included
        {
          id: 'c4',
          status: 'add',
          target: { kind: 'node', ref: 'validNew' },
          intent: { problem: 'missing', approach: 'add' },
          newNode: { label: 'Valid New', kind: 'function' },
        },
      ],
    };

    writeFileSync(planPath, JSON.stringify(mixedPlan));
    addFromPlan(planPath, fragPath, false);

    const model = parseMmd(readFileSync(fragPath, 'utf8'));
    assert.ok(model.nodes['validNew'], 'validNew should be added');
    // existingNode shape should still be rect (not altered by the modify change)
    assert.ok(model.nodes['existingNode'], 'existingNode must still be present');
    // The edge target 'other' might appear due to parseMmd picking up the node def
    // but there should be no ghost node from 'c3' in the directives
    assert.ok(!('other' in (model.fm || {})), 'no fm entry for edge-only ghost node');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
