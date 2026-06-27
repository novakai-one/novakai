#!/usr/bin/env node
/* =====================================================================
   extract.mjs — PIPELINE STEP #2 (the ground truth)
   ---------------------------------------------------------------------
   Walk a TypeScript project with ts-morph and re-serialize the REAL code
   structure into a Flowmap .mmd graph: one node per `@flowmap-node`-tagged
   symbol, its kind/parent from the tag, and its interface skeleton read
   from the actual signatures (so it cannot drift from the code). Import
   relations are emitted as dotted edges (informational; the gate treats
   edges as warnings).

   Identity model (decided, see HANDOVER): a symbol's id/kind/parent come
   from a `// @flowmap-node <id> kind=<kind> [parent=<p>]` banner — a cheap,
   stable tag. The MEMBERS (method/function names, arity, return-ness) are
   read from the real TS signatures, so the thing that actually matters for
   drift is always taken from the code, never from the tag. Files with no
   banner fall back to structural inference (exported class/interface/fn).

   WARNING (the documented failure mode): an extractor that silently
   undercounts produces a false green. This tool is covered by a
   hand-verified fixture test (npm run spec:test). Re-run that test before
   trusting the gate after any change here.

   Usage:
     node extract.mjs --tsconfig <tsconfig.json> --out <extracted.mmd>
     node extract.mjs --src <dir> --out <extracted.mmd>
   ===================================================================== */

import { writeFileSync } from 'node:fs';
import { Project } from 'ts-morph';
import { toMmd } from './mmd-parse.mjs';

const BANNER_RE = /@flowmap-node\s+(\S+)\s+kind=(\S+)(?:\s+parent=(\S+))?/g;
const GATED = new Set(['class', 'function', 'hook', 'type']);

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

function returnText(node) {
  const ann = node.getReturnTypeNode?.();
  if (ann) return ann.getText().trim();
  try { return node.getReturnType().getText(node).trim(); } catch { return 'unknown'; }
}
const isVoid = (txt) => txt === 'void' || txt === '';

/** Banners in a file with their start line, sorted by line. */
function bannersOf(sf) {
  const text = sf.getFullText();
  const out = [];
  let m;
  BANNER_RE.lastIndex = 0;
  while ((m = BANNER_RE.exec(text)) !== null) {
    const line = sf.getLineAndColumnAtPos(m.index).line;
    out.push({ id: m[1], kind: m[2], parent: m[3] || null, line });
  }
  return out.sort((a, b) => a.line - b.line);
}

/** Pick the banner that most closely precedes a declaration's line. */
function ownerBanner(banners, line) {
  let owner = null;
  for (const b of banners) { if (b.line <= line) owner = b; else break; }
  return owner ?? banners[0] ?? null;
}

function memberFromMethod(m) {
  return { name: m.getName(), arity: m.getParameters().length, returnsValue: !isVoid(returnText(m)) };
}
function memberFromFunction(f) {
  return { name: f.getName() || '__call', arity: f.getParameters().length, returnsValue: !isVoid(returnText(f)) };
}

