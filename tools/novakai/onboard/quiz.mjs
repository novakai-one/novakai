#!/usr/bin/env node
/* =====================================================================
   quiz.mjs — TESTABLE understanding (the handover proof)
   ---------------------------------------------------------------------
   A prose "yes, I understand the app" is unverifiable — exactly the
   handover risk novakai exists to kill. This turns understanding into a
   pass/fail test: a fresh agent must answer questions whose answers are
   deterministically derivable from the VERIFIED layer of the map
   (`_bundle.mmd`) — arity, return kind, node kind, owning module, drill
   parent. The answer key is NEVER written to disk; `--check` recomputes
   the truth from the map at scoring time, so the agent has to actually
   read the map, not a key file.

   A 100% score proves two things at once: the map CONTAINS enough to
   answer real structural questions, and the agent EXTRACTED it correctly
   (not a polluted or stale understanding).

   AUD5 fix F-03 — the pass becomes a MACHINE-CHECKABLE artifact: a 100%
   check writes .novakai-quiz-pass.json binding {seed, score} to the sha256
   of the exact map bytes it was scored against. `verify` exits 0 only if
   that artifact matches the CURRENT map — so a pass goes stale the moment
   the map changes, and "did this session pass the quiz?" is a command, not
   a claim. The artifact is personal session state (gitignored), so this is
   a session-protocol gate surfaced by onboard, not a repo/CI predicate.
   Accepted boundary: same-map replay of a correct answers file still passes
   (the key derives from the map itself); binding to the map hash makes the
   pass non-transferable across map changes, which is the replay that
   mattered (AUD2 A4).

   Onboard-cost item 4 (design: docs/novakai/onboard-cost-design.md) — the
   pass becomes SESSION-BOUND, so one agent's pass cannot attest another
   agent's understanding (the checkout-scoped artifact let any subagent's
   pass unlock the orchestrator's src/ edits). `check` records the session
   identity: --session flag, else CLAUDE_CODE_SESSION_ID env (the harness
   sets it for tool-run commands and it equals the PreToolUse payload's
   session_id), else null. `verify` enforces it ONLY when --session is
   passed explicitly — never implicitly from env — so manual CLI runs and
   CI keep deterministic hash-only semantics (the documented no-session
   boundary: outside a harness session there is no identity to bind; the
   enforcement point is edit-gate, which always has the payload id). Under
   the flag, an artifact whose session differs — another id, null, or a
   pre-binding artifact — fails closed with a re-take reason.

   Onboard-cost item 2 — the pass also binds a sha256 PER COLOCATED FRAGMENT
   (every *.novakai.mmd under src/, keyed by `%% root` id). `verify --file`
   resolves the file's owning module (%% src directives, then colocated-
   fragment fallback for module-level boot code like src/main.ts) and checks
   that module's hash plus its direct edge-neighbours' hashes — so unrelated
   whole-bundle drift no longer voids the proof, while anything inside the
   edit's blast radius still does. Unmappable file / missing hash fails
   closed. Flagless verify keeps whole-map semantics; a pre-v2 artifact
   keeps its original any-change-invalidates guarantee.

   Usage:
     node quiz.mjs generate [--n 12] [--seed 0] [--out questions.json]
     node quiz.mjs check --answers <answers.json> [--n 12] [--seed 0] [--session <id>]
     node quiz.mjs verify [--map <map.mmd>] [--session <id>] [--file <src path>]
   answers.json: { "<qid>": "<answer>", ... }
   Exit (check): 0 = all correct, 1 = wrong answer(s), 2 = bad invocation.
   Exit (verify): 0 = a 100% pass exists for the CURRENT map bytes (scoped to
   the CURRENT session under --session, and to the file's module + neighbours
   under --file), 1 = not.
   ===================================================================== */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname, basename, sep } from 'node:path';
