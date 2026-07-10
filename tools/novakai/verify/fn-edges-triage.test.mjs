/* =====================================================================
   fn-edges-triage.test.mjs — proves the --fn-edges REPORT-ONLY triage
   (WI-3) actually surfaces real disagreements between the hand-authored
   function-level edges in _bundle.mmd and docs/novakai/derived-fn-edges.json
   (a deterministic ts-morph call-graph extraction), not just that it runs.
   This is diagnostic, not a gate: unlike edge-verify.test.mjs above, these
   assertions expect a NON-empty phantom/missing list today — that is the
   known, expected state, and this must NOT start failing the moment either
   list is non-zero. It fails only if the triage stops finding the specific
   hand-verified disagreements below (regression in the triage logic itself).
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { triageFnEdges } from './edge-verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const MAP = join(ROOT, 'docs/novakai/_bundle.mmd');
const DERIVED = join(ROOT, 'docs/novakai/derived-fn-edges.json');

// Hand-verified against _bundle.mmd + derived-fn-edges.json (see WI-3 report):
// main__bindToolbar --> main__loadOrSeed is a real edge in the map (line ~3468)
// with no counterpart anywhere in derived-fn-edges.json (386-entry ts-morph
// extraction) — a genuine PHANTOM.
const KNOWN_PHANTOM = 'main__bindToolbar->main__loadOrSeed';

// camera__initCamera -> camera__applyCam is a real entry in
// derived-fn-edges.json, but the map only draws camera__initCamera as a
// dotted "returns" edge to the CameraApi type node, never a function->function
// edge to applyCam — a genuine MISSING edge.
const KNOWN_MISSING = 'camera__initCamera->camera__applyCam';

test('triageFnEdges surfaces a known phantom (hand-authored, no derived counterpart)', () => {
  const triage = triageFnEdges({ mapPath: MAP, derivedPath: DERIVED });
  assert.ok(triage.phantom.includes(KNOWN_PHANTOM), `expected ${KNOWN_PHANTOM} in phantom list`);
});

test('triageFnEdges surfaces a known missing edge (derived, absent from map)', () => {
  const triage = triageFnEdges({ mapPath: MAP, derivedPath: DERIVED });
  assert.ok(triage.missing.includes(KNOWN_MISSING), `expected ${KNOWN_MISSING} in missing list`);
});

test('triageFnEdges only compares function->function edges (module/type edges out of scope)', () => {
  const triage = triageFnEdges({ mapPath: MAP, derivedPath: DERIVED });
  // main->state (module-level) and camera__initCamera->camera__CameraApi (type
  // edge) must never appear as keys — they are not function->function.
  assert.ok(!triage.phantom.includes('main->state') && !triage.missing.includes('main->state'));
  assert.ok(triage.handAuthoredCount > 0 && triage.derivedCount > 0);
});

test('REPORT-ONLY: --fn-edges never fails the build, even with phantom/missing edges present', () => {
  const res = spawnSync('node',
    ['tools/novakai/verify/edge-verify.mjs', '--fn-edges'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0, '--fn-edges must always exit 0 (report-only, not a gate)');
  assert.match(res.stdout, /REPORT ONLY/);
  assert.match(res.stdout, new RegExp(KNOWN_PHANTOM.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(res.stdout, new RegExp(KNOWN_MISSING.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('--fn-edges --json emits the same counts as the plain-text CLI report', () => {
  const res = spawnSync('node',
    ['tools/novakai/verify/edge-verify.mjs', '--fn-edges', '--json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(res.status, 0);
  const triage = JSON.parse(res.stdout);
  assert.ok(triage.phantom.includes(KNOWN_PHANTOM));
  assert.ok(triage.missing.includes(KNOWN_MISSING));
});
