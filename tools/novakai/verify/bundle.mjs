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
  [HEADER, match => ({ type: 'header', dir: match[1] })],
  [D_ROOT, match => ({ type: 'root', id: match[1] })],
  [D_KIND, match => ({ type: 'kind', id: match[1], kind: match[2] })],
  [D_PARENT, match => ({ type: 'parent', child: match[1], parent: match[2] })],
  [D_FMMETA, match => ({ type: 'fmmeta', id: match[1], rest: match[2] })],
  [D_SRC, match => ({ type: 'src', id: match[1], path: match[2] })],
  [D_GROUP, match => ({ type: 'group', id: match[1] })],
  [D_GROUPMEMBER, match => ({ type: 'groupmember', gid: match[1], member: match[2] })],
  [D_FM, () => ({ type: 'drop' })],
  [D_EDGEGEO, () => ({ type: 'drop' })],
  [COMMENT, () => ({ type: 'comment' })],
  [SUBGRAPH, match => ({ type: 'subgraph', id: match[2] })],
  [END, () => ({ type: 'end' })],
  [EDGE, match => ({ type: 'edge', src: match[2], arrow: match[3], label: match[4] || '', dst: match[5] })],
  [NODE_OPEN, match => ({ type: 'node', id: match[2] })],
];

function classify(line) {
  for (const [pattern, build] of LINE_CLASSIFIERS) {
    const match = pattern.exec(line);
    if (match) return build(match);
  }
  if (line.trim() === '') return { type: 'blank' };
  return { type: 'other' };
}

function renameInLine(line, k, ren) {
  switch (k.type) {
    case 'node': return line.replace(NODE_OPEN, (_, indent, id, open) => `${indent}${ren(id)}${open}"`);
    case 'subgraph':
      return line.replace(SUBGRAPH, (_, indent, id, tail) => `${indent}subgraph ${ren(id)}${tail || ''}`);
    case 'edge': return line.replace(EDGE, (...groups) => {
      const [, indent, srcId, arrowText, label, dstId] = groups;
      return `${indent}${ren(srcId)} ${arrowText}${label || ''} ${ren(dstId)}`;
    });
    case 'kind': return line.replace(D_KIND, (_, id, x) => `%% kind ${ren(id)} ${x}`);
    case 'parent':
      return line.replace(D_PARENT, (_, childId, parentId) => `%% parent ${ren(childId)} ${ren(parentId)}`);
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
    if (k.type === 'header') {
      header = k.dir;
      continue;
    }
    if (k.type === 'root') {
      rootId = k.id;
      continue;
    }
    out.push({ raw, k });
  }
  return { source, header, rootId, lines: out };
}

function definedIds(parsed) {
  const ids = new Set();
  for (const { k } of parsed.lines) if (k.type === 'node' || k.type === 'subgraph') ids.add(k.id);
  if (parsed.rootId) ids.add(parsed.rootId);
  return ids;
}

// Line kinds that never emit output and never affect subgraph membership.
const BODY_SKIP_KINDS = new Set(['drop', 'comment', 'blank', 'src']);

// Accumulates the emitted body lines + defined-id set for one parsed doc,
// tracking an open-subgraph stack so nested frames only emit if non-empty.
function createFrameBuilder(isFragment, ren, globalIds) {
  return { top: [], stack: [], defined: new Set(), isFragment, ren, globalIds };
}

function sinkOf(builder) {
  return builder.stack.length ? builder.stack[builder.stack.length - 1].buf : builder.top;
}

function markMember(builder) {
  if (builder.stack.length) builder.stack[builder.stack.length - 1].hasMember = true;
}

// Emit a closed subgraph frame (header + body + closing line) only if it
// ended up with at least one member; chainMember also flags the parent
// frame as having a member, matching the in-loop 'end' behavior exactly.
function closeFrame(builder, frame, closingLine, chainMember) {
  if (!frame || !frame.hasMember) return;
  sinkOf(builder).push(frame.header, ...frame.buf, closingLine);
  builder.defined.add(frame.id);
  if (chainMember) markMember(builder);
}

// Emit a `node` line unless it's a fragment's stub for an already-global id.
function emitNode(builder, raw, k) {
  if (builder.isFragment && builder.globalIds.has(k.id)) return;
  sinkOf(builder).push(renameInLine(raw, k, builder.ren));
  builder.defined.add(builder.ren(k.id));
  markMember(builder);
}

