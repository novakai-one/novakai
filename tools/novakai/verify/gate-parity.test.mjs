/* =====================================================================
   gate-parity.test.mjs — AUD5/F-06: the CI and local gate chains must be
   ONE canonical list, not two silently-diverging ones.

   Attack A7 found the divergence ran both directions: handoff:check, cert,
   plan-check, roadmap:audit and acceptance ran in CI only (a dev running
   the local chain never exercised them), while slice-core and both
   novakai-lint test files ran locally only (a CI run never exercised them).

   The fix this file locks in:
     - CI's buildspec-tests job consumes `spec:test:all` (package.json is
       the single canonical test list) instead of enumerating its own;
     - `novakai:verify:full` exists locally and chains the five previously
       CI-only gates, so a dev can run the whole CI-equivalent before push.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const ciWorkflow = readFileSync(join(ROOT, '.github', 'workflows', 'spec-gate.yml'), 'utf8');
const suite = pkg.scripts['spec:test:all'] || '';

test('CI consumes the canonical suite (spec:test:all), not its own test enumeration', () => {
  assert.match(ciWorkflow, /npm run spec:test:all/,
    'spec-gate.yml buildspec-tests must run spec:test:all — the one canonical list');
});

test('CI enumerates no test file outside the canonical suite (no CI-only tests)', () => {
  const enumerated = [...ciWorkflow.matchAll(/node --test ([^\s]+\.test\.mjs)/g)].map((match) => match[1]);
  const extra = enumerated.filter((file) => !suite.includes(file));
  assert.deepEqual(extra, [],
    `CI runs test files missing from spec:test:all (two diverging lists): ${extra.join(', ')}`);
});

test('every test file in the canonical suite exists on disk', () => {
  const files = suite.split(/\s+/).filter((entry) => entry.endsWith('.test.mjs'));
  assert.ok(files.length >= 20, `suite unexpectedly small (${files.length} files)`);
  const ghosts = files.filter((file) => !existsSync(join(ROOT, file)));
  assert.deepEqual(ghosts, [], `spec:test:all names nonexistent test files: ${ghosts.join(', ')}`);
});

test('novakai:verify:full chains the five previously-CI-only gates for local parity', () => {
  const full = pkg.scripts['novakai:verify:full'];
  assert.ok(full, 'package.json must define novakai:verify:full');
  for (const gate of [
    'novakai:verify',                       // the local drift chain itself
    'novakai:roadmap:audit',                // status-marker ban
    'novakai:cert',                         // plan dry-run cert
    'novakai:plan-check',                   // plan coherence
    'novakai:acceptance',                   // behavioural contract on the real plan
    'novakai:handoff:check',                // F4 handoff freshness
  ]) {
    assert.ok(full.includes(gate), `novakai:verify:full must include ${gate}`);
  }
});

test('F-07: the workflow triggers carry NO path filter (nothing can dodge the gate)', () => {
  // Attack A7: the old paths: filter excluded .claude/** (the hooks),
  // public/plan.json (the exact file cert/plan-check/acceptance target),
  // .quiz-answers.json and root configs — commits touching only those never
  // ran the gate. Fail-closed fix: no filter at all; every push/PR gates.
  assert.ok(!/^\s*paths:/m.test(ciWorkflow),
    'spec-gate.yml must not scope its triggers by path — a path filter is a gate bypass');
});

test('F-16: the once-orphaned diff tests are wired into the canonical suite', () => {
  // AUD3 T9: diff.test / diff-views.test / diff-roundtrip.test existed but ran
  // in neither spec:test:all nor CI. They must stay in the suite (the two
  // TS-importing ones via run-bundled-test.mjs, their documented runner).
  for (const file of [
    'tools/buildspec/testkit/diff.test.mjs',
    'tools/buildspec/testkit/diff-views.test.mjs',
    'tools/buildspec/testkit/diff-roundtrip.test.mjs',
  ]) {
    assert.ok(suite.includes(file), `${file} must run in spec:test:all`);
  }
});

test('the real-plan acceptance step (E4) survives in CI', () => {
  assert.match(ciWorkflow, /novakai:acceptance -- --plan public\/plan\.json/,
    'CI must keep running the behavioural acceptance contract on the REAL plan');
});