function extract(project) {
  const nodes = {};   // id -> { id, kind, parent, group:false }
  const fm = {};      // id -> { name, description, state, interfaces }
  const bodies = {};  // id -> { kind, body }
  const fileNodeIds = new Map(); // SourceFile -> Set<id> (for edge mapping)
  const edges = [];

  const ensure = (id, kind, parent) => {
    if (!nodes[id]) nodes[id] = { id, kind, parent: parent ?? null, group: false };
    if (!fm[id]) fm[id] = { name: id, description: '', state: [], interfaces: [] };
    return id;
  };
  const addMember = (id, mem) => {
    fm[id].interfaces.push({
      name: mem.name,
      accepts: Array.from({ length: mem.arity }, (_, i) => `arg${i}: unknown`),
      returns: [mem.returnsValue ? 'unknown' : 'void'],
    });
  };

  for (const sf of project.getSourceFiles()) {
    const base = sf.getBaseName();
    if (base.endsWith('.contract.ts') || base === '__types.generated.ts') continue;
    const banners = bannersOf(sf);
    const ids = new Set();

    const classes = sf.getClasses().filter((c) => c.isExported() && c.getName());
    const interfaces = sf.getInterfaces().filter((i) => i.isExported() && i.getName());
    const functions = sf.getFunctions().filter((f) => f.isExported() && f.getName());

    if (banners.length) {
      for (const b of banners) ids.add(ensure(b.id, b.kind, b.parent));

      for (const c of classes) {
        const b = ownerBanner(banners, c.getStartLineNumber());
        if (!b) continue;
        if (!bodies[b.id]) bodies[b.id] = { kind: b.kind, body: c.getText() };
        if (GATED.has(b.kind)) for (const m of c.getInstanceMethods()) {
          const _sc = m.getScope ? m.getScope() : 'public'; if (_sc === 'private' || _sc === 'protected') continue;
          addMember(b.id, memberFromMethod(m));
        }
      }
      for (const it of interfaces) {
        const b = ownerBanner(banners, it.getStartLineNumber());
        if (!b) continue;
        if (!bodies[b.id]) bodies[b.id] = { kind: b.kind, body: it.getText() };
        if (GATED.has(b.kind)) for (const m of it.getMethods()) addMember(b.id, memberFromMethod(m));
      }
      for (const f of functions) {
        const b = ownerBanner(banners, f.getStartLineNumber());
        if (!b) continue;
        if (!bodies[b.id]) bodies[b.id] = { kind: b.kind, body: f.getText() };
        if (GATED.has(b.kind)) addMember(b.id, memberFromFunction(f));
      }
    } else {
      // structural fallback for hand-written, untagged code
      for (const c of classes) {
        const id = ensure(c.getName(), 'class', null); ids.add(id);
        bodies[id] = { kind: 'class', body: c.getText() };
        for (const m of c.getInstanceMethods()) {
          const _sc = m.getScope ? m.getScope() : 'public'; if (_sc === 'private' || _sc === 'protected') continue;
          addMember(id, memberFromMethod(m));
        }
      }
      for (const it of interfaces) {
        const id = ensure(it.getName(), 'type', null); ids.add(id);
        bodies[id] = { kind: 'type', body: it.getText() };
        for (const m of it.getMethods()) addMember(id, memberFromMethod(m));
      }
      for (const f of functions) {
        const id = ensure(f.getName(), 'function', null); ids.add(id);
        bodies[id] = { kind: 'function', body: f.getText() };
        addMember(id, memberFromFunction(f));
      }
    }
    fileNodeIds.set(sf, ids);
  }

  // import edges: this file's node(s) -> imported file's node(s)
  for (const sf of project.getSourceFiles()) {
    const fromIds = fileNodeIds.get(sf);
    if (!fromIds || !fromIds.size) continue;
    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (!target) continue;
      const toIds = fileNodeIds.get(target);
      if (!toIds) continue;
      for (const from of fromIds) for (const to of toIds) {
        if (from !== to) edges.push({ from, to, style: 'dotted', label: '' });
      }
    }
  }
  const seen = new Set();
  const uniqEdges = edges.filter((e) => { const k = e.from + '>' + e.to; if (seen.has(k)) return false; seen.add(k); return true; });

  return { dir: 'LR', roots: [], nodes, edges: uniqEdges, groups: new Set(), fm, bodies };
}

function main() {
  const tsconfig = arg('--tsconfig');
  const src = arg('--src');
  const out = arg('--out');
  if (!out || (!tsconfig && !src)) {
    console.error('usage: extract.mjs (--tsconfig <file> | --src <dir>) --out <extracted.mmd>');
    process.exit(2);
  }
  const project = tsconfig
    ? new Project({ tsConfigFilePath: tsconfig })
    : new Project({ compilerOptions: { allowJs: false } });
  if (src) project.addSourceFilesAtPaths(`${src}/**/*.ts`);

  const model = extract(project);
  writeFileSync(out, toMmd(model));
  const n = Object.keys(model.nodes).length;
  console.log(`extracted ${n} nodes, ${model.edges.length} import-edges -> ${out}`);

  // also write bodies.json alongside the .mmd for the in-app source viewer
  const bodiesPath = out.replace(/\.mmd$/, '.bodies.json');
  writeFileSync(bodiesPath, JSON.stringify(model.bodies, null, 2));
  const bn = Object.keys(model.bodies).length;
  console.log(`extracted ${bn} source bodies -> ${bodiesPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { extract };
