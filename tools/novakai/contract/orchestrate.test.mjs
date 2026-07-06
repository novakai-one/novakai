/* =====================================================================
   orchestrate.test.mjs — H4 driver: shape, hash, exit-code, determinism,
   and worktree-cleanup. Routes the real public/plan.json through the
   orchestrator. Heavy (each run spawns waves + per-change verify-change),
   so the shape/hash/exit assertions share ONE --no-worktree run.
   ===================================================================== */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, realpathSync, symlinkSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashOf } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PLAN = join(ROOT, 'public', 'plan.json');

// M2b: NOVAKAI_ROOT is the emitter seam only — verify-change verdict events
// from orchestrated runs land in a scratch sink, never in the real metrics log.
const METRICS_SINK = mkdtempSync(join(tmpdir(), 'orch-metrics-'));
process.on('exit', () => rmSync(METRICS_SINK, { recursive: true, force: true }));

function runOrch(extra = []) {
  return spawnSync('node', [join(HERE, 'orchestrate.mjs'), '--plan', PLAN, '--json', ...extra],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
      env: { ...process.env, NOVAKAI_ROOT: METRICS_SINK } });
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
  const dir = mkdtempSync(join(tmpdir(), 'novakai-f14-'));
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
      env: { ...process.env, NOVAKAI_ROOT: METRICS_SINK } });
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
  assert.ok(!/novakai-orchestrate-wt/.test(list), `no leftover orchestrate worktrees; git worktree list:\n${list}`);
});

/* =====================================================================
   WI-6 — orchestrate-exec, deterministic parts: node_modules symlink,
   the sliced CONTRACT.json packet, and routing the verdict INSIDE the
   worktree (so a build agent's edits are what get verified, not main's).
   ===================================================================== */

// Same base orchestrate.mjs provisions worktrees under (realpath'd — see
// orchestrate.mjs's WT_BASE comment: macOS's /tmp -> /private/tmp symlink
// must be resolved BEFORE building any worktree path, or a child's own
// process.cwd() disagrees with the path string handed to it) — kept in
// sync so this test can inspect the --keep-worktrees output.
const WT_BASE = join(realpathSync(tmpdir()), 'novakai-orchestrate-wt');

function cleanupWt(wt) {
  spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: ROOT });
  rmSync(wt, { recursive: true, force: true });
  spawnSync('git', ['worktree', 'prune'], { cwd: ROOT });
}

test('WI-6a/b: --keep-worktrees provisions a WORKING node_modules symlink and drops the SLICED packet (subMap+slicedBodies) as CONTRACT.json', () => {
  const r = runOrch(['--keep-worktrees']);
  const out = r.stdout ? JSON.parse(r.stdout) : null;
  assert.ok(out, `orchestrate produced stdout; stderr: ${r.stderr}`);
  // public/plan.json's wave 0 is currently all-"add" (unbuilt) changes — if
  // that ever changes, this guard fails loudly instead of passing vacuously.
  assert.ok(out.dispatched.length > 0, 'expected >=1 dispatched change to inspect a kept worktree for');
  try {
    for (const id of out.dispatched) {
      const wt = join(WT_BASE, id);
      assert.ok(existsSync(wt), `worktree[${id}] was provisioned`);

      const nm = join(wt, 'node_modules');
      assert.ok(existsSync(join(nm, 'ts-morph')), `worktree[${id}]: symlinked node_modules RESOLVES (ts-morph reachable through it)`);
      assert.equal(realpathSync(nm), realpathSync(join(ROOT, 'node_modules')), `worktree[${id}]: node_modules symlink points at the main repo's`);

      const contract = JSON.parse(readFileSync(join(wt, 'CONTRACT.json'), 'utf8'));
      assert.ok(Object.prototype.hasOwnProperty.call(contract, 'subMap'), `worktree[${id}]: CONTRACT.json carries subMap (sliced packet, not the old metadata-only shape)`);
      assert.ok(Object.prototype.hasOwnProperty.call(contract, 'slicedBodies'), `worktree[${id}]: CONTRACT.json carries slicedBodies`);
    }
  } finally {
    for (const id of out.dispatched) cleanupWt(join(WT_BASE, id));
  }
});

