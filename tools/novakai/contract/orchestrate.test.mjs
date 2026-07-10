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
import { hashOf, sha256hex } from '../lib/canonical.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const PLAN = join(ROOT, 'public', 'plan.json');
const FLAG_NO_WORKTREE = '--no-worktree';

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
const ONE = runOrch([FLAG_NO_WORKTREE]);
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
  const summary = OUT.summary;
  assert.equal(summary.pass + summary.passUnproven + summary.fail, summary.total, 'pass+passUnproven+fail === total');
  assert.equal(summary.total, OUT.dispatched.length, 'total === dispatched length');
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
  const replay = runOrch([FLAG_NO_WORKTREE]);
  assert.equal(ONE.stdout, replay.stdout, 'orchestrate stdout must be deterministic');
  assert.equal(ONE.status, replay.status, 'exit status must be deterministic');
});

/** F-14 fixture: a plan whose sole change references a node that will never
 *  exist in the code, so its verdict is unconditionally FAIL. Returns the
 *  temp dir (caller cleans it up) and the fixture plan path. */
function writeGhostFixturePlan() {
  const dir = mkdtempSync(join(tmpdir(), 'novakai-f14-'));
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
  return { dir, fixturePlan };
}

test('AUD5/F-14: a guaranteed-FAIL fixture plan exits 1 UNCONDITIONALLY (not data-dependent)', () => {
  // AUD3: the exit-1-iff-FAIL check above is data-dependent on the live
  // public/plan.json state — if that plan ever becomes fully built, the
  // blocking path would go unexercised. This fixture cannot become built:
  // it adds a node whose symbol will never exist in the code.
  const { dir, fixturePlan } = writeGhostFixturePlan();
  try {
    const result = spawnSync('node', [join(HERE, 'orchestrate.mjs'),
      '--plan', fixturePlan, '--json', FLAG_NO_WORKTREE],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 120_000,
      env: { ...process.env, NOVAKAI_ROOT: METRICS_SINK } });
    assert.ok(result.stdout, `orchestrate produced stdout; stderr: ${result.stderr}`);
    const out = JSON.parse(result.stdout);
    assert.deepEqual(out.dispatched, ['ghost-add'], 'the fixture change is dispatched in wave 0');
    assert.equal(out.verdicts['ghost-add'].verdict, 'FAIL', 'an unbuilt add must verdict FAIL');
    assert.equal(out.summary.fail, 1);
    assert.equal(result.status, 1, 'a FAIL in the wave must exit 1 — unconditionally');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('per-change worktree provisioning leaves no leftover worktrees', () => {
  // default mode provisions + tears down an isolated worktree per dispatched change
  const result = runOrch();
  assert.ok(result.stdout, 'default-mode run produced stdout');
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
// process.cwd() disagrees with the path string handed to it; and namespaced
// by a hash of ROOT so this repo's several concurrent git worktrees, which
// share one .git and one machine-global tmpdir, never collide on the same
// path) — kept in sync so this test can inspect the --keep-worktrees output.
const WT_BASE = join(realpathSync(tmpdir()), `novakai-orchestrate-wt-${sha256hex(ROOT).slice(0, 12)}`);

function cleanupWt(worktreeDir) {
  spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], { cwd: ROOT });
  rmSync(worktreeDir, { recursive: true, force: true });
  spawnSync('git', ['worktree', 'prune'], { cwd: ROOT });
}

/** WI-6a: the kept worktree's node_modules symlink resolves to the main repo's. */
function assertKeptWorktreeSymlink(id, worktreeDir) {
  const nodeModules = join(worktreeDir, 'node_modules');
  assert.ok(
    existsSync(join(nodeModules, 'ts-morph')),
    `worktree[${id}]: symlinked node_modules RESOLVES (ts-morph reachable through it)`,
  );
  assert.equal(
    realpathSync(nodeModules), realpathSync(join(ROOT, 'node_modules')),
    `worktree[${id}]: node_modules symlink points at the main repo's`,
  );
}

/** WI-6b: the kept worktree's CONTRACT.json is the sliced packet (subMap + slicedBodies). */
function assertKeptWorktreeContract(id, worktreeDir) {
  const contract = JSON.parse(readFileSync(join(worktreeDir, 'CONTRACT.json'), 'utf8'));
  assert.ok(
    Object.prototype.hasOwnProperty.call(contract, 'subMap'),
    `worktree[${id}]: CONTRACT.json carries subMap (sliced packet, not the old metadata-only shape)`,
  );
  assert.ok(
    Object.prototype.hasOwnProperty.call(contract, 'slicedBodies'),
    `worktree[${id}]: CONTRACT.json carries slicedBodies`,
  );
}

/** WI-6a/b: assert a single kept worktree has a resolvable node_modules
 *  symlink and the sliced CONTRACT.json packet (subMap + slicedBodies). */
function assertKeptWorktree(id) {
  const worktreeDir = join(WT_BASE, id);
  assert.ok(existsSync(worktreeDir), `worktree[${id}] was provisioned`);
  assertKeptWorktreeSymlink(id, worktreeDir);
  assertKeptWorktreeContract(id, worktreeDir);
}

test(
  'WI-6a/b: --keep-worktrees provisions a WORKING node_modules symlink and drops the SLICED packet ' +
  '(subMap+slicedBodies) as CONTRACT.json',
  () => {
    const result = runOrch(['--keep-worktrees']);
    const out = result.stdout ? JSON.parse(result.stdout) : null;
    assert.ok(out, `orchestrate produced stdout; stderr: ${result.stderr}`);
    // public/plan.json's wave 0 is currently all-"add" (unbuilt) changes — if
    // that ever changes, this guard fails loudly instead of passing vacuously.
    assert.ok(out.dispatched.length > 0, 'expected >=1 dispatched change to inspect a kept worktree for');
    try {
      for (const id of out.dispatched) assertKeptWorktree(id);
    } finally {
      for (const id of out.dispatched) cleanupWt(join(WT_BASE, id));
    }
  },
);

/** WI-6c/d harness: run verify-change.mjs for frame-transform inside `cwd`,
 *  exactly the way orchestrate.mjs itself routes a verdict tool into a
 *  worktree (see orchestrate.mjs's routeTool/verify-change wiring). */
function runVerifyChange(cwd) {
  return spawnSync('node', [
    'tools/novakai/contract/verify-change.mjs', '--change', 'frame-transform',
    '--plan', join(cwd, 'public', 'plan.json'),
    '--map', join(cwd, 'docs', 'novakai', '_bundle.mmd'),
    '--tsconfig', join(cwd, 'tsconfig.json'), '--json',
  ], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

/** Fresh `git worktree add --detach HEAD` checkouts for both sides of the
 *  WI-6c/d comparison, each with node_modules symlinked in (see
 *  orchestrate.mjs's WHY on the symlink). */
function provisionMechWorktrees(worktreeDirs) {
  for (const worktreeDir of worktreeDirs) {
    const add = spawnSync('git', ['worktree', 'add', '--detach', worktreeDir, 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
    assert.equal(add.status, 0, 'git worktree add failed: ' + add.stderr);
    symlinkSync(join(ROOT, 'node_modules'), join(worktreeDir, 'node_modules'), 'dir');
  }
}

/** Mutate state.ts's clamp line INSIDE `worktreeDir` only — the worktree-local
 *  behavioural regression WI-6d proves diverges from the baseline verdict. */
function mutateClampInWorktree(worktreeDir) {
  const target = join(worktreeDir, 'src', 'core', 'state', 'state.ts');
  const src = readFileSync(target, 'utf8');
  const needle = 'const z = Math.min(zMax, Math.max(zMin, wantZ));';
  const hits = src.split(needle).length - 1;
  assert.equal(hits, 1, 'mutation anchor must occur exactly once in state.ts');
  writeFileSync(target, src.replace(needle, 'const z = wantZ;'));
}

/** UNCHANGED — routed inside its own worktree, must match byte-for-byte. */
function assertUnchangedMatchesBaseline(mechWt, base, baseOut) {
  const wtSame = runVerifyChange(mechWt);
  assert.equal(
    wtSame.stdout, base.stdout,
    'in-worktree verdict is byte-identical across two independent HEAD checkouts',
  );
  assert.equal(JSON.parse(wtSame.stdout).verdictHash, baseOut.verdictHash);
}

/** EDITED — mutate the target file INSIDE mechWt only (baselineWt untouched),
 *  and prove the verdict both FAILs and diverges from the baseline hash. */
function assertEditedDivergesFromBaseline(mechWt, baseOut) {
  mutateClampInWorktree(mechWt);
  const wtEdited = runVerifyChange(mechWt);
  const wtEditedOut = JSON.parse(wtEdited.stdout);
  assert.equal(wtEditedOut.verdict, 'FAIL', 'a worktree-local behavioural regression must FAIL');
  assert.notEqual(
    wtEditedOut.verdictHash, baseOut.verdictHash,
    'verdict DIVERGES from the baseline after the worktree-local edit',
  );
}

/** baselineWt (untouched) must still match its own earlier result — proof
 *  the mutation stayed scoped to mechWt. */
function assertBaselineUnaffected(baselineWt, base) {
  const baseAgain = runVerifyChange(baselineWt);
  assert.equal(baseAgain.stdout, base.stdout, "the untouched worktree is unaffected by the other worktree's edit");
}

/** Regression control (the probe pattern): without the symlink, deps are
 *  genuinely worktree-local — status.mjs cannot import ts-morph. fs.rmSync
 *  (no recursive) refuses a symlink-to-directory on this Node version —
 *  unlinkSync removes the link itself without following it. */
function assertNoSymlinkRegressionControl(mechWt) {
  unlinkSync(join(mechWt, 'node_modules'));
  const noSymlink = runVerifyChange(mechWt);
  assert.equal(noSymlink.status, 2, 'no node_modules symlink => bad-invocation exit');
  assert.match(noSymlink.stderr, /ERR_MODULE_NOT_FOUND/, 'ts-morph must be unresolvable without the symlink');
}

/** WI-6c/d comparison: provision fresh worktrees for both sides, verify
 *  frame-transform's verdict matches an independent HEAD checkout when
 *  unchanged, diverges after a worktree-local edit, and confirm neither
 *  side touched the main ROOT working tree. */
function assertMechComparison(baselineWt, mechWt, before) {
  provisionMechWorktrees([baselineWt, mechWt]);

  // baseline: an independent HEAD checkout, run the same "in-worktree" way.
  const base = runVerifyChange(baselineWt);
  const baseOut = base.stdout ? JSON.parse(base.stdout) : null;
  assert.ok(baseOut, `baseline verify-change produced stdout; stderr: ${base.stderr}`);
  assert.equal(baseOut.verdict, 'PASS', 'sanity: frame-transform is PASS at HEAD');

  assertUnchangedMatchesBaseline(mechWt, base, baseOut);
  assertEditedDivergesFromBaseline(mechWt, baseOut);
  assertBaselineUnaffected(baselineWt, base);
  assertNoSymlinkRegressionControl(mechWt);

  // none of this touched the main ROOT working tree.
  const after = spawnSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' }).stdout;
  assert.equal(after, before, 'main ROOT working tree must be unchanged by this test');
}

test(
  'WI-6c/d: verify-change routed INSIDE a worktree matches an independent HEAD checkout for an unchanged ' +
  'real change, and DIVERGES after a worktree-local edit',
  () => {
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
      assertMechComparison(baselineWt, mechWt, before);
    } finally {
      cleanupWt(baselineWt);
      cleanupWt(mechWt);
    }
  },
);
