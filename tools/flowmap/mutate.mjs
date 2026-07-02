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

     for each corpus mutation (tools/flowmap/mutations.json):
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
     node mutate.mjs [--corpus tools/flowmap/mutations.json]
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
const ROOT = join(HERE, '..', '..');

function arg(flag, fb = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fb;
}

const CORPUS = arg('--corpus', join(ROOT, 'tools', 'flowmap', 'mutations.json'));
const TIER = arg('--tier', 'fast');
const ONLY = arg('--id');
const JSON_OUT = process.argv.includes('--json');
const WT_BASE = arg('--wt-base', join(tmpdir(), 'flowmap-mutate-wt'));

if (!['fast', 'full'].includes(TIER)) { console.error(`unknown tier: ${TIER} (fast|full)`); process.exit(2); }

let corpus;
try { corpus = JSON.parse(readFileSync(CORPUS, 'utf8')); }
catch (e) { console.error('cannot read corpus: ' + e.message); process.exit(2); }

let mutations = corpus.mutations || [];
if (ONLY) {
  mutations = mutations.filter((m) => m.id === ONLY);
  if (!mutations.length) { console.error(`no mutation with id "${ONLY}" in ${CORPUS}`); process.exit(2); }
}

function git(args) {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  return { status: r.status ?? 1, stdout: r.stdout || '', stderr: r.stderr || '' };
}

function provision(id) {
  const wt = join(WT_BASE, id);
  git(['worktree', 'remove', '--force', wt]);
  try { if (existsSync(wt)) rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  git(['worktree', 'prune']);
  mkdirSync(WT_BASE, { recursive: true });
  const add = git(['worktree', 'add', '--detach', wt, 'HEAD']);
  if (add.status !== 0) return { wt: null, err: add.stderr.trim().split('\n')[0] };
  try { symlinkSync(join(ROOT, 'node_modules'), join(wt, 'node_modules'), 'dir'); }
  catch (e) { return { wt: null, err: 'node_modules symlink failed: ' + e.message }; }
  return { wt, err: null };
}

function teardown(id) {
  const wt = join(WT_BASE, id);
  git(['worktree', 'remove', '--force', wt]);
  try { if (existsSync(wt)) rmSync(wt, { recursive: true, force: true }); } catch { /* ignore */ }
  git(['worktree', 'prune']);
}

function occurrences(hay, needle) {
  let n = 0, i = 0;
  while ((i = hay.indexOf(needle, i)) !== -1) { n += 1; i += needle.length; }
  return n;
}

const results = [];
let staleCorpus = false;

for (const m of mutations) {
  const { wt, err } = provision(m.id);
  if (!wt) {
    results.push({ id: m.id, outcome: 'error', detail: `worktree: ${err}` });
    continue;
  }
  try {
    const target = join(wt, m.file);
    if (!existsSync(target)) {
      staleCorpus = true;
      results.push({ id: m.id, outcome: 'stale-corpus', detail: `${m.file} does not exist at HEAD` });
      continue;
    }
    const src = readFileSync(target, 'utf8');
    const hits = occurrences(src, m.find);
    if (hits !== 1) {
      staleCorpus = true;
      results.push({ id: m.id, outcome: 'stale-corpus', detail: `find-string occurs ${hits}x in ${m.file} (must be exactly 1) — the corpus no longer describes the code` });
      continue;
    }
    writeFileSync(target, src.replace(m.find, m.replace));

    const cmd = TIER === 'full' ? 'npm run spec:test:all' : m.fast;
    const run = spawnSync('sh', ['-c', cmd],
      { cwd: wt, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 1_200_000,
        env: { ...process.env, FLOWMAP_ROADMAP_SKIP_CMD: '1' } });
    const observed = run.status === 0 ? 'survived' : 'caught';
    const ok = observed === m.expect;
    results.push({ id: m.id, tier: TIER, expect: m.expect, observed, ok });
  } finally {
    teardown(m.id);
  }
}

const mismatches = results.filter((r) => r.ok === false);
const errors = results.filter((r) => r.outcome === 'error' || r.outcome === 'stale-corpus');
const exit = staleCorpus || errors.length ? 2 : mismatches.length ? 1 : 0;

if (JSON_OUT) {
  console.log(JSON.stringify({ tier: TIER, corpus: mutations.length, results, exit }, null, 2));
  process.exit(exit);
}

console.log(`=== flowmap:mutate — ${mutations.length} mutation(s), tier ${TIER} ===`);
for (const r of results) {
  if (r.outcome) { console.log(`  ✗ ${r.id} — ${r.outcome}: ${r.detail}`); continue; }
  const mark = r.ok ? '✓' : '✗';
  console.log(`  ${mark} ${r.id} — expected ${r.expect}, observed ${r.observed}${r.ok ? '' : '  <-- EXPECTATION BROKEN'}`);
}
if (exit === 0) {
  console.log('\nHARNESS GREEN — every deliberate defect got exactly the reaction the corpus expects.');
} else if (exit === 1) {
  console.log('\nHARNESS RED — an expectation broke. expected-caught that SURVIVED = a deny test silently died (fix the suite);');
  console.log('expected-survived that was CAUGHT = coverage improved (update the corpus entry to caught).');
} else {
  console.log('\nHARNESS REFUSED — stale corpus or worktree failure (see above). Fix the corpus so it describes the real code.');
}
process.exit(exit);
