#!/usr/bin/env node
/* =====================================================================
   mutate.mjs — the mutation harness: proves the suite's DENY coverage
   stays real, instead of trusting that it once was.
   ---------------------------------------------------------------------
   AUD3 broke three gate predicates by hand and found two of the three
   mutations SURVIVED the whole suite (03-tests.md §2). The AUD5 fixes
   added the killing tests — but a one-off manual experiment rots: the
   next refactor can silently orphan a deny test again. This harness
   re-runs the experiment on demand, mechanically:

     for each corpus mutation (tools/novakai/verify/mutations.json):
       1. provision an ISOLATED git worktree at HEAD (never the main
          tree — AUD3 had to mutate in place and revert by hand);
          node_modules is symlinked in (worktrees don't carry it);
       2. verify `find` occurs EXACTLY once in the target file, then
          apply the mutation (a moved/renamed target = STALE corpus =
          refusal, so the corpus cannot silently test nothing);
       3. run the tier command INSIDE the worktree —
            fast (default): the mutation's own `fast` test file(s)
            full (--tier full): the whole `npm run spec:test:all`
       4. observed = tests fail => CAUGHT · tests pass => SURVIVED;
       5. tear the worktree down (always — pass/fail/crash).

   The verdict compares observed against the corpus `expect` (set to
   MEASURED current reality): expected-caught that survives = a gate
   silently died (the exact AUD3 failure mode); expected-survived that
   is caught = reality improved — update the corpus entry.

   NOTE: mutations run against HEAD (committed state), not the working
   tree — commit before expecting the harness to see your changes.

   Usage:
     node mutate.mjs [--corpus tools/novakai/verify/mutations.json]
                     [--tier fast|full] [--id <mutation-id>] [--json]
                     [--wt-base <dir>]   (worktree parent; default under tmp —
                                          pass a unique dir when running the
                                          harness from inside another harness)
   Exit: 0 = every mutation matched its expectation,
         1 = >= 1 expectation mismatch,
         2 = bad invocation / stale corpus / worktree failure.
   ===================================================================== */

