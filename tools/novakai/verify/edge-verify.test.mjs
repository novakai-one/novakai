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
  const r = verifyEdges({ mapPath: MAP, tsconfig: TSCONFIG, allowPath: ALLOW });
  assert.equal(r.unaccounted.length, 0, 'unaccounted edges: ' + r.unaccounted.map((e) => e.key).join(', '));
  assert.equal(r.verifiedImport + r.verifiedIntra + r.advisory, r.total);
});

test('the verifier actually proves real dependencies (not vacuously green)', () => {
  const r = verifyEdges({ mapPath: MAP, tsconfig: TSCONFIG, allowPath: ALLOW });
  // most edges are real code relations, only a handful are audited advisory
  assert.ok(r.verifiedImport > 50, `import-backed edges too few: ${r.verifiedImport}`);
  assert.ok(r.verifiedIntra > 50, `intra-file edges too few: ${r.verifiedIntra}`);
  assert.ok(r.advisory < 20, `too many advisory edges — allowlist is doing too much work: ${r.advisory}`);
});

test('fail-closed: WITHOUT the allowlist, the advisory edges surface as unaccounted', () => {
  const r = verifyEdges({ mapPath: MAP, tsconfig: TSCONFIG, allowPath: '/no/such/allowlist' });
  assert.ok(r.unaccounted.length >= 1, 'an empty allowlist must surface the semantic edges');
  // the documented render->wires hooks edge must be among them
  assert.ok(r.unaccounted.some((e) => e.key === 'render->wires'),
    'render->wires (a hooks edge) must be flagged when not allowlisted');
});

test('fail-closed CLI: --strict exits 1 when an edge is unaccounted', () => {
  // point --allow at a path that does not exist → the 4 advisory edges are unaccounted
  const r = spawnSync('node', ['tools/novakai/verify/edge-verify.mjs', '--strict', '--allow', '/no/such/file'],
    { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 1, 'strict mode must exit 1 on unaccounted edges');
  assert.match(r.stdout, /UNACCOUNTED/);
});

test('green CLI: --strict exits 0 with the real allowlist', () => {
  const r = spawnSync('node', ['tools/novakai/verify/edge-verify.mjs', '--strict'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, 'strict mode must pass with the audited allowlist');
  assert.match(r.stdout, /every edge is code-backed/);
});
