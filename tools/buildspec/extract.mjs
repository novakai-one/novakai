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

import { writeFileSync, readFileSync } from 'node:fs';
import { Project, Node } from 'ts-morph';
import { toMmd, parseMmd } from './mmd-parse.mjs';
import { resolve } from 'node:path';

const BANNER_RE = /@flowmap-node\s+(\S+)\s+kind=(\S+)(?:\s+parent=(\S+))?/g;
const GATED = new Set(['class', 'function', 'hook', 'type']);
const D_SRC = /^%%\s*src\s+([A-Za-z0-9_]+)\s+(\S+)\s*$/;

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

/** Real param `name: type` list + return type for a function-like node. */
function memberTypes(node) {
  const accepts = (node.getParameters?.() ?? []).map((p) => {
    const tn = p.getTypeNode?.();
    return `${p.getName()}: ${tn ? tn.getText() : 'unknown'}`;
  });
  let returns;
  try { const r = returnText(node); returns = isVoid(r) ? 'void' : r; } catch { returns = 'unknown'; }
  return { accepts, returns };
}
function memberFromMethod(m) {
  const t = memberTypes(m);
  return { name: m.getName(), arity: m.getParameters().length, returnsValue: !isVoid(returnText(m)), accepts: t.accepts, returns: t.returns };
}
function memberFromFunction(f) {
  const t = memberTypes(f);
  return { name: f.getName() || '__call', arity: f.getParameters().length, returnsValue: !isVoid(returnText(f)), accepts: t.accepts, returns: t.returns };
}

/**
 * The declaration node a banner sits above (first decl at/after the banner
 * line). Banners may tag a private class method, a non-exported nested
 * function, an arrow assigned to a const, an object-literal arrow, or a
 * top-level decl. Returns the ts-morph node, or null.
 */
function declAtBanner(sf, bannerLine) {
  let best = null;
  sf.forEachDescendant((node) => {
    const k = node.getKindName();
    const isDecl =
      k === 'MethodDeclaration' ||
      k === 'FunctionDeclaration' ||
      k === 'ClassDeclaration' ||
      k === 'InterfaceDeclaration' ||
      k === 'VariableStatement' ||
      k === 'PropertyDeclaration' ||
      k === 'PropertyAssignment' ||
      k === 'TypeAliasDeclaration' ||
      k === 'GetAccessor' ||
      k === 'SetAccessor' ||
      k === 'ExpressionStatement';     // fallback: tagged bare calls (e.g. a subscription)
    if (!isDecl) return;
    const line = node.getStartLineNumber();
    if (line < bannerLine) return;
    if (best === null || line < best.line) best = { line, node };
  });
  return best ? best.node : null;
}

/** Find a function-like node inside a decl (the decl itself, or an arrow/fn it wraps). */
function fnInside(node) {
  if (!node) return null;
  const k = node.getKindName();
  if (k === 'MethodDeclaration' || k === 'FunctionDeclaration' ||
      k === 'GetAccessor' || k === 'SetAccessor') return node;
  // VariableStatement / PropertyAssignment / PropertyDeclaration wrapping an arrow or fn expr
  let found = null;
  node.forEachDescendant((d) => {
    if (found) return;
    const dk = d.getKindName();
    if (dk === 'ArrowFunction' || dk === 'FunctionExpression') found = d;
  });
  return found;
}

/** Real signature (param name:type list + return type) of whatever a banner tags. */
function signatureAtBanner(declNode) {
  const fn = fnInside(declNode);
  if (!fn || !fn.getParameters) return { accepts: [], returns: null };
  const accepts = fn.getParameters().map((p) => {
    const tn = p.getTypeNode?.();
    const ty = tn ? tn.getText() : 'unknown';
    return `${p.getName()}: ${ty}`;
  });
  let returns = null;
  try {
    const r = returnText(fn);
    returns = isVoid(r) ? 'void' : r;
  } catch { returns = null; }
  return { accepts, returns };
}

/**
 * Body of whatever declaration a banner sits above. Kept as a thin wrapper so
 * existing call sites read unchanged.
 */
function bodyAtBanner(sf, bannerLine) {
  const node = declAtBanner(sf, bannerLine);
  return node ? node.getText() : null;
}

/** Find a declaration by name in a source file (replaces banner line-proximity). */
function findSymbol(sf, name) {
  let hit = null;
  sf.forEachDescendant((d) => {
    if (hit) return;
    if ((Node.isFunctionDeclaration(d) || Node.isClassDeclaration(d) || Node.isMethodDeclaration(d) ||
         Node.isInterfaceDeclaration(d) || Node.isTypeAliasDeclaration(d)) && d.getName?.() === name) hit = d;
    else if (Node.isVariableDeclaration(d) && d.getName() === name) hit = d.getVariableStatement() ?? d;
  });
  return hit;
}

