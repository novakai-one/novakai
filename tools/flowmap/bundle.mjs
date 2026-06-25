#!/usr/bin/env node
// flowmap-bundle.mjs
// Merge per-folder Flowmap fragments into ONE spec-valid .mmd ("the bundle").
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
// Usage:  node flowmap-bundle.mjs <root.mmd> <fragmentA.mmd> [fragmentB.mmd ...]
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
const COMMENT = /^%%/;

function classify(line) {
  let m;
  if ((m = HEADER.exec(line))) return { t: 'header', dir: m[1] };
  if ((m = D_ROOT.exec(line))) return { t: 'root', id: m[1] };
  if ((m = D_KIND.exec(line))) return { t: 'kind', id: m[1], kind: m[2] };
  if ((m = D_PARENT.exec(line))) return { t: 'parent', child: m[1], parent: m[2] };
  if ((m = D_FMMETA.exec(line))) return { t: 'fmmeta', id: m[1], rest: m[2] };
  if (D_FM.test(line)) return { t: 'drop' };
  if (D_EDGEGEO.test(line)) return { t: 'drop' };
  if (COMMENT.test(line)) return { t: 'comment' };
  if ((m = SUBGRAPH.exec(line))) return { t: 'subgraph', id: m[2] };
  if (END.test(line)) return { t: 'end' };
  if ((m = EDGE.exec(line))) return { t: 'edge', src: m[2], arrow: m[3], label: m[4] || '', dst: m[5] };
  if ((m = NODE_OPEN.exec(line))) return { t: 'node', id: m[2] };
  if (line.trim() === '') return { t: 'blank' };
  return { t: 'other' };
}

