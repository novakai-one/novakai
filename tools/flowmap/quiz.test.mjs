/* quiz.test.mjs — acceptance for Keystone 1's machinery (AUD5 fix F-03,
   docs/flowmap/audit/04-findings.md).

   AUD2 A4 / AUD3 T10: the quiz claimed "understanding becomes pass/fail" but
   ran in nothing and had no test; a committed answers file was a replay
   surface. Now a 100% check emits a pass artifact bound to the sha256 of the
   exact map bytes, and `verify` proves it against the CURRENT map. All tests
   spawn the real CLI in a temp cwd with a hand-knowable fixture map, so the
   repo's own quiz state is never touched. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), 'quiz.mjs');

// Two-node fixture whose every derivable answer is hand-knowable.
const FIXTURE_MMD = `flowchart TD
  camera["camera"]
  camera__toWorld("toWorld")
%% kind camera module
%% kind camera__toWorld function
%% fm:meta camera__toWorld name=toWorld
%% fm:meta camera__toWorld i0.name=toWorld
%% fm:meta camera__toWorld i0.accepts=sx: number
%% fm:meta camera__toWorld i0.returns=Point
`;
const FACTS = {
  camera: { kind: 'module', owner: 'camera', parent: 'none' },
  camera__toWorld: { kind: 'function', owner: 'camera', parent: 'none', arity: '1', returns: 'value' },
};

function answerFor(prompt, ref) {
  const f = FACTS[ref];
  if (prompt.startsWith('What is the node kind')) return f.kind;
  if (prompt.startsWith('Which top-level module')) return f.owner;
  if (prompt.startsWith('What is the drill-in parent')) return f.parent;
  if (prompt.startsWith('How many parameters')) return f.arity;
  if (prompt.startsWith('Does')) return f.returns;
  throw new Error(`unrecognised prompt: ${prompt}`);
}

function quiz(cwd, args) {
  // FLOWMAP_ROOT here is the M2b emitter seam: check-attempt events land in
  // the fixture dir, never in the repo's real metrics log.
  const r = spawnSync('node', [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, FLOWMAP_ROOT: cwd } });
  return { status: r.status, stdout: r.stdout ?? '' };
}

/** Temp dir with the fixture map; quiz state lives in this cwd only. */
function mkfixture() {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-t-'));
  writeFileSync(join(dir, 'map.mmd'), FIXTURE_MMD);
  return dir;
}
const MAP_ARGS = ['--map', 'map.mmd', '--n', '4', '--seed', '1'];

function generate(dir) {
  const r = quiz(dir, ['generate', ...MAP_ARGS, '--out', 'questions.json']);
  assert.equal(r.status, 0, r.stdout);
  return JSON.parse(readFileSync(join(dir, 'questions.json'), 'utf8'));
}

test('generate is deterministic: same map+seed -> identical question files', () => {
  const dir = mkfixture();
  try {
    const a = generate(dir);
    const b = generate(dir);
    assert.deepEqual(a, b);
    assert.ok(a.questions.length >= 2, 'fixture must yield at least 2 computable questions');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check DENIES wrong answers (exit 1) and writes NO pass artifact', () => {
  const dir = mkfixture();
  try {
    const qs = generate(dir).questions;
    const wrong = Object.fromEntries(qs.map((q) => [q.id, 'zzz-wrong']));
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(wrong));
    const r = quiz(dir, ['check', '--answers', 'answers.json', ...MAP_ARGS]);
    assert.equal(r.status, 1);
    assert.equal(existsSync(join(dir, '.flowmap-quiz-pass.json')), false,
      'a failed check must not leave a pass artifact');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check on 100% exits 0 and emits a pass artifact bound to the map hash (F-03)', () => {
  const dir = mkfixture();
  try {
    const qs = generate(dir).questions;
    const right = Object.fromEntries(qs.map((q) => [q.id, answerFor(q.prompt, q.ref)]));
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(right));
    const r = quiz(dir, ['check', '--answers', 'answers.json', ...MAP_ARGS]);
    assert.equal(r.status, 0, r.stdout);
    const pass = JSON.parse(readFileSync(join(dir, '.flowmap-quiz-pass.json'), 'utf8'));
    assert.match(pass.mapHash, /^[0-9a-f]{64}$/);
    assert.equal(pass.score.split('/')[0], pass.score.split('/')[1], 'recorded score is a full pass');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify: DENIES with no artifact; passes after a pass; DENIES once the map changes (F-03)', () => {
  const dir = mkfixture();
  try {
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 1, 'no artifact -> not verified');
    const qs = generate(dir).questions;
    const right = Object.fromEntries(qs.map((q) => [q.id, answerFor(q.prompt, q.ref)]));
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(right));
    assert.equal(quiz(dir, ['check', '--answers', 'answers.json', ...MAP_ARGS]).status, 0);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 0, 'fresh pass -> verified');
    appendFileSync(join(dir, 'map.mmd'), '%% a comment changes the bytes\n');
    const stale = quiz(dir, ['verify', '--map', 'map.mmd']);
    assert.equal(stale.status, 1, 'any map change must invalidate the pass');
    assert.match(stale.stdout, /STALE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify: a tampered artifact claiming a partial score is DENIED', () => {
  const dir = mkfixture();
  try {
    writeFileSync(join(dir, '.flowmap-quiz-pass.json'),
      JSON.stringify({ map: 'map.mmd', seed: 1, n: 4, score: '3/4', mapHash: 'f'.repeat(64) }));
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('M2b: BOTH check outcomes are metered (pass rate = attempts, not just passes) — exit codes unchanged', () => {
  const dir = mkfixture();
  try {
    const qs = generate(dir).questions;
    const wrong = Object.fromEntries(qs.map((q) => [q.id, 'zzz-wrong']));
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(wrong));
    assert.equal(quiz(dir, ['check', '--answers', 'answers.json', ...MAP_ARGS]).status, 1);
    const right = Object.fromEntries(qs.map((q) => [q.id, answerFor(q.prompt, q.ref)]));
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(right));
    assert.equal(quiz(dir, ['check', '--answers', 'answers.json', ...MAP_ARGS]).status, 0);
    const log = join(dir, 'docs', 'flowmap', 'metrics', 'session-log.jsonl');
    const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    const checks = lines.filter((l) => l.event === 'quiz' && l.cmd === 'check');
    assert.equal(checks.length, 2, 'a FAILED attempt must leave a record too');
    assert.deepEqual(checks.map((c) => c.pass), [false, true]);
    assert.match(checks[1].mapHash, /^[0-9a-f]{64}$/, 'provenance rides along');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