import { readFileSync, writeFileSync, rmSync, existsSync, symlinkSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const CORPUS = arg('--corpus', join(ROOT, 'tools', 'novakai', 'verify', 'mutations.json'));
const TIER = arg('--tier', 'fast');
const ONLY = arg('--id');
const JSON_OUT = process.argv.includes('--json');
const WT_BASE = arg('--wt-base', join(tmpdir(), 'novakai-mutate-wt'));
const OUTCOME_STALE_CORPUS = 'stale-corpus';

if (!['fast', 'full'].includes(TIER)) {
  console.error(`unknown tier: ${TIER} (fast|full)`);
  process.exit(2);
}

let corpus;
try {
  corpus = JSON.parse(readFileSync(CORPUS, 'utf8'));
} catch (e) {
  console.error('cannot read corpus: ' + e.message);
  process.exit(2);
}

let mutations = corpus.mutations || [];
if (ONLY) {
  mutations = mutations.filter((mutation) => mutation.id === ONLY);
  if (!mutations.length) {
    console.error(`no mutation with id "${ONLY}" in ${CORPUS}`);
    process.exit(2);
  }
}

function git(args) {
  const spawnResult = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { status: spawnResult.status ?? 1, stdout: spawnResult.stdout || '', stderr: spawnResult.stderr || '' };
}

function provision(id) {
  const worktreeDir = join(WT_BASE, id);
  git(['worktree', 'remove', '--force', worktreeDir]);
  try {
    if (existsSync(worktreeDir)) rmSync(worktreeDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  git(['worktree', 'prune']);
  mkdirSync(WT_BASE, { recursive: true });
  const add = git(['worktree', 'add', '--detach', worktreeDir, 'HEAD']);
  if (add.status !== 0) return { dir: null, err: add.stderr.trim().split('\n')[0] };
  try {
    symlinkSync(join(ROOT, 'node_modules'), join(worktreeDir, 'node_modules'), 'dir');
  } catch (e) {
    return { dir: null, err: 'node_modules symlink failed: ' + e.message };
  }
  return { dir: worktreeDir, err: null };
}

function teardown(id) {
  const worktreeDir = join(WT_BASE, id);
  git(['worktree', 'remove', '--force', worktreeDir]);
  try {
    if (existsSync(worktreeDir)) rmSync(worktreeDir, { recursive: true, force: true });
  } catch { /* ignore */ }
  git(['worktree', 'prune']);
}

function occurrences(hay, needle) {
  let count = 0;
  let i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) {
    count += 1;
    i += needle.length;
  }
  return count;
}

const results = [];
let staleCorpus = false;

for (const mutation of mutations) {
  const { dir: worktreeDir, err } = provision(mutation.id);
  if (!worktreeDir) {
    results.push({ id: mutation.id, outcome: 'error', detail: `worktree: ${err}` });
    continue;
  }
  try {
    const target = join(worktreeDir, mutation.file);
    if (!existsSync(target)) {
      staleCorpus = true;
      results.push({
        id: mutation.id, outcome: OUTCOME_STALE_CORPUS, detail: `${mutation.file} does not exist at HEAD`,
      });
      continue;
    }
    const src = readFileSync(target, 'utf8');
    const hits = occurrences(src, mutation.find);
    if (hits !== 1) {
      staleCorpus = true;
      results.push({
        id: mutation.id, outcome: OUTCOME_STALE_CORPUS,
        detail: `find-string occurs ${hits}x in ${mutation.file} (must be exactly 1) — ` +
          'the corpus no longer describes the code',
      });
      continue;
    }
    writeFileSync(target, src.replace(mutation.find, mutation.replace));

    const cmd = TIER === 'full' ? 'npm run spec:test:all' : mutation.fast;
    const run = spawnSync('sh', ['-c', cmd],
      { cwd: worktreeDir, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_200_000,
        env: { ...process.env, NOVAKAI_ROADMAP_SKIP_CMD: '1' } });
    const observed = run.status === 0 ? 'survived' : 'caught';
    const expectationMet = observed === mutation.expect;
    results.push({ id: mutation.id, tier: TIER, expect: mutation.expect, observed, matched: expectationMet });
  } finally {
    teardown(mutation.id);
  }
}

const mismatches = results.filter((entry) => entry.matched === false);
const errors = results.filter((entry) => entry.outcome === 'error' || entry.outcome === OUTCOME_STALE_CORPUS);
const exit = staleCorpus || errors.length ? 2 : mismatches.length ? 1 : 0;

if (JSON_OUT) {
  console.log(JSON.stringify({ tier: TIER, corpus: mutations.length, results, exit }, null, 2));
  process.exit(exit);
}

console.log(`=== novakai:mutate — ${mutations.length} mutation(s), tier ${TIER} ===`);
for (const entry of results) {
  if (entry.outcome) {
    console.log(`  ✗ ${entry.id} — ${entry.outcome}: ${entry.detail}`);
    continue;
  }
  const mark = entry.matched ? '✓' : '✗';
  console.log(
    `  ${mark} ${entry.id} — expected ${entry.expect}, observed ${entry.observed}` +
    `${entry.matched ? '' : '  <-- EXPECTATION BROKEN'}`
  );
}
if (exit === 0) {
  console.log('\nHARNESS GREEN — every deliberate defect got exactly the reaction the corpus expects.');
} else if (exit === 1) {
  console.log(
    '\nHARNESS RED — an expectation broke. expected-caught that SURVIVED = a deny test silently died ' +
    '(fix the suite);'
  );
  console.log('expected-survived that was CAUGHT = coverage improved (update the corpus entry to caught).');
} else {
  console.log(
    '\nHARNESS REFUSED — stale corpus or worktree failure (see above). Fix the corpus so it describes the real code.'
  );
}
process.exit(exit);
