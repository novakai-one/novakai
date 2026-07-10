#!/usr/bin/env node
/* =====================================================================
   edge-verify.mjs — A5: make the map's EDGES code-backed-or-audited
   ---------------------------------------------------------------------
   The gate (gate.mjs) proves every NODE exists in code and every gated
   signature matches — but it treats EDGES as warnings only ("spec edges
   are semantic call-order, extracted edges are imports — not 1:1"). That
   left the whole edge set (the call/runtime graph) UNVERIFIED. The human
   review surface sells blast-radius / downstreamCone / "who consumes this
   node" — and every one of those walks the edge list. So the one layer the
   review's confidence rests on was the one layer nothing enforced.

   A5 closes that the same way A1 (exports-coverage) closed hidden symbols:
   not by proving every semantic edge is a literal call, but by making each
   edge ACCOUNTED FOR. Every spec edge is one of:

     VERIFIED(import) — the source node's file imports the target node's file
                        (the real module dependency the edge claims).
     VERIFIED(intra)  — both endpoints live in the same file (co-located;
                        the source declaration textually references the
                        target symbol). An import is N/A within one file.
     ADVISORY         — neither of the above, but the edge is listed in the
                        audited allowlist docs/novakai/edge-advisory-allowlist.txt
                        (a deliberate semantic/runtime edge with no direct
                        import — e.g. a ctx.hooks call that breaks an import
                        cycle by design). Editing that file is a design
                        decision, exactly like the curation-allowlist.
     UNACCOUNTED      — none of the above. A FAIL under --strict: an edge
                        asserting a dependency that neither exists in code
                        nor was consciously marked advisory. This is the
                        case that used to pass silently and mislead a review.

   Node->files: a unit node maps to its `%% src <id> <path>#<sym>` file. A
   module/group node (no src of its own) maps to the union of its descendant
   units' files, so module-level edges (main -> state) resolve to real files.

   Usage:
     node edge-verify.mjs [--map docs/novakai/_bundle.mmd] [--tsconfig tsconfig.json]
                          [--allow docs/novakai/edge-advisory-allowlist.txt]
                          [--strict] [--json] [--write-allowlist]
   Exit: 0 = every edge accounted for (or non-strict), 1 = unaccounted edges
         under --strict (or --write-allowlist failed), 2 = bad invocation.

     node edge-verify.mjs --fn-edges [--map ...] [--derived docs/novakai/derived-fn-edges.json] [--json]
   REPORT-ONLY mode: triages hand-authored function-level edges against the
   ts-morph-derived call graph (see triageFnEdges below). Always exits 0 —
   this is diagnostic, not a gate, until the triage is clean.
   ===================================================================== */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Project } from 'ts-morph';
import { parseMmd } from '../../buildspec/core/mmd-parse.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const D_SRC = /^%%\s*src\s+([A-Za-z0-9_]+)\s+(\S+)\s*$/;

function arg(flag, fallback = null) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

/** Parse `%% src <id> <path>[#symbol]` lines into id -> { path, symbol }. */
function srcMapOf(text) {
  const out = {};
  for (const line of text.split('\n')) {
    const match = D_SRC.exec(line);
    if (match) {
      const raw = match[2];
      const hash = raw.indexOf('#');
      out[match[1]] = {
        path: hash >= 0 ? raw.slice(0, hash) : raw,
        symbol: hash >= 0 ? raw.slice(hash + 1) : match[1],
      };
    }
  }
  return out;
}

/** children map (parent id -> child ids), groups included. */
function childrenOf(nodes) {
  const kids = {};
  for (const id in nodes) {
    const parentId = nodes[id].parent;
    if (parentId) (kids[parentId] ||= []).push(id);
  }
  return kids;
}

/** Every transitive descendant id of `id` (through group subgraphs too). */
function descendants(id, kids) {
  const out = [];
  const stack = [...(kids[id] || [])];
  const seen = new Set();
  while (stack.length) {
    const childId = stack.pop();
    if (seen.has(childId)) continue;
    seen.add(childId);
    out.push(childId);
    for (const grandchildId of kids[childId] || []) stack.push(grandchildId);
  }
  return out;
}

/**
 * node id -> Set<absolute file path>. A unit node = its own src file; a
 * module/group node = the union of its descendant units' files. When a module
 * node carries no src and has no src-mapped descendants (e.g. `main` — the
 * untagged composition root), fall back to the repo's one-module-per-file
 * convention (CLAUDE.md invariant): match the node id to a source file whose
 * basename equals it. Pure layout nodes with no match stay empty.
 */
function fileOf(ctx, id) {
  return ctx.srcMap[id] ? resolve(ROOT, ctx.srcMap[id].path) : null;
}

// a node's own resolvable file: its src, or the module=file basename fallback.
function ownFile(ctx, id) {
  return fileOf(ctx, id) || ctx.basenameIndex[id] || null;
}

