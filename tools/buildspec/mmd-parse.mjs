/* =====================================================================
   mmd-parse.mjs — shared, zero-dependency parser for the Flowmap .mmd
   dialect (Mermaid flowchart + %% metadata). Single source of truth for
   reading a spec; reused by spec-to-stubs (#1), gate (#3) and the
   extractor's emitter (#2). Mirrors the grammar in SYNTAX_README.md and
   the parse in src/io/mermaid.ts / src/core/frontmatter.ts.

   parseMmd(text) -> {
     dir, roots:string[],
     nodes: { [id]: { id, kind, parent, group:boolean, shape } },
     edges: [{ from, to, style:'solid'|'thick'|'dotted', label }],
     groups: Set<string>,
     fm: { [id]: Frontmatter }
   }
   Frontmatter = { name, description, state:string[],
                   interfaces:[{ name, accepts:string[], returns:string[] }] }

   No runtime deps. Node 16+.
   ===================================================================== */

const KINDS = new Set([
  'component', 'hook', 'class', 'store', 'module', 'function', 'type', 'service', 'event',
]);

const SHAPE_RES = [
  ['stadium', /^(\w+)\(\["?([^"\)]*)"?\]\)/],
  ['cylinder', /^(\w+)\[\("?([^"\)]*)"?\)\]/],
  ['hex', /^(\w+)\{\{"?([^"\}]*)"?\}\}/],
  ['circle', /^(\w+)\(\("?([^"\)]*)"?\)\)/],
  ['diamond', /^(\w+)\{"?([^"\}]*)"?\}/],
  ['note', /^(\w+)>"?([^"\]]*)"?\]/],
  ['round', /^(\w+)\("?([^"\)]*)"?\)/],
  ['rect', /^(\w+)\["?([^"\]]*)"?\]/],
];

const EDGE_RE = /^(\w+)\s*(-\.->|==>|-->|---)\s*(?:\|([^|]*)\|)?\s*(\w+)/;

function emptyFm() {
  return { name: '', description: '', state: [], interfaces: [] };
}
function emptyIface() {
  return { name: '', accepts: [], returns: [] };
}

/** Match one `%% fm:meta <id> <key>=<value>` line (incl. legacy bare forms). */
export function matchFrontmatterLine(line) {
  const m = line.match(
    /^%% fm:meta (\w+) (?:i(\d+)\.(name|accepts|returns)|(name|desc|state|accepts|returns))=(.*)$/,
  );
  if (!m) return null;
  const id = m[1];
  const value = m[5];
  if (m[2] !== undefined) return { id, key: m[3], value, iface: +m[2] };
  const nodeKey = m[4];
  if (nodeKey === 'accepts' || nodeKey === 'returns') return { id, key: nodeKey, value, iface: 0 };
  return { id, key: nodeKey, value };
}

function ensureIface(fm, i) {
  while (fm.interfaces.length <= i) fm.interfaces.push(emptyIface());
  return fm.interfaces[i];
}

function applyFmLine(fmMap, parsed) {
  const fm = fmMap[parsed.id] ?? (fmMap[parsed.id] = emptyFm());
  const v = parsed.value;
  if (parsed.iface !== undefined) {
    const iface = ensureIface(fm, parsed.iface);
    if (parsed.key === 'name') iface.name = v;
    else if (parsed.key === 'accepts') iface.accepts.push(v);
    else if (parsed.key === 'returns') iface.returns.push(v);
    return;
  }
  if (parsed.key === 'name') fm.name = v;
  else if (parsed.key === 'desc') fm.description = v;
  else if (parsed.key === 'state') fm.state.push(v);
}

