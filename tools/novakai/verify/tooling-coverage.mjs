#!/usr/bin/env node
/* =====================================================================
   tooling-coverage.mjs — COMPLETENESS + SYMBOL-TRUTH guard for the
   tooling map (docs/novakai/_tooling.mmd).
   ---------------------------------------------------------------------
   The src map is gated by ts-morph (novakai:gate). The dev-time tooling
   is .mjs, which that gate (allowJs:false) cannot see — so this guard is
   the tooling's equivalent proof of TRUE + COMPLETE:

     COMPLETE  — every load-bearing tools/ *.mjs module (minus the
                 audited exclusions in the allowlist) is referenced by at
                 least one `%% src <id> <path>[#symbol]` line in the map.
                 One unmapped module = exit 1 (a subsystem cannot drift
                 out of the map silently, the way tools/ did originally).
     TRUE      — every `%% src <id> <path>#<symbol>` in the map resolves:
                 the file exists AND the symbol is really defined/exported
                 there. One dangling pointer = exit 1.

   Usage:
     node tooling-coverage.mjs [--map docs/novakai/_tooling.mmd]
                               [--tools tools]
                               [--allow docs/novakai/tooling-curation-allowlist.txt]
                               [--json]
   Exit: 0 = complete + true, 1 = problem(s), 2 = bad invocation.
   ===================================================================== */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const MAP = arg('--map', 'docs/novakai/_bundle.mmd');
const TOOLS = arg('--tools', 'tools');
const ALLOW = arg('--allow', 'docs/novakai/tooling-curation-allowlist.txt');
const JSON_OUT = process.argv.includes('--json');

// Not architecture: tests, smoke checks, fixtures.
const IGNORE = [/\.test\.mjs$/, /\.smoke\.mjs$/, /__fixtures__/, /[\\/]fixtures[\\/]/];

function walk(dir, hit) {
  for (const name of readdirSync(dir)) {
    const entryPath = join(dir, name);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) walk(entryPath, hit);
    else hit(entryPath);
  }
}

// 1. denominator — every load-bearing tools/**/*.mjs
const allowlisted = new Set();
if (existsSync(ALLOW)) {
  for (const line of readFileSync(ALLOW, 'utf8').split('\n')) {
    const cleaned = line.replace(/#.*$/, '').trim();
    if (cleaned) allowlisted.add(resolve(cleaned));
  }
}
const modules = [];
walk(TOOLS, (modulePath) => {
  if (!modulePath.endsWith('.mjs')) return;
  if (IGNORE.some((pattern) => pattern.test(modulePath))) return;
  if (allowlisted.has(resolve(modulePath))) return;
  modules.push(modulePath);
});

// 2. every `%% src` pointer in the map
const SRC_LINE = /^%%\s*src\s+([A-Za-z0-9_]+)\s+(\S+?)(?:#(\S+))?\s*$/;
const covered = new Set();     // resolved file paths referenced by any %% src
const pointers = [];           // { id, path, symbol }
let mapText;
try {
  mapText = readFileSync(MAP, 'utf8');
} catch (e) {
  console.error(`cannot read map ${MAP}: ${e.message}`);
  process.exit(2);
}
for (const line of mapText.split('\n')) {
  const match = SRC_LINE.exec(line);
  if (!match) continue;
  covered.add(resolve(match[2]));
  pointers.push({ id: match[1], path: match[2], symbol: match[3] || null });
}

const problems = [];

// COMPLETE — every module is referenced
for (const modulePath of modules.sort()) {
  if (!covered.has(resolve(modulePath))) {
    problems.push(
      `UNMAPPED: ${relative('.', modulePath)} is a load-bearing tooling module with no %% src node ` +
      `in the map (map it, or add it to ${relative('.', ALLOW)} with a reason)`
    );
  }
}

// TRUE — every pointer resolves to a real file + real symbol
function definesSymbol(text, sym) {
  const esc = sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const forms = [
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${esc}\\b`),
    new RegExp(`export\\s+(?:const|let|var|class)\\s+${esc}\\b`),
    new RegExp(`export\\s+default\\s+(?:async\\s+)?function\\s+${esc}\\b`),
    new RegExp(`\\b(?:async\\s+)?function\\s+${esc}\\b`),
    new RegExp(`\\b(?:const|let|var|class)\\s+${esc}\\b`),
  ];
  if (forms.some((pattern) => pattern.test(text))) return true;
  // export { a, b as c } — match the exported (post-`as`) name
  const blocks = text.match(/export\s*\{[^}]*\}/g) || [];
  for (const block of blocks) {
    const names = block.replace(/export\s*\{|\}/g, '').split(',')
      .map((part) => part.trim().split(/\s+as\s+/).pop().trim());
    if (names.includes(sym)) return true;
  }
  return false;
}
for (const { id, path, symbol } of pointers) {
  const abs = resolve(path);
  if (!path.startsWith(TOOLS.replace(/\\/g, '/')) && !abs.includes(`${resolve(TOOLS)}`)) {
    // a %% src that points outside tools/ (e.g. an app-surface reuse note) — skip symbol-truth,
    // it is not a tooling module this guard owns.
    continue;
  }
  if (!existsSync(abs)) {
    problems.push(`DANGLING: node "${id}" points to ${path} which does not exist`);
    continue;
  }
  if (symbol) {
    const text = readFileSync(abs, 'utf8');
    if (!definesSymbol(text, symbol)) {
      problems.push(`SYMBOL: node "${id}" points to ${path}#${symbol} but ${symbol} is not defined/exported there`);
    }
  }
}

const stats = {
  modules: modules.length,
  mapped: modules.filter((modulePath) => covered.has(resolve(modulePath))).length,
  pointers: pointers.length,
  allowlisted: allowlisted.size,
};

if (JSON_OUT) {
  console.log(JSON.stringify({ problems, stats }, null, 2));
  process.exit(problems.length ? 1 : 0);
}
if (problems.length === 0) {
  console.log(
    `tooling-coverage: PASS — all ${stats.modules} tooling modules mapped, ` +
    `all ${stats.pointers} %% src pointers resolve.`
  );
  process.exit(0);
}
console.log(`tooling-coverage: FAIL — ${problems.length} problem(s):`);
for (const problem of problems) console.log('  ✗ ' + problem);
process.exit(1);
