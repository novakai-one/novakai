/* =====================================================================
   plan-cert.test.mjs — C2 dry-run certificate (node --test).
   Proves: a well-formed plan certifies (no new errors vs base), and a plan
   that proposes an uncompilable signature is caught BEFORE human review.
   Run: node --test tools/flowmap/plan/plan-cert.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPlanToSpec, certifyPlan } from './plan-cert.mjs';
import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SAMPLE = join(HERE, '..', '..', 'buildspec', '__fixtures__', 'sample.mmd');

test('applyPlanToSpec: add introduces a node, modify rewrites fm, remove drops it', () => {
  const base = parseMmd('flowchart TD\n%% kind a function\n%% fm:meta a name=a\n  a("a")\n');
  const plan = {
    changes: [
      { id: 'x', status: 'add', target: { kind: 'node', ref: 'b' }, newNode: { label: 'B', kind: 'function', parent: null },
        fm: { name: 'b', description: '', state: [], interfaces: [{ name: 'b', accepts: ['n: number'], returns: ['number'] }] } },
      { id: 'y', status: 'remove', target: { kind: 'node', ref: 'a' } },
    ],
  };
  const out = applyPlanToSpec(base, plan);
  assert.ok(out.nodes.b, 'add lands node b');
  assert.equal(out.nodes.b.kind, 'function');
  assert.ok(!out.nodes.a, 'remove drops node a');
  assert.equal(out.fm.b.interfaces[0].returns[0], 'number');
});

test('a well-formed plan is CERTIFIED (no new errors vs base)', () => {
  const plan = {
    base: 'sample',
    changes: [
      // add a new gated function with a clean, compilable signature
      { id: 'add-norm', status: 'add', target: { kind: 'node', ref: 'normalize' },
        newNode: { label: 'normalize', kind: 'function', parent: null },
        fm: { name: 'normalize', description: 'clamp', state: [], interfaces: [{ name: 'normalize', accepts: ['n: number'], returns: ['number'] }] } },
      // modify an existing node's signature to another clean one
      { id: 'mod-val', status: 'modify', target: { kind: 'node', ref: 'validate' },
        fm: { name: 'validate', description: '', state: [], interfaces: [{ name: 'isValid', accepts: ['x: number'], returns: ['boolean'] }] } },
    ],
  };
  const res = certifyPlan({ mapPath: SAMPLE, plan });
  assert.equal(res.certified, true, `expected CERTIFIED, got newTsc=${JSON.stringify(res.newTsc)} newGate=${JSON.stringify(res.newGate)}`);
});

test('a plan with an uncompilable proposed signature is NOT certified', () => {
  const plan = {
    base: 'sample',
    changes: [
      // "number string" is a clean-looking but invalid TS type -> stub won't compile
      { id: 'bad', status: 'modify', target: { kind: 'node', ref: 'validate' },
        fm: { name: 'validate', description: '', state: [], interfaces: [{ name: 'isValid', accepts: ['x: number'], returns: ['number string'] }] } },
    ],
  };
  const res = certifyPlan({ mapPath: SAMPLE, plan });
  assert.equal(res.certified, false, 'an uncompilable signature must NOT certify');
  assert.ok(res.newTsc.length > 0, 'the new tsc error must be reported');
});

test('M2b: the CLI verdict site is metered (emitter wired at main, NOT inside pure certifyPlan)', () => {
  // Grep-form check (the CLI path costs a tsc run; loop-e2e spawns it for real):
  // the emitter import exists, and the record call sits in the CLI main between
  // certifyPlan and the output — so library importers never double-record.
  const src = readFileSync(join(HERE, 'plan-cert.mjs'), 'utf8');
  assert.match(src, /from '\.\.\/lib\/metrics-log\.mjs'/, 'emitter is imported');
  const call = src.indexOf("recordEvent({ event: 'verdict', source: 'plan-cert.mjs'");
  assert.ok(call >= 0, 'the cert verdict is recorded');
  assert.ok(call > src.indexOf('function main()'), 'recorded on the CLI path only');
  assert.equal(src.slice(0, src.indexOf('function main()')).includes('recordEvent('), false,
    'certifyPlan and applyPlanToSpec stay pure imports');
});
