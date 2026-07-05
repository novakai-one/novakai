/* =====================================================================
   acceptance.test.mjs — E2 keystone-2 mechanism test (node --test).
   Proves the behavioural contract runs against REAL code: a correct
   expectation goes green, a wrong one goes red, and a symbol with no map
   mapping (unimplemented) is red — exactly the "failing until done" property.
   Run: node --test tools/buildspec/acceptance/acceptance.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { srcDirectives, collectCases, runAcceptance } from './acceptance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const BUNDLE = join(ROOT, 'docs', 'novakai', '_bundle.mmd');

test('srcDirectives + collectCases resolve a change to a real export', () => {
  const map = srcDirectives('%% src levelPositions src/core/plan/plan.ts#levelPositions\n');
  assert.deepEqual(map.levelPositions, { path: 'src/core/plan/plan.ts', symbol: 'levelPositions' });
  const plan = { changes: [{ id: 'x', status: 'modify', target: { kind: 'node', ref: 'levelPositions' },
    acceptance: { cases: [{ name: 'c', args: [[]], equals: {} }] } }] };
  const cases = collectCases(plan, map);
  assert.equal(cases.length, 1);
  assert.equal(cases[0].path, 'src/core/plan/plan.ts');
});

// pre-flight: app TS import must work for the behavioural runner
const PRE = runAcceptance({ planPath: writePlan([{ name: 'noop', args: [[]], equals: {} }]), mapPath: BUNDLE });
const AVAILABLE = PRE.ran && PRE.results[0] && (PRE.results[0].pass || !/runner failed/.test(PRE.results[0].error || ''));

test('a CORRECT behavioural case against real levelPositions goes GREEN', { skip: !AVAILABLE }, () => {
  const planPath = writePlan([
    { name: 'real node keeps its position',
      args: [[{ id: 'a', x: 11, y: 22, synth: false }]],
      equals: { a: { x: 11, y: 22 } } },
  ]);
  const res = runAcceptance({ planPath, mapPath: BUNDLE });
  assert.ok(res.ran);
  assert.equal(res.results.every((r) => r.pass), true, `expected all green, got ${JSON.stringify(res.results)}`);
});

test('a WRONG expectation goes RED (the gap the signature gate cannot catch)', { skip: !AVAILABLE }, () => {
  const planPath = writePlan([
    { name: 'wrong expected position',
      args: [[{ id: 'a', x: 11, y: 22, synth: false }]],
      equals: { a: { x: 999, y: 999 } } },
  ]);
  const res = runAcceptance({ planPath, mapPath: BUNDLE });
  assert.equal(res.results.some((r) => !r.pass), true, 'a wrong expectation must fail');
});

test('a symbol with no map mapping (unimplemented) is RED', { skip: !AVAILABLE }, () => {
  const planPath = writePlan([{ name: 'ghost', args: [], equals: 1 }], 'doesNotExistInMap');
  const res = runAcceptance({ planPath, mapPath: BUNDLE });
  assert.equal(res.results.every((r) => !r.pass), true, 'an unmapped/unimplemented symbol must be red');
});

test('acc.path/acc.symbol wins over a wrong `%% src` mapping (pure lens escape hatch)', { skip: !AVAILABLE }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'acc-lens-'));
  const mapPath = join(dir, 'fake.mmd');
  // the map's own src directive points at a location that cannot be imported —
  // if the map won precedence, every case below would be red.
  writeFileSync(mapPath, '%% src levelPositions src/does/not/exist.ts#nope\n');
  const planPath = join(dir, 'plan.json');
  writeFileSync(planPath, JSON.stringify({
    base: 'test',
    changes: [{ id: 'c1', status: 'modify', target: { kind: 'node', ref: 'levelPositions' },
      intent: { problem: '', approach: '' },
      acceptance: {
        path: 'src/core/plan/plan.ts', symbol: 'levelPositions',
        cases: [{ name: 'real node keeps its position',
          args: [[{ id: 'a', x: 11, y: 22, synth: false }]],
          equals: { a: { x: 11, y: 22 } } }],
      } }],
  }));
  const res = runAcceptance({ planPath, mapPath });
  assert.ok(res.ran);
  assert.equal(res.results.every((r) => r.pass), true, `expected green via acc.path lens, got ${JSON.stringify(res.results)}`);
});

/* ---- H1: projection-kind cases (ctx/DOM-bound behaviour without a DOM) ---- */

