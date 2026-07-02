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

/* ---------- onboard-cost item 4 (session-bound pass; design:
   docs/flowmap/onboard-cost-design.md) ---------- */

test('session: check records --session (flag beats env; neither -> null)', () => {
  const dir = mkfixture();
  try {
    const qs = generate(dir).questions;
    const right = Object.fromEntries(qs.map((q) => [q.id, answerFor(q.prompt, q.ref)]));
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(right));

    const run = (extra, env) => spawnSync('node',
      [CLI, 'check', '--answers', 'answers.json', ...MAP_ARGS, ...extra],
      { cwd: dir, encoding: 'utf8', env: { ...process.env, FLOWMAP_ROOT: dir, ...env } });

    assert.equal(run(['--session', 'flag-sess'], { CLAUDE_CODE_SESSION_ID: 'env-sess' }).status, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, '.flowmap-quiz-pass.json'), 'utf8')).session, 'flag-sess',
      'the explicit flag must beat the env');

    assert.equal(run([], { CLAUDE_CODE_SESSION_ID: 'env-sess' }).status, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, '.flowmap-quiz-pass.json'), 'utf8')).session, 'env-sess',
      'the harness env is the default identity');

    assert.equal(run([], { CLAUDE_CODE_SESSION_ID: '' }).status, 0);
    assert.equal(JSON.parse(readFileSync(join(dir, '.flowmap-quiz-pass.json'), 'utf8')).session, null,
      'no flag and no env -> null (manual CLI, documented boundary)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('session: verify --session matches / mismatches / legacy artifact; flagless stays hash-only', () => {
  const dir = mkfixture();
  try {
    const qs = generate(dir).questions;
    const right = Object.fromEntries(qs.map((q) => [q.id, answerFor(q.prompt, q.ref)]));
    writeFileSync(join(dir, 'answers.json'), JSON.stringify(right));
    assert.equal(quiz(dir, ['check', '--answers', 'answers.json', ...MAP_ARGS, '--session', 'sess-A']).status, 0);

    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--session', 'sess-A']).status, 0,
      'matching session -> verified');
    const mm = quiz(dir, ['verify', '--map', 'map.mmd', '--session', 'sess-B']);
    assert.equal(mm.status, 1, 'another session cannot claim this pass');
    assert.match(mm.stdout, /session/i);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 0,
      'flagless verify stays hash-only (manual CLI / CI, documented boundary)');

    // legacy / anonymous artifact: correct hash but no session field
    const pass = JSON.parse(readFileSync(join(dir, '.flowmap-quiz-pass.json'), 'utf8'));
    delete pass.session;
    writeFileSync(join(dir, '.flowmap-quiz-pass.json'), JSON.stringify(pass));
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--session', 'sess-A']).status, 1,
      'an anonymous pass cannot be claimed by a session (fail closed)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- onboard-cost item 2 (per-module staleness; design:
   docs/flowmap/onboard-cost-design.md). Fixture: camera --> wires edge,
   state unrelated; one colocated fragment per module. ---------- */

const FIXTURE2_MMD = `flowchart TD
  camera["camera"]
  wires["wires"]
  state["state"]
  camera__toWorld("toWorld")
  camera --> wires
%% kind camera module
%% kind wires module
%% kind state module
%% kind camera__toWorld function
%% fm:meta camera__toWorld name=toWorld
%% fm:meta camera__toWorld i0.name=toWorld
%% fm:meta camera__toWorld i0.accepts=sx: number
%% fm:meta camera__toWorld i0.returns=Point
%% src camera__toWorld src/core/camera/camera.ts#toWorld
%% src wires src/render/wires.ts
%% src state src/core/state/state.ts
`;
const FACTS2 = {
  camera: { kind: 'module', owner: 'camera', parent: 'none' },
  wires: { kind: 'module', owner: 'wires', parent: 'none' },
  state: { kind: 'module', owner: 'state', parent: 'none' },
  camera__toWorld: { kind: 'function', owner: 'camera', parent: 'none', arity: '1', returns: 'value' },
};