// Dispatch one classified line into the builder per its kind.
function applyLine(builder, raw, k) {
  if (BODY_SKIP_KINDS.has(k.type)) return;
  if (k.type === 'subgraph') {
    builder.stack.push({ header: renameInLine(raw, k, builder.ren), id: builder.ren(k.id), buf: [], hasMember: false });
    return;
  }
  if (k.type === 'end') {
    closeFrame(builder, builder.stack.pop(), raw, true);
    return;
  }
  if (k.type === 'node') {
    emitNode(builder, raw, k);
    return;
  }
  if (k.type === 'other') sinkOf(builder).push(raw);
}

function buildBody(parsed, isFragment, ren, globalIds) {
  const builder = createFrameBuilder(isFragment, ren, globalIds);
  for (const { raw, k } of parsed.lines) applyLine(builder, raw, k);
  while (builder.stack.length) closeFrame(builder, builder.stack.pop(), '  end', false);
  return { lines: builder.top, defined: builder.defined };
}

// Parse each fragment and drop (with a warning) any that lack `%% root <id>`;
// also warns when a fragment's root isn't a node defined in root.mmd.
function parseFragments(fragments, globalIds, warnings) {
  const frags = fragments.map(frag => parseFile(frag.text, frag.name)).filter(frag => {
    if (!frag.rootId) {
      warnings.push(`${frag.source}: no \`%% root <id>\` — skipped.`);
      return false;
    }
    return true;
  });
  for (const frag of frags)
    if (!globalIds.has(frag.rootId))
      warnings.push(
        `${frag.source}: \`%% root ${frag.rootId}\` not defined as a node in root.mmd — container will not ` +
        'attach. Add a node for it in root.mmd.'
      );
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
function addEdge(state, line, sig) {
  if (!state.edgeKey.has(sig)) {
    state.edgeKey.add(sig);
    state.edgeLines.push(line);
  }
}

// One handler per classified-line kind, keyed the same as LINE_CLASSIFIERS'
// `t`/`type` tags — keeps ingest() a flat dispatch instead of an if/else
// chain, so its complexity stays low as directive kinds are added.
const INGEST_HANDLERS = {
  fmmeta: (state, ctx) => addFmMeta(state, ctx.ren(ctx.k.id), renameInLine(ctx.raw, ctx.k, ctx.ren), ctx.owner),
  kind: (state, ctx) => addKind(state, ctx.ren(ctx.k.id), renameInLine(ctx.raw, ctx.k, ctx.ren), ctx.owner),
  parent: (state, ctx) => state.parentLines.push(renameInLine(ctx.raw, ctx.k, ctx.ren)),
  src: (state, ctx) => state.srcLines.push(renameInLine(ctx.raw, ctx.k, ctx.ren)),
  group: (state, ctx) => state.groupLines.push(renameInLine(ctx.raw, ctx.k, ctx.ren)),
  groupmember: (state, ctx) => state.groupLines.push(renameInLine(ctx.raw, ctx.k, ctx.ren)),
  edge: (state, ctx) => addEdge(
    state,
    renameInLine(ctx.raw, ctx.k, ctx.ren),
    `${ctx.ren(ctx.k.src)}|${ctx.k.arrow}|${ctx.k.label}|${ctx.ren(ctx.k.dst)}`
  ),
};

// Absorb one parsed doc (root or fragment) into the shared ingest state.
function ingest(state, parsed, isFragment, ren) {
  const owner = isFragment ? 'frag' : 'root';
  for (const { raw, k } of parsed.lines) {
    const handler = INGEST_HANDLERS[k.type];
    if (handler) handler(state, { raw, k, ren, owner });
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
    else if (match) {
      warnings.push(`dropped dangling \`%% parent ${match[1]} ${match[2]}\` (an endpoint was not emitted).`);
    }
  }
  const seen = new Set();
  return keptParents.filter(line => (seen.has(line) ? false : (seen.add(line), true)));
}

function pushFmMetaLines(out, fmById) {
  for (const [, fmLines] of fmById) for (const fmLine of fmLines) out.push(fmLine);
}

// Each fragment's body, blank-line separated.
function pushBodyChunks(out, bodyChunks) {
  for (const chunk of bodyChunks) {
    for (const line of chunk.lines) out.push(line);
    out.push('');
  }
}

// Assemble the bundle's line order: header, fm:meta, kind, parent, group,
// src, one blank, each fragment's body (blank-separated), then edges.
function renderBundleLines(dir, globalRootId, state, parents) {
  const out = [`flowchart ${dir}`,
    '%% AUTO-GENERATED BUNDLE — do not edit. Edit the per-folder fragments and re-bundle.',
    `%% root ${globalRootId}`, ''];
  pushFmMetaLines(out, state.fmById);
  out.push('');
  for (const [, kindEntry] of state.kindById) out.push(kindEntry.line);
  for (const parentLine of parents) out.push(parentLine);
  for (const groupLine of state.groupLines) out.push(groupLine);
  for (const srcLine of state.srcLines) out.push(srcLine);
  out.push('');
  pushBodyChunks(out, state.bodyChunks);
  for (const edgeLine of state.edgeLines) out.push(edgeLine);
  return out;
}

// Collapse runs of blank lines to at most one, trim trailing blanks, and join.
function collapseBlankRuns(lines) {
  const final = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === '') {
      blanks++;
      if (blanks <= 1) final.push('');
    } else {
      blanks = 0;
      final.push(line);
    }
  }
  while (final.length && final[final.length - 1] === '') final.pop();
  final.push('');
  return final.join('\n');
}

