#!/usr/bin/env node
// novakai-bundle.mjs
// Merge per-folder Novakai fragments into ONE spec-valid .mmd ("the bundle").
//
// CONTRACT (no special directives needed):
//   root.mmd  defines the GLOBAL namespace: container nodes (public-contract
//             frontmatter), shared nodes (stores/types/registries/shared
//             modules), and cross-container edges. Every id defined in root.mmd
//             is GLOBAL.
//   fragment  one per folder, self-rooted `%% root <containerId>` where
//             <containerId> is a node defined in root.mmd (the join key).
//             Any id NOT global is PRIVATE -> namespaced `<containerId>__<id>`
//             at merge time, so two folders can both define `createBlock`.
//             A fragment lists its cross-folder refs as local STUB nodes
//             (ids that are global); the bundler drops them, leaving the edge
//             pointing at the single global node. Group stubs in a
//             `Dependencies` subgraph (do NOT `%% parent` it).
//
// OWNERSHIP on merge:
//   node line + `%% kind` for a GLOBAL id  -> root.mmd
//   `%% fm:meta` for a CONTAINER id        -> its fragment (canonical)
//   `%% fm:meta` for any other GLOBAL id   -> root.mmd
//   PRIVATE ids                            -> their fragment (namespaced)
//   `%% fm` / `%% edge` geometry           -> dropped (Tidy re-lays the bundle)
//
// Usage:  node novakai-bundle.mjs <root.mmd> <fragmentA.mmd> [fragmentB.mmd ...]
//         add --check to lint only (warnings to stderr, no bundle on stdout)

import { readFileSync } from 'node:fs';

