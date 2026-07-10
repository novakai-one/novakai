/* =====================================================================
   plan-from-diff.test.mjs — D2 unified-review acceptance test.

   D2 collapses the two review surfaces into one: the planner can review a
   raw before/after .mmd proposal, not only an authored plan.json, by
   deriving a Plan from the diff (planFromDiff). This test exercises the
   REAL shipped planFromDiff() through the --experimental-strip-types
   bridge and asserts a structural diff becomes the right set of changes —
   the same change vocabulary the planner already reviews.

   Run: node --test tools/buildspec/testkit/plan-from-diff.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PLAN_TS_URL = pathToFileURL(join(ROOT, 'src', 'core', 'plan', 'plan.ts')).href;

const SUBPROCESS = `
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL && !/\\.[^./]+$/.test(specifier)) {
      const dir = fileURLToPath(new URL('.', context.parentURL));
      const tsPath = join(dir, specifier + '.ts');
      if (existsSync(tsPath)) return { shortCircuit: true, url: pathToFileURL(tsPath).href };
    }
    return nextResolve(specifier, context);
  },
});
const { planFromDiff } = await import(${JSON.stringify(PLAN_TS_URL)});
const { before, after } = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(planFromDiff(before, after, 'test')));
`;

function run(before, after) {
  const res = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', SUBPROCESS],
    { input: JSON.stringify({ before, after }), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (res.status !== 0) return { succeeded: false, error: res.stderr };
  try {
    return { succeeded: true, plan: JSON.parse(res.stdout) };
  } catch (e) {
    return { succeeded: false, error: `${e.message}\n${res.stdout.slice(0, 300)}` };
  }
}

const node = (id, extra = {}) => ({
  id, label: id, shape: 'rect', kind: 'module', color: null, x: 0, y: 0, 'w': 180, 'h': 54, parent: null, ...extra,
});
const PRE = run({ nodes: { 'a': node('a') }, edges: [] }, { nodes: { 'a': node('a') }, edges: [] });
const AVAILABLE = PRE.succeeded;
if (!AVAILABLE) console.log(`  (plan-from-diff: app import unavailable — ${String(PRE.error).slice(0, 120)})`);

const BEFORE_D2 = {
  nodes: { keep: node('keep'), gone: node('gone'), edit: node('edit', { label: 'old' }) },
  edges: [{ id: 'e1', from: 'keep', 'to': 'gone', style: 'solid', label: '' }],
};
const AFTER_D2 = {
  nodes: { keep: node('keep'), edit: node('edit', { label: 'new' }), fresh: node('fresh', { kind: 'function' }) },
  edges: [{ id: 'e2', from: 'keep', 'to': 'fresh', style: 'dotted', label: '' }],
};

function byStatusKind(plan, status, kind) {
  return plan.changes.filter((change) => change.status === status && change.target.kind === kind);
}

test('D2: a before/after diff becomes add/remove/modify/edge changes', { skip: !AVAILABLE }, () => {
  const { plan } = run(BEFORE_D2, AFTER_D2);

  assert.equal(byStatusKind(plan, 'add', 'node').length, 1, 'one added node (fresh)');
  assert.equal(byStatusKind(plan, 'add', 'node')[0].target.ref, 'fresh');
  assert.equal(byStatusKind(plan, 'add', 'node')[0].newNode.kind, 'function');
  assert.equal(byStatusKind(plan, 'remove', 'node').length, 1, 'one removed node (gone)');
  assert.equal(byStatusKind(plan, 'remove', 'node')[0].target.ref, 'gone');
  assert.equal(byStatusKind(plan, 'modify', 'node').length, 1, 'one modified node (edit: label changed)');
  assert.equal(byStatusKind(plan, 'add', 'edge').length, 1, 'one added edge (keep->fresh:dotted)');
  assert.equal(byStatusKind(plan, 'add', 'edge')[0].target.ref, 'keep->fresh:dotted');
  assert.equal(byStatusKind(plan, 'remove', 'edge').length, 1, 'one removed edge (keep->gone:solid)');
  // every derived change carries an intent (so the planner's review UI renders)
  assert.ok(plan.changes.every((change) => change.intent && change.intent.problem && change.intent.approach),
    'each change has a derived intent');
});

test('D2: identical maps derive an empty plan (nothing to review)', { skip: !AVAILABLE }, () => {
  const model = {
    nodes: { 'a': node('a'), 'b': node('b') },
    edges: [{ id: 'e1', from: 'a', 'to': 'b', style: 'solid', label: '' }],
  };
  const { plan } = run(model, structuredClone(model));
  assert.equal(plan.changes.length, 0, 'no diff → no changes');
});