function mkfixture2() {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-frag-'));
  writeFileSync(join(dir, 'map.mmd'), FIXTURE2_MMD);
  for (const [mod, rel] of [
    ['camera', 'src/core/camera/camera.flowmap.mmd'],
    ['wires', 'src/render/wires.flowmap.mmd'],
    ['state', 'src/core/state/state.flowmap.mmd'],
  ]) {
    const p = join(dir, rel);
    require_mkdir(dirname(p));
    writeFileSync(p, `%% root ${mod}\nflowchart TD\n  ${mod}["${mod}"]\n`);
  }
  return dir;
}
function require_mkdir(p) { spawnSync('mkdir', ['-p', p]); }

function passQuiz2(dir, extra = []) {
  const qs = JSON.parse((quiz(dir, ['generate', ...MAP_ARGS, '--out', 'q.json']), readFileSync(join(dir, 'q.json'), 'utf8'))).questions;
  const right = Object.fromEntries(qs.map((q) => {
    const f = FACTS2[q.ref];
    let a;
    if (q.prompt.startsWith('What is the node kind')) a = f.kind;
    else if (q.prompt.startsWith('Which top-level module')) a = f.owner;
    else if (q.prompt.startsWith('What is the drill-in parent')) a = f.parent;
    else if (q.prompt.startsWith('How many parameters')) a = f.arity;
    else a = f.returns;
    return [q.id, a];
  }));
  writeFileSync(join(dir, 'answers.json'), JSON.stringify(right));
  const r = quiz(dir, ['check', '--answers', 'answers.json', ...MAP_ARGS, ...extra]);
  assert.equal(r.status, 0, r.stdout);
}
const readPass = (dir) => JSON.parse(readFileSync(join(dir, '.flowmap-quiz-pass.json'), 'utf8'));
const writePass = (dir, p) => writeFileSync(join(dir, '.flowmap-quiz-pass.json'), JSON.stringify(p));

test('fragments: check records a sha256 per %% root module (v2, scope "all")', () => {
  const dir = mkfixture2();
  try {
    passQuiz2(dir);
    const pass = readPass(dir);
    assert.equal(pass.v, 2);
    assert.equal(pass.scope, 'all');
    assert.deepEqual(Object.keys(pass.fragments).sort(), ['camera', 'state', 'wires']);
    for (const h of Object.values(pass.fragments)) assert.match(h, /^[0-9a-f]{64}$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify --file: fresh module verifies; whole-bundle drift alone no longer denies it (flagless still does)', () => {
  const dir = mkfixture2();
  try {
    passQuiz2(dir);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', 'src/core/camera/camera.ts']).status, 0);
    appendFileSync(join(dir, 'map.mmd'), '%% bundle drift with no fragment change\n');
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', 'src/core/camera/camera.ts']).status, 0,
      'per-module verify must not die on unrelated whole-bundle drift');
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 1,
      'flagless (full) verify keeps whole-map semantics');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify --file: a stale direct edge-neighbour denies (named); an unrelated stale module does not', () => {
  const dir = mkfixture2();
  try {
    passQuiz2(dir);
    appendFileSync(join(dir, 'src/core/state/state.flowmap.mmd'), '%% drift\n');
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', 'src/core/camera/camera.ts']).status, 0,
      'state has no edge to camera — its drift is outside the blast radius');
    appendFileSync(join(dir, 'src/render/wires.flowmap.mmd'), '%% drift\n');
    const r = quiz(dir, ['verify', '--map', 'map.mmd', '--file', 'src/core/camera/camera.ts']);
    assert.equal(r.status, 1, 'camera --> wires: a stale neighbour is inside the blast radius');
    assert.match(r.stdout, /wires/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify --file fail-closed: unmapped file denies; missing fragment hash denies', () => {
  const dir = mkfixture2();
  try {
    passQuiz2(dir);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', 'src/nowhere/thing.ts']).status, 1,
      'a file the map cannot account for is not verifiable');
    const pass = readPass(dir);
    delete pass.fragments.camera;
    writePass(dir, pass);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', 'src/core/camera/camera.ts']).status, 1,
      'no recorded hash for the edited module -> deny');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify --file on a pre-fragment (v1) artifact falls back to whole-map semantics', () => {
  const dir = mkfixture2();
  try {
    passQuiz2(dir);
    const pass = readPass(dir);
    delete pass.fragments; delete pass.scope; delete pass.v;
    writePass(dir, pass);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', 'src/core/camera/camera.ts']).status, 0);
    appendFileSync(join(dir, 'map.mmd'), '%% drift\n');
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', 'src/core/camera/camera.ts']).status, 1,
      'a v1 artifact keeps its original any-change-invalidates guarantee');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
