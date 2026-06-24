#!/usr/bin/env node
/* =====================================================================
   flowmap-lint.mjs — static checker for Flowmap .mmd files
   ---------------------------------------------------------------------
   Predicts the "Tidy spreads it out" failure BEFORE you load the file,
   by reproducing the classification in flowmap/src/io/layout.ts:
     - spine   = node touched by a SOLID edge (or a declared %% root)
     - satellite = node touched only by DOTTED edges
     - layout LAYERS the spine; it PARKS loose satellites at the bottom
       of the whole spine (cMax + LAYER_GAP) -> the far-flung look.
     - a satellite INLINES tight ONLY if it shares a subgraph with a
       spine node (mixed-group inline path).
   So a "loose satellite" (satellite, in no mixed group) is the bug.

   Usage:  node flowmap-lint.mjs path/to/diagram.mmd [...more]
   Exit:   0 = clean, 1 = errors found.
   No dependencies. Node 16+.
   ===================================================================== */

import { readFileSync } from 'node:fs';

const FLOW_KINDS = new Set(['component', 'hook', 'class', 'module', 'function']); // should be spine
const SAT_KINDS = new Set(['store', 'type', 'service', 'event']);                 // satellite ok

function parse(text) {
  const lines = text.split('\n');
  const nodes = {};            // id -> { id, group, shape }
  const groups = new Set();
  const bodyParent = {};       // id -> subgraph id (from nesting)
  const parentDecl = {};       // id -> parent (from %% parent), applied last
  const kind = {};
  const roots = [];
  const edges = [];            // { from, to, dotted, line }
  let cur = null;              // current subgraph
  let dir = 'TD';

  const shapeRe = /^\s{1,}([A-Za-z0-9_]+)\s*(\[\(|\(\(|\{\{|\[|\(|\{|>)/;
  const edgeRe = /^\s+([A-Za-z0-9_]+)\s+(-->|==>|-\.->)(?:\|[^|]*\|)?\s*([A-Za-z0-9_]+)/;

  lines.forEach((l, i) => {
    let m;
    if ((m = l.match(/^flowchart\s+(\w+)/))) { dir = m[1] === 'TB' ? 'TD' : m[1]; return; }
    if ((m = l.match(/^%% root (\w+)/))) { roots.push(m[1]); return; }
    if ((m = l.match(/^%% kind (\w+) (\w+)/))) { kind[m[1]] = m[2]; return; }
    if ((m = l.match(/^%% parent (\w+) (\w+)/))) { parentDecl[m[1]] = m[2]; return; }
    if (/^\s*%%/.test(l)) return; // other meta
    if ((m = l.match(/^\s*subgraph\s+([A-Za-z0-9_]+)/))) {
      groups.add(m[1]); nodes[m[1]] = { id: m[1], group: true }; cur = m[1]; return;
    }
    if (/^\s*end\s*$/.test(l)) { cur = null; return; }
    if ((m = l.match(shapeRe))) {
      const id = m[1];
      nodes[id] = nodes[id] || { id, group: false };
      if (cur) bodyParent[id] = cur;
      return;
    }
    if ((m = l.match(edgeRe))) {
      edges.push({ from: m[1], to: m[3], dotted: m[2] === '-.->', line: i + 1 });
      // edge-introduced nodes default to rect (still real nodes)
      for (const id of [m[1], m[3]]) nodes[id] = nodes[id] || { id, group: false };
    }
  });

  // resolve parent: subgraph nesting, then %% parent overrides (mirrors mermaid.ts)
  for (const id in nodes) nodes[id].parent = bodyParent[id] ?? null;
  for (const c in parentDecl) if (nodes[c]) nodes[c].parent = parentDecl[c];

  return { nodes, groups, kind, roots, edges, dir, parentDecl };
}

function containerOf(nodes, id) {
  let c = nodes[id]?.parent ?? null;
  const seen = new Set();
  while (c && nodes[c] && !seen.has(c)) {
    seen.add(c);
    if (!nodes[c].group) return c;
    c = nodes[c].parent ?? null;
  }
  return null;
}

function lint(file) {
  const text = readFileSync(file, 'utf8');
  const { nodes, groups, kind, roots, edges, parentDecl } = parse(text);
  const errors = [], warns = [];
  const real = Object.keys(nodes).filter((id) => !nodes[id].group);

  // --- structural integrity ---
  for (const e of edges) {
    if (!nodes[e.from]) errors.push(`line ${e.line}: edge from undefined node "${e.from}"`);
    if (!nodes[e.to]) errors.push(`line ${e.line}: edge to undefined node "${e.to}"`);
  }
  for (const c in parentDecl) {
    if (!nodes[c]) errors.push(`%% parent: child "${c}" is not defined`);
    else if (!nodes[parentDecl[c]]) errors.push(`%% parent: parent "${parentDecl[c]}" of "${c}" is not defined`);
  }
  // RULE 2: a root must be declared
  if (!roots.length) warns.push(`no %% root declared — Tidy will guess the entry; declare one (biggest readability factor)`);
  for (const r of roots) if (!nodes[r]) errors.push(`%% root "${r}" is not a defined node`);
  // RULE: kind on every real node (spec requires it; drives tint + this lint)
  for (const id of real) if (!kind[id]) warns.push(`node "${id}" has no %% kind — required by spec, and this lint uses it`);

  // --- spine / satellite classification (mirrors layout.ts) ---
  const spine = new Set(roots.filter((r) => nodes[r]));
  for (const e of edges) if (!e.dotted) { spine.add(e.from); spine.add(e.to); }

  // group members = real nodes whose resolved parent is that group
  const gmem = {};
  for (const g of groups) gmem[g] = real.filter((id) => nodes[id].parent === g);
  // layout.ts places satellites two safe ways:
  //   mixed group  (spine + sat members) -> sat INLINES beside a groupmate
  //   all-sat group (only satellites)     -> CLUSTER path: tidy contiguous band
  // A satellite is only DANGEROUS (scattered far-park) when it is in NO group.
  const safeSat = new Set();
  for (const g of groups) {
    if (!gmem[g].length) continue;
    const sp = gmem[g].filter((id) => spine.has(id));
    const sat = gmem[g].filter((id) => !spine.has(id));
    if (sat.length && (sp.length || sat.length === gmem[g].length)) sat.forEach((s) => safeSat.add(s));
  }

  // RULE 5 (the big one): loose satellites (in no subgraph) far-park -> spread
  const loose = real.filter((id) => !spine.has(id) && !safeSat.has(id));
  for (const id of loose) {
    const k = kind[id] || 'unknown';
    errors.push(`"${id}" (kind ${k}) is a loose satellite in no subgraph — it will far-park and scatter. Put it in a subgraph (with or beside spine nodes), or give it a SOLID --> edge if it's really flow`);
  }

  // RULE 4 (soft): a flow-kind node reached only by dotted is usually a
  // miswired call (the original bug). Role is by edge style, so this is a
  // warning, not an error — but worth a look.
  for (const id of real) {
    if (spine.has(id)) continue;
    const k = kind[id] || 'unknown';
    if (FLOW_KINDS.has(k))
      warns.push(`"${id}" (kind ${k}) is reached only by dotted edges — if it's actually called in the flow, use SOLID --> so it layers on the spine`);
  }

  // RULE 1: solid spine should be one connected tree from the root(s)
  if (spine.size) {
    const adj = {};
    for (const id of spine) adj[id] = [];
    for (const e of edges) if (!e.dotted && spine.has(e.from) && spine.has(e.to)) {
      adj[e.from].push(e.to); adj[e.to].push(e.from);
    }
    const seed = roots.find((r) => spine.has(r)) ?? [...spine][0];
    const seen = new Set([seed]); const stack = [seed];
    while (stack.length) { const n = stack.pop(); for (const v of adj[n] || []) if (!seen.has(v)) { seen.add(v); stack.push(v); } }
    const island = [...spine].filter((id) => !seen.has(id));
    if (island.length)
      warns.push(`spine is split — these solid nodes don't connect to the root: ${island.join(', ')}`);
  }

  // top-level node count (informational)
  const top = real.filter((id) => containerOf(nodes, id) === null);

  return { file, errors, warns, stats: { real: real.length, groups: groups.size, edges: edges.length, top: top.length, topIds: top, loose: loose.length } };
}

let bad = 0;
for (const file of process.argv.slice(2)) {
  const r = lint(file);
  console.log(`\n=== ${file} ===`);
  console.log(`nodes ${r.stats.real} · groups ${r.stats.groups} · edges ${r.stats.edges} · top-level ${r.stats.top} (${r.stats.topIds.join(', ') || '—'})`);
  if (r.errors.length) { bad = 1; console.log(`\nERRORS (${r.errors.length}):`); r.errors.forEach((e) => console.log('  ✗ ' + e)); }
  if (r.warns.length) { console.log(`\nwarnings (${r.warns.length}):`); r.warns.forEach((w) => console.log('  ! ' + w)); }
  if (!r.errors.length && !r.warns.length) console.log('  ✓ clean');
  else if (!r.errors.length) console.log('\n  ✓ no errors (warnings only)');
}
process.exit(bad);
