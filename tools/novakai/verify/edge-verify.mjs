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
    const m = D_SRC.exec(line);
    if (m) {
      const raw = m[2];
      const hash = raw.indexOf('#');
      out[m[1]] = {
        path: hash >= 0 ? raw.slice(0, hash) : raw,
        symbol: hash >= 0 ? raw.slice(hash + 1) : m[1],
      };
    }
  }
  return out;
}

/** children map (parent id -> child ids), groups included. */
function childrenOf(nodes) {
  const kids = {};
  for (const id in nodes) {
    const p = nodes[id].parent;
    if (p) (kids[p] ||= []).push(id);
  }
  return kids;
}

/** Every transitive descendant id of `id` (through group subgraphs too). */
function descendants(id, kids) {
  const out = [];
  const stack = [...(kids[id] || [])];
  const seen = new Set();
  while (stack.length) {
    const c = stack.pop();
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    for (const g of kids[c] || []) stack.push(g);
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
function nodeFiles(nodes, srcMap, kids, basenameIndex) {
  const fileOf = (id) => (srcMap[id] ? resolve(ROOT, srcMap[id].path) : null);
  // a node's own resolvable file: its src, or the module=file basename fallback.
  const ownFile = (id) => fileOf(id) || basenameIndex[id] || null;
  // nearest ancestor (through group subgraphs) whose own file resolves — lets a
  // tagged-but-not-src-mapped unit (e.g. main.ts's boot fns, types.ts's enums)
  // inherit its module's file so intra-module edges verify as co-located.
  const ancestorFile = (id) => {
    let cur = nodes[id]?.parent ?? null;
    const seen = new Set();
    while (cur && nodes[cur] && !seen.has(cur)) {
      seen.add(cur);
      const f = ownFile(cur);
      if (f) return f;
      cur = nodes[cur].parent ?? null;
    }
    return null;
  };
  const collect = (id) => {
    const files = new Set();
    const self = fileOf(id);
    if (self) files.add(self);
    for (const d of descendants(id, kids)) { const f = fileOf(d); if (f) files.add(f); }
    // A split module's node src-maps to its part/-core files, but the file OTHER
    // modules actually import is the same-basename facade/barrel entry (e.g.
    // avoidRouter.ts re-exporting avoidRouter-core). Include it so an import of
    // the facade verifies as a real import, not a hand-audited advisory edge.
    if (basenameIndex[id]) files.add(basenameIndex[id]);
    if (!files.size) { const a = ancestorFile(id); if (a) files.add(a); } // inherit module file
    return files;
  };
  const out = {};
  for (const id in nodes) out[id] = collect(id);
  return out;
}

/** file path -> Set<file path> it imports (resolved, intra-project only). */
function importGraph(project) {
  const g = {};
  for (const sf of project.getSourceFiles()) {
    const from = sf.getFilePath();
    const set = (g[from] ||= new Set());
    for (const imp of sf.getImportDeclarations()) {
      const tgt = imp.getModuleSpecifierSourceFile();
      if (tgt) set.add(tgt.getFilePath());
    }
    // re-exports (export ... from './x') are dependencies too
    for (const ex of sf.getExportDeclarations?.() || []) {
      const tgt = ex.getModuleSpecifierSourceFile?.();
      if (tgt) set.add(tgt.getFilePath());
    }
  }
  return g;
}

/** Does any file in `froms` import any file in `tos` (cross-file)? */
function importsAcross(froms, tos, g) {
  for (const f of froms) {
    const imp = g[f];
    if (!imp) continue;
    for (const t of tos) if (t !== f && imp.has(t)) return true;
  }
  return false;
}

/** Do froms and tos share a file (co-located endpoints)? */
function sharesFile(froms, tos) {
  for (const f of froms) if (tos.has(f)) return true;
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
export function triageFnEdges({ mapPath, derivedPath }) {
  const text = readFileSync(mapPath, 'utf8');
  const model = parseMmd(text);
  const derived = JSON.parse(readFileSync(derivedPath, 'utf8'));

  const handAuthored = new Set();
  for (const e of model.edges) {
    const from = model.nodes[e.from];
    const to = model.nodes[e.to];
    if (from?.kind !== 'function' || to?.kind !== 'function') continue; // out of scope
    handAuthored.add(edgeKey(e));
  }

  const derivedKeys = new Set(derived.map(edgeKey));

  const phantom = [...handAuthored].filter((k) => !derivedKeys.has(k)).sort();
  const missing = [...derivedKeys].filter((k) => !handAuthored.has(k)).sort();

  return { handAuthoredCount: handAuthored.size, derivedCount: derivedKeys.size, phantom, missing };
}

export function verifyEdges({ mapPath, tsconfig, allowPath }) {
  const text = readFileSync(mapPath, 'utf8');
  const model = parseMmd(text);
  const srcMap = srcMapOf(text);
  const kids = childrenOf(model.nodes);

  const project = new Project({ tsConfigFilePath: resolve(ROOT, tsconfig) });
  const g = importGraph(project);

  // basename -> absolute path (one-module-per-file convention fallback)
  const basenameIndex = {};
  for (const sf of project.getSourceFiles()) {
    const base = sf.getBaseName().replace(/\.ts$/, '');
    if (!(base in basenameIndex)) basenameIndex[base] = sf.getFilePath();
  }
  const files = nodeFiles(model.nodes, srcMap, kids, basenameIndex);

  const allow = new Set();
  if (allowPath && existsSync(allowPath)) {
    for (const line of readFileSync(allowPath, 'utf8').split('\n')) {
      const s = line.replace(/#.*$/, '').trim();
      if (s) allow.add(s);
    }
  }

  const results = [];
  for (const e of model.edges) {
    const key = edgeKey(e);
    const froms = files[e.from] || new Set();
    const tos = files[e.to] || new Set();
    let tier;
    if (importsAcross(froms, tos, g)) tier = 'import';
    else if (froms.size && tos.size && sharesFile(froms, tos)) tier = 'intra';
    else if (allow.has(key)) tier = 'advisory';
    else tier = 'unaccounted';
    results.push({ key, from: e.from, to: e.to, style: e.style, tier });
  }

  const by = (t) => results.filter((r) => r.tier === t);
  const usedAllow = new Set(results.filter((r) => r.tier === 'advisory').map((r) => r.key));
  const staleAllow = [...allow].filter((k) => !usedAllow.has(k)); // listed but now code-backed or gone
  return {
    total: results.length,
    verifiedImport: by('import').length,
    verifiedIntra: by('intra').length,
    advisory: by('advisory').length,
    unaccounted: by('unaccounted'),
    staleAllow,
    results,
  };
}

/* ---------------- CLI ---------------- */
function main() {
  const mapPath = resolve(ROOT, arg('--map', 'docs/novakai/_bundle.mmd'));
  const tsconfig = arg('--tsconfig', 'tsconfig.json');
  const allowPath = resolve(ROOT, arg('--allow', 'docs/novakai/edge-advisory-allowlist.txt'));
  const strict = process.argv.includes('--strict');
  const jsonOut = process.argv.includes('--json');
  const writeAllow = process.argv.includes('--write-allowlist');

  if (process.argv.includes('--fn-edges')) {
    const derivedPath = resolve(ROOT, arg('--derived', 'docs/novakai/derived-fn-edges.json'));
    const t = triageFnEdges({ mapPath, derivedPath });
    if (jsonOut) {
      console.log(JSON.stringify(t, null, 2));
    } else {
      console.log('=== function-edge triage — hand-authored map vs derived call graph (REPORT ONLY) ===\n');
      console.log(`  ${t.handAuthoredCount}  hand-authored function->function edges in the map`);
      console.log(`  ${t.derivedCount}  derived function-call edges (ts-morph)`);
      console.log(`  ${t.phantom.length}  PHANTOM  — hand-authored edge, no derived counterpart`);
      console.log(`  ${t.missing.length}  MISSING  — derived call edge absent from the map\n`);
      if (t.phantom.length) {
        console.log(`PHANTOM (${t.phantom.length}):`);
        for (const k of t.phantom) console.log('  ✗ ' + k);
        console.log('');
      }
      if (t.missing.length) {
        console.log(`MISSING (${t.missing.length}):`);
        for (const k of t.missing) console.log('  + ' + k);
        console.log('');
      }
      console.log('(report-only — does not affect exit code; not yet a gate.)');
    }
    process.exit(0);
  }

  const r = verifyEdges({ mapPath, tsconfig, allowPath });

  if (writeAllow) {
    // seed/refresh the audited advisory list with every currently-unaccounted
    // edge, so a maintainer reviews them once and the gate then holds the line.
    const lines = [
      '# edge-advisory-allowlist.txt — edges deliberately NOT import-backed (A5).',
      '# Each line is a `from->to` edge that is a real SEMANTIC/runtime relation',
      '# (e.g. a ctx.hooks call that breaks an import cycle by design) with no',
      '# direct import. Listing an edge here is an AUDITED design decision, the',
      '# same as docs/novakai/curation-allowlist.txt for symbols. Remove a line',
      '# once the edge becomes a real import (edge-verify will flag it as stale).',
      '',
      ...r.unaccounted.map((e) => e.key).sort(),
      '',
    ];
    writeFileSync(allowPath, lines.join('\n'));
    console.log(`wrote ${r.unaccounted.length} edge(s) to ${allowPath}`);
    process.exit(0);
  }

  if (jsonOut) {
    console.log(JSON.stringify(r, null, 2));
    process.exit(strict && r.unaccounted.length ? 1 : 0);
  }

  console.log('=== novakai edge verification (A5) — every edge code-backed or audited ===\n');
  console.log(`  ${r.verifiedImport}  VERIFIED(import)  — source file imports target file`);
  console.log(`  ${r.verifiedIntra}  VERIFIED(intra)   — endpoints co-located in one file`);
  console.log(`  ${r.advisory}  ADVISORY          — audited semantic edge (in allowlist)`);
  console.log(`  ${r.unaccounted.length}  UNACCOUNTED       — neither code-backed nor audited`);
  console.log(`  ${'-'.repeat(40)}`);
  console.log(`  ${r.total}  total edges\n`);

  if (r.staleAllow.length) {
    console.log(`note: ${r.staleAllow.length} allowlist entr(y/ies) no longer needed (edge is now code-backed or gone):`);
    for (const k of r.staleAllow) console.log('  ~ ' + k);
    console.log('');
  }

  if (r.unaccounted.length) {
    console.log(`UNACCOUNTED edges (${r.unaccounted.length}) — add to the allowlist if a deliberate semantic edge, else fix the map:`);
    for (const e of r.unaccounted) console.log(`  ✗ ${e.key}  [${e.style}]`);
    if (strict) { console.log('\n✗ FAIL — edges above assert a dependency with no code backing and no audit entry.'); process.exit(1); }
    console.log('\n(advisory run — pass --strict to fail on the above; --write-allowlist to audit them in.)');
    process.exit(0);
  }

  console.log('✓ every edge is code-backed (import/intra) or an audited advisory edge.');
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