import { sha256hex } from '../lib/canonical.mjs';
import { recordEvent } from '../lib/metrics-log.mjs';
import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';
import { specSkeleton, gateParent, ARITY_GATED_KINDS } from '../../buildspec/core/skeleton.mjs';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const CMD = process.argv[2];
const MAP = arg('--map', 'docs/novakai/_bundle.mmd');
const QUESTION_COUNT = parseInt(arg('--n', '12'), 10);
const SEED = parseInt(arg('--seed', '0'), 10);
// The explicit flag is the only thing that ACTIVATES session checking in
// `verify`; `check` additionally falls back to the harness env for recording.
const SESSION_FLAG = arg('--session', null);
const SESSION_ID = SESSION_FLAG ?? (process.env.CLAUDE_CODE_SESSION_ID || null);
// Onboard-cost item 2: verify a single src file against its module's fragment
// hash + its direct edge-neighbours' hashes, instead of the whole bundle.
const FILE_FLAG = arg('--file', null);
// Onboard-cost item 3: scoped quiz — questions drawn only from the named
// modules; the pass then unlocks edits only inside that proven scope.
const SCOPE_FLAG = arg('--scope', null);
const SCOPE = SCOPE_FLAG ? SCOPE_FLAG.split(',').map((part) => part.trim()).filter(Boolean) : null;

const PASS_FILE = resolve('.novakai-quiz-pass.json');
const mapHash = () => sha256hex(readFileSync(resolve(MAP)));

const mapText = readFileSync(resolve(MAP), 'utf8');
const model = parseMmd(mapText);
const allIds = Object.keys(model.nodes).filter((id) => !model.nodes[id].group).sort();
const realIds = SCOPE
  ? allIds.filter((id) => SCOPE.includes(id.includes('__') ? id.split('__')[0] : id))
  : allIds;

const ownerOf = (id) => (id.includes('__') ? id.split('__')[0] : id);

/* ---------- onboard-cost item 2: fragment discovery + file->module scoping ----------
   A module IS a colocated fragment (every *.novakai.mmd under src/, keyed by its
   `%% root` id) — the same contract the bundler merges by. Hashes are over exact
   fragment bytes, the per-module analogue of the F-03 whole-map binding. */
function discoverFragments() {
  const out = {};
  const srcDir = resolve('src');
  if (!existsSync(srcDir)) return out;
  for (const ent of readdirSync(srcDir, { recursive: true })) {
    const rel = String(ent);
    if (!rel.endsWith('.novakai.mmd')) continue;
    const full = join(srcDir, rel);
    const match = /^%%\s*root\s+([A-Za-z0-9_]+)\s*$/m.exec(readFileSync(full, 'utf8'));
    if (!match) continue;
    out[match[1]] = { file: 'src/' + rel.split(sep).join('/'), hash: sha256hex(readFileSync(full)) };
  }
  return out;
}

/** Resolve a src file to its owning module: authoritative `%% src` directives first
    (46/47 files, exactly one owner each), then the colocated-fragment fallback that
    covers module-level boot code like src/main.ts. Ambiguity or no match -> null
    (the caller fails closed: an edit the map cannot account for is not verifiable). */
function ownersFromSrcDirectives(norm) {
  const owners = new Set();
  for (const match of mapText.matchAll(/^%%\s*src\s+(\S+)\s+(\S+)\s*$/gm)) {
    if (match[2].split('#')[0] === norm) owners.add(ownerOf(match[1]));
  }
  return owners;
}

function moduleFromFragmentFallback(norm, frags) {
  const selfFragment = Object.entries(frags).find(([, frag]) => frag.file === norm);
  if (selfFragment) return selfFragment[0];
  const dir = dirname(norm), base = basename(norm).replace(/\.[^.]+$/, '');
  const inDir = Object.entries(frags).filter(([, frag]) => dirname(frag.file) === dir);
  const byBase = inDir.find(([, frag]) => basename(frag.file) === base + '.novakai.mmd');
  if (byBase) return byBase[0];
  if (inDir.length === 1) return inDir[0][0];
  return null;
}

function moduleForFile(relPath, frags) {
  const norm = relPath.split(sep).join('/');
  const owners = ownersFromSrcDirectives(norm);
  if (owners.size === 1) return [...owners][0];
  if (owners.size > 1) return null;
  return moduleFromFragmentFallback(norm, frags);
}