test('WI-6c/d: verify-change routed INSIDE a worktree matches an independent HEAD checkout for an unchanged real change, and DIVERGES after a worktree-local edit', () => {
  // frame-transform is a real, already-built, PASS change (public/plan.json) —
  // wave-0 dispatch is always unbuilt-only (see AUD5/F-14 above), so this
  // mechanism is exercised directly (mirroring orchestrate.mjs's own
  // provision+route, per docs/novakai/plans/contract-slice.build.md's PROBE
  // RESULT), not through the wave-0 selection. BOTH sides of the comparison
  // are fresh `git worktree add --detach HEAD` checkouts (not the live ROOT
  // working tree), so the test is immune to concurrent uncommitted edits
  // elsewhere in this shared repo (other builders may be mid-edit on other
  // files right now) — it proves the routing mechanism, not a race.
  // realpath'd for the same reason as WT_BASE above (macOS /tmp symlink).
  const REAL_TMP = realpathSync(tmpdir());
  const baselineWt = join(REAL_TMP, 'novakai-orch-mech-baseline');
  const mechWt = join(REAL_TMP, 'novakai-orch-mech-test');
  const before = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  cleanupWt(baselineWt);
  cleanupWt(mechWt);
  try {
    for (const wt of [baselineWt, mechWt]) {
      const add = spawnSync('git', ['worktree', 'add', '--detach', wt, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
      assert.equal(add.status, 0, 'git worktree add failed: ' + add.stderr);
      symlinkSync(join(ROOT, 'node_modules'), join(wt, 'node_modules'), 'dir');
    }

    const runVerify = (cwd) => spawnSync('node', [
      'tools/novakai/contract/verify-change.mjs', '--change', 'frame-transform',
      '--plan', join(cwd, 'public', 'plan.json'),
      '--map', join(cwd, 'docs', 'novakai', '_bundle.mmd'),
      '--tsconfig', join(cwd, 'tsconfig.json'), '--json',
    ], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

    // baseline: an independent HEAD checkout, run the same "in-worktree" way.
    const base = runVerify(baselineWt);
    const baseOut = base.stdout ? JSON.parse(base.stdout) : null;
    assert.ok(baseOut, `baseline verify-change produced stdout; stderr: ${base.stderr}`);
    assert.equal(baseOut.verdict, 'PASS', 'sanity: frame-transform is PASS at HEAD');

    // UNCHANGED — routed inside its own worktree, must match byte-for-byte.
    const wtSame = runVerify(mechWt);
    assert.equal(wtSame.stdout, base.stdout, 'in-worktree verdict is byte-identical across two independent HEAD checkouts');
    assert.equal(JSON.parse(wtSame.stdout).verdictHash, baseOut.verdictHash);

    // EDITED — mutate the target file INSIDE mechWt only (baselineWt untouched).
    const target = join(mechWt, 'src', 'core', 'state', 'state.ts');
    const src = readFileSync(target, 'utf8');
    const needle = 'const z = Math.min(zMax, Math.max(zMin, wantZ));';
    const hits = src.split(needle).length - 1;
    assert.equal(hits, 1, 'mutation anchor must occur exactly once in state.ts');
    writeFileSync(target, src.replace(needle, 'const z = wantZ;'));

    const wtEdited = runVerify(mechWt);
    const wtEditedOut = JSON.parse(wtEdited.stdout);
    assert.equal(wtEditedOut.verdict, 'FAIL', 'a worktree-local behavioural regression must FAIL');
    assert.notEqual(wtEditedOut.verdictHash, baseOut.verdictHash, 'verdict DIVERGES from the baseline after the worktree-local edit');

    // baselineWt (untouched) must still match its own earlier result —
    // proof the mutation stayed scoped to mechWt.
    const baseAgain = runVerify(baselineWt);
    assert.equal(baseAgain.stdout, base.stdout, 'the untouched worktree is unaffected by the other worktree\'s edit');

    // Regression control (the probe pattern): without the symlink, deps are
    // genuinely worktree-local — status.mjs cannot import ts-morph.
    // fs.rmSync (no recursive) refuses a symlink-to-directory on this Node
    // version — unlinkSync removes the link itself without following it.
    unlinkSync(join(mechWt, 'node_modules'));
    const noSymlink = runVerify(mechWt);
    assert.equal(noSymlink.status, 2, 'no node_modules symlink => bad-invocation exit');
    assert.match(noSymlink.stderr, /ERR_MODULE_NOT_FOUND/, 'ts-morph must be unresolvable without the symlink');

    // none of this touched the main ROOT working tree.
    const after = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout;
    assert.equal(after, before, 'main ROOT working tree must be unchanged by this test');
  } finally {
    cleanupWt(baselineWt);
    cleanupWt(mechWt);
  }
});