// nearest ancestor (through group subgraphs) whose own file resolves — lets a
// tagged-but-not-src-mapped unit (e.g. main.ts's boot fns, types.ts's enums)
// inherit its module's file so intra-module edges verify as co-located.
function ancestorFile(ctx, id) {
  let cur = ctx.nodes[id]?.parent ?? null;
  const seen = new Set();
  while (cur && ctx.nodes[cur] && !seen.has(cur)) {
    seen.add(cur);
    const file = ownFile(ctx, cur);
    if (file) return file;
    cur = ctx.nodes[cur].parent ?? null;
  }
  return null;
}

function collectFiles(ctx, id) {
  const files = new Set();
  const self = fileOf(ctx, id);
  if (self) files.add(self);
  for (const descendantId of descendants(id, ctx.kids)) {
    const file = fileOf(ctx, descendantId);
    if (file) files.add(file);
  }
  // A split module's node src-maps to its part/-core files, but the file OTHER
  // modules actually import is the same-basename facade/barrel entry (e.g.
  // avoidRouter.ts re-exporting avoidRouter-core). Include it so an import of
  // the facade verifies as a real import, not a hand-audited advisory edge.
  if (ctx.basenameIndex[id]) files.add(ctx.basenameIndex[id]);
  if (!files.size) { // inherit module file
    const ancestor = ancestorFile(ctx, id);
    if (ancestor) files.add(ancestor);
  }
  return files;
}

function nodeFiles(nodes, srcMap, kids, basenameIndex) {
  const ctx = { nodes, srcMap, kids, basenameIndex };
  const out = {};
  for (const id in nodes) out[id] = collectFiles(ctx, id);
  return out;
}

/** file path -> Set<file path> it imports (resolved, intra-project only). */
function importGraph(project) {
  const graph = {};
  for (const sourceFile of project.getSourceFiles()) {
    const from = sourceFile.getFilePath();
    const set = (graph[from] ||= new Set());
    for (const imp of sourceFile.getImportDeclarations()) {
      const tgt = imp.getModuleSpecifierSourceFile();
      if (tgt) set.add(tgt.getFilePath());
    }
    // re-exports (export ... from './x') are dependencies too
    for (const exportDecl of sourceFile.getExportDeclarations?.() || []) {
      const tgt = exportDecl.getModuleSpecifierSourceFile?.();
      if (tgt) set.add(tgt.getFilePath());
    }
  }
  return graph;
}

/** Does any file in `froms` import any file in `tos` (cross-file)? */
function importsAcross(froms, tos, graph) {
  for (const fromFile of froms) {
    const imported = graph[fromFile];
    if (!imported) continue;
    for (const toFile of tos) if (toFile !== fromFile && imported.has(toFile)) return true;
  }
  return false;
}

/** Do froms and tos share a file (co-located endpoints)? */
function sharesFile(froms, tos) {
  for (const file of froms) if (tos.has(file)) return true;
  return false;
}

const edgeKey = (e) => `${e.from}->${e.to}`;

/**
 * --fn-edges triage (REPORT-ONLY, not a gate): compare the hand-authored
 * function-to-function edges in the map against docs/novakai/derived-fn-edges.json
 * (a deterministic ts-morph call-graph extraction, ~386 edges, regenerated every
 * novakai:ship). Scope is deliberately narrow: only edges where BOTH endpoints
 * are `kind function` are comparable — module-level edges (main -> state) and
 * type edges (initCamera -.->|returns| CameraApi) describe something a call
 * graph can't confirm or deny, so they're excluded rather than mis-scored.
 *
 *   PHANTOM — a hand-authored function->function edge with no derived
 *             counterpart (the map claims a call ts-morph never saw).
 *   MISSING — a derived call edge absent from the map (a real call the map
 *             never documented).
 *
 * This is diagnostic triage for A5's future tightening, not today's gate: the
 * map and the derived extraction disagree in both directions right now (that
 * is expected), so this never fails a build — see main()'s --fn-edges branch.
 */
// Function->function edges in the map — the only edges a call graph can confirm/deny.
function collectHandAuthored(model) {
  const handAuthored = new Set();
  for (const e of model.edges) {
    const fromNode = model.nodes[e.from];
    const toNode = model.nodes[e.to];
    if (fromNode?.kind !== 'function' || toNode?.kind !== 'function') continue; // out of scope
    handAuthored.add(edgeKey(e));
  }
  return handAuthored;
}

export function triageFnEdges({ mapPath, derivedPath }) {
  const text = readFileSync(mapPath, 'utf8');
  const model = parseMmd(text);
  const derived = JSON.parse(readFileSync(derivedPath, 'utf8'));

  const handAuthored = collectHandAuthored(model);
  const derivedKeys = new Set(derived.map(edgeKey));

  const phantom = [...handAuthored].filter((k) => !derivedKeys.has(k)).sort();
  const missing = [...derivedKeys].filter((k) => !handAuthored.has(k)).sort();

  return { handAuthoredCount: handAuthored.size, derivedCount: derivedKeys.size, phantom, missing };
}

