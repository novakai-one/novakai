#!/usr/bin/env node
/* =====================================================================
   harvest-corpus.mjs — J1: append-only behavioural acceptance corpus.
   ---------------------------------------------------------------------
   Completed plans' acceptance cases (Keystone 2, acceptance.mjs) are
   discarded once a plan ships — a feature proven last month is unguarded
   this month. This scans `docs/novakai/plans/*.plan.json` for changes
   carrying `acceptance.cases` and merges them into ONE durable,
   plan-shaped corpus file that `acceptance.mjs` runs unchanged forever.

   Resolution is MAP-FIRST: a change's `target.ref` is resolved against
   the CURRENT `%% src` directives in `_bundle.mmd` (so a since-moved file
   still resolves), falling back to the archived plan's own baked
   `acceptance.path`/`symbol` only if the map has no entry. A ref that
   resolves neither way is unrunnable today and is SKIPPED (logged), not
   silently dropped from the intent.

   Merge is APPEND-ONLY: existing changes/cases are never deleted. Cases
   dedupe by name — a name already in the corpus keeps its existing
   content (a deliberate hand-edit to a corpus case, e.g. to update an
   `equals`, survives every future harvest run untouched); only
   never-before-seen names are appended. path/symbol on an existing
   change MAY refresh to the current map resolution (harmless — it only
   changes where the runner looks, not what it asserts).

   Before writing, the merged candidate is validated by running it
   through the real `runAcceptance` engine:
     - a newly-added case that comes up RED is dropped with a warning
       (a corpus can't harvest a case the current code doesn't satisfy);
     - a PRE-EXISTING corpus case that comes up RED is a regression —
       exit 1 and refuse to write. Fix the code, or deliberately edit/
       delete the case in docs/novakai/acceptance-corpus.plan.json in the
       same PR (harvest itself never deletes).
   An empty `changes` array is refused outright (never write a vacuous
   corpus that would make the CI acceptance step pass trivially).

   This is a ponytail one-shot backfill run once against the 10 archived
   plans, re-run manually whenever a plan with acceptance cases completes
   — no hook, no schedule. No dedicated test suite for this tool: the
   generated corpus file + CI's `novakai:acceptance -- --plan
   acceptance-corpus.plan.json` step ARE the regression check, and the
   red-refusal guard above just duplicates what that CI step already
   enforces, so keeping this file itself untested is a deliberate trim.

   Runtime note: the corpus is executed by acceptance.mjs's subprocess,
   which runs under `node --experimental-strip-types` (not tsx) — a case
   whose target module uses a TS `enum` or `namespace` cannot run there.

   Usage:
     node harvest-corpus.mjs [--plans docs/novakai/plans]
                             [--corpus docs/novakai/acceptance-corpus.plan.json]
                             [--map docs/novakai/_bundle.mmd]
   Exit: 0 = merged/validated (or already up to date), 1 = a pre-existing
   corpus case regressed, 2 = refused to write an empty corpus.
   ===================================================================== */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { srcDirectives, runAcceptance } from './acceptance.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const CORPUS_NOTE = 'Append-only behavioural acceptance corpus harvested from completed plans '
  + '(see harvest-corpus.mjs). Never hand-delete a case; edit deliberately if the behaviour '
  + 'changed on purpose.';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Read the existing corpus file, or the empty-corpus shape if none yet. */
function loadExistingCorpus(corpusPath) {
  return existsSync(resolve(corpusPath))
    ? JSON.parse(readFileSync(resolve(corpusPath), 'utf8'))
    : { base: 'acceptance-corpus', note: CORPUS_NOTE, changes: [] };
}

/** Resolve a plan change's target ref to a { path, symbol }, map-first. */
function resolveMergeTarget(change, srcMap) {
  const ref = change.target.ref;
  const resolved = srcMap[ref]
    || (change.acceptance.path ? { path: change.acceptance.path, symbol: change.acceptance.symbol || ref } : null);
  return { ref, resolved };
}

/** Look up (or create) the corpus's change record for `changeId`, refreshing
 *  its path/symbol to the latest resolution either way. Mutates `byId`. */
