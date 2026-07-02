/* =====================================================================
   orchestrate.test.mjs — H4 driver: shape, hash, exit-code, determinism,
   and worktree-cleanup. Routes the real public/plan.json through the
   orchestrator. Heavy (each run spawns waves + per-change verify-change),
   so the shape/hash/exit assertions share ONE --no-worktree run.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from './lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const PLAN = join(ROOT, 'public', 'plan.json');

// M2b: FLOWMAP_ROOT is the emitter seam only — verify-change verdict events
// from orchestrated runs land in a scratch sink, never in the real metrics log.
const METRICS_SINK = mkdtempSync(join(tmpdir(), 'orch-metrics-'));
process.on('exit', () => rmSync(METRICS_SINK, { recursive: true, force: true }));

function runOrch(extra = []) {
  return spawnSync('node', [join(HERE, 'orchestrate.mjs'), '--plan', PLAN, '--json', ...extra],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
      env: { ...process.env, FLOWMAP_ROOT: METRICS_SINK } });
}

// One shared run (worktree-free for speed; stdout is identical with/without worktrees by design).
const ONE = runOrch(['--no-worktree']);
const OUT = ONE.stdout ? JSON.parse(ONE.stdout) : null;

test('emits a canonical, well-formed summary keyed by the wave-0 set', () => {
  assert.ok(OUT, `orchestrate produced stdout; stderr: ${ONE.stderr}`);
  assert.equal(OUT.orchestrateVersion, 1);
  assert.ok(Array.isArray(OUT.dispatched), 'dispatched is an array');
  // exactly one verdict per dispatched change
  assert.deepEqual(Object.keys(OUT.verdicts).sort(), OUT.dispatched.slice().sort());
  for (const id of OUT.dispatched) {
    assert.ok(['PASS', 'PASS_UNPROVEN', 'FAIL'].includes(OUT.verdicts[id].verdict), `valid verdict for ${id}`);
  }
});

test('summary counts partition the dispatched set', () => {
  const s = OUT.summary;
  assert.equal(s.pass + s.passUnproven + s.fail, s.total, 'pass+passUnproven+fail === total');
  assert.equal(s.total, OUT.dispatched.length, 'total === dispatched length');
});

test('orchestrateHash is the content hash of the body (recomputable)', () => {
  const { orchestrateHash, ...body } = OUT;
  assert.equal(orchestrateHash, hashOf(body), 'orchestrateHash === hashOf(body without the hash)');
});

test('exit code reflects the verdicts (non-zero iff a FAIL is present)', () => {
  // public/plan.json wave 0 is unbuilt => FAIL => exit 1 (expected, documented).
  assert.equal(ONE.status, OUT.summary.fail > 0 ? 1 : 0);
});

test('stdout is byte-identical across two runs (replay idiom)', () => {
  const b = runOrch(['--no-worktree']);
  assert.equal(ONE.stdout, b.stdout, 'orchestrate stdout must be deterministic');
  assert.equal(ONE.status, b.status, 'exit status must be deterministic');
});

test('AUD5/F-14: a guaranteed-FAIL fixture plan exits 1 UNCONDITIONALLY (not data-dependent)', () => {
  // AUD3: the exit-1-iff-FAIL check above is data-dependent on the live
  // public/plan.json state — if that plan ever becomes fully built, the
  // blocking path would go unexercised. This fixture cannot become built:
  // it adds a node whose symbol will never exist in the code.
  const dir = mkdtempSync(join(tmpdir(), 'flowmap-f14-'));
  try {
    const fixturePlan = join(dir, 'fail-plan.json');
    writeFileSync(fixturePlan, JSON.stringify({
      base: 'f14-guaranteed-fail',
      changes: [
        { id: 'ghost-add', status: 'add',
          target: { kind: 'node', ref: 'zzF14GhostNode' },
          newNode: { label: 'zzF14GhostNode', kind: 'function', parent: null },
          intent: { problem: 'fixture: never implemented, so the verdict must be FAIL' } },
      ],
    }));
    const r = spawnSync('node', [join(HERE, 'orchestrate.mjs'),
      '--plan', fixturePlan, '--json', '--no-worktree'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
      env: { ...process.env, FLOWMAP_ROOT: METRICS_SINK } });
    assert.ok(r.stdout, `orchestrate produced stdout; stderr: ${r.stderr}`);
    const out = JSON.parse(r.stdout);
    assert.deepEqual(out.dispatched, ['ghost-add'], 'the fixture change is dispatched in wave 0');
    assert.equal(out.verdicts['ghost-add'].verdict, 'FAIL', 'an unbuilt add must verdict FAIL');
    assert.equal(out.summary.fail, 1);
    assert.equal(r.status, 1, 'a FAIL in the wave must exit 1 — unconditionally');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('per-change worktree provisioning leaves no leftover worktrees', () => {
  // default mode provisions + tears down an isolated worktree per dispatched change
  const r = runOrch();
  assert.ok(r.stdout, 'default-mode run produced stdout');
  const list = spawnSync('git', ['worktree', 'list'], { cwd: ROOT, encoding: 'utf8' }).stdout || '';
  assert.ok(!/flowmap-orchestrate-wt/.test(list), `no leftover orchestrate worktrees; git worktree list:\n${list}`);
});
