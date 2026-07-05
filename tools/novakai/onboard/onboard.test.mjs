/* =====================================================================
   onboard.test.mjs — AUD5/F-09: the handoff-freshness state must surface
   at session START, not only at clean session Stop.

   Attack A8: the Stop-hook nudge fires only on a clean Stop — a session
   that crashes mid-operation never gets the freshness nudge, so the next
   session starts on a stale handoff with no warning. Start-of-session is
   crash-proof: whatever killed the last session, the next one always
   onboards. (F4 CI remains the hard backstop that blocks the merge.)

   NOTE: this spawns the real onboard (novakai:verify + roadmap), so it is
   the slowest test in the suite — one spawn, all assertions share it.
   Deny-side smoke tests (stale map => exit 1) are F-17's scope.

   NOVAKAI_ROADMAP_SKIP_CMD: onboard's STEP 6 roadmap normally executes the
   roadmap.json cmd predicates — which spawn gate tools (incl. orchestrate
   with git worktrees) CONCURRENTLY with the rest of this suite and race it
   (seen in CI: a parallel orchestrate's worktree tripped orchestrate.test's
   cleanup assertion). Skipping cmds here only DOWNGRADES statuses
   (built -> partial, per roadmap.mjs); every file/grep predicate and every
   onboard step still runs for real.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

const r = spawnSync('node', [join('tools', 'novakai', 'onboard', 'onboard.mjs')],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000,
    env: { ...process.env, NOVAKAI_ROADMAP_SKIP_CMD: '1' } });

test('onboard exits 0 on the real repo (the map at HEAD is trustworthy)', () => {
  assert.equal(r.status, 0, `onboard failed:\n${r.stdout}\n${r.stderr}`);
});

test('F-09: onboard surfaces the handoff-freshness state every session start', () => {
  assert.match(r.stdout, /handoff/i,
    'onboard output must mention the handoff-freshness check');
  assert.match(r.stdout, /HANDOFF (TRUSTWORTHY|MAKES A FALSE CLAIM)/,
    'onboard must print the computed handoff verdict (trustworthy or false-claim)');
});

/* ---------- AUD5/F-17: the deny side — "exit 0 = trustworthy, 1 = NOT"
   was never exercised (AUD3 T10). Prove it on a doctored checkout: an
   isolated git worktree (node_modules symlinked in) with one fragment
   deleted — file-coverage must fail, and onboard must STOP with exit 1. */

import { symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { mkdtempSync } from 'node:fs';

test('F-17 deny: onboard exits 1 on a doctored checkout (map incomplete vs code)', () => {
  const base = mkdtempSync(join(tmpdir(), 'onboard-deny-'));
  const wt = join(base, 'wt');
  const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  try {
    const add = git(['worktree', 'add', '--detach', wt, 'HEAD']);
    assert.equal(add.status, 0, `worktree add failed: ${add.stderr}`);
    symlinkSync(join(ROOT, 'node_modules'), join(wt, 'node_modules'), 'dir');
    // doctor: delete one fragment — its source files lose their %% src pointers,
    // so novakai:verify's coverage step must fail inside onboard STEP 1.
    const frag = join(wt, 'src', 'core', 'camera', 'camera.novakai.mmd');
    assert.ok(existsSync(frag), 'fixture fragment exists at HEAD');
    rmSync(frag);
    const deny = spawnSync('node', [join('tools', 'novakai', 'onboard', 'onboard.mjs')],
      { cwd: wt, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000,
        env: { ...process.env, NOVAKAI_ROADMAP_SKIP_CMD: '1' } });
    assert.equal(deny.status, 1, `doctored checkout must exit 1:\n${deny.stdout}\n${deny.stderr}`);
    assert.match(deny.stdout, /STOP — the map is NOT trustworthy/,
      'onboard names the refusal, not just a non-zero exit');
    assert.match(deny.stdout, /camera\.ts/,
      'the refusal is for the RIGHT reason: coverage names the file the doctored map lost');
  } finally {
    git(['worktree', 'remove', '--force', wt]);
    git(['worktree', 'prune']);
    rmSync(base, { recursive: true, force: true });
  }
});

/* ---------- onboard-cost item 3: the --continue track (design:
   docs/novakai/onboard-cost-design.md). Spawned against the real repo like
   the full-track run above; the m4 plan's refs resolve to src modules. */

const CONT_RULE = 'Design questions outside the proven scope require either reading the relevant fragments and re-quizzing that scope, or re-running full onboard.';

test('continue track: scoped pointers, scoped quiz commands, and the verbatim out-of-scope rule', () => {
  const c = spawnSync('node', [join('tools', 'novakai', 'onboard', 'onboard.mjs'), '--continue',
    '--plan', join('docs', 'novakai', 'plans', 'm4-read-primary.plan.json')],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
  assert.equal(c.status, 0, `continue onboard failed:\n${c.stdout}\n${c.stderr}`);
  assert.ok(c.stdout.includes(CONT_RULE), 'the out-of-scope design-question rule must be printed verbatim');
  assert.match(c.stdout, /root\.mmd/, 'continue track points at root.mmd, not the whole bundle');
  assert.match(c.stdout, /--scope [^\n]*viewspec/, 'scoped quiz command names the plan modules');
  assert.match(c.stdout, /src\/core\/viewspec\/viewspec\.novakai\.mmd/, 'the plan modules fragments are listed');
  assert.doesNotMatch(c.stdout, /read docs\/novakai\/_bundle\.mmd\b/i, 'continue track must not direct a wholesale bundle read');
});

test('continue track: --continue without --plan is a usage error (exit 2)', () => {
  const c = spawnSync('node', [join('tools', 'novakai', 'onboard', 'onboard.mjs'), '--continue'],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
  assert.equal(c.status, 2);
});
