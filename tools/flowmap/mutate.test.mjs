/* =====================================================================
   mutate.test.mjs — meta-tests for the mutation harness (mutate.mjs).

   The harness itself must be deny-proven (the AUD3 T4 lesson applies to
   the instrument too): a harness that reports GREEN on a broken corpus
   or a dead expectation is worse than none. Synthetic single-mutation
   corpora prove the three verdict classes via the real spawned CLI:
     expectation met       → exit 0
     expectation broken    → exit 1
     corpus stale (find≠1) → exit 2 (refusal, names the mutation)

   The REAL corpus (tools/flowmap/mutations.json) is deliberately NOT run
   here — each entry costs a worktree + a test-file run (fast) or a whole
   suite (full), and full tier would recurse into this very file. Run it
   on demand: `npm run flowmap:mutate` / `npm run flowmap:mutate:full`.
   ===================================================================== */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import * as fsSync from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

// package.json's name field is a stable, unique find-anchor at HEAD.
const FIND = '"name": "flowmap",';

function runMutate(dir, corpusObj) {
  const corpus = join(dir, 'corpus.json');
  writeFileSync(corpus, JSON.stringify(corpusObj));
  return spawnSync('node', [join('tools', 'flowmap', 'mutate.mjs'),
    '--corpus', corpus, '--wt-base', join(dir, 'wt')],
  { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 300_000 });
}

const entry = (over) => ({
  id: 'synthetic', file: 'package.json',
  find: FIND, replace: '"name": "flowmap-mutant",',
  fast: 'node -e "process.exit(1)"', expect: 'caught', ...over,
});

test('harness: expectation met (caught as expected) → exit 0', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mutate-t-'));
  try {
    const r = runMutate(dir, { mutations: [entry({})] });
    assert.equal(r.status, 0, `expected green harness:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /HARNESS GREEN/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('harness: expectation broken (expected survived, tests caught it) → exit 1', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mutate-t-'));
  try {
    const r = runMutate(dir, { mutations: [entry({ expect: 'survived' })] });
    assert.equal(r.status, 1, `a broken expectation must exit 1:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /EXPECTATION BROKEN/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('harness: a survived mutation is observed as survived (tests pass → survived)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mutate-t-'));
  try {
    const r = runMutate(dir, { mutations: [entry({ fast: 'node -e "process.exit(0)"', expect: 'survived' })] });
    assert.equal(r.status, 0, `survived-as-expected is green:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /expected survived, observed survived/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('harness: stale corpus (find-string not in the file) → refusal, exit 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mutate-t-'));
  try {
    const r = runMutate(dir, { mutations: [entry({ find: 'ZZ-NEVER-IN-PACKAGE-JSON' })] });
    assert.equal(r.status, 2, `a stale corpus must refuse:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /stale-corpus/, 'names the refusal class');
    assert.match(r.stdout, /synthetic/, 'names the offending mutation id');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('harness: the REAL corpus is not stale (every find-string matches HEAD exactly once)', () => {
  // Cheap freshness half only (no worktrees, no test runs): each corpus
  // entry's find-anchor must occur exactly once in the HEAD revision of its
  // target — HEAD is what the harness's worktrees actually mutate.
  const { readFileSync } = fsSync;
  const corpus = JSON.parse(readFileSync(join(ROOT, 'tools', 'flowmap', 'mutations.json'), 'utf8'));
  for (const m of corpus.mutations) {
    const src = spawnSync('git', ['show', `HEAD:${m.file}`], { cwd: ROOT, encoding: 'utf8' }).stdout;
    const hits = src.split(m.find).length - 1;
    assert.equal(hits, 1, `${m.id}: find-string must occur exactly once in HEAD:${m.file} (got ${hits})`);
  }
});