// basename -> absolute path (one-module-per-file convention fallback)
function basenameIndexOf(project) {
  const basenameIndex = {};
  for (const sourceFile of project.getSourceFiles()) {
    const base = sourceFile.getBaseName().replace(/\.ts$/, '');
    if (!(base in basenameIndex)) basenameIndex[base] = sourceFile.getFilePath();
  }
  return basenameIndex;
}

// `from->to` edges deliberately marked NOT import-backed (A5's audited list).
function readAllowlist(allowPath) {
  const allow = new Set();
  if (allowPath && existsSync(allowPath)) {
    for (const line of readFileSync(allowPath, 'utf8').split('\n')) {
      const cleaned = line.replace(/#.*$/, '').trim();
      if (cleaned) allow.add(cleaned);
    }
  }
  return allow;
}

// tools/*.mjs endpoints (own anchor or every descendant file outside src/) are
// ts-morph-invisible; tooling-coverage owns those nodes, not this gate.
function outsideSrcTest(srcMap, files) {
  const srcRoot = resolve(ROOT, 'src') + '/';
  return (id) => {
    if (srcMap[id]) return !srcMap[id].path.startsWith('src/');
    const fileSet = files[id];
    return !!(fileSet && fileSet.size) && [...fileSet].every((file) => !file.startsWith(srcRoot));
  };
}

// Classify one edge into VERIFIED(import) / VERIFIED(intra) / ADVISORY / UNACCOUNTED.
function classifyEdge(edge, ctx) {
  const froms = ctx.files[edge.from] || new Set();
  const tos = ctx.files[edge.to] || new Set();
  if (importsAcross(froms, tos, ctx.graph)) return 'import';
  if (froms.size && tos.size && sharesFile(froms, tos)) return 'intra';
  if (ctx.allow.has(edgeKey(edge))) return 'advisory';
  return 'unaccounted';
}

function classifyEdges(model, ctx) {
  const isOutsideSrc = outsideSrcTest(ctx.srcMap, ctx.files);
  const results = [];
  for (const edge of model.edges) {
    if (isOutsideSrc(edge.from) || isOutsideSrc(edge.to)) continue;
    const tier = classifyEdge(edge, ctx);
    results.push({ key: edgeKey(edge), from: edge.from, ['to']: edge.to, style: edge.style, tier });
  }
  return results;
}

function byTier(results, tier) {
  return results.filter((result) => result.tier === tier);
}

// Summarize classified edges + which allowlist entries are still exercised.
function summarizeResults(results, allow) {
  const usedAllow = new Set(byTier(results, 'advisory').map((result) => result.key));
  const staleAllow = [...allow].filter((entry) => !usedAllow.has(entry)); // now code-backed or gone
  return {
    total: results.length,
    verifiedImport: byTier(results, 'import').length,
    verifiedIntra: byTier(results, 'intra').length,
    advisory: byTier(results, 'advisory').length,
    unaccounted: byTier(results, 'unaccounted'),
    staleAllow,
    results,
  };
}

export function verifyEdges({ mapPath, tsconfig, allowPath }) {
  const text = readFileSync(mapPath, 'utf8');
  const model = parseMmd(text);
  const srcMap = srcMapOf(text);
  const kids = childrenOf(model.nodes);

  const project = new Project({ tsConfigFilePath: resolve(ROOT, tsconfig) });
  const graph = importGraph(project);
  const files = nodeFiles(model.nodes, srcMap, kids, basenameIndexOf(project));
  const allow = readAllowlist(allowPath);

  const ctx = { files, srcMap, graph, allow };
  const results = classifyEdges(model, ctx);
  return summarizeResults(results, allow);
}

/* ---------------- CLI ---------------- */
function parseCliArgs() {
  return {
    mapPath: resolve(ROOT, arg('--map', 'docs/novakai/_bundle.mmd')),
    tsconfig: arg('--tsconfig', 'tsconfig.json'),
    allowPath: resolve(ROOT, arg('--allow', 'docs/novakai/edge-advisory-allowlist.txt')),
    strict: process.argv.includes('--strict'),
    jsonOut: process.argv.includes('--json'),
    writeAllow: process.argv.includes('--write-allowlist'),
  };
}

// Prints one labelled key list (PHANTOM/MISSING) if non-empty.
function printKeyList(label, marker, keys) {
  if (!keys.length) return;
  console.log(`${label} (${keys.length}):`);
  for (const key of keys) console.log(`  ${marker} ${key}`);
  console.log('');
}

// Human-readable --fn-edges report (REPORT-ONLY; see triageFnEdges doc comment).
function printTriageHuman(triage) {
  console.log('=== function-edge triage — hand-authored map vs derived call graph (REPORT ONLY) ===\n');
  console.log(`  ${triage.handAuthoredCount}  hand-authored function->function edges in the map`);
  console.log(`  ${triage.derivedCount}  derived function-call edges (ts-morph)`);
  console.log(`  ${triage.phantom.length}  PHANTOM  — hand-authored edge, no derived counterpart`);
  console.log(`  ${triage.missing.length}  MISSING  — derived call edge absent from the map\n`);
  printKeyList('PHANTOM', '✗', triage.phantom);
  printKeyList('MISSING', '+', triage.missing);
  console.log('(report-only — does not affect exit code; not yet a gate.)');
}

// --fn-edges branch: always exits 0 (diagnostic, not a gate).
function runFnEdgesTriage(mapPath, jsonOut) {
  const derivedPath = resolve(ROOT, arg('--derived', 'docs/novakai/derived-fn-edges.json'));
  const triage = triageFnEdges({ mapPath, derivedPath });
  if (jsonOut) console.log(JSON.stringify(triage, null, 2));
  else printTriageHuman(triage);
  process.exit(0);
}

// --write-allowlist: seed/refresh the audited advisory list with every
// currently-unaccounted edge, so a maintainer reviews them once and the gate
// then holds the line. Always exits 0.
function writeAllowlistAndExit(result, allowPath) {
  const lines = [
    '# edge-advisory-allowlist.txt — edges deliberately NOT import-backed (A5).',
    '# Each line is a `from->to` edge that is a real SEMANTIC/runtime relation',
    '# (e.g. a ctx.hooks call that breaks an import cycle by design) with no',
    '# direct import. Listing an edge here is an AUDITED design decision, the',
    '# same as docs/novakai/curation-allowlist.txt for symbols. Remove a line',
    '# once the edge becomes a real import (edge-verify will flag it as stale).',
    '',
    ...result.unaccounted.map((edge) => edge.key).sort(),
    '',
  ];
  writeFileSync(allowPath, lines.join('\n'));
  console.log(`wrote ${result.unaccounted.length} edge(s) to ${allowPath}`);
  process.exit(0);
}

function printJsonAndExit(result, strict) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(strict && result.unaccounted.length ? 1 : 0);
}

