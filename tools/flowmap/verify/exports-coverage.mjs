#!/usr/bin/env node
/* =====================================================================
   exports-coverage.mjs — map COMPLETENESS guard at SYMBOL level
   ---------------------------------------------------------------------
   coverage.mjs proves every source FILE is represented. That is not
   enough: a new exported function/type added to an already-covered file
   sails through silently — the map under-describes the code while the
   gate (map-driven) and coverage (file-level) both stay green. That is
   exactly how `downstreamCone`, `applyPlan`, `sliceIds`, `sliceStubs`
   drifted out of the map while CI was green.

   This guard closes that hole. For every exported symbol under <src>
   (functions, classes, interfaces, type aliases, const, enums — via the
   TS type-checker, not regex), it FAILS unless the symbol is one of:
     1. the `#symbol` of a `%% src` pointer in the bundle (a real node), or
     2. the `name=` of a node that has no `%% src` (a type-alias node), or
     3. an explicit entry in the curation allowlist (deliberately not a
        node — e.g. config scalars, trivial type aliases).

   The allowlist makes "omitted" an auditable decision, never an accident.

   Usage:
     node exports-coverage.mjs --map <bundle.mmd> --tsconfig <tsconfig> \
                               --src src --allow <allowlist.txt> [--report]

   Exit: 0 = every export mapped or allow-listed, 1 = unmapped export(s),
         2 = bad invocation. --report lists+counts but always exits 0.
   ===================================================================== */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { Project } from 'ts-morph';

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const MAP = arg('--map', 'docs/flowmap/_bundle.mmd');
const TSCONFIG = arg('--tsconfig', 'tsconfig.json');
const SRC = arg('--src', 'src');
const ALLOW = arg('--allow', 'docs/flowmap/curation-allowlist.txt');
const REPORT_ONLY = process.argv.includes('--report');

const IGNORE = [/\.d\.ts$/, /vite-env\.d\.ts$/, /\.test\.ts$/, /\.spec\.ts$/, /\.contract\.ts$/, /__types\.generated\.ts$/];

/* ---------- 1. exported symbols the CODE defines, per file ---------- */
const project = new Project({ tsConfigFilePath: resolve(TSCONFIG) });
const codeExports = new Map(); // resolved file -> Set(symbol)
for (const sf of project.getSourceFiles()) {
  const fp = sf.getFilePath();
  if (!fp.includes(`/${SRC}/`) && !fp.endsWith(`/${SRC}`)) {
    // only files under <src>
    if (!resolve(fp).startsWith(resolve(SRC) + '/')) continue;
  }
  if (IGNORE.some((re) => re.test(fp))) continue;
  const set = new Set();
  for (const [name, decls] of sf.getExportedDeclarations()) {
    // keep the name only if at least one declaration physically lives in
    // this file (drop pure re-exports, which the owning file already covers)
    if (decls.some((d) => d.getSourceFile() === sf)) set.add(name);
  }
  if (set.size) codeExports.set(resolve(fp), set);
}

/* ---------- 2. symbols the MAP represents ---------- */
const SRC_LINE = /^%%\s*src\s+(\S+)\s+(\S+?)(?:#(\S+))?\s*$/;
const NAME_LINE = /^%%\s*fm:meta\s+(\S+)\s+name=(.+?)\s*$/;
const fileMapped = new Map(); // resolved file -> Set(symbol with a %% src)
const srcIds = new Set();      // node ids that have a %% src
const nameOf = new Map();      // node id -> name
const text = readFileSync(MAP, 'utf8');
for (const line of text.split('\n')) {
  let m;
  if ((m = SRC_LINE.exec(line))) {
    const [, id, path, sym] = m;
    srcIds.add(id);
    if (sym) {
      const f = resolve(path);
      if (!fileMapped.has(f)) fileMapped.set(f, new Set());
      fileMapped.get(f).add(sym);
    }
  } else if ((m = NAME_LINE.exec(line))) {
    nameOf.set(m[1], m[2]);
  }
}
// type-alias nodes: have a name= but no %% src — accepted by name globally
const srclessNames = new Set();
for (const [id, name] of nameOf) if (!srcIds.has(id)) srclessNames.add(name);

/* ---------- 3. curation allowlist ---------- */
const allowPair = new Set(); // "relpath#symbol"
const allowBare = new Set(); // "symbol" (any file)
if (existsSync(ALLOW)) {
  for (const raw of readFileSync(ALLOW, 'utf8').split('\n')) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    if (line.includes('#')) allowPair.add(line); // note: '#' stripped above, so use '/' form
  }
  // re-parse to keep "path#symbol" (the comment strip above would eat '#'):
  allowPair.clear();
  for (const raw of readFileSync(ALLOW, 'utf8').split('\n')) {
    const noComment = raw.replace(/\s+#.*$/, '').trim(); // strip trailing " # comment" only
    if (!noComment || noComment.startsWith('#')) continue;
    if (noComment.includes('#')) allowPair.add(noComment);
    else allowBare.add(noComment);
  }
}

/* ---------- 4. diff ---------- */
const uncovered = [];
for (const [file, syms] of [...codeExports].sort()) {
  const rel = relative('.', file);
  const mapped = fileMapped.get(file) || new Set();
  for (const sym of [...syms].sort()) {
    const covered =
      mapped.has(sym) ||
      srclessNames.has(sym) ||
      allowPair.has(`${rel}#${sym}`) ||
      allowBare.has(sym);
    if (!covered) uncovered.push(`${rel}#${sym}`);
  }
}

/* ---------- 5. report ---------- */
if (uncovered.length) {
  console.log(`flowmap-exports: ${uncovered.length} exported symbol(s) not represented in the map:`);
  for (const u of uncovered) console.log('  ✗ ' + u);
  console.log('\nEach exported symbol must be a node in the map, or an explicit entry in');
  console.log(`${ALLOW} (a deliberate curation decision). Add a node to the owning fragment`);
  console.log('and run `npm run flowmap:ship`, or allowlist it with a reason.');
  if (!REPORT_ONLY) process.exit(1);
} else {
  const total = [...codeExports.values()].reduce((n, s) => n + s.size, 0);
  console.log(`flowmap-exports: PASS — all ${total} exported symbols across ${codeExports.size} files are represented (node or allow-listed).`);
}
process.exit(0);