/** Modules sharing a direct edge with `mod` (both directions; edges are code-backed
    or audited per A5). Only fragment-bearing owners count as modules — a global
    shared node (no fragment) is not a staleness surface. */
function neighbourModules(mod, recorded, current) {
  const isModule = (id) => recorded[id] !== undefined || current[id] !== undefined;
  const neighbours = new Set();
  for (const edge of model.edges || []) {
    const fromOwner = ownerOf(edge.from), toOwner = ownerOf(edge.to);
    if (fromOwner === mod && toOwner !== mod && isModule(toOwner)) neighbours.add(toOwner);
    if (toOwner === mod && fromOwner !== mod && isModule(fromOwner)) neighbours.add(fromOwner);
  }
  return [...neighbours];
}
const primaryMember = (id) => {
  const skeleton = specSkeleton(model, id);
  return { skeleton, member: skeleton.members[0] || null };
};

/* ---------- the verified-fact answer functions, one per question type ---------- */
const TYPES = {
  kind: {
    ask: (id) => `What is the node kind of "${id}" (e.g. function, type, module, hook, store, ` +
      'service, class, component, event)?',
    answer: (id) => model.nodes[id]?.kind ?? null,
  },
  owner: {
    ask: (id) => `Which top-level module owns the unit "${id}"?`,
    answer: (id) => ownerOf(id),
  },
  parent: {
    ask: (id) => `What is the drill-in parent MODULE of "${id}" — the top-level unit it belongs to ` +
      '(walk OUT through any subgraph grouping to the owning module, not the subgraph)? Answer "none" ' +
      'if it has no drill-in parent.',
    answer: (id) => gateParent(model, id) || 'none',
  },
  arity: {
    ask: (id) => `How many parameters does the primary signature of "${id}" take? (a number)`,
    answer: (id) => {
      const { skeleton, member } = primaryMember(id);
      if (!ARITY_GATED_KINDS.has(skeleton.kind) || !member) return null;
      return String(member.arity);
    },
  },
  returns: {
    ask: (id) => `Does "${id}" return a value or void? Answer "value" or "void".`,
    answer: (id) => {
      const { skeleton, member } = primaryMember(id);
      if (!ARITY_GATED_KINDS.has(skeleton.kind) || !member) return null;
      return member.returnsValue ? 'value' : 'void';
    },
  },
};

/* ---------- deterministic question selection (same map+seed -> same quiz) ---------- */
// Extracted from buildQuestions to keep it under the statement/line budget: tries one
// (id,type) pair and appends a question when the answer is computable and unseen.
function tryAddQuestion(questions, id, type, used) {
  const key = id + ':' + type;
  if (used.has(key)) return;
  const answerValue = TYPES[type].answer(id);
  if (answerValue === null || answerValue === undefined || answerValue === '') return;
  used.add(key);
  questions.push({ id: `q${questions.length + 1}`, type, ref: id, prompt: TYPES[type].ask(id) });
}

function buildQuestions() {
  const typeKeys = Object.keys(TYPES);
  const questions = [];
  // stride through the sorted id list, offset by seed, rotating question type,
  // skipping (id,type) pairs whose answer is not computable.
  let i = SEED % Math.max(1, realIds.length);
  let guard = 0;
  const used = new Set();
  while (questions.length < QUESTION_COUNT && guard < realIds.length * typeKeys.length * 2) {
    const id = realIds[i % realIds.length];
    const type = typeKeys[(i + questions.length) % typeKeys.length];
    tryAddQuestion(questions, id, type, used);
    i += 7; // coprime-ish stride for spread across modules
    guard++;
  }
  return questions;
}

function correctAnswer(question) {
  return String(TYPES[question.type].answer(question.ref)).trim().toLowerCase();
}

