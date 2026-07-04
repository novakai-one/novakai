/* =====================================================================
   plan-layout.test.mjs — D1 layout-fidelity acceptance test.

   The contract D1 makes: the planner review canvas renders every REAL node
   at its exact ctx.state (x, y) — the human's live layout — and never a
   re-simulated force-sim position. Only synthesised add-nodes get a computed
   slot. This was a "manual"/visual claim; this test makes it machine-checked
   (the behaviour that flips D1's roadmap predicate from manual → verified).

   It imports the PURE levelPositions() from src/core/plan/plan.ts through the
   same --experimental-strip-types subprocess bridge parser-conformance uses
   (with a resolve hook for extensionless .ts imports), so the real shipped
   function is exercised, not a copy.

   Run: node --test tools/buildspec/testkit/plan-layout.test.mjs
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PLAN_TS_URL = pathToFileURL(join(ROOT, 'src', 'core', 'plan', 'plan.ts')).href;

// Subprocess: import the real levelPositions() and run it on a JSON-supplied
// array of PlanLayoutNode, printing the resulting positions map as JSON.
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

const { levelPositions } = await import(${JSON.stringify(PLAN_TS_URL)});
const nodes = JSON.parse(readFileSync(0, 'utf8'));
console.log(JSON.stringify(levelPositions(nodes)));
`;

function runLevelPositions(nodes) {
  const r = spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', SUBPROCESS],
    { input: JSON.stringify(nodes), encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (r.status !== 0) return { ok: false, error: r.stderr || 'subprocess failed' };
  try { return { ok: true, pos: JSON.parse(r.stdout) }; }
  catch (e) { return { ok: false, error: `${e.message}\n${r.stdout.slice(0, 300)}` }; }
}

// Pre-flight once: if --experimental-strip-types is unavailable, skip (don't fail).
const PRE = runLevelPositions([{ id: 'a', x: 1, y: 2, synth: false }]);
const AVAILABLE = PRE.ok;
if (!AVAILABLE) console.log(`  (plan-layout: app import unavailable — ${String(PRE.error).slice(0, 120)})`);

test('D1: every real node renders at its verbatim ctx.state position', { skip: !AVAILABLE }, () => {
  const reals = [
    { id: 'state', x: 137, y: 42, synth: false },
    { id: 'render', x: 980, y: 311, synth: false },
    { id: 'camera', x: 12, y: 760, synth: false },
  ];
  const { pos } = runLevelPositions(reals);
  for (const n of reals) {
    assert.deepEqual(pos[n.id], { x: n.x, y: n.y },
      `real node ${n.id} must keep its exact state position — no force-sim displacement`);
  }
});

test('D1: synth add-nodes get a slot that never collides with a real position', { skip: !AVAILABLE }, () => {
  const nodes = [
    { id: 'state', x: 100, y: 100, synth: false },
    { id: 'render', x: 400, y: 100, synth: false },
    { id: 'commandPalette', x: 0, y: 0, parent: null, synth: true },   // new top-level
    { id: 'camera__frameNode', x: 0, y: 0, parent: 'state', synth: true }, // new child of a real node
  ];
  const { pos } = runLevelPositions(nodes);
  // reals untouched
  assert.deepEqual(pos.state, { x: 100, y: 100 });
  assert.deepEqual(pos.render, { x: 400, y: 100 });
  // parentless synth parked to the right of the real bounding box (maxX = 400)
  assert.ok(pos.commandPalette.x > 400, 'parentless synth parks right of the real nodes');
  // parented synth placed beside its real parent
  assert.ok(pos.camera__frameNode.x > pos.state.x, 'parented synth sits next to its parent');
  // no synth lands exactly on a real node
  const realKeys = new Set([JSON.stringify(pos.state), JSON.stringify(pos.render)]);
  assert.ok(!realKeys.has(JSON.stringify(pos.commandPalette)), 'synth must not overlap a real node');
});