const NODE_OPEN = /^(\s*)([A-Za-z0-9_]+)\s*(\[\(|\(\[|\{\{|\(\(|\[|\(|\{|>)"/;
const EDGE = /^(\s*)([A-Za-z0-9_]+)\s*(-\.->|-->|==>)(\|[^|]*\|)?\s*([A-Za-z0-9_]+)\s*$/;
const SUBGRAPH = /^(\s*)subgraph\s+([A-Za-z0-9_]+)(\s.*)?$/;
const END = /^\s*end\s*$/;
const HEADER = /^\s*flowchart\s+(\S+)\s*$/;
const D_ROOT = /^%%\s*root\s+([A-Za-z0-9_]+)\s*$/;
const D_KIND = /^%%\s*kind\s+([A-Za-z0-9_]+)\s+(\S+)\s*$/;
const D_PARENT = /^%%\s*parent\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*$/;
const D_FMMETA = /^%%\s*fm:meta\s+([A-Za-z0-9_]+)\s+(.*)$/;
const D_FM = /^%%\s*fm\s+/;
const D_EDGEGEO = /^%%\s*edge\s+/;
const D_SRC = /^%%\s*src\s+([A-Za-z0-9_]+)\s+(\S+)\s*$/;
const D_GROUP = /^%%\s*group\s+([A-Za-z0-9_]+)\s+"([^"]*)"(?:\s+parent\s+([A-Za-z0-9_]+))?\s*$/;
const D_GROUPMEMBER = /^%%\s*group-member\s+([A-Za-z0-9_]+)\s+([A-Za-z0-9_]+)\s*$/;
const COMMENT = /^%%/;

// Ordered [pattern, builder] pairs — first match wins. A table + single loop
// keeps this a flat dispatch (instead of a long if/else chain) so complexity
// stays low as directive kinds are added.
const LINE_CLASSIFIERS = [
  [HEADER, match => ({ t: 'header', dir: match[1] })],
  [D_ROOT, match => ({ t: 'root', id: match[1] })],
  [D_KIND, match => ({ t: 'kind', id: match[1], kind: match[2] })],
  [D_PARENT, match => ({ t: 'parent', child: match[1], parent: match[2] })],
  [D_FMMETA, match => ({ t: 'fmmeta', id: match[1], rest: match[2] })],
  [D_SRC, match => ({ t: 'src', id: match[1], path: match[2] })],
  [D_GROUP, match => ({ t: 'group', id: match[1] })],
  [D_GROUPMEMBER, match => ({ t: 'groupmember', gid: match[1], member: match[2] })],
  [D_FM, () => ({ t: 'drop' })],
  [D_EDGEGEO, () => ({ t: 'drop' })],
  [COMMENT, () => ({ t: 'comment' })],
  [SUBGRAPH, match => ({ t: 'subgraph', id: match[2] })],
  [END, () => ({ t: 'end' })],
  [EDGE, match => ({ t: 'edge', src: match[2], arrow: match[3], label: match[4] || '', dst: match[5] })],
  [NODE_OPEN, match => ({ t: 'node', id: match[2] })],
];

function classify(line) {
  for (const [pattern, build] of LINE_CLASSIFIERS) {
    const match = pattern.exec(line);
    if (match) return build(match);
  }
  if (line.trim() === '') return { t: 'blank' };
  return { t: 'other' };
}

function renameInLine(line, k, ren) {
  switch (k.t) {
    case 'node': return line.replace(NODE_OPEN, (_, ws, id, open) => `${ws}${ren(id)}${open}"`);
    case 'subgraph': return line.replace(SUBGRAPH, (_, ws, id, tail) => `${ws}subgraph ${ren(id)}${tail || ''}`);
    case 'edge': return line.replace(EDGE, (...groups) => {
      const [, ws, srcId, arrowText, label, dstId] = groups;
      return `${ws}${ren(srcId)} ${arrowText}${label || ''} ${ren(dstId)}`;
    });
    case 'kind': return line.replace(D_KIND, (_, id, x) => `%% kind ${ren(id)} ${x}`);
    case 'parent': return line.replace(D_PARENT, (_, childId, parentId) => `%% parent ${ren(childId)} ${ren(parentId)}`);
    case 'fmmeta': return line.replace(D_FMMETA, (_, id, rest) => `%% fm:meta ${ren(id)} ${rest}`);
    case 'src': return line.replace(D_SRC, (_, id, path) => `%% src ${ren(id)} ${path}`);
    case 'groupmember': return line.replace(D_GROUPMEMBER, (_, gid, member) => `%% group-member ${gid} ${ren(member)}`);
    default: return line;
  }
}

function parseFile(text, source) {
  const out = [];
  let header = null, rootId = null;
  for (const raw of text.split('\n')) {
    const k = classify(raw);
    if (k.t === 'header') { header = k.dir; continue; }
    if (k.t === 'root') { rootId = k.id; continue; }
    out.push({ raw, k });
  }
  return { source, header, rootId, lines: out };
}

function definedIds(parsed) {
  const ids = new Set();
  for (const { k } of parsed.lines) if (k.t === 'node' || k.t === 'subgraph') ids.add(k.id);
  if (parsed.rootId) ids.add(parsed.rootId);
  return ids;
}

// Line kinds that never emit output and never affect subgraph membership.
const BODY_SKIP_KINDS = new Set(['drop', 'comment', 'blank', 'src']);

function buildBody(parsed, isFragment, ren, globalIds) {
  const top = [];
  const stack = [];
  const defined = new Set();
  const sink = () => (stack.length ? stack[stack.length - 1].buf : top);
  const markMember = () => { if (stack.length) stack[stack.length - 1].hasMember = true; };
  // Emit a closed subgraph frame (header + body + closing line) only if it
  // ended up with at least one member; chainMember also flags the parent
  // frame as having a member, matching the in-loop 'end' behavior exactly.
  const closeFrame = (frame, closingLine, chainMember) => {
    if (!frame || !frame.hasMember) return;
    sink().push(frame.header, ...frame.buf, closingLine);
    defined.add(frame.id);
    if (chainMember) markMember();
  };

  // Emit a `node` line unless it's a fragment's stub for an already-global id.
  const emitNode = (raw, k) => {
    if (isFragment && globalIds.has(k.id)) return;
    sink().push(renameInLine(raw, k, ren));
    defined.add(ren(k.id));
    markMember();
  };

  for (const { raw, k } of parsed.lines) {
    if (BODY_SKIP_KINDS.has(k.t)) continue;
    if (k.t === 'subgraph') { stack.push({ header: renameInLine(raw, k, ren), id: ren(k.id), buf: [], hasMember: false }); continue; }
    if (k.t === 'end') { closeFrame(stack.pop(), raw, true); continue; }
    if (k.t === 'node') { emitNode(raw, k); continue; }
    if (k.t === 'other') sink().push(raw);
  }
  while (stack.length) closeFrame(stack.pop(), '  end', false);
  return { lines: top, defined };
}

// Parse each fragment and drop (with a warning) any that lack `%% root <id>`;
// also warns when a fragment's root isn't a node defined in root.mmd.
function parseFragments(fragments, globalIds, warnings) {
  const frags = fragments.map(frag => parseFile(frag.text, frag.name)).filter(frag => {
    if (!frag.rootId) { warnings.push(`${frag.source}: no \`%% root <id>\` — skipped.`); return false; }
    return true;
  });
  for (const frag of frags)
    if (!globalIds.has(frag.rootId))
      warnings.push(`${frag.source}: \`%% root ${frag.rootId}\` not defined as a node in root.mmd — container will not attach. Add a node for it in root.mmd.`);
  return frags;
}

// Mutable accumulators shared by ingest() across the root doc and every fragment.
function createIngestState(globalIds, containerIds) {
  return {
    globalIds, containerIds,
    fmById: new Map(),
    kindById: new Map(),
    parentLines: [],
    srcLines: [],
    groupLines: [],
    edgeKey: new Set(),
    edgeLines: [],
    bodyChunks: [],
    allDefined: new Set(),
  };
}

function addFmMeta(state, id, line, owner) {
  const want = state.containerIds.has(id) ? 'frag' : (state.globalIds.has(id) ? 'root' : 'frag');
  if (owner !== want) return;
  if (!state.fmById.has(id)) state.fmById.set(id, []);
  state.fmById.get(id).push(line);
}
function addKind(state, id, line, owner) {
  const want = state.globalIds.has(id) ? 'root' : 'frag';
  const cur = state.kindById.get(id);
  if (cur && cur.owner === want) return;
  if (!cur || owner === want) state.kindById.set(id, { owner, line });
}
function addEdge(state, line, sig) { if (!state.edgeKey.has(sig)) { state.edgeKey.add(sig); state.edgeLines.push(line); } }

// Absorb one parsed doc (root or fragment) into the shared ingest state.
function ingest(state, parsed, isFragment, ren) {
  for (const { raw, k } of parsed.lines) {
    if (k.t === 'fmmeta') addFmMeta(state, ren(k.id), renameInLine(raw, k, ren), isFragment ? 'frag' : 'root');
    else if (k.t === 'kind') addKind(state, ren(k.id), renameInLine(raw, k, ren), isFragment ? 'frag' : 'root');
    else if (k.t === 'parent') state.parentLines.push(renameInLine(raw, k, ren));
    else if (k.t === 'src') state.srcLines.push(renameInLine(raw, k, ren));
    else if (k.t === 'group' || k.t === 'groupmember') state.groupLines.push(renameInLine(raw, k, ren));
    else if (k.t === 'edge') addEdge(state, renameInLine(raw, k, ren), `${ren(k.src)}|${k.arrow}|${k.label}|${ren(k.dst)}`);
  }
  const body = buildBody(parsed, isFragment, ren, state.globalIds);
  for (const id of body.defined) state.allDefined.add(id);
  state.bodyChunks.push({ source: parsed.source, lines: body.lines });
}

// Drop `%% parent` lines whose endpoints never got emitted (warning per drop),
// then dedupe the survivors.
function resolveParents(parentLines, allDefined, warnings) {
  const keptParents = [];
  for (const line of parentLines) {
    const match = D_PARENT.exec(line);
    if (match && allDefined.has(match[1]) && allDefined.has(match[2])) keptParents.push(line);
    else if (match) warnings.push(`dropped dangling \`%% parent ${match[1]} ${match[2]}\` (an endpoint was not emitted).`);
  }
  const seen = new Set();
  return keptParents.filter(line => (seen.has(line) ? false : (seen.add(line), true)));
}

// Assemble the bundle's line order: header, fm:meta, kind, parent, group,
// src, one blank, each fragment's body (blank-separated), then edges.
function renderBundleLines(dir, globalRootId, state, parents) {
  const out = [`flowchart ${dir}`,
    '%% AUTO-GENERATED BUNDLE — do not edit. Edit the per-folder fragments and re-bundle.',
    `%% root ${globalRootId}`, ''];
  for (const [, fmLines] of state.fmById) for (const fmLine of fmLines) out.push(fmLine);
  out.push('');
  for (const [, kindEntry] of state.kindById) out.push(kindEntry.line);
  for (const parentLine of parents) out.push(parentLine);
  for (const groupLine of state.groupLines) out.push(groupLine);
  for (const srcLine of state.srcLines) out.push(srcLine);
  out.push('');
  for (const chunk of state.bodyChunks) { for (const line of chunk.lines) out.push(line); out.push(''); }
  for (const edgeLine of state.edgeLines) out.push(edgeLine);
  return out;
}

// Collapse runs of blank lines to at most one, trim trailing blanks, and join.
function collapseBlankRuns(lines) {
  const final = []; let blanks = 0;
  for (const line of lines) { if (line.trim() === '') { blanks++; if (blanks <= 1) final.push(''); } else { blanks = 0; final.push(line); } }
  while (final.length && final[final.length - 1] === '') final.pop();
  final.push('');
  return final.join('\n');
}

// Merge root.mmd + fragments into one spec-valid bundle; see file header for the contract.
function bundle(rootText, fragments) {
  const warnings = [];
  const root = parseFile(rootText, 'root.mmd');
  if (!root.header) warnings.push('root.mmd: missing `flowchart <dir>` header (defaulting to LR).');
  const globalRootId = root.rootId || 'main';
  const dir = root.header || 'LR';
  const globalIds = definedIds(root);

  const frags = parseFragments(fragments, globalIds, warnings);
  const containerIds = new Set(frags.map(frag => frag.rootId));

  const state = createIngestState(globalIds, containerIds);
  ingest(state, root, false, id => id);
  for (const frag of frags) { const ns = frag.rootId; ingest(state, frag, true, id => (globalIds.has(id) ? id : `${ns}__${id}`)); }

  const parents = resolveParents(state.parentLines, state.allDefined, warnings);
  const out = renderBundleLines(dir, globalRootId, state, parents);
  return { text: collapseBlankRuns(out), warnings };
}

// CLI supports two forms:
//   explicit:   node novakai-bundle.mjs [--check] <root.mmd> <frag.mmd> ...
//   discovery:  node novakai-bundle.mjs [--check] --root <root.mmd> --dir <srcDir>
//               (recursively bundles every *.novakai.mmd under <srcDir>, except <root.mmd>)
import { readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const argv = process.argv.slice(2);
let checkOnly = false, rootPath = null, dir = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--check') checkOnly = true;
  else if (arg === '--root') rootPath = argv[++i];
  else if (arg === '--dir') dir = argv[++i];
  else positional.push(arg);
}

let fragPaths = [];
if (dir) {
  const rootAbs = rootPath ? resolve(rootPath) : null;
  fragPaths = readdirSync(dir, { recursive: true })
    .filter(entry => typeof entry === 'string' && (basename(entry) === 'novakai.mmd' || basename(entry).endsWith('.novakai.mmd')))
    .map(entry => join(dir, entry))
    .filter(entry => resolve(entry) !== rootAbs)
    .sort();
} else {
  if (!rootPath) rootPath = positional.shift();
  fragPaths = positional;
}
if (!rootPath) { console.error('usage: node novakai-bundle.mjs [--check] <root.mmd> <frag.mmd>...\n   or: node novakai-bundle.mjs [--check] --root <root.mmd> --dir <srcDir>'); process.exit(2); }

const res = bundle(readFileSync(rootPath, 'utf8'), fragPaths.map(fragPath => ({ name: fragPath, text: readFileSync(fragPath, 'utf8') })));
for (const warning of res.warnings) console.error('WARN ' + warning);
if (!checkOnly) process.stdout.write(res.text);
else console.error(res.warnings.length ? `${res.warnings.length} warning(s).` : 'OK: no warnings.');
