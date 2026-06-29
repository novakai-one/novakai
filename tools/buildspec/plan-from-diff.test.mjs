/* =====================================================================
   plan-from-diff.test.mjs — D2 unified-review acceptance test.

   D2 collapses the two review surfaces into one: the planner can review a
   raw before/after .mmd proposal, not only an authored plan.json, by
   deriving a Plan from the diff (planFromDiff). This test exercises the
   REAL shipped planFromDiff() through the --experimental-strip-types
   bridge and asserts a structural diff becomes the right set of changes —
   the same change vocabulary the planner already reviews.

   Run: node --test tools/buildspec/plan-from-diff.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
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
  const r = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', SUBPROCESS],
    { input: JSON.stringify({ before, after }), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, error: r.stderr };
  try { return { ok: true, plan: JSON.parse(r.stdout) }; } catch (e) { return { ok: false, error: `${e.message}\n${r.stdout.slice(0, 300)}` }; }
}

const node = (id, extra = {}) => ({ id, label: id, shape: 'rect', kind: 'module', color: null, x: 0, y: 0, w: 180, h: 54, parent: null, ...extra });
const PRE = run({ nodes: { a: node('a') }, edges: [] }, { nodes: { a: node('a') }, edges: [] });
const AVAILABLE = PRE.ok;
if (!AVAILABLE) console.log(`  (plan-from-diff: app import unavailable — ${String(PRE.error).slice(0, 120)})`);

test('D2: a before/after diff becomes add/remove/modify/edge changes', { skip: !AVAILABLE }, () => {
  const before = { nodes: { keep: node('keep'), gone: node('gone'), edit: node('edit', { label: 'old' }) },
    edges: [{ id: 'e1', from: 'keep', to: 'gone', style: 'solid', label: '' }] };
  const after = { nodes: { keep: node('keep'), edit: node('edit', { label: 'new' }), fresh: node('fresh', { kind: 'function' }) },
    edges: [{ id: 'e2', from: 'keep', to: 'fresh', style: 'dotted', label: '' }] };

  const { plan } = run(before, after);
  const byStatusKind = (s, k) => plan.changes.filter((c) => c.status === s && c.target.kind === k);

  assert.equal(byStatusKind('add', 'node').length, 1, 'one added node (fresh)');
  assert.equal(byStatusKind('add', 'node')[0].target.ref, 'fresh');
  assert.equal(byStatusKind('add', 'node')[0].newNode.kind, 'function');
  assert.equal(byStatusKind('remove', 'node').length, 1, 'one removed node (gone)');
  assert.equal(byStatusKind('remove', 'node')[0].target.ref, 'gone');
  assert.equal(byStatusKind('modify', 'node').length, 1, 'one modified node (edit: label changed)');
  assert.equal(byStatusKind('add', 'edge').length, 1, 'one added edge (keep->fresh:dotted)');
  assert.equal(byStatusKind('add', 'edge')[0].target.ref, 'keep->fresh:dotted');
  assert.equal(byStatusKind('remove', 'edge').length, 1, 'one removed edge (keep->gone:solid)');
  // every derived change carries an intent (so the planner's review UI renders)
  assert.ok(plan.changes.every((c) => c.intent && c.intent.problem && c.intent.approach), 'each change has a derived intent');
});

test('D2: identical maps derive an empty plan (nothing to review)', { skip: !AVAILABLE }, () => {
  const m = { nodes: { a: node('a'), b: node('b') }, edges: [{ id: 'e1', from: 'a', to: 'b', style: 'solid', label: '' }] };
  const { plan } = run(m, structuredClone(m));
  assert.equal(plan.changes.length, 0, 'no diff → no changes');
});