function renameInLine(line, k, ren) {
  switch (k.t) {
    case 'node': return line.replace(NODE_OPEN, (f, ws, id, open) => `${ws}${ren(id)}${open}"`);
    case 'subgraph': return line.replace(SUBGRAPH, (f, ws, id, tail) => `${ws}subgraph ${ren(id)}${tail || ''}`);
    case 'edge': return line.replace(EDGE, (f, ws, s, a, l, d) => `${ws}${ren(s)} ${a}${l || ''} ${ren(d)}`);
    case 'kind': return line.replace(D_KIND, (f, id, x) => `%% kind ${ren(id)} ${x}`);
    case 'parent': return line.replace(D_PARENT, (f, c, p) => `%% parent ${ren(c)} ${ren(p)}`);
    case 'fmmeta': return line.replace(D_FMMETA, (f, id, r) => `%% fm:meta ${ren(id)} ${r}`);
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

function buildBody(parsed, isFragment, ren, globalIds) {
  const top = [];
  const stack = [];
  const defined = new Set();
  const sink = () => (stack.length ? stack[stack.length - 1].buf : top);
  const markMember = () => { if (stack.length) stack[stack.length - 1].hasMember = true; };
  for (const { raw, k } of parsed.lines) {
    if (k.t === 'drop' || k.t === 'comment' || k.t === 'blank') continue;
    if (k.t === 'subgraph') { stack.push({ header: renameInLine(raw, k, ren), id: ren(k.id), buf: [], hasMember: false }); continue; }
    if (k.t === 'end') {
      const f = stack.pop();
      if (f && f.hasMember) { const dst = sink(); dst.push(f.header, ...f.buf, raw); defined.add(f.id); markMember(); }
      continue;
    }
    if (k.t === 'node') {
      if (isFragment && globalIds.has(k.id)) continue;
      sink().push(renameInLine(raw, k, ren)); defined.add(ren(k.id)); markMember();
      continue;
    }
    if (k.t === 'other') { sink().push(raw); continue; }
  }
  while (stack.length) { const f = stack.pop(); if (f.hasMember) { sink().push(f.header, ...f.buf, '  end'); defined.add(f.id); } }
  return { lines: top, defined };
}

function bundle(rootText, fragments) {
  const warnings = [];
  const root = parseFile(rootText, 'root.mmd');
  if (!root.header) warnings.push('root.mmd: missing `flowchart <dir>` header (defaulting to LR).');
  const globalRootId = root.rootId || 'main';
  const dir = root.header || 'LR';
  const globalIds = definedIds(root);

  const frags = fragments.map(f => parseFile(f.text, f.name)).filter(f => {
    if (!f.rootId) { warnings.push(`${f.source}: no \`%% root <id>\` — skipped.`); return false; }
    return true;
  });
  const containerIds = new Set(frags.map(f => f.rootId));
  for (const f of frags)
    if (!globalIds.has(f.rootId))
      warnings.push(`${f.source}: \`%% root ${f.rootId}\` not defined as a node in root.mmd — container will not attach. Add a node for it in root.mmd.`);

  const fmById = new Map();
  const kindById = new Map();
  const parentLines = [];
  const edgeKey = new Set();
  const edgeLines = [];
  const bodyChunks = [];
  const allDefined = new Set();

  function addFmMeta(id, line, owner) {
    const want = containerIds.has(id) ? 'frag' : (globalIds.has(id) ? 'root' : 'frag');
    if (owner !== want) return;
    if (!fmById.has(id)) fmById.set(id, []);
    fmById.get(id).push(line);
  }
  function addKind(id, line, owner) {
    const want = globalIds.has(id) ? 'root' : 'frag';
    const cur = kindById.get(id);
    if (cur && cur.owner === want) return;
    if (!cur || owner === want) kindById.set(id, { owner, line });
  }
  function addEdge(line, sig) { if (!edgeKey.has(sig)) { edgeKey.add(sig); edgeLines.push(line); } }

  function ingest(parsed, isFragment, ren) {
    for (const { raw, k } of parsed.lines) {
      if (k.t === 'fmmeta') addFmMeta(ren(k.id), renameInLine(raw, k, ren), isFragment ? 'frag' : 'root');
      else if (k.t === 'kind') addKind(ren(k.id), renameInLine(raw, k, ren), isFragment ? 'frag' : 'root');
      else if (k.t === 'parent') parentLines.push(renameInLine(raw, k, ren));
      else if (k.t === 'edge') addEdge(renameInLine(raw, k, ren), `${ren(k.src)}|${k.arrow}|${k.label}|${ren(k.dst)}`);
    }
    const body = buildBody(parsed, isFragment, ren, globalIds);
    for (const id of body.defined) allDefined.add(id);
    bodyChunks.push({ source: parsed.source, lines: body.lines });
  }

  ingest(root, false, id => id);
  for (const f of frags) { const ns = f.rootId; ingest(f, true, id => (globalIds.has(id) ? id : `${ns}__${id}`)); }

  const keptParents = [];
  for (const p of parentLines) {
    const m = D_PARENT.exec(p);
    if (m && allDefined.has(m[1]) && allDefined.has(m[2])) keptParents.push(p);
    else if (m) warnings.push(`dropped dangling \`%% parent ${m[1]} ${m[2]}\` (an endpoint was not emitted).`);
  }
  const seenP = new Set(); const parents = keptParents.filter(p => (seenP.has(p) ? false : (seenP.add(p), true)));

  const out = [`flowchart ${dir}`,
    '%% AUTO-GENERATED BUNDLE — do not edit. Edit the per-folder fragments and re-bundle.',
    `%% root ${globalRootId}`, ''];
  for (const [, lines] of fmById) for (const l of lines) out.push(l);
  out.push('');
  for (const [, v] of kindById) out.push(v.line);
  for (const p of parents) out.push(p);
  out.push('');
  for (const chunk of bodyChunks) { for (const l of chunk.lines) out.push(l); out.push(''); }
  for (const l of edgeLines) out.push(l);

  const final = []; let blanks = 0;
  for (const l of out) { if (l.trim() === '') { blanks++; if (blanks <= 1) final.push(''); } else { blanks = 0; final.push(l); } }
  while (final.length && final[final.length - 1] === '') final.pop();
  final.push('');
  return { text: final.join('\n'), warnings };
}

// CLI supports two forms:
//   explicit:   node flowmap-bundle.mjs [--check] <root.mmd> <frag.mmd> ...
//   discovery:  node flowmap-bundle.mjs [--check] --root <root.mmd> --dir <srcDir>
//               (recursively bundles every *.flowmap.mmd under <srcDir>, except <root.mmd>)
import { readdirSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const argv = process.argv.slice(2);
let checkOnly = false, rootPath = null, dir = null;
const positional = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--check') checkOnly = true;
  else if (a === '--root') rootPath = argv[++i];
  else if (a === '--dir') dir = argv[++i];
  else positional.push(a);
}

let fragPaths = [];
if (dir) {
  const rootAbs = rootPath ? resolve(rootPath) : null;
  fragPaths = readdirSync(dir, { recursive: true })
    .filter(p => typeof p === 'string' && basename(p) === 'flowmap.mmd')
    .map(p => join(dir, p))
    .filter(p => resolve(p) !== rootAbs)
    .sort();
} else {
  if (!rootPath) rootPath = positional.shift();
  fragPaths = positional;
}
if (!rootPath) { console.error('usage: node flowmap-bundle.mjs [--check] <root.mmd> <frag.mmd>...\n   or: node flowmap-bundle.mjs [--check] --root <root.mmd> --dir <srcDir>'); process.exit(2); }

const res = bundle(readFileSync(rootPath, 'utf8'), fragPaths.map(p => ({ name: p, text: readFileSync(p, 'utf8') })));
for (const w of res.warnings) console.error('WARN ' + w);
if (!checkOnly) process.stdout.write(res.text);
else console.error(res.warnings.length ? `${res.warnings.length} warning(s).` : 'OK: no warnings.');
