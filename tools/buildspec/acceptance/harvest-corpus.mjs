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

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Build the merged, validated corpus. Throws on a pre-existing regression
 *  or an empty result; returns a summary of what happened otherwise. */
export function harvest({ plansDir, corpusPath, mapPath }) {
  const srcMap = srcDirectives(readFileSync(resolve(mapPath), 'utf8'));
  const existing = existsSync(resolve(corpusPath))
    ? JSON.parse(readFileSync(resolve(corpusPath), 'utf8'))
    : { base: 'acceptance-corpus', note: 'Append-only behavioural acceptance corpus harvested from completed plans (see harvest-corpus.mjs). Never hand-delete a case; edit deliberately if the behaviour changed on purpose.', changes: [] };

  const byId = new Map((existing.changes || []).map((c) => [c.id, c]));
  const skips = [];
  const addedNew = []; // { changeId, ref, name } newly appended this run

  const planFiles = readdirSync(resolve(plansDir))
    .filter((f) => f.endsWith('.plan.json'))
    .sort();

  for (const file of planFiles) {
    const planBase = file.replace(/\.plan\.json$/, '');
    const plan = JSON.parse(readFileSync(join(resolve(plansDir), file), 'utf8'));
    for (const c of plan.changes || []) {
      if (c.target?.kind !== 'node' || !Array.isArray(c.acceptance?.cases) || !c.acceptance.cases.length) continue;
      const ref = c.target.ref;
      const resolved = srcMap[ref] || (c.acceptance.path ? { path: c.acceptance.path, symbol: c.acceptance.symbol || ref } : null);
      if (!resolved) {
        console.log(`SKIP unresolvable ${ref} (${file}) — no %% src in the map and no baked acceptance.path/symbol`);
        skips.push(ref);
        continue;
      }
      const changeId = `${planBase}:${ref}`;
      let change = byId.get(changeId);
      if (!change) {
        change = { id: changeId, target: { kind: 'node', ref }, acceptance: { path: resolved.path, symbol: resolved.symbol, cases: [] } };
        byId.set(changeId, change);
      } else {
        change.acceptance.path = resolved.path;
        change.acceptance.symbol = resolved.symbol;
      }
      const haveNames = new Set(change.acceptance.cases.map((cs) => cs.name));
      for (const cs of c.acceptance.cases) {
        if (haveNames.has(cs.name)) continue;
        change.acceptance.cases.push({ ...cs });
        haveNames.add(cs.name);
        addedNew.push({ changeId, ref, name: cs.name });
      }
    }
  }

  let changes = [...byId.values()]
    .filter((c) => c.acceptance.cases.length > 0)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  if (!changes.length) {
    throw Object.assign(new Error('refuse to write an empty changes array — no resolvable acceptance cases found'), { code: 2 });
  }

  const candidate = { base: existing.base, note: existing.note, changes };

  // Validate the candidate against the real, current code before writing.
  const tmpPath = join(tmpdir(), `acceptance-corpus-candidate-${randomUUID()}.json`);
  writeFileSync(tmpPath, JSON.stringify(candidate, null, 2));
  const { results } = runAcceptance({ planPath: tmpPath, mapPath });
  const byKey = new Map(results.map((r) => [`${r.id}::${r.name}`, r]));
  const preExistingIds = new Set(addedNew.map((a) => `${a.changeId}::${a.name}`));

  const regressions = [];
  const dropped = [];
  for (const change of changes) {
    change.acceptance.cases = change.acceptance.cases.filter((cs) => {
      const key = `${change.target.ref}::${cs.name}`;
      const r = byKey.get(key);
      if (!r || r.pass) return true;
      const isNew = preExistingIds.has(`${change.id}::${cs.name}`);
      if (isNew) {
        dropped.push({ changeId: change.id, name: cs.name, error: r.error });
        console.warn(`WARN dropping newly-harvested case "${cs.name}" for ${change.id} — red against current code: ${r.error || 'no error detail'}`);
        return false;
      }
      regressions.push({ changeId: change.id, name: cs.name, error: r.error });
      return true; // keep it — the regression is reported, not silently dropped
    });
  }

  if (regressions.length) {
    const lines = regressions.map((r) => `  ${r.changeId} — ${r.name}: ${r.error || 'no error detail'}`).join('\n');
    throw Object.assign(new Error(
      `corpus regression — fix the code, or deliberately edit/delete the case in ${corpusPath} in the same PR; harvest never deletes:\n${lines}`
    ), { code: 1 });
  }

  changes = changes.filter((c) => c.acceptance.cases.length > 0);
  if (!changes.length) {
    throw Object.assign(new Error('refuse to write an empty changes array — every harvested case was red against current code'), { code: 2 });
  }
  candidate.changes = changes;

  writeFileSync(resolve(corpusPath), JSON.stringify(candidate, null, 2) + '\n');

  return {
    changeCount: changes.length,
    caseCount: changes.reduce((n, c) => n + c.acceptance.cases.length, 0),
    skips,
    added: addedNew.filter((a) => !dropped.some((d) => d.changeId === a.changeId && d.name === a.name)),
    dropped,
  };
}

function main() {
  const plansDir = arg('--plans', join(ROOT, 'docs', 'novakai', 'plans'));
  const corpusPath = arg('--corpus', join(ROOT, 'docs', 'novakai', 'acceptance-corpus.plan.json'));
  const mapPath = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
  try {
    const r = harvest({ plansDir, corpusPath, mapPath });
    console.log(`harvested: ${r.changeCount} change(s), ${r.caseCount} case(s) total, ${r.added.length} newly added, ${r.skips.length} skipped, ${r.dropped.length} newly-harvested case(s) dropped as red.`);
    process.exit(0);
  } catch (e) {
    console.error(e.message || String(e));
    process.exit(e.code || 1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
