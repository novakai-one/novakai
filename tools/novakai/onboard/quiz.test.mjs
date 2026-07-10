/* quiz.test.mjs — acceptance for Keystone 1's machinery (AUD5 fix F-03,
   docs/novakai/audit/04-findings.md).

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

// Field names mirroring the CLI's own answers.json / pass-artifact schemas —
// reused verbatim across many tests, so hoisted here instead of repeated.
const ANSWERS_FILE = 'answers.json';
const PASS_ARTIFACT = '.novakai-quiz-pass.json';
const CAMERA_TS = 'src/core/camera/camera.ts';
const PROMPT_KIND = 'What is the node kind';
const PROMPT_OWNER = 'Which top-level module';
const PROMPT_PARENT = 'What is the drill-in parent';
const PROMPT_ARITY = 'How many parameters';

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
  const fact = FACTS[ref];
  if (prompt.startsWith(PROMPT_KIND)) return fact.kind;
  if (prompt.startsWith(PROMPT_OWNER)) return fact.owner;
  if (prompt.startsWith(PROMPT_PARENT)) return fact.parent;
  if (prompt.startsWith(PROMPT_ARITY)) return fact.arity;
  if (prompt.startsWith('Does')) return fact.returns;
  throw new Error(`unrecognised prompt: ${prompt}`);
}

// Same first-match-wins chain as answerFor, but over an arbitrary fact record
// (FACTS2) instead of a ref lookup — the shared shape behind passQuiz2 and
// the scope tests, which used to duplicate this inline three times.
function answerForFact(prompt, fact) {
  if (prompt.startsWith(PROMPT_KIND)) return fact.kind;
  if (prompt.startsWith(PROMPT_OWNER)) return fact.owner;
  if (prompt.startsWith(PROMPT_PARENT)) return fact.parent;
  if (prompt.startsWith(PROMPT_ARITY)) return fact.arity;
  return fact.returns;
}

function quiz(cwd, args) {
  // NOVAKAI_ROOT here is the M2b emitter seam: check-attempt events land in
  // the fixture dir, never in the repo's real metrics log.
  const result = spawnSync('node', [CLI, ...args],
    { cwd, encoding: 'utf8', env: { ...process.env, NOVAKAI_ROOT: cwd } });
  return { status: result.status, stdout: result.stdout ?? '' };
}

/** Temp dir with the fixture map; quiz state lives in this cwd only. */
function mkfixture() {
  const dir = mkdtempSync(join(tmpdir(), 'quiz-t-'));
  writeFileSync(join(dir, 'map.mmd'), FIXTURE_MMD);
  return dir;
}
const MAP_ARGS = ['--map', 'map.mmd', '--n', '4', '--seed', '1'];

function generate(dir) {
  const result = quiz(dir, ['generate', ...MAP_ARGS, '--out', 'questions.json']);
  assert.equal(result.status, 0, result.stdout);
  return JSON.parse(readFileSync(join(dir, 'questions.json'), 'utf8'));
}

function readPass(dir) {
  return JSON.parse(readFileSync(join(dir, PASS_ARTIFACT), 'utf8'));
}
function writePass(dir, pass) {
  writeFileSync(join(dir, PASS_ARTIFACT), JSON.stringify(pass));
}

/** Write a wrong answer for every question — used by the DENY-path tests. */
function writeWrongAnswers(dir, questions) {
  const wrong = Object.fromEntries(questions.map((question) => [question.id, 'zzz-wrong']));
  writeFileSync(join(dir, ANSWERS_FILE), JSON.stringify(wrong));
}
/** Write the fully-correct answer for every question, via answerFor/FACTS. */
function writeRightAnswers(dir, questions) {
  const right = Object.fromEntries(questions.map((question) =>
    [question.id, answerFor(question.prompt, question.ref)]));
  writeFileSync(join(dir, ANSWERS_FILE), JSON.stringify(right));
}