function getOrCreateCorpusChange({ byId, changeId, ref, resolved }) {
  let corpusChange = byId.get(changeId);
  if (!corpusChange) {
    corpusChange = {
      id: changeId, target: { kind: 'node', ref },
      acceptance: { path: resolved.path, symbol: resolved.symbol, cases: [] },
    };
    byId.set(changeId, corpusChange);
  } else {
    corpusChange.acceptance.path = resolved.path;
    corpusChange.acceptance.symbol = resolved.symbol;
  }
  return corpusChange;
}

/** Append never-before-seen cases (by name) onto `corpusChange`, recording
 *  each into `addedNew`. Mutates `corpusChange.acceptance.cases`. */
function appendNewCases({ corpusChange, cases, changeId, ref, addedNew }) {
  const haveNames = new Set(corpusChange.acceptance.cases.map((entry) => entry.name));
  for (const caseEntry of cases) {
    if (haveNames.has(caseEntry.name)) continue;
    corpusChange.acceptance.cases.push({ ...caseEntry });
    haveNames.add(caseEntry.name);
    addedNew.push({ changeId, ref, name: caseEntry.name });
  }
}

/** Merge one plan change's acceptance cases into the corpus's `byId` map
 *  (mutates `byId` in place), appending newly-seen case names to `addedNew`
 *  and unresolvable refs to `skips`. */
function mergeOnePlanChange({ change, planBase, planFile, srcMap, byId, skips, addedNew }) {
  if (change.target?.kind !== 'node' || !Array.isArray(change.acceptance?.cases)
    || !change.acceptance.cases.length) return;
  const { ref, resolved } = resolveMergeTarget(change, srcMap);
  if (!resolved) {
    console.log(`SKIP unresolvable ${ref} (${planFile}) `
      + '— no %% src in the map and no baked acceptance.path/symbol');
    skips.push(ref);
    return;
  }
  const changeId = `${planBase}:${ref}`;
  const corpusChange = getOrCreateCorpusChange({ byId, changeId, ref, resolved });
  appendNewCases({ corpusChange, cases: change.acceptance.cases, changeId, ref, addedNew });
}

/** Scan every plan file's changes and merge their acceptance cases into
 *  `byId` (mutated in place). Returns { skips, addedNew }. */
function mergePlanChangesIntoCorpus({ plansDir, srcMap, byId }) {
  const skips = [];
  const addedNew = []; // { changeId, ref, name } newly appended this run

  const planFiles = readdirSync(resolve(plansDir))
    .filter((file) => file.endsWith('.plan.json'))
    .sort();

  for (const planFile of planFiles) {
    const planBase = planFile.replace(/\.plan\.json$/, '');
    const plan = JSON.parse(readFileSync(join(resolve(plansDir), planFile), 'utf8'));
    for (const change of plan.changes || []) {
      mergeOnePlanChange({ change, planBase, planFile, srcMap, byId, skips, addedNew });
    }
  }
  return { skips, addedNew };
}

/** Decide whether one case survives validation: pass/unknown keeps it; a red
 *  newly-harvested case is dropped (with a warning); a red PRE-EXISTING case
 *  is a regression (kept, reported). Mutates `dropped`/`regressions`. */
function classifyCaseResult({ change, caseEntry, byKey, preExistingIds, dropped, regressions }) {
  const key = `${change.target.ref}::${caseEntry.name}`;
  const result = byKey.get(key);
  if (!result || result.pass) return true;
  const isNew = preExistingIds.has(`${change.id}::${caseEntry.name}`);
  if (isNew) {
    dropped.push({ changeId: change.id, name: caseEntry.name, error: result.error });
    console.warn(`WARN dropping newly-harvested case "${caseEntry.name}" for ${change.id} `
      + `— red against current code: ${result.error || 'no error detail'}`);
    return false;
  }
  regressions.push({ changeId: change.id, name: caseEntry.name, error: result.error });
  return true; // keep it — the regression is reported, not silently dropped
}

/** Validate the candidate corpus against the real, current code. Mutates
 *  each change's `acceptance.cases` in place, dropping newly-harvested red
 *  cases. Returns { regressions, dropped }. */
