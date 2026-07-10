/* =====================================================================
   edge-verify.test.mjs — A5 proof, run against the REAL repo map (not a
   synthetic fixture), so green means the actual call graph is accounted
   for, and the fail-closed case proves an unaccounted edge breaks the gate.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEdges } from './edge-verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const MAP = join(ROOT, 'docs/novakai/_bundle.mmd');
const ALLOW = join(ROOT, 'docs/novakai/edge-advisory-allowlist.txt');
const TSCONFIG = 'tsconfig.json';

test('every real edge is accounted for with the audited allowlist (the CI invariant)', () => {
  const res = verifyEdges({ mapPath: MAP, tsconfig: TSCONFIG, allowPath: ALLOW });
  assert.equal(res.unaccounted.length, 0, 'unaccounted edges: ' + res.unaccounted.map((e) => e.key).join(', '));
  assert.equal(res.verifiedImport + res.verifiedIntra + res.advisory, res.total);
});

test('the verifier actually proves real dependencies (not vacuously green)', () => {
  const res = verifyEdges({ mapPath: MAP, tsconfig: TSCONFIG, allowPath: ALLOW });
  // most edges are real code relations, only a handful are audited advisory
  assert.ok(res.verifiedImport > 50, `import-backed edges too few: ${res.verifiedImport}`);
  assert.ok(res.verifiedIntra > 50, `intra-file edges too few: ${res.verifiedIntra}`);
  assert.ok(res.advisory < 20, `too many advisory edges — allowlist is doing too much work: ${res.advisory}`);
});

test('fail-closed: WITHOUT the allowlist, the advisory edges surface as unaccounted', () => {
  const res = verifyEdges({ mapPath: MAP, tsconfig: TSCONFIG, allowPath: '/no/such/allowlist' });
  assert.ok(res.unaccounted.length >= 1, 'an empty allowlist must surface the semantic edges');
  // the documented render->wires hooks edge must be among them
  assert.ok(res.unaccounted.some((e) => e.key === 'render->wires'),
    'render->wires (a hooks edge) must be flagged when not allowlisted');
});

test('fail-closed CLI: --strict exits 1 when an edge is unaccounted', () => {
  // point --allow at a path that does not exist → the 4 advisory edges are unaccounted
  const res = spawnSync('node', ['tools/novakai/verify/edge-verify.mjs', '--strict', '--allow', '/no/such/file'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 1, 'strict mode must exit 1 on unaccounted edges');
  assert.match(res.stdout, /UNACCOUNTED/);
});

test('green CLI: --strict exits 0 with the real allowlist', () => {
  const res = spawnSync('node', ['tools/novakai/verify/edge-verify.mjs', '--strict'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, 'strict mode must pass with the audited allowlist');
  assert.match(res.stdout, /every edge is code-backed/);
});
