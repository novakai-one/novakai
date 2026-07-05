#!/usr/bin/env node
/* =====================================================================
   coverage.mjs — map COMPLETENESS guard
   ---------------------------------------------------------------------
   The bundle/validate/lint pipeline proves the map is well-formed, but
   NOT that it covers every module. A brand-new source file with no
   fragment (and therefore no `%% src` pointer anywhere) sails through
   silently — that is exactly how a whole subsystem can land undocumented.

   This guard closes that hole. It walks every real source .ts file under
   <src> and fails if any file is not referenced by at least one
   `%% src <id> <path>#<symbol>` line across the per-folder fragments and
   root.mmd. One uncovered file = exit 1.

   Usage:
     node coverage.mjs [--src src] [--root docs/novakai/root.mmd]

   Exit: 0 = every source file is represented, 1 = uncovered file(s),
         2 = bad invocation.
   ===================================================================== */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, basename } from 'node:path';

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const SRC = arg('--src', 'src');
const ROOT = arg('--root', 'docs/novakai/root.mmd');

// Files that are not modules to document: type shims, worker entry already
// covered, tests, and the generated/declaration files.
const IGNORE = [
  /\.d\.ts$/,
  /vite-env\.d\.ts$/,
  /\.test\.ts$/,
  /\.spec\.ts$/,
];

function walk(dir, hit) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, hit);
    else hit(p);
  }
}

// 1. real source files that should be covered
const sources = [];
walk(SRC, (p) => {
  if (!p.endsWith('.ts')) return;
  if (IGNORE.some((re) => re.test(p))) return;
  sources.push(p);
});

// 2. every file path referenced by a `%% src` line, from all fragments + root
const SRC_LINE = /^%%\s*src\s+[A-Za-z0-9_]+\s+(\S+?)(?:#\S+)?\s*$/;
const covered = new Set();
const fragments = [];
walk(SRC, (p) => { if (p.endsWith('.novakai.mmd')) fragments.push(p); });
fragments.push(ROOT);
for (const f of fragments) {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch { continue; }
  for (const line of text.split('\n')) {
    const m = SRC_LINE.exec(line);
    if (m) covered.add(resolve(m[1]));
  }
}

// A file is also covered if it has its own sibling fragment, even when that
// fragment carries no `%% src` back to it (e.g. main.ts, the composition root,
// is documented as boot phases rather than exported symbols).
const hasSiblingFragment = (p) => {
  try { return !!statSync(p.replace(/\.ts$/, '.novakai.mmd')); }
  catch { return false; }
};

// 3. report
const uncovered = sources
  .filter((p) => !covered.has(resolve(p)) && !hasSiblingFragment(p))
  .sort();
if (uncovered.length) {
  console.log(`novakai-coverage: ${uncovered.length} source file(s) not represented in the map:`);
  for (const p of uncovered) console.log('  ✗ ' + relative('.', p));
  console.log('\nEvery module must be documented. Add a `*.novakai.mmd` fragment beside the file');
  console.log('(or fold its symbols into a parent fragment via `%% src <id> <path>#<symbol>`),');
  console.log('register the container in root.mmd if it is a new top-level module, then re-run `npm run novakai:ship`.');
  process.exit(1);
}
console.log(`novakai-coverage: PASS — all ${sources.length} source files are represented in the map.`);
process.exit(0);