/* ---------- commands ---------- */
if (CMD === 'generate') {
  if (SCOPE && realIds.length === 0) {
    console.error(`no map nodes are owned by scope [${SCOPE.join(', ')}] — check the module names against the map.`);
    process.exit(2);
  }
  const questions = buildQuestions();
  const out = arg('--out');
  const payload = {
    map: MAP, seed: SEED, 'n': questions.length,
    instructions: 'Answer each question using ONLY docs/novakai/_bundle.mmd. Write {"<qid>": "<answer>"} to a ' +
      'file, then run: npm run novakai:quiz -- check --answers <file> --seed ' + SEED,
    questions: questions.map((question) => ({ id: question.id, ref: question.ref, prompt: question.prompt })),
  };
  if (out) {
    writeFileSync(out, JSON.stringify(payload, null, 2));
    console.log(`wrote ${questions.length} questions -> ${out}`);
  } else {
    console.log(`# novakai comprehension quiz — ${questions.length} questions (seed ${SEED})`);
    console.log(`# Answer from docs/novakai/_bundle.mmd only.\n`);
    for (const question of questions) console.log(`${question.id}. ${question.prompt}`);
  }
  process.exit(0);
}

if (CMD === 'check') {
  const ansPath = arg('--answers');
  if (!ansPath) {
    console.error('usage: quiz.mjs check --answers <answers.json> [--seed N] [--n K]');
    process.exit(2);
  }
  const given = JSON.parse(readFileSync(resolve(ansPath), 'utf8'));
  const answers = given.questions ? given : given; // accept raw {qid:ans} or wrapped
  const ansMap = given.answers || given; // allow {answers:{...}} or flat
  const questions = buildQuestions();
  // Footgun guard: `generate --n K` then `check` (default --n 12) compares against
  // a DIFFERENT question set. If the answer count doesn't match the quiz size at
  // this --n/--seed, say so loudly instead of silently scoring unseen questions.
  const answeredCount = Object.keys(ansMap).filter((k) => /^q\d+$/.test(k)).length;
  if (answeredCount !== questions.length) {
    console.log(`⚠ mismatch: you answered ${answeredCount} question(s) but this quiz has ${questions.length} ` +
      `at --seed ${SEED} --n ${N}.`);
    console.log(`  Pass the SAME --n to generate and check (you likely generated with --n ${answeredCount}).\n`);
  }
  let correct = 0;
  const results = [];
  for (const question of questions) {
    const want = correctAnswer(question);
    const gotRaw = ansMap[question.id];
    const got = (gotRaw === undefined || gotRaw === null) ? '' : String(gotRaw).trim().toLowerCase();
    const isCorrect = got === want;
    if (isCorrect) correct++;
    results.push({ id: question.id, ref: question.ref, prompt: question.prompt, expected: want, got, isCorrect });
  }
  const pct = questions.length ? Math.round((correct / questions.length) * 100) : 0;
  // M2b: one line per check ATTEMPT, pass or fail — the intent's "quiz pass
  // rate" is over attempts, so a failed check must leave a record too.
  // (`verify` is deliberately NOT logged: edit-gate spawns it per src/ edit.)
  recordEvent({
    event: 'quiz', source: 'quiz.mjs', cmd: 'check',
    pass: correct === questions.length, score: `${correct}/${questions.length}`,
    seed: SEED, 'n': questions.length, mapHash: mapHash(),
  });
  for (const result of results) {
    console.log(`  ${result.isCorrect ? '✓' : '✗'} ${result.id} (${result.ref}) — your answer: "${result.got}"` +
      `${result.isCorrect ? '' : `  ✗ correct: "${result.expected}"`}`);
  }
  console.log(`\nScore: ${correct}/${questions.length} (${pct}%)`);
  if (correct === questions.length) {
    // F-03: bind the pass to the exact map bytes it was scored against, so
    // `verify` can prove it later and any map change invalidates it.
    const frags = discoverFragments();
    // A scoped pass records no whole-map hash: it must satisfy --file verifies
    // inside its scope and NEVER the full (flagless) verify.
    writeFileSync(PASS_FILE, JSON.stringify({
      'v': 2, map: MAP, seed: SEED, 'n': questions.length, score: `${correct}/${questions.length}`,
      mapHash: SCOPE ? null : mapHash(), session: SESSION_ID, scope: SCOPE ?? 'all',
      fragments: Object.fromEntries(Object.entries(frags).map(([k, frag]) => [k, frag.hash])),
    }, null, 2) + '\n');
    console.log('UNDERSTANDING VERIFIED — handover trusted.');
    console.log(`pass artifact written: ${PASS_FILE} (bound to the current map hash; verify with: quiz.mjs verify)`);
    process.exit(0);
  }
  console.log('NOT verified — the map answers these deterministically; re-read _bundle.mmd for the misses above.');
  process.exit(1);
}