function validateCandidate({ candidate, mapPath, addedNew }) {
  const tmpPath = join(tmpdir(), `acceptance-corpus-candidate-${randomUUID()}.json`);
  writeFileSync(tmpPath, JSON.stringify(candidate, null, 2));
  const { results } = runAcceptance({ planPath: tmpPath, mapPath });
  const byKey = new Map(results.map((result) => [`${result.id}::${result.name}`, result]));
  const preExistingIds = new Set(addedNew.map((entry) => `${entry.changeId}::${entry.name}`));

  const regressions = [];
  const dropped = [];
  for (const change of candidate.changes) {
    change.acceptance.cases = change.acceptance.cases.filter((caseEntry) =>
      classifyCaseResult({ change, caseEntry, byKey, preExistingIds, dropped, regressions }));
  }
  return { regressions, dropped };
}

/** Sort the merged corpus changes deterministically, dropping any with no
 *  surviving cases. */
function assembleSortedChanges(byId) {
  return [...byId.values()]
    .filter((change) => change.acceptance.cases.length > 0)
    .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
}

/** Throw a code:2 error (refuse-to-write) if `changes` is empty. */
function requireNonEmptyChanges(changes, message) {
  if (!changes.length) throw Object.assign(new Error(message), { code: 2 });
}

/** Throw a code:1 error describing every pre-existing regression. */
function reportRegressions(regressions, corpusPath) {
  const lines = regressions
    .map((entry) => `  ${entry.changeId} — ${entry.name}: ${entry.error || 'no error detail'}`)
    .join('\n');
  throw Object.assign(new Error(
    `corpus regression — fix the code, or deliberately edit/delete the case in ${corpusPath} `
    + `in the same PR; harvest never deletes:\n${lines}`
  ), { code: 1 });
}

/** Re-filter the validated candidate, write it, and build the run summary. */
function writeCorpusAndSummarize({ candidate, corpusPath, skips, addedNew, dropped }) {
  const changes = candidate.changes.filter((change) => change.acceptance.cases.length > 0);
  requireNonEmptyChanges(changes, 'refuse to write an empty changes array — '
    + 'every harvested case was red against current code');
  candidate.changes = changes;

  writeFileSync(resolve(corpusPath), JSON.stringify(candidate, null, 2) + '\n');

  return {
    changeCount: changes.length,
    caseCount: changes.reduce((total, change) => total + change.acceptance.cases.length, 0),
    skips,
    added: addedNew.filter((entry) =>
      !dropped.some((drop) => drop.changeId === entry.changeId && drop.name === entry.name)),
    dropped,
  };
}

/** Build the merged, validated corpus. Throws on a pre-existing regression
 *  or an empty result; returns a summary of what happened otherwise. */
export function harvest({ plansDir, corpusPath, mapPath }) {
  const srcMap = srcDirectives(readFileSync(resolve(mapPath), 'utf8'));
  const existing = loadExistingCorpus(corpusPath);

  const byId = new Map((existing.changes || []).map((entry) => [entry.id, entry]));
  const { skips, addedNew } = mergePlanChangesIntoCorpus({ plansDir, srcMap, byId });

  const changes = assembleSortedChanges(byId);
  requireNonEmptyChanges(changes, 'refuse to write an empty changes array — no resolvable acceptance cases found');

  const candidate = { base: existing.base, note: existing.note, changes };

  // Validate the candidate against the real, current code before writing.
  const { regressions, dropped } = validateCandidate({ candidate, mapPath, addedNew });
  if (regressions.length) reportRegressions(regressions, corpusPath);

  return writeCorpusAndSummarize({ candidate, corpusPath, skips, addedNew, dropped });
}

function main() {
  const plansDir = arg('--plans', join(ROOT, 'docs', 'novakai', 'plans'));
  const corpusPath = arg('--corpus', join(ROOT, 'docs', 'novakai', 'acceptance-corpus.plan.json'));
  const mapPath = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
  try {
    const outcome = harvest({ plansDir, corpusPath, mapPath });
    console.log(`harvested: ${outcome.changeCount} change(s), ${outcome.caseCount} case(s) total, `
      + `${outcome.added.length} newly added, ${outcome.skips.length} skipped, `
      + `${outcome.dropped.length} newly-harvested case(s) dropped as red.`);
    process.exit(0);
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(e.code || 1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
