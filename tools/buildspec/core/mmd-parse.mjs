/* =====================================================================
   mmd-parse.mjs — shared, zero-dependency parser for the Novakai .mmd
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
  const match = line.match(
    /^%% fm:meta (\w+) (?:i(\d+)\.(name|accepts|returns)|(name|desc|state|accepts|returns))=(.*)$/,
  );
  if (!match) return null;
  const id = match[1];
  const value = match[5];
  if (match[2] !== undefined) return { id, key: match[3], value, iface: +match[2] };
  const nodeKey = match[4];
  if (nodeKey === 'accepts' || nodeKey === 'returns') return { id, key: nodeKey, value, iface: 0 };
  return { id, key: nodeKey, value };
}

function ensureIface(frontmatter, ifaceIndex) {
  while (frontmatter.interfaces.length <= ifaceIndex) frontmatter.interfaces.push(emptyIface());
  return frontmatter.interfaces[ifaceIndex];
}

function applyFmLine(fmMap, parsed) {
  const frontmatter = fmMap[parsed.id] ?? (fmMap[parsed.id] = emptyFm());
  const value = parsed.value;
  if (parsed.iface !== undefined) {
    const iface = ensureIface(frontmatter, parsed.iface);
    if (parsed.key === 'name') iface.name = value;
    else if (parsed.key === 'accepts') iface.accepts.push(value);
    else if (parsed.key === 'returns') iface.returns.push(value);
    return;
  }
  if (parsed.key === 'name') frontmatter.name = value;
  else if (parsed.key === 'desc') frontmatter.description = value;
  else if (parsed.key === 'state') frontmatter.state.push(value);
}

function ensure(state, id, shape) {
  if (!state.nodes[id]) {
    state.nodes[id] = { id, kind: null, parent: null, group: false, shape: shape ?? 'rect' };
  } else if (shape) {
    state.nodes[id].shape = shape;
  }
  if (state.groupStack.length) state.bodyParent[id] = state.groupStack[state.groupStack.length - 1];
  return state.nodes[id];
}

function matchFlowchartHeader(line, state) {
  const headerMatch = line.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i);
  if (!headerMatch) return false;
  const upper = headerMatch[1].toUpperCase();
  state.dir = upper === 'TB' ? 'TD' : upper;
  return true;
}

function matchRootDirective(line, state) {
  const match = line.match(/^%% root (\w+)/);
  if (!match) return false;
  state.roots.push(match[1]);
  return true;
}

// %% group <gid> "<label>" [parent <gid2>] — reading-mode group declaration
function matchGroupDirective(line, state) {
  const match = line.match(/^%% group (\w+) "([^"]*)"(?: parent (\w+))?$/);
  if (!match) return false;
  state.hier.groups[match[1]] = { id: match[1], label: match[2], parent: match[3] ?? null };
  return true;
}

// %% group-member <gid> <nodeId> — top-level node → group membership
function matchGroupMemberDirective(line, state) {
  const match = line.match(/^%% group-member (\w+) (\w+)$/);
  if (!match) return false;
  state.hier.memberOf[match[2]] = match[1];
  return true;
}

function matchKindDirective(line, state) {
  const match = line.match(/^%% kind (\w+) (\w+)/);
  if (!match) return false;
  ensure(state, match[1]);
  state.nodes[match[1]].kind = match[2];
  return true;
}

function matchParentDirective(line, state) {
  const match = line.match(/^%% parent (\w+) (\w+)/);
  if (!match) return false;
  state.parentDecl[match[1]] = match[2];
  return true;
}

function matchFrontmatterDirective(line, state) {
  const fmLine = matchFrontmatterLine(line);
  if (!fmLine) return false;
  ensure(state, fmLine.id);
  applyFmLine(state.fm, fmLine);
  return true;
}

// `flowchart TD|...` header, or any `%%` directive (root/group/kind/parent/fm:meta/other).
function matchDirectiveLine(line, state) {
  if (matchFlowchartHeader(line, state)) return true;
  if (matchRootDirective(line, state)) return true;
  if (matchGroupDirective(line, state)) return true;
  if (matchGroupMemberDirective(line, state)) return true;
  if (matchKindDirective(line, state)) return true;
  if (matchParentDirective(line, state)) return true;
  if (matchFrontmatterDirective(line, state)) return true;
  if (/^%%/.test(line)) return true; // %% fm geometry, %% edge, any other meta
  return false;
}

function matchSubgraphOpen(line, state) {
  const subgraphMatch = line.match(/^subgraph\s+(\w+)\s*\["?([^"\]]*)"?\]/);
  if (!subgraphMatch) return false;
  state.groups.add(subgraphMatch[1]);
  const node = ensure(state, subgraphMatch[1]);
  node.group = true;
  node.shape = 'group';
  state.groupStack.push(subgraphMatch[1]);
  return true;
}

function matchSubgraphEnd(line, state) {
  if (line !== 'end') return false;
  state.groupStack.pop();
  return true;
}

function matchShapedNode(line, state) {
  for (const [shape, shapeRe] of SHAPE_RES) {
    const shapeMatch = line.match(shapeRe);
    if (!shapeMatch) continue;
    ensure(state, shapeMatch[1], shape);
    return true;
  }
  return false;
}

function matchStructuralLine(line, state) {
  if (matchSubgraphOpen(line, state)) return true;
  if (matchSubgraphEnd(line, state)) return true;
  return matchShapedNode(line, state);
}

function matchEdgeLine(line, state) {
  const match = line.match(EDGE_RE);
  if (!match) return false;
  ensure(state, match[1]);
  ensure(state, match[4]);
  const style = match[2] === '-.->' ? 'dotted' : match[2] === '==>' ? 'thick' : 'solid';
  state.edges.push({ from: match[1], 'to': match[4], style, label: (match[3] || '').trim() });
  return true;
}

function applyBodyParents(state) {
  for (const id in state.nodes) state.nodes[id].parent = state.bodyParent[id] ?? null;
}

function applyParentDeclOverrides(state) {
  for (const childId in state.parentDecl) {
    if (state.nodes[childId]) state.nodes[childId].parent = state.parentDecl[childId];
  }
}

function pruneDanglingGroupMembers(state) {
  for (const nodeId of Object.keys(state.hier.memberOf)) {
    const groupId = state.hier.memberOf[nodeId];
    if (!state.nodes[nodeId] || !state.hier.groups[groupId]) delete state.hier.memberOf[nodeId];
  }
}

function pruneDanglingGroupParents(state) {
  for (const groupId of Object.keys(state.hier.groups)) {
    const parentId = state.hier.groups[groupId].parent;
    if (parentId && !state.hier.groups[parentId]) state.hier.groups[groupId].parent = null;
  }
}

// Resolve parents (subgraph nesting, then %% parent overrides), then prune dangling refs.
function finalizeHierarchy(state) {
  applyBodyParents(state);
  applyParentDeclOverrides(state);
  pruneDanglingGroupMembers(state);
  pruneDanglingGroupParents(state);
}

function createParseState() {
  return {
    nodes: {},
    edges: [],
    groups: new Set(),
    'fm': {},
    bodyParent: {},   // id -> subgraph id (nesting)
    parentDecl: {},   // id -> parent (%% parent), applied last
    roots: [],
    groupStack: [],
    hier: { groups: {}, memberOf: {} }, // %% group / %% group-member overlay
    dir: 'TD',
  };
}

function parseLines(text, state) {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;

    if (matchDirectiveLine(line, state)) continue;
    if (matchStructuralLine(line, state)) continue;
    matchEdgeLine(line, state);
  }
}

function buildParseResult(state) {
  return {
    dir: state.dir,
    roots: state.roots,
    nodes: state.nodes,
    edges: state.edges,
    groups: state.groups,
    'fm': state.fm,
    hier: state.hier,
  };
}

// Parse .mmd source text into the Novakai model (nodes/edges/groups/fm/hier).
export function parseMmd(text) {
  const state = createParseState();
  parseLines(text, state);
  finalizeHierarchy(state);
  return buildParseResult(state);
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

// Serialize a parsed model back to canonical, deterministically-ordered .mmd text.
export function toMmd(model, { dir = 'TD' } = {}) {
  const ids = Object.keys(model.nodes).sort();
  let out = `flowchart ${model.dir || dir}\n`;
  out += serializeRootsAndFrontmatter(ids, model);
  out += serializeGroupsAndMembers(model);
  out += serializeKindsAndParents(ids, model);
  out += serializeNodesAndEdges(ids, model);
  return out;
}

function serializeFrontmatterEntry(id, frontmatter) {
  let out = '';
  if (frontmatter.name) out += `%% fm:meta ${id} name=${frontmatter.name}\n`;
  if (frontmatter.description) out += `%% fm:meta ${id} desc=${frontmatter.description}\n`;
  for (const stateValue of frontmatter.state || []) out += `%% fm:meta ${id} state=${stateValue}\n`;
  (frontmatter.interfaces || []).forEach((iface, ifaceIndex) => {
    if (iface.name) out += `%% fm:meta ${id} i${ifaceIndex}.name=${iface.name}\n`;
    for (const accept of iface.accepts || []) out += `%% fm:meta ${id} i${ifaceIndex}.accepts=${accept}\n`;
    for (const ret of iface.returns || []) out += `%% fm:meta ${id} i${ifaceIndex}.returns=${ret}\n`;
  });
  return out;
}

function serializeRootsAndFrontmatter(ids, model) {
  let out = '';
  for (const id of (model.roots || []).slice().sort()) out += `%% root ${id}\n`;
  for (const id of ids) {
    const frontmatter = model.fm?.[id];
    if (frontmatter) out += serializeFrontmatterEntry(id, frontmatter);
  }
  return out;
}

function serializeGroupsAndMembers(model) {
  let out = '';
  for (const groupId of Object.keys(model.hier?.groups ?? {}).sort()) {
    const group = model.hier.groups[groupId];
    out += `%% group ${groupId} "${group.label}"${group.parent ? ` parent ${group.parent}` : ''}\n`;
  }
  for (const nodeId of Object.keys(model.hier?.memberOf ?? {}).sort()) {
    out += `%% group-member ${model.hier.memberOf[nodeId]} ${nodeId}\n`;
  }
  return out;
}

function serializeKindsAndParents(ids, model) {
  let out = '';
  for (const id of ids) if (model.nodes[id].kind) out += `%% kind ${id} ${model.nodes[id].kind}\n`;
  for (const id of ids) {
    const parentId = model.nodes[id].parent;
    if (parentId && model.nodes[parentId] && !model.nodes[parentId].group) out += `%% parent ${id} ${parentId}\n`;
  }
  return out;
}

const EDGE_ARROWS = { solid: '-->', thick: '==>', dotted: '-.->' };

function serializeNodesAndEdges(ids, model) {
  let out = '';
  for (const id of ids) {
    const node = model.nodes[id];
    if (node.group) continue;
    out += `  ${id}["${id}"]\n`;
  }
  const sorted = model.edges
    .slice()
    .sort((edgeA, edgeB) => (edgeA.from + edgeA.to).localeCompare(edgeB.from + edgeB.to));
  for (const edge of sorted) {
    const arrow = EDGE_ARROWS[edge.style] || '-->';
    const labelPart = edge.label ? '|' + edge.label + '|' : '';
    out += `  ${edge.from} ${arrow}${labelPart} ${edge.to}\n`;
  }
  return out;
}

export { KINDS };
