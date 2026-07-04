/* =====================================================================
   cli-wiring.test.mjs — AUD5/F-10: the mutation-blind gate CLIs get their
   first spawn tests.

   AUD3 T4: gate.mjs was spawned by ZERO tests, and plan-check / plan-cert /
   flowmap-lint were tested fn-only — their argv parsing and exit wiring
   could be mutated without any suite noticing (only the internal logic was
   locked). One thin spawn pair per gate: bad input → the documented
   non-zero exit; good input → 0. (handoff-fresh got its CLI deny tests in
   aud5/F-02 — see handoff-fresh.test.mjs.)
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function cli(rel, args) {
  return spawnSync('node', [rel, ...args],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/* ---------- gate.mjs (the A2 lock: spawned by zero tests before) ---------- */

const SPEC_A = `flowchart TB
  a("fn")
%% kind a function
%% fm:meta a name=fn
%% fm:meta a i0.name=fn
%% fm:meta a i0.returns=number
`;
const SPEC_B = SPEC_A.replace('i0.returns=number', 'i0.returns=string');

test('gate.mjs CLI: identical spec vs code → exit 0 (in sync)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-wiring-'));
  try {
    const spec = join(dir, 'spec.mmd'); writeFileSync(spec, SPEC_A);
    const code = join(dir, 'code.mmd'); writeFileSync(code, SPEC_A);
    const r = cli('tools/buildspec/pipeline/gate.mjs', ['--spec', spec, '--code', code]);
    assert.equal(r.status, 0, `in-sync gate must exit 0:\n${r.stdout}${r.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('gate.mjs CLI: signature drift → exit 1; missing args → exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-wiring-'));
  try {
    const spec = join(dir, 'spec.mmd'); writeFileSync(spec, SPEC_A);
    const code = join(dir, 'code.mmd'); writeFileSync(code, SPEC_B);
    const drift = cli('tools/buildspec/pipeline/gate.mjs', ['--spec', spec, '--code', code]);
    assert.equal(drift.status, 1, `drifted gate must exit 1:\n${drift.stdout}${drift.stderr}`);
    assert.equal(cli('tools/buildspec/pipeline/gate.mjs', []).status, 2, 'no args is a usage error (2)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- plan-check.mjs (C3) ---------- */

test('plan-check.mjs CLI: incoherent plan → exit 1; unreadable plan → exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-wiring-'));
  try {
    const bad = join(dir, 'bad-plan.json');
    // a dangling dependsOn — one of the coherence classes the fn tests lock
    writeFileSync(bad, JSON.stringify({
      base: 'x', changes: [
        { id: 'c1', status: 'add', target: { kind: 'node', ref: 'zzNew1' },
          newNode: { label: 'n', kind: 'function', parent: null }, dependsOn: ['no-such-change'] },
      ],
    }));
    const r = cli('tools/flowmap/plan/plan-check.mjs', ['--plan', bad]);
    assert.equal(r.status, 1, `incoherent plan must exit 1:\n${r.stdout}${r.stderr}`);
    const gone = cli('tools/flowmap/plan/plan-check.mjs', ['--plan', join(dir, 'ghost.json')]);
    assert.equal(gone.status, 2, 'unreadable plan is exit 2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('plan-check.mjs CLI: the real in-flight plan → exit 0 (good-path wiring)', () => {
  const r = cli('tools/flowmap/plan/plan-check.mjs', ['--plan', 'public/plan.json']);
  assert.equal(r.status, 0, `real plan must be coherent:\n${r.stdout}${r.stderr}`);
});

/* ---------- plan-cert.mjs (C2) — deny wiring; the good path is already
   spawned by loop-e2e.test.mjs stage 2 (CERTIFIED on the real plan) ---------- */

test('plan-cert.mjs CLI: no --plan → exit 2; unreadable plan → exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-wiring-'));
  try {
    assert.equal(cli('tools/flowmap/plan/plan-cert.mjs', []).status, 2, 'no --plan is a usage error (2)');
    const gone = cli('tools/flowmap/plan/plan-cert.mjs', ['--plan', join(dir, 'ghost.json')]);
    assert.equal(gone.status, 2, 'unreadable plan is exit 2');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- flowmap-lint.mjs ---------- */

test('flowmap-lint.mjs CLI: flat file-mirror → exit 1; no path → exit 2; real map → exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-wiring-'));
  try {
    const flat = join(dir, 'flat.mmd');
    writeFileSync(flat, `flowchart LR\n%% root a\n${
      Array.from({ length: 10 }, (_, i) => `%% kind n${i} module`).join('\n')}\n${
      Array.from({ length: 10 }, (_, i) => `  n${i}["n${i}"]`).join('\n')}\n  n0 --> n1\n`);
    const r = cli('tools/flowmap/verify/flowmap-lint.mjs', [flat]);
    assert.equal(r.status, 1, `flat mirror must exit 1:\n${r.stdout}${r.stderr}`);
    assert.equal(cli('tools/flowmap/verify/flowmap-lint.mjs', []).status, 2, 'no path is a usage error (2)');
    const real = cli('tools/flowmap/verify/flowmap-lint.mjs', ['docs/flowmap/_bundle.mmd']);
    assert.equal(real.status, 0, `the real bundle must lint clean:\n${real.stdout}${real.stderr}`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