export function parseMmd(text) {
  const nodes = {};
  const edges = [];
  const groups = new Set();
  const fm = {};
  const bodyParent = {};   // id -> subgraph id (nesting)
  const parentDecl = {};   // id -> parent (%% parent), applied last
  const roots = [];
  const groupStack = [];
  let dir = 'TD';

  const ensure = (id, shape) => {
    if (!nodes[id]) nodes[id] = { id, kind: null, parent: null, group: false, shape: shape ?? 'rect' };
    else if (shape) nodes[id].shape = shape;
    if (groupStack.length) bodyParent[id] = groupStack[groupStack.length - 1];
    return nodes[id];
  };

  for (const raw of text.split('\n')) {
    const t = raw.trim();
    if (!t) continue;
    let m;

    if ((m = t.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i))) {
      const d = m[1].toUpperCase();
      dir = d === 'TB' ? 'TD' : d;
      continue;
    }
    if ((m = t.match(/^%% root (\w+)/))) { roots.push(m[1]); continue; }
    if ((m = t.match(/^%% kind (\w+) (\w+)/))) { ensure(m[1]); nodes[m[1]].kind = m[2]; continue; }
    if ((m = t.match(/^%% parent (\w+) (\w+)/))) { parentDecl[m[1]] = m[2]; continue; }
    const fmLine = matchFrontmatterLine(t);
    if (fmLine) { ensure(fmLine.id); applyFmLine(fm, fmLine); continue; }
    if (/^%%/.test(t)) continue; // %% fm geometry, %% edge, any other meta

    if ((m = t.match(/^subgraph\s+(\w+)\s*\["?([^"\]]*)"?\]/))) {
      groups.add(m[1]);
      const n = ensure(m[1]); n.group = true; n.shape = 'group';
      groupStack.push(m[1]);
      continue;
    }
    if (t === 'end') { groupStack.pop(); continue; }

    let matchedShape = false;
    for (const [shape, re] of SHAPE_RES) {
      if ((m = t.match(re))) { ensure(m[1], shape); matchedShape = true; break; }
    }
    if (matchedShape) continue;

    if ((m = t.match(EDGE_RE))) {
      ensure(m[1]); ensure(m[4]);
      const style = m[2] === '-.->' ? 'dotted' : m[2] === '==>' ? 'thick' : 'solid';
      edges.push({ from: m[1], to: m[4], style, label: (m[3] || '').trim() });
    }
  }

  // resolve parent: subgraph nesting, then %% parent overrides
  for (const id in nodes) nodes[id].parent = bodyParent[id] ?? null;
  for (const c in parentDecl) if (nodes[c]) nodes[c].parent = parentDecl[c];

  return { dir, roots, nodes, edges, groups, fm };
}

/** Real (non-group) node ids. */
export function realNodeIds(model) {
  return Object.keys(model.nodes).filter((id) => !model.nodes[id].group);
}

/* ---------------------------------------------------------------------
   Canonical serializer. Deterministic %% ordering so an extracted graph
   writes to a stable .mmd. The gate diffs the MODEL, not text, so this
   is for the extractor's on-disk artifact and human reading only.
   --------------------------------------------------------------------- */
export function toMmd(model, { dir = 'TD' } = {}) {
  const ids = Object.keys(model.nodes).sort();
  let out = `flowchart ${model.dir || dir}\n`;
  for (const id of (model.roots || []).slice().sort()) out += `%% root ${id}\n`;
  for (const id of ids) {
    const f = model.fm?.[id];
    if (!f) continue;
    if (f.name) out += `%% fm:meta ${id} name=${f.name}\n`;
    if (f.description) out += `%% fm:meta ${id} desc=${f.description}\n`;
    for (const s of f.state || []) out += `%% fm:meta ${id} state=${s}\n`;
    (f.interfaces || []).forEach((iface, n) => {
      if (iface.name) out += `%% fm:meta ${id} i${n}.name=${iface.name}\n`;
      for (const a of iface.accepts || []) out += `%% fm:meta ${id} i${n}.accepts=${a}\n`;
      for (const r of iface.returns || []) out += `%% fm:meta ${id} i${n}.returns=${r}\n`;
    });
  }
  for (const id of ids) if (model.nodes[id].kind) out += `%% kind ${id} ${model.nodes[id].kind}\n`;
  for (const id of ids) {
    const p = model.nodes[id].parent;
    if (p && model.nodes[p] && !model.nodes[p].group) out += `%% parent ${id} ${p}\n`;
  }
  for (const id of ids) {
    const n = model.nodes[id];
    if (n.group) continue;
    out += `  ${id}["${id}"]\n`;
  }
  const arrow = { solid: '-->', thick: '==>', dotted: '-.->' };
  for (const e of model.edges.slice().sort((a, b) => (a.from + a.to).localeCompare(b.from + b.to))) {
    out += `  ${e.from} ${arrow[e.style] || '-->'} ${e.to}\n`;
  }
  return out;
}

export { KINDS };