/**
 * Extract from a bundle .mmd that carries `%% src <id> <path>[#symbol]`
 * directives. Reads node identity (id/kind/parent/groups) from the bundle,
 * then uses findSymbol to locate each declaration in the TS project and
 * reads real signatures + bodies + members — same output shape as extract().
 */
function extractFromMap(bundlePath, project) {
  const text = readFileSync(bundlePath, 'utf8');
  const model = parseMmd(text);

  // Parse %% src directives: id -> { path, symbol }
  const srcMap = {};
  for (const line of text.split('\n')) {
    const m = D_SRC.exec(line);
    if (m) {
      const id = m[1];
      const raw = m[2];
      const hashIdx = raw.indexOf('#');
      srcMap[id] = {
        path: hashIdx >= 0 ? raw.slice(0, hashIdx) : raw,
        symbol: hashIdx >= 0 ? raw.slice(hashIdx + 1) : id,
      };
    }
  }

  // Reset fm interfaces — we want CODE-derived members, not spec-declared ones
  for (const id in model.fm) {
    model.fm[id].interfaces = [];
  }

  // Resolve parents: walk through section groups to the real container
  // (same logic as gateParent in skeleton.mjs) so toMmd serializes correct
  // %% parent lines. Without this, nodes inside section subgraphs lose
  // their parent in the extracted .mmd, causing false parent-mismatch drift.
  for (const id in model.nodes) {
    if (model.nodes[id].group) continue;
    let cur = model.nodes[id].parent;
    const seen = new Set();
    while (cur && model.nodes[cur] && !seen.has(cur)) {
      seen.add(cur);
      if (!model.nodes[cur].group) break;
      cur = model.nodes[cur].parent ?? null;
    }
    model.nodes[id].parent = (cur && model.nodes[cur] && !model.nodes[cur].group) ? cur : null;
  }

  const bodies = {};
  const addMember = (id, mem) => {
    if (!model.fm[id]) model.fm[id] = { name: id, description: '', state: [], interfaces: [] };
    model.fm[id].interfaces.push({
      name: mem.name,
      // real types when captured, placeholder only as a last resort — this is
      // what lets the gate compare parameter/return TYPES, not just arity.
      accepts: mem.accepts ?? Array.from({ length: mem.arity }, (_, i) => `arg${i}: unknown`),
      returns: [mem.returns ?? (mem.returnsValue ? 'unknown' : 'void')],
    });
  };

  for (const id in srcMap) {
    const { path, symbol } = srcMap[id];
    const sf = project.getSourceFile(resolve(path));
    if (!sf) continue;
    const decl = findSymbol(sf, symbol);
    if (!decl) continue;

    const kind = model.nodes[id]?.kind;
    const sig = signatureAtBanner(decl);
    bodies[id] = { kind, body: decl.getText(), accepts: sig.accepts, returns: sig.returns };

    if (GATED.has(kind)) {
      if (Node.isClassDeclaration(decl)) {
        for (const m of decl.getInstanceMethods()) {
          const sc = m.getScope ? m.getScope() : 'public';
          if (sc === 'private' || sc === 'protected') continue;
          addMember(id, memberFromMethod(m));
        }
      } else if (Node.isInterfaceDeclaration(decl)) {
        for (const m of decl.getMethods()) addMember(id, memberFromMethod(m));
      } else if (Node.isFunctionDeclaration(decl)) {
        addMember(id, memberFromFunction(decl));
      }
    }
  }

  model.bodies = bodies;
  if (!model.edges) model.edges = [];
  return model;
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
      accepts: mem.accepts ?? Array.from({ length: mem.arity }, (_, i) => `arg${i}: unknown`),
      returns: [mem.returns ?? (mem.returnsValue ? 'unknown' : 'void')],
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

      // Body + REAL signature for EVERY banner, by line proximity. Covers
      // private methods, nested functions, const/object arrows — anything the
      // export-only loops below miss. The signature (real param types + return)
      // rides on the body entry for the source viewer; it does NOT touch the
      // frontmatter skeleton the gate checks.
      for (const b of banners) {
        if (bodies[b.id]) continue;
        const declNode = declAtBanner(sf, b.line);
        if (!declNode) continue;
        const sig = signatureAtBanner(declNode);
        bodies[b.id] = { kind: b.kind, body: declNode.getText(), accepts: sig.accepts, returns: sig.returns };
      }

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
  const map = arg('--map');
  const out = arg('--out');
  if (!out || (!tsconfig && !src && !map)) {
    console.error('usage: extract.mjs (--tsconfig <file> | --src <dir> | --map <bundle.mmd> --tsconfig <file>) --out <extracted.mmd>');
    process.exit(2);
  }
  const project = tsconfig
    ? new Project({ tsConfigFilePath: tsconfig })
    : new Project({ compilerOptions: { allowJs: false } });
  if (src) project.addSourceFilesAtPaths(`${src}/**/*.ts`);

  const model = map ? extractFromMap(map, project) : extract(project);
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
export { extract, extractFromMap, findSymbol, signatureAtBanner, fnInside, returnText };
