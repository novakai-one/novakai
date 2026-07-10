#!/usr/bin/env node
/* =====================================================================
   acceptance.mjs — E2: KEYSTONE 2, behavioural acceptance tests in the
   contract.
   ---------------------------------------------------------------------
   The signature gate proves a change is correctly SHAPED (arity, types,
   members). It cannot prove the code BEHAVES as agreed — a function with
   the right signature can still return the wrong thing. This closes that
   gap: an approved plan change may carry `acceptance` cases (concrete
   input → expected output examples for the node's symbol). This tool runs
   them against the REAL implemented code (resolved from the map's `%% src`
   directive), so:

     • before the change is implemented  → the symbol is missing / a thrown
       stub  → every case FAILS (red).  "done" is provably not yet reached.
     • after it is implemented to spec    → cases PASS (green).

   "done" therefore means BOTH the signature gate is green AND these
   behavioural cases are green — not just correctly-shaped, but correct.

   A change's acceptance block:
     "acceptance": {
       "cases": [
         { "name": "real node keeps its position",
           "args": [[{ "id": "a", "x": 1, "y": 2 }]],
           "equals": { "a": { "x": 1, "y": 2 } } }
       ]
     }
   The symbol under test is the change's target node id, resolved to a real
   export via the map's `%% src <id> <path>#<symbol>` directive.

   CASE KINDS (H1 — widen Keystone-2 beyond pure functions):
     • "pure" (default): deepStrictEqual(fn(...args), equals).
     • "projection": for ctx/DOM-bound logic factored to take a plain
       ctx-slice arg. The case adds a "projection" lens — a PURE expression
       string of the form "(result, args) => <slice>" — and the runner
       compares lens(fn(...args), args) to `equals`. This lets a function
       that returns a large object (assert only a slice) or mutates a
       plain-object arg (assert `args[i]` post-call) carry a behavioural
       contract WITHOUT a DOM. The lens is built with `new Function` (an
       expression, never statements) and must be pure — no Date.now /
       Math.random / external refs — so the run stays byte-deterministic
       (replayable). No jsdom, no real DOM, ever.
         { "name": "clamps to readable zoom", "kind": "projection",
           "args": [{ "w": 200, "h": 100, "x": 100, "y": 100 }, 800, 600, 10, 0.15, 3],
           "projection": "(result) => result.z", "equals": 3 }

   Usage:
     node acceptance.mjs --plan <plan.json> [--map docs/novakai/_bundle.mmd] [--json]
   Exit: 0 = all behavioural cases pass, 1 = a case failed (red / not done),
         2 = bad invocation, 4 = no acceptance cases found in the plan.
   ===================================================================== */

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const D_SRC = /^%%\s*src\s+([A-Za-z0-9_]+)\s+(\S+)\s*$/;

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Map node id -> { path, symbol } from the bundle's `%% src` directives. */
export function srcDirectives(mapText) {
  const out = {};
  for (const line of mapText.split('\n')) {
    const match = D_SRC.exec(line);
    if (match) {
      const raw = match[2];
      const hashIndex = raw.indexOf('#');
      out[match[1]] = {
        path: hashIndex >= 0 ? raw.slice(0, hashIndex) : raw,
        symbol: hashIndex >= 0 ? raw.slice(hashIndex + 1) : match[1],
      };
    }
  }
  return out;
}

/** Resolve a change's acceptance source: its own baked path/symbol wins,
 *  else the map's current `%% src` resolution for the node id. */
function resolveCaseSource(acc, ref, srcMap) {
  return acc.path ? { path: acc.path, symbol: acc.symbol || ref } : (srcMap[ref] || null);
}

/** Build one runnable case record from a plan's raw case spec. */
function buildCase(ref, src, caseSpec) {
  return {
    id: ref,
    path: src?.path ?? null,
    symbol: src?.symbol ?? ref,
    name: caseSpec.name || `${ref} case`,
    kind: caseSpec.kind === 'projection' ? 'projection' : 'pure',
    projection: typeof caseSpec.projection === 'string' ? caseSpec.projection : null,
    args: Array.isArray(caseSpec.args) ? caseSpec.args : [],
    equals: caseSpec.equals,
  };
}

/**
 * Collect runnable acceptance cases from a plan. Each case resolves the
 * change's target node id to a real export via the map. Returns
 * [{ id, path, symbol, name, args, equals }].
 */
export function collectCases(plan, srcMap) {
  const cases = [];
  for (const change of plan.changes || []) {
    const acc = change.acceptance;
    if (!acc || !Array.isArray(acc.cases) || change.target?.kind !== 'node') continue;
    const ref = change.target.ref;
    const src = resolveCaseSource(acc, ref, srcMap);
    for (const caseSpec of acc.cases) cases.push(buildCase(ref, src, caseSpec));
  }
  return cases;
}

