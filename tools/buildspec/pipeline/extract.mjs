#!/usr/bin/env node
/* =====================================================================
   extract.mjs — PIPELINE STEP #2 (the ground truth)
   ---------------------------------------------------------------------
   Walk a TypeScript project with ts-morph and re-serialize the REAL code
   structure into a Novakai .mmd graph: one node per `@novakai-node`-tagged
   symbol, its kind/parent from the tag, and its interface skeleton read
   from the actual signatures (so it cannot drift from the code). Import
   relations are emitted as dotted edges (informational; the gate treats
   edges as warnings).

   Identity model (decided, see HANDOVER): a symbol's id/kind/parent come
   from a `// @novakai-node <id> kind=<kind> [parent=<p>]` banner — a cheap,
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
import { toMmd, parseMmd } from '../core/mmd-parse.mjs';
import { resolve } from 'node:path';

const BANNER_RE = /@novakai-node\s+(\S+)\s+kind=(\S+)(?:\s+parent=(\S+))?/g;
const GATED = new Set(['class', 'function', 'hook', 'type']);
const D_SRC = /^%%\s*src\s+([A-Za-z0-9_]+)\s+(\S+)\s*$/;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : null;
}

// Real return-type text for a function-like node, annotated or inferred.
function returnText(node) {
  const ann = node.getReturnTypeNode?.();
  if (ann) return ann.getText().trim();
  try {
    return node.getReturnType().getText(node).trim();
  } catch {
    return 'unknown';
  }
}
const isVoid = (txt) => txt === 'void' || txt === '';

/** Banners in a file with their start line, sorted by line. */
function bannersOf(sourceFile) {
  const text = sourceFile.getFullText();
  const out = [];
  let match;
  BANNER_RE.lastIndex = 0;
  while ((match = BANNER_RE.exec(text)) !== null) {
    const line = sourceFile.getLineAndColumnAtPos(match.index).line;
    out.push({ id: match[1], kind: match[2], parent: match[3] || null, line });
  }
  return out.sort((x, y) => x.line - y.line);
}

/** Pick the banner that most closely precedes a declaration's line. */
function ownerBanner(banners, line) {
  let owner = null;
  for (const banner of banners) {
    if (banner.line <= line) owner = banner;
    else break;
  }
  return owner ?? banners[0] ?? null;
}

/** Real param `name: type` list + return type for a function-like node. */
function memberTypes(node) {
  const accepts = (node.getParameters?.() ?? []).map((param) => {
    const typeNode = param.getTypeNode?.();
    return `${param.getName()}: ${typeNode ? typeNode.getText() : 'unknown'}`;
  });
  let returns;
  try {
    const txt = returnText(node);
    returns = isVoid(txt) ? 'void' : txt;
  } catch {
    returns = 'unknown';
  }
  return { accepts, returns };
}
function memberFromMethod(method) {
  const sig = memberTypes(method);
  return {
    name: method.getName(),
    arity: method.getParameters().length,
    returnsValue: !isVoid(returnText(method)),
    accepts: sig.accepts,
    returns: sig.returns,
  };
}
function memberFromFunction(func) {
  const sig = memberTypes(func);
  return {
    name: func.getName() || '__call',
    arity: func.getParameters().length,
    returnsValue: !isVoid(returnText(func)),
    accepts: sig.accepts,
    returns: sig.returns,
  };
}

function memberEntry(mem) {
  return {
    name: mem.name,
    accepts: mem.accepts ?? Array.from({ length: mem.arity }, (_, i) => `arg${i}: unknown`),
    returns: [mem.returns ?? (mem.returnsValue ? 'unknown' : 'void')],
  };
}

function addPublicMethods(cls, id, addMember, declIndex) {
  for (const method of cls.getInstanceMethods()) {
    const scope = method.getScope ? method.getScope() : 'public';
    if (scope === 'private' || scope === 'protected') continue;
    addMember(id, memberFromMethod(method));
    if (declIndex) declIndex.set(method, id);
  }
}

function addInterfaceMethods(iface, id, addMember) {
  for (const method of iface.getMethods()) addMember(id, memberFromMethod(method));
}