test('generate is deterministic: same map+seed -> identical question files', () => {
  const dir = mkfixture();
  try {
    const first = generate(dir);
    const second = generate(dir);
    assert.deepEqual(first, second);
    assert.ok(first.questions.length >= 2, 'fixture must yield at least 2 computable questions');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check DENIES wrong answers (exit 1) and writes NO pass artifact', () => {
  const dir = mkfixture();
  try {
    const questions = generate(dir).questions;
    writeWrongAnswers(dir, questions);
    const result = quiz(dir, ['check', '--answers', ANSWERS_FILE, ...MAP_ARGS]);
    assert.equal(result.status, 1);
    assert.equal(existsSync(join(dir, PASS_ARTIFACT)), false,
      'a failed check must not leave a pass artifact');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('check on 100% exits 0 and emits a pass artifact bound to the map hash (F-03)', () => {
  const dir = mkfixture();
  try {
    const questions = generate(dir).questions;
    writeRightAnswers(dir, questions);
    const result = quiz(dir, ['check', '--answers', ANSWERS_FILE, ...MAP_ARGS]);
    assert.equal(result.status, 0, result.stdout);
    const pass = readPass(dir);
    assert.match(pass.mapHash, /^[0-9a-f]{64}$/);
    assert.equal(pass.score.split('/')[0], pass.score.split('/')[1], 'recorded score is a full pass');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify: DENIES with no artifact; passes after a pass; DENIES once the map changes (F-03)', () => {
  const dir = mkfixture();
  try {
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 1, 'no artifact -> not verified');
    const questions = generate(dir).questions;
    writeRightAnswers(dir, questions);
    assert.equal(quiz(dir, ['check', '--answers', ANSWERS_FILE, ...MAP_ARGS]).status, 0);
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
    writePass(dir, { map: 'map.mmd', seed: 1, 'n': 4, score: '3/4', mapHash: 'f'.repeat(64) });
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** Read this fixture dir's metered check-attempt events from the metrics log. */
function readMetricsChecks(dir) {
  const log = join(dir, 'docs', 'novakai', 'metrics', 'session-log.jsonl');
  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  return lines.filter((line) => line.event === 'quiz' && line.cmd === 'check');
}

test('M2b: BOTH check outcomes are metered (pass rate = attempts, not just passes) — exit codes unchanged', () => {
  const dir = mkfixture();
  try {
    const questions = generate(dir).questions;
    writeWrongAnswers(dir, questions);
    assert.equal(quiz(dir, ['check', '--answers', ANSWERS_FILE, ...MAP_ARGS]).status, 1);
    writeRightAnswers(dir, questions);
    assert.equal(quiz(dir, ['check', '--answers', ANSWERS_FILE, ...MAP_ARGS]).status, 0);
    const checks = readMetricsChecks(dir);
    assert.equal(checks.length, 2, 'a FAILED attempt must leave a record too');
    assert.deepEqual(checks.map((check) => check.pass), [false, true]);
    assert.match(checks[1].mapHash, /^[0-9a-f]{64}$/, 'provenance rides along');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- onboard-cost item 4 (session-bound pass; design:
   docs/novakai/onboard-cost-design.md) ---------- */

/** Run `check` with a custom --session/env combo and assert the recorded session. */
function assertSessionRecorded(dir, { extra, env, expectedSession, message }) {
  const result = spawnSync('node',
    [CLI, 'check', '--answers', ANSWERS_FILE, ...MAP_ARGS, ...extra],
    { cwd: dir, encoding: 'utf8', env: { ...process.env, NOVAKAI_ROOT: dir, ...env } });
  assert.equal(result.status, 0);
  assert.equal(readPass(dir).session, expectedSession, message);
}

test('session: check records --session (flag beats env; neither -> null)', () => {
  const dir = mkfixture();
  try {
    const questions = generate(dir).questions;
    writeRightAnswers(dir, questions);

    assertSessionRecorded(dir, {
      extra: ['--session', 'flag-sess'], env: { CLAUDE_CODE_SESSION_ID: 'env-sess' },
      expectedSession: 'flag-sess', message: 'the explicit flag must beat the env',
    });
    assertSessionRecorded(dir, {
      extra: [], env: { CLAUDE_CODE_SESSION_ID: 'env-sess' },
      expectedSession: 'env-sess', message: 'the harness env is the default identity',
    });
    assertSessionRecorded(dir, {
      extra: [], env: { CLAUDE_CODE_SESSION_ID: '' },
      expectedSession: null, message: 'no flag and no env -> null (manual CLI, documented boundary)',
    });
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/** Legacy/anonymous artifact repro: drop `session` from the recorded pass, then verify. */
function dropSessionFromPassAndVerify(dir, sessionArg) {
  const pass = readPass(dir);
  delete pass.session;
  writePass(dir, pass);
  return quiz(dir, ['verify', '--map', 'map.mmd', '--session', sessionArg]);
}

test('session: verify --session matches / mismatches / legacy artifact; flagless stays hash-only', () => {
  const dir = mkfixture();
  try {
    const questions = generate(dir).questions;
    writeRightAnswers(dir, questions);
    assert.equal(quiz(dir, ['check', '--answers', ANSWERS_FILE, ...MAP_ARGS, '--session', 'sess-A']).status, 0);

    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--session', 'sess-A']).status, 0,
      'matching session -> verified');
    const mismatch = quiz(dir, ['verify', '--map', 'map.mmd', '--session', 'sess-B']);
    assert.equal(mismatch.status, 1, 'another session cannot claim this pass');
    assert.match(mismatch.stdout, /session/i);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 0,
      'flagless verify stays hash-only (manual CLI / CI, documented boundary)');

    // legacy / anonymous artifact: correct hash but no session field
    assert.equal(dropSessionFromPassAndVerify(dir, 'sess-A').status, 1,
      'an anonymous pass cannot be claimed by a session (fail closed)');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- onboard-cost item 2 (per-module staleness; design:
   docs/novakai/onboard-cost-design.md). Fixture: camera --> wires edge,
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
    ['camera', 'src/core/camera/camera.novakai.mmd'],
    ['wires', 'src/render/wires.novakai.mmd'],
    ['state', 'src/core/state/state.novakai.mmd'],
  ]) {
    const fragPath = join(dir, rel);
    requireMkdir(dirname(fragPath));
    writeFileSync(fragPath, `%% root ${mod}\nflowchart TD\n  ${mod}["${mod}"]\n`);
  }
  return dir;
}
function requireMkdir(dirPath) {
  spawnSync('mkdir', ['-p', dirPath]);
}

function passQuiz2(dir, extra = []) {
  quiz(dir, ['generate', ...MAP_ARGS, '--out', 'q.json']);
  const questions = JSON.parse(readFileSync(join(dir, 'q.json'), 'utf8')).questions;
  const right = Object.fromEntries(questions.map((question) =>
    [question.id, answerForFact(question.prompt, FACTS2[question.ref])]));
  writeFileSync(join(dir, ANSWERS_FILE), JSON.stringify(right));
  const result = quiz(dir, ['check', '--answers', ANSWERS_FILE, ...MAP_ARGS, ...extra]);
  assert.equal(result.status, 0, result.stdout);
}

test('fragments: check records a sha256 per %% root module (v2, scope "all")', () => {
  const dir = mkfixture2();
  try {
    passQuiz2(dir);
    const pass = readPass(dir);
    assert.equal(pass.v, 2);
    assert.equal(pass.scope, 'all');
    assert.deepEqual(Object.keys(pass.fragments).sort(), ['camera', 'state', 'wires']);
    for (const hash of Object.values(pass.fragments)) assert.match(hash, /^[0-9a-f]{64}$/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify --file: fresh module verifies; whole-bundle drift alone no longer denies it (flagless still does)', () => {
  const dir = mkfixture2();
  try {
    passQuiz2(dir);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', CAMERA_TS]).status, 0);
    appendFileSync(join(dir, 'map.mmd'), '%% bundle drift with no fragment change\n');
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', CAMERA_TS]).status, 0,
      'per-module verify must not die on unrelated whole-bundle drift');
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 1,
      'flagless (full) verify keeps whole-map semantics');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify --file: a stale direct edge-neighbour denies (named); an unrelated stale module does not', () => {
  const dir = mkfixture2();
  try {
    passQuiz2(dir);
    appendFileSync(join(dir, 'src/core/state/state.novakai.mmd'), '%% drift\n');
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', CAMERA_TS]).status, 0,
      'state has no edge to camera — its drift is outside the blast radius');
    appendFileSync(join(dir, 'src/render/wires.novakai.mmd'), '%% drift\n');
    const result = quiz(dir, ['verify', '--map', 'map.mmd', '--file', CAMERA_TS]);
    assert.equal(result.status, 1, 'camera --> wires: a stale neighbour is inside the blast radius');
    assert.match(result.stdout, /wires/);
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
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', CAMERA_TS]).status, 1,
      'no recorded hash for the edited module -> deny');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('verify --file on a pre-fragment (v1) artifact falls back to whole-map semantics', () => {
  const dir = mkfixture2();
  try {
    passQuiz2(dir);
    const pass = readPass(dir);
    delete pass.fragments;
    delete pass.scope;
    delete pass.v;
    writePass(dir, pass);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', CAMERA_TS]).status, 0);
    appendFileSync(join(dir, 'map.mmd'), '%% drift\n');
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', CAMERA_TS]).status, 1,
      'a v1 artifact keeps its original any-change-invalidates guarantee');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

/* ---------- onboard-cost item 3 (scoped quiz; design:
   docs/novakai/onboard-cost-design.md) ---------- */

/** Run `generate --scope <scope>` against the fixture2 map and return its questions. */
function generateScoped(dir, scope) {
  const result = quiz(dir,
    ['generate', '--map', 'map.mmd', '--n', '4', '--seed', '1', '--scope', scope, '--out', 'q.json']);
  assert.equal(result.status, 0, result.stdout);
  return JSON.parse(readFileSync(join(dir, 'q.json'), 'utf8')).questions;
}
/** Write correct FACTS2 answers for a (possibly scoped) question set. */
function writeScopedAnswers(dir, questions) {
  const right = Object.fromEntries(questions.map((question) =>
    [question.id, answerForFact(question.prompt, FACTS2[question.ref])]));
  writeFileSync(join(dir, ANSWERS_FILE), JSON.stringify(right));
}

test('scope: generate --scope draws only in-scope questions; check records the scope', () => {
  const dir = mkfixture2();
  try {
    const questions = generateScoped(dir, 'camera');
    assert.ok(questions.length >= 1);
    for (const question of questions) assert.match(question.ref, /^camera(__|$)/, `out-of-scope ref ${question.ref}`);
    writeScopedAnswers(dir, questions);
    assert.equal(quiz(dir, ['check', '--answers', ANSWERS_FILE, '--map', 'map.mmd', '--n', '4', '--seed', '1',
      '--scope', 'camera']).status, 0);
    const pass = readPass(dir);
    assert.deepEqual(pass.scope, ['camera']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('scope: a scoped pass unlocks only its scope; it never satisfies a full verify', () => {
  const dir = mkfixture2();
  try {
    const questions = generateScoped(dir, 'camera');
    writeScopedAnswers(dir, questions);
    assert.equal(quiz(dir, ['check', '--answers', ANSWERS_FILE, '--map', 'map.mmd', '--n', '4', '--seed', '1',
      '--scope', 'camera']).status, 0);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd', '--file', CAMERA_TS]).status, 0,
      'in-scope module verifies');
    const out = quiz(dir, ['verify', '--map', 'map.mmd', '--file', 'src/core/state/state.ts']);
    assert.equal(out.status, 1, 'a module outside the proven scope must not verify');
    assert.match(out.stdout, /scope/i);
    assert.equal(quiz(dir, ['verify', '--map', 'map.mmd']).status, 1,
      'a scoped pass must never satisfy the full (flagless) verify');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
