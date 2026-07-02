/* =====================================================================
   gate-parity.test.mjs — AUD5/F-06: the CI and local gate chains must be
   ONE canonical list, not two silently-diverging ones.

   Attack A7 found the divergence ran both directions: handoff:check, cert,
   plan-check, roadmap:audit and acceptance ran in CI only (a dev running
   the local chain never exercised them), while slice-core and both
   flowmap-lint test files ran locally only (a CI run never exercised them).

   The fix this file locks in:
     - CI's buildspec-tests job consumes `spec:test:all` (package.json is
       the single canonical test list) instead of enumerating its own;
     - `flowmap:verify:full` exists locally and chains the five previously
       CI-only gates, so a dev can run the whole CI-equivalent before push.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const ci = readFileSync(join(ROOT, '.github', 'workflows', 'spec-gate.yml'), 'utf8');
const suite = pkg.scripts['spec:test:all'] || '';

test('CI consumes the canonical suite (spec:test:all), not its own test enumeration', () => {
  assert.match(ci, /npm run spec:test:all/,
    'spec-gate.yml buildspec-tests must run spec:test:all — the one canonical list');
});

test('CI enumerates no test file outside the canonical suite (no CI-only tests)', () => {
  const enumerated = [...ci.matchAll(/node --test ([^\s]+\.test\.mjs)/g)].map((m) => m[1]);
  const extra = enumerated.filter((f) => !suite.includes(f));
  assert.deepEqual(extra, [],
    `CI runs test files missing from spec:test:all (two diverging lists): ${extra.join(', ')}`);
});

test('every test file in the canonical suite exists on disk', () => {
  const files = suite.split(/\s+/).filter((t) => t.endsWith('.test.mjs'));
  assert.ok(files.length >= 20, `suite unexpectedly small (${files.length} files)`);
  const ghosts = files.filter((f) => !existsSync(join(ROOT, f)));
  assert.deepEqual(ghosts, [], `spec:test:all names nonexistent test files: ${ghosts.join(', ')}`);
});

test('flowmap:verify:full chains the five previously-CI-only gates for local parity', () => {
  const full = pkg.scripts['flowmap:verify:full'];
  assert.ok(full, 'package.json must define flowmap:verify:full');
  for (const gate of [
    'flowmap:verify',                       // the local drift chain itself
    'flowmap:roadmap:audit',                // status-marker ban
    'flowmap:cert',                         // plan dry-run cert
    'flowmap:plan-check',                   // plan coherence
    'flowmap:acceptance',                   // behavioural contract on the real plan
    'flowmap:handoff:check',                // F4 handoff freshness
  ]) {
    assert.ok(full.includes(gate), `flowmap:verify:full must include ${gate}`);
  }
});

test('the real-plan acceptance step (E4) survives in CI', () => {
  assert.match(ci, /flowmap:acceptance -- --plan public\/plan\.json/,
    'CI must keep running the behavioural acceptance contract on the REAL plan');
});