// Validate the root doc's header/root-id and compute the bundle's global ids.
function deriveRootMeta(root, warnings) {
  if (!root.header) warnings.push('root.mmd: missing `flowchart <dir>` header (defaulting to LR).');
  return {
    globalRootId: root.rootId || 'main',
    dir: root.header || 'LR',
    globalIds: definedIds(root),
  };
}

// Ingest each fragment under its own private-id namespace (`<containerId>__<id>`).
function ingestFragments(state, frags, globalIds) {
  for (const frag of frags) {
    const namespace = frag.rootId;
    ingest(state, frag, true, id => (globalIds.has(id) ? id : `${namespace}__${id}`));
  }
}

// Merge root.mmd + fragments into one spec-valid bundle; see file header for the contract.
function bundle(rootText, fragments) {
  const warnings = [];
  const root = parseFile(rootText, 'root.mmd');
  const { globalRootId, dir, globalIds } = deriveRootMeta(root, warnings);

  const frags = parseFragments(fragments, globalIds, warnings);
  const containerIds = new Set(frags.map(frag => frag.rootId));
  const state = createIngestState(globalIds, containerIds);
  ingest(state, root, false, id => id);
  ingestFragments(state, frags, globalIds);

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
let checkOnly = false, rootPath = null;
const dirs = [];
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === '--check') checkOnly = true;
  else if (arg === '--root') rootPath = argv[++i];
  else if (arg === '--dir') dirs.push(argv[++i]);
  else positional.push(arg);
}

let fragPaths = [];
if (dirs.length) {
  const rootAbs = rootPath ? resolve(rootPath) : null;
  fragPaths = dirs.flatMap(sourceDir => readdirSync(sourceDir, { recursive: true })
    .filter(entry => typeof entry === 'string' &&
      (basename(entry) === 'novakai.mmd' || basename(entry).endsWith('.novakai.mmd')))
    .map(entry => join(sourceDir, entry)))
    .filter(entry => resolve(entry) !== rootAbs)
    .sort();
} else {
  if (!rootPath) rootPath = positional.shift();
  fragPaths = positional;
}
if (!rootPath) {
  console.error(
    'usage: node novakai-bundle.mjs [--check] <root.mmd> <frag.mmd>...\n' +
    '   or: node novakai-bundle.mjs [--check] --root <root.mmd> --dir <srcDir>'
  );
  process.exit(2);
}

const res = bundle(
  readFileSync(rootPath, 'utf8'),
  fragPaths.map(fragPath => ({ name: fragPath, text: readFileSync(fragPath, 'utf8') }))
);
for (const warning of res.warnings) console.error('WARN ' + warning);
if (!checkOnly) process.stdout.write(res.text);
else console.error(res.warnings.length ? `${res.warnings.length} warning(s).` : 'OK: no warnings.');
