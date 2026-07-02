#!/usr/bin/env node
/* =====================================================================
   quiz.mjs — TESTABLE understanding (the handover proof)
   ---------------------------------------------------------------------
   A prose "yes, I understand the app" is unverifiable — exactly the
   handover risk flowmap exists to kill. This turns understanding into a
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
   check writes .flowmap-quiz-pass.json binding {seed, score} to the sha256
   of the exact map bytes it was scored against. `verify` exits 0 only if
   that artifact matches the CURRENT map — so a pass goes stale the moment
   the map changes, and "did this session pass the quiz?" is a command, not
   a claim. The artifact is personal session state (gitignored), so this is
   a session-protocol gate surfaced by onboard, not a repo/CI predicate.
   Accepted boundary: same-map replay of a correct answers file still passes
   (the key derives from the map itself); binding to the map hash makes the
   pass non-transferable across map changes, which is the replay that
   mattered (AUD2 A4).

   Usage:
     node quiz.mjs generate [--n 12] [--seed 0] [--out questions.json]
     node quiz.mjs check --answers <answers.json> [--n 12] [--seed 0]
     node quiz.mjs verify [--map <map.mmd>]
   answers.json: { "<qid>": "<answer>", ... }
   Exit (check): 0 = all correct, 1 = wrong answer(s), 2 = bad invocation.
   Exit (verify): 0 = a 100% pass exists for the CURRENT map bytes, 1 = not.
   ===================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256hex } from './lib/canonical.mjs';
import { parseMmd } from '../buildspec/mmd-parse.mjs';
import { specSkeleton, gateParent, ARITY_GATED_KINDS } from '../buildspec/skeleton.mjs';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const CMD = process.argv[2];
const MAP = arg('--map', 'docs/flowmap/_bundle.mmd');
const N = parseInt(arg('--n', '12'), 10);
const SEED = parseInt(arg('--seed', '0'), 10);

const PASS_FILE = resolve('.flowmap-quiz-pass.json');
const mapHash = () => sha256hex(readFileSync(resolve(MAP)));

const model = parseMmd(readFileSync(resolve(MAP), 'utf8'));
const realIds = Object.keys(model.nodes).filter((id) => !model.nodes[id].group).sort();

const ownerOf = (id) => (id.includes('__') ? id.split('__')[0] : id);
const primaryMember = (id) => {
  const sk = specSkeleton(model, id);
  return { sk, m: sk.members[0] || null };
};

/* ---------- the verified-fact answer functions, one per question type ---------- */
const TYPES = {
  kind: {
    ask: (id) => `What is the node kind of "${id}" (e.g. function, type, module, hook, store, service, class, component, event)?`,
    answer: (id) => model.nodes[id]?.kind ?? null,
  },
  owner: {
    ask: (id) => `Which top-level module owns the unit "${id}"?`,
    answer: (id) => ownerOf(id),
  },
  parent: {
    ask: (id) => `What is the drill-in parent MODULE of "${id}" — the top-level unit it belongs to (walk OUT through any subgraph grouping to the owning module, not the subgraph)? Answer "none" if it has no drill-in parent.`,
    answer: (id) => gateParent(model, id) || 'none',
  },
  arity: {
    ask: (id) => `How many parameters does the primary signature of "${id}" take? (a number)`,
    answer: (id) => {
      const { sk, m } = primaryMember(id);
      if (!ARITY_GATED_KINDS.has(sk.kind) || !m) return null;
      return String(m.arity);
    },
  },
  returns: {
    ask: (id) => `Does "${id}" return a value or void? Answer "value" or "void".`,
    answer: (id) => {
      const { sk, m } = primaryMember(id);
      if (!ARITY_GATED_KINDS.has(sk.kind) || !m) return null;
      return m.returnsValue ? 'value' : 'void';
    },
  },
};

/* ---------- deterministic question selection (same map+seed -> same quiz) ---------- */
function buildQuestions() {
  const typeKeys = Object.keys(TYPES);
  const qs = [];
  // stride through the sorted id list, offset by seed, rotating question type,
  // skipping (id,type) pairs whose answer is not computable.
  let i = SEED % Math.max(1, realIds.length);
  let guard = 0;
  const used = new Set();
  while (qs.length < N && guard < realIds.length * typeKeys.length * 2) {
    const id = realIds[i % realIds.length];
    const type = typeKeys[(i + qs.length) % typeKeys.length];
    const key = id + ':' + type;
    if (!used.has(key)) {
      const a = TYPES[type].answer(id);
      if (a !== null && a !== undefined && a !== '') {
        used.add(key);
        qs.push({ id: `q${qs.length + 1}`, type, ref: id, prompt: TYPES[type].ask(id) });
      }
    }
    i += 7; // coprime-ish stride for spread across modules
    guard++;
  }
  return qs;
}

