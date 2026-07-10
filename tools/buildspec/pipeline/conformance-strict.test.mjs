/* =====================================================================
   conformance-strict.test.mjs — AUD5/F-15: the A3 conformance suite must
   not vacuously pass in CI.

   parser-conformance.test.mjs silently `test.skip`ed its whole app-parser
   half whenever the strip-types subprocess failed to load — so "parsers
   PROVABLY agree" could go green in CI without ever comparing the parsers.
   These meta-tests spawn the real suite with the unavailable path forced
   (NOVAKAI_FORCE_APP_UNAVAILABLE) and assert both modes:
     strict (CI=true or NOVAKAI_CONFORMANCE_STRICT=1) → non-zero exit
     lenient (local default)                          → skip, exit 0
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const SUITE = join('tools', 'buildspec', 'pipeline', 'parser-conformance.test.mjs');

function runSuite(env) {
  // CI is stripped from the base env so the meta-test behaves identically
  // on a dev machine and inside GitHub Actions; each case then sets its own.
  const base = { ...process.env, NOVAKAI_FORCE_APP_UNAVAILABLE: '1' };
  delete base.CI;
  delete base.NOVAKAI_CONFORMANCE_STRICT;
  // a nested `node --test` must not inherit the outer runner's context
  for (const k of Object.keys(base)) if (k.startsWith('NODE_TEST')) delete base[k];
  return spawnSync('node', ['--test', SUITE],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: { ...base, ...env }, timeout: 120_000 });
}

test('F-15 strict: an unavailable app parser FAILS the conformance suite under CI', () => {
  const result = runSuite({ 'CI': 'true' });
  assert.notEqual(result.status, 0, 'CI must not accept a skipped conformance half');
  assert.match(result.stdout, /MUST load under CI\/strict/, 'the failure names the strict rule');
});

test('F-15 lenient: locally an unavailable app parser still skips (exit 0, skip visible)', () => {
  const result = runSuite({});
  assert.equal(result.status, 0, `lenient mode must not fail:\n${result.stdout}`);
  assert.match(result.stdout, /comparison tests skipped|skipped/i, 'the skip is visible, not silent-green');
});