// Declaration kinds `declAtBanner` will accept as "the thing a banner tags".
const DECL_KINDS = new Set([
  'MethodDeclaration', 'FunctionDeclaration', 'ClassDeclaration', 'InterfaceDeclaration',
  'VariableStatement', 'PropertyDeclaration', 'PropertyAssignment', 'TypeAliasDeclaration',
  'GetAccessor', 'SetAccessor',
  'ExpressionStatement', // fallback: tagged bare calls (e.g. a subscription)
]);

/**
 * The declaration node a banner sits above (first decl at/after the banner
 * line). Banners may tag a private class method, a non-exported nested
 * function, an arrow assigned to a const, an object-literal arrow, or a
 * top-level decl. Returns the ts-morph node, or null.
 */
function declAtBanner(sourceFile, bannerLine) {
  let best = null;
  sourceFile.forEachDescendant((node) => {
    if (!DECL_KINDS.has(node.getKindName())) return;
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
  node.forEachDescendant((child) => {
    if (found) return;
    const childKind = child.getKindName();
    if (childKind === 'ArrowFunction' || childKind === 'FunctionExpression') found = child;
  });
  return found;
}

/** Real signature (param name:type list + return type) of whatever a banner tags. */
function signatureAtBanner(declNode) {
  const fnNode = fnInside(declNode);
  if (!fnNode || !fnNode.getParameters) return { accepts: [], returns: null };
  const accepts = fnNode.getParameters().map((param) => {
    const typeNode = param.getTypeNode?.();
    const typeText = typeNode ? typeNode.getText() : 'unknown';
    return `${param.getName()}: ${typeText}`;
  });
  let returns = null;
  try {
    const txt = returnText(fnNode);
    returns = isVoid(txt) ? 'void' : txt;
  } catch { returns = null; }
  return { accepts, returns };
}

/**
 * Body of whatever declaration a banner sits above. Kept as a thin wrapper so
 * existing call sites read unchanged.
 */
function bodyAtBanner(sourceFile, bannerLine) {
  const node = declAtBanner(sourceFile, bannerLine);
  return node ? node.getText() : null;
}

/** True if `node` is a named decl kind findSymbol recognizes, matching `name`. */
function isMatchingDecl(node, name) {
  if (Node.isFunctionDeclaration(node) || Node.isClassDeclaration(node) || Node.isMethodDeclaration(node) ||
      Node.isInterfaceDeclaration(node) || Node.isTypeAliasDeclaration(node)) {
    return node.getName?.() === name;
  }
  return false;
}

/** Find a declaration by name in a source file (replaces banner line-proximity). */
function findSymbol(sourceFile, name) {
  let hit = null;
  sourceFile.forEachDescendant((node) => {
    if (hit) return;
    if (isMatchingDecl(node, name)) hit = node;
    else if (Node.isVariableDeclaration(node) && node.getName() === name) hit = node.getVariableStatement() ?? node;
  });
  return hit;
}

/**
 * Which real declaration a call-site identifier for `symbolName` resolves
 * to. `findSymbol` collapses a variable's declaration up to its enclosing
 * VariableStatement (so bodies[id].body prints the full `const x = ...`),
 * but a call expression's symbol always points at the VariableDeclaration
 * itself — so for that case we re-find the precise declarator by name.
 */
function callableDeclOf(decl, symbolName) {
  if (decl.getKindName() !== 'VariableStatement') return decl;
  let match = null;
  decl.forEachDescendant((node) => {
    if (!match && Node.isVariableDeclaration(node) && node.getName() === symbolName) match = node;
  });
  return match ?? decl;
}

/** Resolve a call/new expression's callee to a known node id, or null. */
function resolveCalleeId(calleeExpr, declIndex) {
  let symbol;
  try {
    symbol = calleeExpr.getSymbol?.();
  } catch {
    symbol = undefined;
  }
  if (!symbol) return null;
  try {
    if (symbol.isAlias()) symbol = symbol.getAliasedSymbol() ?? symbol;
  } catch {
    /* not an alias */
  }
  for (const decl of symbol.getDeclarations()) {
    const id = declIndex.get(decl);
    if (id) return id;
  }
  return null;
}

/** Every OTHER known node id called from within `root` (sorted, deduped). */
function collectCalls(root, declIndex, selfId) {
  const found = new Set();
  root.forEachDescendant((node) => {
    const k = node.getKindName();
    if (k !== 'CallExpression' && k !== 'NewExpression') return;
    const id = resolveCalleeId(node.getExpression(), declIndex);
    if (id && id !== selfId) found.add(id);
  });
  return Array.from(found).sort();
}

function newExtractState() {
  return { bodies: {}, declIndex: new Map(), idDecl: new Map() };
}

function makeAddMemberFor(model) {
  return (id, mem) => {
    if (!model.fm[id]) model.fm[id] = { name: id, description: '', state: [], interfaces: [] };
    model.fm[id].interfaces.push(memberEntry(mem));
  };
}

function populateFromSrcEntry(id, ref, ctx) {
  const sourceFile = ctx.project.getSourceFile(resolve(ref.path));
  if (!sourceFile) return;
  const decl = findSymbol(sourceFile, ref.symbol);
  if (!decl) return;

  const kind = ctx.model.nodes[id]?.kind;
  const sig = signatureAtBanner(decl);
  ctx.bodies[id] = { kind, body: decl.getText(), accepts: sig.accepts, returns: sig.returns };

  if (ctx.declIndex) ctx.declIndex.set(callableDeclOf(decl, ref.symbol), id);
  if (ctx.idDecl) ctx.idDecl.set(id, decl);

  if (GATED.has(kind)) addGatedMembers(decl, id, ctx.addMember, ctx.declIndex);
}

function populateAll(srcMap, ctx) {
  for (const id in srcMap) populateFromSrcEntry(id, srcMap[id], ctx);
  for (const [id, root] of ctx.idDecl) ctx.bodies[id].calls = collectCalls(root, ctx.declIndex, id);
}

/**
 * Extract from a bundle .mmd that carries `%% src <id> <path>[#symbol]`
 * directives. Reads node identity (id/kind/parent/groups) from the bundle,
 * then uses findSymbol to locate each declaration in the TS project and
 * reads real signatures + bodies + members — same output shape as extract().
 * Also derives a `calls[]` per node: the other known node ids referenced by
 * call/new expressions inside its body (A5 ground truth for edge triage).
 */
function extractFromMap(bundlePath, project) {
  const text = readFileSync(bundlePath, 'utf8');
  const model = parseMmd(text);
  const srcMap = parseSrcDirectives(text);

  resetFmInterfaces(model);
  resolveNodeParents(model);

  const { bodies, declIndex, idDecl } = newExtractState();
  const addMember = makeAddMemberFor(model);
  const ctx = { model, project, addMember, bodies, declIndex, idDecl };
  populateAll(srcMap, ctx);

  model.bodies = bodies;
  if (!model.edges) model.edges = [];
  return model;
}

function parseSrcDirectives(text) {
  const srcMap = {};
  for (const line of text.split('\n')) {
    const match = D_SRC.exec(line);
    if (!match) continue;
    const id = match[1];
    const raw = match[2];
    if (!raw.startsWith('src/')) continue; // tools/*.mjs anchors are ts-morph-invisible; tooling-coverage owns them
    const hashIdx = raw.indexOf('#');
    srcMap[id] = {
      path: hashIdx >= 0 ? raw.slice(0, hashIdx) : raw,
      symbol: hashIdx >= 0 ? raw.slice(hashIdx + 1) : id,
    };
  }
  return srcMap;
}

function resetFmInterfaces(model) {
  for (const id in model.fm) {
    model.fm[id].interfaces = [];
  }
}

/** Walk a node's parent chain up through group nodes to the nearest real (non-group) ancestor. */
function resolveParentChain(nodes, startParent) {
  let cur = startParent;
  const seen = new Set();
  while (cur && nodes[cur] && !seen.has(cur)) {
    seen.add(cur);
    if (!nodes[cur].group) break;
    cur = nodes[cur].parent ?? null;
  }
  return cur;
}

function resolveNodeParents(model) {
  for (const id in model.nodes) {
    if (model.nodes[id].group) continue;
    const cur = resolveParentChain(model.nodes, model.nodes[id].parent);
    model.nodes[id].parent = (cur && model.nodes[cur] && !model.nodes[cur].group) ? cur : null;
  }
}

function addGatedMembers(decl, id, addMember, declIndex) {
  if (Node.isClassDeclaration(decl)) addPublicMethods(decl, id, addMember, declIndex);
  else if (Node.isInterfaceDeclaration(decl)) addInterfaceMethods(decl, id, addMember);
  else if (Node.isFunctionDeclaration(decl)) addMember(id, memberFromFunction(decl));
}

function fillBannerBody(sourceFile, banner, bodies) {
  if (bodies[banner.id]) return;
  const declNode = declAtBanner(sourceFile, banner.line);
  if (!declNode) return;
  const sig = signatureAtBanner(declNode);
  bodies[banner.id] = { kind: banner.kind, body: declNode.getText(), accepts: sig.accepts, returns: sig.returns };
}

function linkBannerOwner(decl, addMembers, ctx) {
  const owner = ownerBanner(ctx.banners, decl.getStartLineNumber());
  if (!owner) return;
  if (!ctx.bodies[owner.id]) ctx.bodies[owner.id] = { kind: owner.kind, body: decl.getText() };
  if (GATED.has(owner.kind)) addMembers(decl, owner.id, ctx.addMember);
}

const linkBannerFunctionMember = (func, id, addMember) => addMember(id, memberFromFunction(func));

function extractBannerFile(sourceFile, ctx) {
  const { banners, exported, ensure, addMember, bodies } = ctx;
  const ownerCtx = { banners, bodies, addMember };
  const ids = new Set();
  for (const banner of banners) ids.add(ensure(banner.id, banner.kind, banner.parent));
  for (const banner of banners) fillBannerBody(sourceFile, banner, bodies);
  for (const cls of exported.classes) linkBannerOwner(cls, addPublicMethods, ownerCtx);
  for (const iface of exported.interfaces) linkBannerOwner(iface, addInterfaceMethods, ownerCtx);
  for (const func of exported.functions) linkBannerOwner(func, linkBannerFunctionMember, ownerCtx);
  return ids;
}

function addFallbackClass(cls, ctx) {
  const id = ctx.ensure(cls.getName(), 'class', null);
  ctx.ids.add(id);
  ctx.bodies[id] = { kind: 'class', body: cls.getText() };
  addPublicMethods(cls, id, ctx.addMember);
}
function addFallbackInterface(iface, ctx) {
  const id = ctx.ensure(iface.getName(), 'type', null);
  ctx.ids.add(id);
  ctx.bodies[id] = { kind: 'type', body: iface.getText() };
  addInterfaceMethods(iface, id, ctx.addMember);
}
function addFallbackFunction(func, ctx) {
  const id = ctx.ensure(func.getName(), 'function', null);
  ctx.ids.add(id);
  ctx.bodies[id] = { kind: 'function', body: func.getText() };
  ctx.addMember(id, memberFromFunction(func));
}

function extractFallbackFile(exported, ensure, addMember, bodies) {
  const ids = new Set();
  const ctx = { ensure, addMember, bodies, ids };
  for (const cls of exported.classes) addFallbackClass(cls, ctx);
  for (const iface of exported.interfaces) addFallbackInterface(iface, ctx);
  for (const func of exported.functions) addFallbackFunction(func, ctx);
  return ids;
}

function extractFileNodes(sourceFile, ensure, addMember, bodies) {
  const banners = bannersOf(sourceFile);
  const exported = {
    classes: sourceFile.getClasses().filter((cls) => cls.isExported() && cls.getName()),
    interfaces: sourceFile.getInterfaces().filter((iface) => iface.isExported() && iface.getName()),
    functions: sourceFile.getFunctions().filter((func) => func.isExported() && func.getName()),
  };
  return banners.length
    ? extractBannerFile(sourceFile, { banners, exported, ensure, addMember, bodies })
    : extractFallbackFile(exported, ensure, addMember, bodies);
}

function importEdgesFor(sourceFile, fileNodeIds) {
  const fromIds = fileNodeIds.get(sourceFile);
  if (!fromIds || !fromIds.size) return [];
  const out = [];
  for (const imp of sourceFile.getImportDeclarations()) {
    const target = imp.getModuleSpecifierSourceFile();
    if (!target) continue;
    const toIds = fileNodeIds.get(target);
    if (!toIds) continue;
    for (const from of fromIds) for (const toId of toIds) {
      if (from !== toId) out.push({ from, ['to']: toId, style: 'dotted', label: '' });
    }
  }
  return out;
}

function dedupeEdges(edges) {
  const seen = new Set();
  return edges.filter((e) => {
    const key = e.from + '>' + e.to;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function collectFileNodes(project, ensure, addMember, bodies) {
  const fileNodeIds = new Map(); // SourceFile -> Set<id> (for edge mapping)
  for (const sourceFile of project.getSourceFiles()) {
    const base = sourceFile.getBaseName();
    if (base.endsWith('.contract.ts') || base === '__types.generated.ts') continue;
    fileNodeIds.set(sourceFile, extractFileNodes(sourceFile, ensure, addMember, bodies));
  }
  return fileNodeIds;
}

function collectImportEdges(project, fileNodeIds) {
  const rawEdges = [];
  for (const sourceFile of project.getSourceFiles()) rawEdges.push(...importEdgesFor(sourceFile, fileNodeIds));
  return dedupeEdges(rawEdges);
}

// Walk the TS project and build the node/edge/frontmatter model for the map.
function extract(project) {
  const nodes = {};        // id -> { id, kind, parent, group:false }
  const frontmatter = {};  // id -> { name, description, state, interfaces }
  const bodies = {};       // id -> { kind, body }

  const ensure = (id, kind, parent) => {
    if (!nodes[id]) nodes[id] = { id, kind, parent: parent ?? null, group: false };
    if (!frontmatter[id]) frontmatter[id] = { name: id, description: '', state: [], interfaces: [] };
    return id;
  };
  const addMember = (id, mem) => {
    frontmatter[id].interfaces.push(memberEntry(mem));
  };

  const fileNodeIds = collectFileNodes(project, ensure, addMember, bodies);
  const edges = collectImportEdges(project, fileNodeIds);

  return { dir: 'LR', roots: [], nodes, edges, groups: new Set(), ['fm']: frontmatter, bodies };
}

function parseArgs() {
  const tsconfig = arg('--tsconfig');
  const src = arg('--src');
  const map = arg('--map');
  const out = arg('--out');
  if (!out || (!tsconfig && !src && !map)) {
    console.error(
      'usage: extract.mjs (--tsconfig <file> | --src <dir> | --map <bundle.mmd> --tsconfig <file>) '
      + '--out <extracted.mmd>',
    );
    process.exit(2);
  }
  return { tsconfig, src, map, out };
}

function buildProject(tsconfig, src) {
  const project = tsconfig
    ? new Project({ tsConfigFilePath: tsconfig })
    : new Project({ compilerOptions: { allowJs: false } });
  if (src) project.addSourceFilesAtPaths(`${src}/**/*.ts`);
  return project;
}

function writeExtractedMmd(model, out) {
  writeFileSync(out, toMmd(model));
  const nodeCount = Object.keys(model.nodes).length;
  console.log(`extracted ${nodeCount} nodes, ${model.edges.length} import-edges -> ${out}`);
}

function writeBodiesJson(model, out) {
  const bodiesPath = out.replace(/\.mmd$/, '.bodies.json');
  writeFileSync(bodiesPath, JSON.stringify(model.bodies, null, 2));
  const bodyCount = Object.keys(model.bodies).length;
  console.log(`extracted ${bodyCount} source bodies -> ${bodiesPath}`);
}

function writeCallsJson(model, out) {
  const callsPath = out.replace(/\.mmd$/, '.calls.json');
  const callEdges = deriveCallEdges(model.bodies);
  writeFileSync(callsPath, JSON.stringify(callEdges, null, 2));
  console.log(`derived ${callEdges.length} function-call edges -> ${callsPath}`);
}

function main() {
  const { tsconfig, src, map, out } = parseArgs();
  const project = buildProject(tsconfig, src);
  const model = map ? extractFromMap(map, project) : extract(project);

  writeExtractedMmd(model, out);
  // also write bodies.json alongside the .mmd for the in-app source viewer
  writeBodiesJson(model, out);
  // derived intra-body call graph (WI-2/A5 ground truth): flatten bodies[id].calls
  // into a deterministic edge list, written alongside bodies.json by this same step.
  writeCallsJson(model, out);
}

/** Flatten `bodies[id].calls[]` into a sorted, deterministic {from,to}[] edge list. */
function deriveCallEdges(bodies) {
  const edges = [];
  for (const id of Object.keys(bodies).sort()) {
    for (const toId of bodies[id].calls ?? []) edges.push({ from: id, ['to']: toId });
  }
  return edges;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
export { extract, extractFromMap, findSymbol, signatureAtBanner, fnInside, returnText, deriveCallEdges };