if (CMD === 'verify') {
  if (!existsSync(PASS_FILE)) {
    console.log('✗ no quiz pass for this checkout — run the quiz (onboard STEP 4).');
    process.exit(1);
  }
  let pass;
  try {
    pass = JSON.parse(readFileSync(PASS_FILE, 'utf8'));
  } catch {
    console.log('✗ quiz pass artifact is unreadable — re-run the quiz.');
    process.exit(1);
  }
  const [got, total] = String(pass.score || '0/1').split('/');
  if (got !== total) {
    console.log(`✗ recorded score is ${pass.score}, not a full pass — re-run the quiz.`);
    process.exit(1);
  }
  // Item 4: session binding — enforced only under the explicit flag (see header).
  if (SESSION_FLAG !== null && pass.session !== SESSION_FLAG) {
    console.log('✗ quiz pass belongs to another session (or predates session binding) — this agent has not proven ' +
      'its own read. Re-take the quiz in THIS session (onboard STEP 4).');
    process.exit(1);
  }
  // Item 2: per-module verify. A v2 artifact binds per-fragment hashes, so a
  // --file verify checks the edited module + its direct edge-neighbours and
  // ignores unrelated whole-bundle drift. A pre-v2 artifact (no fragments)
  // keeps its original any-change-invalidates guarantee. Flagless verify
  // keeps whole-map semantics for both.
  if (FILE_FLAG !== null && pass.fragments) {
    const frags = discoverFragments();
    const mod = moduleForFile(FILE_FLAG, frags);
    if (!mod) {
      console.log(`✗ cannot scope "${FILE_FLAG}" to a mapped module (no %% src match, no colocated fragment) — ` +
        'an edit the map cannot account for is not verifiable.');
      process.exit(1);
    }
    if (pass.scope !== 'all' && !(Array.isArray(pass.scope) && pass.scope.includes(mod))) {
      console.log(`✗ module "${mod}" is outside this pass's proven scope (${JSON.stringify(pass.scope)}) — read ` +
        'its fragment and re-take a quiz covering it.');
      process.exit(1);
    }
    const stale = [mod, ...neighbourModules(mod, pass.fragments, frags)].filter((moduleId) =>
      !pass.fragments[moduleId] || !frags[moduleId] || pass.fragments[moduleId] !== frags[moduleId].hash);
    if (stale.length) {
      console.log(`✗ quiz pass is STALE for "${mod}" — changed since it was scored: ${stale.join(', ')}. Re-read ` +
        'those fragments and re-take the quiz (onboard STEP 4).');
      process.exit(1);
    }
    console.log(`✓ quiz pass VERIFIED for module "${mod}" and its edge-neighbours (seed ${pass.seed}, ${pass.score}).`);
    process.exit(0);
  }
  if (pass.scope && pass.scope !== 'all') {
    console.log(`✗ this pass is scoped to [${[].concat(pass.scope).join(', ')}] — a full verify requires a ` +
      'full-map pass (onboard STEP 4, no --scope).');
    process.exit(1);
  }
  if (pass.mapHash !== mapHash()) {
    console.log('✗ quiz pass is STALE — the map changed since it was scored. Re-read the map and re-take the quiz.');
    process.exit(1);
  }
  console.log(`✓ quiz pass VERIFIED for the current map (seed ${pass.seed}, ${pass.score}).`);
  process.exit(0);
}

console.error('usage: quiz.mjs <generate|check|verify> [--n 12] [--seed 0] [--answers <file>] [--out <file>]');
process.exit(2);