function printSummaryHuman(result) {
  console.log('=== novakai edge verification (A5) — every edge code-backed or audited ===\n');
  console.log(`  ${result.verifiedImport}  VERIFIED(import)  — source file imports target file`);
  console.log(`  ${result.verifiedIntra}  VERIFIED(intra)   — endpoints co-located in one file`);
  console.log(`  ${result.advisory}  ADVISORY          — audited semantic edge (in allowlist)`);
  console.log(`  ${result.unaccounted.length}  UNACCOUNTED       — neither code-backed nor audited`);
  console.log(`  ${'-'.repeat(40)}`);
  console.log(`  ${result.total}  total edges\n`);
  if (result.staleAllow.length) {
    console.log(
      `note: ${result.staleAllow.length} allowlist entr(y/ies) no longer needed (edge is now code-backed or gone):`
    );
    for (const key of result.staleAllow) console.log('  ~ ' + key);
    console.log('');
  }
}

// Prints the UNACCOUNTED section and exits (1 under --strict, else 0).
function reportUnaccountedAndExit(result, strict) {
  console.log(
    `UNACCOUNTED edges (${result.unaccounted.length}) — add to the allowlist if a deliberate semantic edge, ` +
    'else fix the map:'
  );
  for (const edge of result.unaccounted) console.log(`  ✗ ${edge.key}  [${edge.style}]`);
  if (strict) {
    console.log('\n✗ FAIL — edges above assert a dependency with no code backing and no audit entry.');
    process.exit(1);
  }
  console.log('\n(advisory run — pass --strict to fail on the above; --write-allowlist to audit them in.)');
  process.exit(0);
}

function printAllClearAndExit() {
  console.log('✓ every edge is code-backed (import/intra) or an audited advisory edge.');
  process.exit(0);
}

function main() {
  const { mapPath, tsconfig, allowPath, strict, jsonOut, writeAllow } = parseCliArgs();

  if (process.argv.includes('--fn-edges')) runFnEdgesTriage(mapPath, jsonOut);

  const result = verifyEdges({ mapPath, tsconfig, allowPath });

  if (writeAllow) writeAllowlistAndExit(result, allowPath);
  if (jsonOut) printJsonAndExit(result, strict);

  printSummaryHuman(result);
  if (result.unaccounted.length) reportUnaccountedAndExit(result, strict);

  printAllClearAndExit();
}

if (import.meta.url === `file://${process.argv[1]}`) main();
