/* diff-roundtrip.test.mjs — proves the REAL parser feeds diffModels with
   zero false positives. Parse the same .mmd into both slots → diff must be
   empty. This is the canary: if fromMermaid is non-deterministic or diff
   keys on volatile data, this fails.
   Run: node --test tools/buildspec/testkit/diff-roundtrip.test.mjs */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fromMermaid } from '../../../src/io/mermaid.ts';
import { diffModels } from '../../../src/core/diff/diff.ts';

const SAMPLE = `flowchart LR
%% fm A 0 0 160 56 rect null
%% fm B 200 0 160 56 round null
%% kind A module
%% kind B function
  A["Alpha"]
  B("Beta")
  A --> B
  B -.-> A
`;

test('same mmd in both slots = zero diff', () => {
  const before = fromMermaid(SAMPLE);
  const after = fromMermaid(SAMPLE);
  const result = diffModels(before, after);
  assert.equal(result.counts.nAdd, 0, 'no added nodes');
  assert.equal(result.counts.nRem, 0, 'no removed nodes');
  assert.equal(result.counts.nChg, 0, 'no changed nodes');
  assert.equal(result.counts.eAdd, 0, 'no added edges');
  assert.equal(result.counts.eRem, 0, 'no removed edges');
});

test('real edit through parser is detected', () => {
  const before = fromMermaid(SAMPLE);
  const edited = SAMPLE.replace('"Beta"', '"Beta v2"').replace('  B -.-> A\n', '');
  const after = fromMermaid(edited);
  const result = diffModels(before, after);
  // label of B changed
  assert.ok(result.changedNodes.some((change) => change.id === 'B' && change.field === 'label'), 'B label change seen');
  // the dotted B->A edge removed
  assert.ok(result.removedEdges.some((k) => k.startsWith('B->A')), 'B->A edge removed');
});