function correctAnswer(q) {
  return String(TYPES[q.type].answer(q.ref)).trim().toLowerCase();
}

/* ---------- commands ---------- */
if (CMD === 'generate') {
  const qs = buildQuestions();
  const out = arg('--out');
  const payload = {
    map: MAP, seed: SEED, n: qs.length,
    instructions: 'Answer each question using ONLY docs/flowmap/_bundle.mmd. Write {"<qid>": "<answer>"} to a file, then run: npm run flowmap:quiz -- check --answers <file> --seed ' + SEED,
    questions: qs.map((q) => ({ id: q.id, ref: q.ref, prompt: q.prompt })),
  };
  if (out) { writeFileSync(out, JSON.stringify(payload, null, 2)); console.log(`wrote ${qs.length} questions -> ${out}`); }
  else {
    console.log(`# flowmap comprehension quiz — ${qs.length} questions (seed ${SEED})`);
    console.log(`# Answer from docs/flowmap/_bundle.mmd only.\n`);
    for (const q of qs) console.log(`${q.id}. ${q.prompt}`);
  }
  process.exit(0);
}

if (CMD === 'check') {
  const ansPath = arg('--answers');
  if (!ansPath) { console.error('usage: quiz.mjs check --answers <answers.json> [--seed N] [--n K]'); process.exit(2); }
  const given = JSON.parse(readFileSync(resolve(ansPath), 'utf8'));
  const answers = given.questions ? given : given; // accept raw {qid:ans} or wrapped
  const ansMap = given.answers || given; // allow {answers:{...}} or flat
  const qs = buildQuestions();
  // Footgun guard: `generate --n K` then `check` (default --n 12) compares against
  // a DIFFERENT question set. If the answer count doesn't match the quiz size at
  // this --n/--seed, say so loudly instead of silently scoring unseen questions.
  const answeredCount = Object.keys(ansMap).filter((k) => /^q\d+$/.test(k)).length;
  if (answeredCount !== qs.length) {
    console.log(`⚠ mismatch: you answered ${answeredCount} question(s) but this quiz has ${qs.length} at --seed ${SEED} --n ${N}.`);
    console.log(`  Pass the SAME --n to generate and check (you likely generated with --n ${answeredCount}).\n`);
  }
  let correct = 0;
  const results = [];
  for (const q of qs) {
    const want = correctAnswer(q);
    const gotRaw = ansMap[q.id];
    const got = (gotRaw === undefined || gotRaw === null) ? '' : String(gotRaw).trim().toLowerCase();
    const ok = got === want;
    if (ok) correct++;
    results.push({ id: q.id, ref: q.ref, prompt: q.prompt, expected: want, got, ok });
  }
  const pct = qs.length ? Math.round((correct / qs.length) * 100) : 0;
  for (const r of results) {
    console.log(`  ${r.ok ? '✓' : '✗'} ${r.id} (${r.ref}) — your answer: "${r.got}"${r.ok ? '' : `  ✗ correct: "${r.expected}"`}`);
  }
  console.log(`\nScore: ${correct}/${qs.length} (${pct}%)`);
  if (correct === qs.length) {
    // F-03: bind the pass to the exact map bytes it was scored against, so
    // `verify` can prove it later and any map change invalidates it.
    writeFileSync(PASS_FILE, JSON.stringify({ map: MAP, seed: SEED, n: qs.length, score: `${correct}/${qs.length}`, mapHash: mapHash() }, null, 2) + '\n');
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
  try { pass = JSON.parse(readFileSync(PASS_FILE, 'utf8')); }
  catch { console.log('✗ quiz pass artifact is unreadable — re-run the quiz.'); process.exit(1); }
  const [got, of] = String(pass.score || '0/1').split('/');
  if (got !== of) { console.log(`✗ recorded score is ${pass.score}, not a full pass — re-run the quiz.`); process.exit(1); }
  if (pass.mapHash !== mapHash()) {
    console.log('✗ quiz pass is STALE — the map changed since it was scored. Re-read the map and re-take the quiz.');
    process.exit(1);
  }
  console.log(`✓ quiz pass VERIFIED for the current map (seed ${pass.seed}, ${pass.score}).`);
  process.exit(0);
}

console.error('usage: quiz.mjs <generate|check|verify> [--n 12] [--seed 0] [--answers <file>] [--out <file>]');
process.exit(2);