// Subprocess: imports each referenced symbol from its real .ts source (with a
// resolve hook for extensionless imports), runs every case with deepStrictEqual,
// and prints results. A missing/throwing symbol => that case fails (not crash).
// kind:'projection' cases apply a pure `new Function` lens to the result+args
// before comparing, so ctx/DOM-bound logic factored to plain data is testable.
// `await` wraps the call so sync AND async symbols both work (await of a
// non-Promise is a no-op). No DOM is ever constructed; the lens must be pure.
const SUBPROCESS = `
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && context.parentURL && !/\\.[^./]+$/.test(specifier)) {
      const dir = fileURLToPath(new URL('.', context.parentURL));
      const tsPath = join(dir, specifier + '.ts');
      if (existsSync(tsPath)) return { shortCircuit: true, url: pathToFileURL(tsPath).href };
    }
    return nextResolve(specifier, context);
  },
});

const cases = JSON.parse(readFileSync(0, 'utf8'));
const modCache = new Map();
const results = [];
for (const c of cases) {
  try {
    if (!c.path) throw new Error('no %% src mapping for ' + c.id + ' (symbol not in the map / not implemented)');
    const abs = pathToFileURL(c.path).href;
    if (!modCache.has(abs)) modCache.set(abs, await import(abs));
    const mod = modCache.get(abs);
    const fn = mod[c.symbol];
    if (typeof fn !== 'function') throw new Error('export ' + c.symbol + ' is not a function (unimplemented?)');
    const got = await fn(...c.args);
    if (c.kind === 'projection') {
      if (typeof c.projection !== 'string' || !c.projection.trim())
        throw new Error('projection case "' + c.name +
          '" has no projection lens (expected "(result, args) => <slice>")');
      let lens;
      try { lens = (new Function('return (' + c.projection + ')'))(); }
      catch (le) { throw new Error('projection lens is not a valid expression: ' + String(le && le.message || le)); }
      if (typeof lens !== 'function') throw new Error('projection lens must evaluate to a function');
      const projected = await lens(got, c.args);
      assert.deepStrictEqual(projected, c.equals);
    } else {
      assert.deepStrictEqual(got, c.equals);
    }
    results.push({ id: c.id, name: c.name, pass: true });
  } catch (e) {
    results.push({
      id: c.id, name: c.name, pass: false,
      error: String(e && e.message || e).split('\\n')[0].slice(0, 500),
    });
  }
}
console.log(JSON.stringify(results));
`;

/** Run the SUBPROCESS harness against the prepared cases. */
function runSubprocess(prepared) {
  return spawnSync('node', ['--experimental-strip-types', '--input-type=module', '-e', SUBPROCESS],
    { input: JSON.stringify(prepared), encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

/** Turn a spawnSync result into the { ran, results, error? } shape. */
function parseSubprocessResult(result, cases) {
  if (result.status !== 0 && !result.stdout) {
    return {
      ran: true,
      error: result.stderr || 'subprocess failed',
      results: cases.map((caseItem) => (
        { id: caseItem.id, name: caseItem.name, pass: false, error: 'runner failed to start' }
      )),
    };
  }
  try {
    return { ran: true, results: JSON.parse(result.stdout) };
  } catch {
    return { ran: true, error: `bad runner output: ${result.stdout.slice(0, 300)}`, results: [] };
  }
}

export function runAcceptance({ planPath, mapPath }) {
  const plan = JSON.parse(readFileSync(resolve(planPath), 'utf8'));
  const srcMap = srcDirectives(readFileSync(resolve(mapPath), 'utf8'));
  const cases = collectCases(plan, srcMap);
  if (!cases.length) return { ran: false, results: [] };

  // resolve relative src paths against repo root for the subprocess
  const prepared = cases.map((caseItem) => (
    { ...caseItem, path: caseItem.path ? resolve(ROOT, caseItem.path) : null }
  ));
  return parseSubprocessResult(runSubprocess(prepared), cases);
}

/** Print the human-readable result listing; returns the passed count. */
function printHumanResults(res, planPath) {
  const passed = res.results.filter((result) => result.pass).length;
  console.log(`=== acceptance — behavioural contract for ${planPath} ===\n`);
  for (const result of res.results) {
    console.log(`  ${result.pass ? '✓' : '✗'} ${result.id} — ${result.name}`
      + `${result.pass ? '' : `\n        ${result.error}`}`);
  }
  console.log(`\n${passed}/${res.results.length} behavioural case(s) green`);
  if (res.error) console.log(`(runner note: ${res.error})`);
  return passed;
}

/** Read --plan or exit 2 with a usage message. */
function requirePlanPath() {
  const planPath = arg('--plan');
  if (!planPath) {
    console.error('usage: acceptance.mjs --plan <plan.json> [--map <bundle.mmd>] [--json]');
    process.exit(2);
  }
  return planPath;
}

/** Print the final verdict line (unless --json) and exit 0/1 accordingly. */
function finishWithVerdict({ passed, res, jsonOut }) {
  if (passed === res.results.length && res.results.length) {
    if (!jsonOut) console.log('✓ behavioural contract satisfied — the change is DONE (shaped AND correct).');
    process.exit(0);
  }
  if (!jsonOut) console.log('✗ behavioural contract NOT satisfied — red until the code behaves as agreed.');
  process.exit(1);
}

/* ---------------- CLI ---------------- */
function main() {
  const planPath = requirePlanPath();
  const mapPath = arg('--map', join(ROOT, 'docs', 'novakai', '_bundle.mmd'));
  const jsonOut = process.argv.includes('--json');

  const res = runAcceptance({ planPath, mapPath });
  if (jsonOut) console.log(JSON.stringify(res, null, 2));

  if (!res.ran) {
    if (!jsonOut) console.log('no acceptance cases in this plan — nothing to verify '
      + '(add an `acceptance.cases` block to a change).');
    process.exit(4);
  }

  const passed = jsonOut
    ? res.results.filter((result) => result.pass).length
    : printHumanResults(res, planPath);

  finishWithVerdict({ passed, res, jsonOut });
}

if (import.meta.url === `file://${process.argv[1]}`) main();