test('collectCases lifts kind:projection + the lens onto the case', () => {
  const map = srcDirectives('%% src levelPositions src/core/plan/plan.ts#levelPositions\n');
  const plan = { changes: [{ id: 'x', status: 'modify', target: { kind: 'node', ref: 'levelPositions' },
    acceptance: { cases: [{ name: 'p', kind: 'projection', projection: '(r) => r.a', args: [[]], equals: {} }] } }] };
  const c = collectCases(plan, map)[0];
  assert.equal(c.kind, 'projection');
  assert.equal(c.projection, '(r) => r.a');
});

test('collectCases defaults a case to kind:pure with no lens', () => {
  const map = srcDirectives('%% src levelPositions src/core/plan/plan.ts#levelPositions\n');
  const plan = { changes: [{ id: 'x', status: 'modify', target: { kind: 'node', ref: 'levelPositions' },
    acceptance: { cases: [{ name: 'p', args: [[]], equals: {} }] } }] };
  const c = collectCases(plan, map)[0];
  assert.equal(c.kind, 'pure');
  assert.equal(c.projection, null);
});

test('a projection case asserting a SLICE of the real result goes GREEN', { skip: !AVAILABLE }, () => {
  const planPath = writePlan([
    { name: 'project the x of node a', kind: 'projection',
      args: [[{ id: 'a', x: 11, y: 22, synth: false }]],
      projection: '(result) => result.a.x', equals: 11 },
  ]);
  const res = runAcceptance({ planPath, mapPath: BUNDLE });
  assert.ok(res.ran);
  assert.equal(res.results.every((r) => r.pass), true, `expected green, got ${JSON.stringify(res.results)}`);
});

test('a projection case with a WRONG slice expectation goes RED', { skip: !AVAILABLE }, () => {
  const planPath = writePlan([
    { name: 'wrong projected slice', kind: 'projection',
      args: [[{ id: 'a', x: 11, y: 22, synth: false }]],
      projection: '(result) => result.a.x', equals: 999 },
  ]);
  const res = runAcceptance({ planPath, mapPath: BUNDLE });
  assert.equal(res.results.some((r) => !r.pass), true, 'a wrong projected slice must fail');
});

test('a projection case with NO lens is RED (not a silent pass)', { skip: !AVAILABLE }, () => {
  const planPath = writePlan([
    { name: 'missing lens', kind: 'projection',
      args: [[{ id: 'a', x: 11, y: 22, synth: false }]], equals: 11 },
  ]);
  const res = runAcceptance({ planPath, mapPath: BUNDLE });
  assert.equal(res.results.every((r) => !r.pass), true, 'a projection case with no lens must be red');
});

test('a projection run is byte-identical across two runs (replay idiom)', { skip: !AVAILABLE }, () => {
  const cases = [{ name: 'project x', kind: 'projection',
    args: [[{ id: 'a', x: 11, y: 22, synth: false }]],
    projection: '(result) => result.a.x', equals: 11 }];
  const r1 = runAcceptance({ planPath: writePlan(cases), mapPath: BUNDLE });
  const r2 = runAcceptance({ planPath: writePlan(cases), mapPath: BUNDLE });
  assert.equal(JSON.stringify(r1.results), JSON.stringify(r2.results), 'projection results must be identical across runs');
});

/* ---- helpers ---- */
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
function writePlan(cases, ref = 'plan__levelPositions') {
  const dir = mkdtempSync(join(tmpdir(), 'acc-'));
  const p = join(dir, 'plan.json');
  writeFileSync(p, JSON.stringify({
    base: 'test',
    changes: [{ id: 'c1', status: 'modify', target: { kind: 'node', ref }, intent: { problem: '', approach: '' },
      acceptance: { cases } }],
  }));
  return p;
}
