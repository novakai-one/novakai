/* =====================================================================
   mermaid.ts — two-way Mermaid text <-> model
   ---------------------------------------------------------------------
   Responsibility: serialize the model to Mermaid flowchart text
   (toMermaid, with %% fm layout metadata so positions round-trip),
   parse Mermaid text back into a model (fromMermaid), apply parsed text
   to the live model (applyText), and keep the textarea in sync (sync).

   This is the only module that knows the Mermaid grammar + the custom
   metadata comments. Pure transform on one side, model write on the other.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type {
  DiagramNode, DiagramEdge, ShapeKind, FlowDir, Point, Hier, NodeKind, Frontmatter,
} from '../core/types/types';
import type { StateStore } from '../core/state/state';
import type { SelectionApi } from '../interaction/selection';
import { STYLES, DEFAULTS, PALETTE, escM } from '../core/config/config';
import {
  frontmatterToMermaid, matchFrontmatterLine, applyFrontmatterLine, isFrontmatterEmpty,
} from '../core/frontmatter/frontmatter';

export interface MermaidApi {
  toMermaid: (opts?: { only?: Set<string> }) => string;
  sync: () => void;
  applyText: () => void;
}

/** Per-shape Mermaid wrappers. */
const shapeWrap: Record<ShapeKind, (id: string, l: string) => string> = {
  rect: (id, l) => `${id}["${l}"]`,
  round: (id, l) => `${id}("${l}")`,
  stadium: (id, l) => `${id}(["${l}"])`,
  cylinder: (id, l) => `${id}[("${l}")]`,
  diamond: (id, l) => `${id}{"${l}"}`,
  circle: (id, l) => `${id}(("${l}"))`,
  hex: (id, l) => `${id}{{"${l}"}}`,
  note: (id, l) => `${id}>"${l}"]`,
  group: (id, l) => `subgraph ${id} ["${l}"]\n  end`,
};

interface ParseResult {
  nodes: Record<string, DiagramNode>;
  edges: DiagramEdge[];
  nextN: number;
  nextE: number;
  dir: FlowDir;
  roots: string[];
  hier: Hier;
}

/** Parse one `%% group <gid> "<label>" [parent <gid>]` or `%% group-member
    <gid> <nodeId>` line into the hier overlay. Returns true when the line was
    consumed. The pipeline parser (tools/buildspec/mmd-parse.mjs) mirrors this
    grammar; parser-conformance.test.mjs holds the two together (A3). */
export function parseGroupDirective(line: string, hier: Hier): boolean {
  let m: RegExpMatchArray | null;
  if ((m = line.match(/^%% group (\w+) "([^"]*)"(?: parent (\w+))?$/))) {
    hier.groups[m[1]] = { id: m[1], label: m[2], parent: m[3] ?? null };
    return true;
  }
  if ((m = line.match(/^%% group-member (\w+) (\w+)$/))) {
    hier.memberOf[m[2]] = m[1];
    return true;
  }
  return false;
}

type FmMeta = { x: number; y: number; w: number; h: number; shape: ShapeKind; color: string | null };

// Mutable accumulator threaded through the per-line `%%` metadata parsers below,
// so each parser stays a small module-private function instead of a giant closure.
interface MetaAccum {
  meta: Record<string, FmMeta>;
  orthoSet: Set<string>;
  bendMap: Map<string, Point>;
  labelPosMap: Map<string, Point>;
  roots: string[];
  hier: Hier;
  fmAcc: Record<string, Frontmatter>;
  kindMap: Map<string, NodeKind>;
  parentMap: Map<string, string>;
  bumpN: (id: string) => void;
}

// Parse one `%% ...` metadata comment line into the accumulator. Returns true
// when the line was a recognized directive (fm/edge/root/group/kind/parent).
function parseMetaLine(line: string, acc: MetaAccum): boolean {
  let match: RegExpMatchArray | null;
  if ((match = line.match(/^%% fm (\w+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\w+) (#?\w+)/))) {
    acc.meta[match[1]] = {
      x: +match[2], y: +match[3], w: +match[4], h: +match[5],
      shape: match[6] as ShapeKind, color: match[7] === 'null' ? null : match[7],
    };
    acc.bumpN(match[1]); return true;
  }
  const fmLine = matchFrontmatterLine(line);
  if (fmLine) { applyFrontmatterLine(acc.fmAcc, fmLine); acc.bumpN(fmLine.id); return true; }
  if ((match = line.match(/^%% edge (\w+) ortho/))) { acc.orthoSet.add(match[1]); return true; }
  if ((match = line.match(/^%% edge (\w+) bend (-?\d+) (-?\d+)/))) {
    acc.bendMap.set(match[1], { x: +match[2], y: +match[3] }); return true;
  }
  if ((match = line.match(/^%% edge (\w+) labelpos (-?\d+) (-?\d+)/))) {
    acc.labelPosMap.set(match[1], { x: +match[2], y: +match[3] }); return true;
  }
  if ((match = line.match(/^%% root (\w+)/))) { acc.roots.push(match[1]); acc.bumpN(match[1]); return true; }
  if (parseGroupDirective(line, acc.hier)) return true;
  if ((match = line.match(/^%% kind (\w+) (\w+)/))) {
    acc.kindMap.set(match[1], match[2] as NodeKind); acc.bumpN(match[1]); return true;
  }
  if ((match = line.match(/^%% parent (\w+) (\w+)/))) {
    acc.parentMap.set(match[1], match[2]); acc.bumpN(match[1]); acc.bumpN(match[2]); return true;
  }
  return false;
}

// Parse a node/subgraph declaration line, calling `ensure` to create/update the
// node. Returns true when the line matched a known shape syntax.
function parseShapeLine(line: string, ensure: (id: string, label?: string, shape?: ShapeKind) => void, groupStack: string[]): boolean {
  let match: RegExpMatchArray | null;
  if ((match = line.match(/^subgraph\s+(\w+)\s*\["?([^"\]]*)"?\]/))) {
    ensure(match[1], match[2], 'group'); groupStack.push(match[1]); return true;
  }
  if ((match = line.match(/^(\w+)\(\["?([^"\)]*)"?\]\)/))) { ensure(match[1], match[2], 'stadium'); return true; }
  if ((match = line.match(/^(\w+)\[\("?([^"\)]*)"?\)\]/))) { ensure(match[1], match[2], 'cylinder'); return true; }
  if ((match = line.match(/^(\w+)\{\{"?([^"\}]*)"?\}\}/))) { ensure(match[1], match[2], 'hex'); return true; }
  if ((match = line.match(/^(\w+)\(\("?([^"\)]*)"?\)\)/))) { ensure(match[1], match[2], 'circle'); return true; }
  if ((match = line.match(/^(\w+)\{"?([^"\}]*)"?\}/))) { ensure(match[1], match[2], 'diamond'); return true; }
  if ((match = line.match(/^(\w+)>"?([^"\]]*)"?\]/))) { ensure(match[1], match[2], 'note'); return true; }
  if ((match = line.match(/^(\w+)\("?([^"\)]*)"?\)/))) { ensure(match[1], match[2], 'round'); return true; }
  if ((match = line.match(/^(\w+)\["?([^"\]]*)"?\]/))) { ensure(match[1], match[2], 'rect'); return true; }
  return false;
}

// Parse an edge line (arrow between two node ids, optional label). Returns
// true when the line matched; pushes the parsed edge onto `edges`.
function parseEdgeLine(
  line: string,
  ensure: (id: string, label?: string, shape?: ShapeKind) => void,
  edges: DiagramEdge[],
  nextEdgeId: () => string,
): boolean {
  const edgeMatch = line.match(/^(\w+)\s*(-\.->|==>|-->|---)\s*(?:\|([^|]*)\|)?\s*(\w+)/);
  if (!edgeMatch) return false;
  ensure(edgeMatch[1]); ensure(edgeMatch[4]);
  const style = edgeMatch[2] === '-.->' ? 'dotted' : edgeMatch[2] === '==>' ? 'thick' : 'solid';
  edges.push({
    id: nextEdgeId(), from: edgeMatch[1], to: edgeMatch[4],
    label: (edgeMatch[3] || '').trim(), style, routing: 'straight',
  });
  return true;
}

// Assign fm-metadata positions or auto-place nodes lacking them; attach any
// parsed frontmatter/semantic kind. Mutates `nodes` in place.
function placeAndAnnotateNodes(
  nodes: Record<string, DiagramNode>,
  meta: Record<string, FmMeta>,
  fmAcc: Record<string, Frontmatter>,
  kindMap: Map<string, NodeKind>,
): void {
  let auto = 0;
  for (const id in nodes) {
    const node = nodes[id], placed = meta[id];
    if (placed) {
      Object.assign(node, placed);
    } else {
      const size = DEFAULTS[node.shape] || DEFAULTS.rect;
      node.w = size.w; node.h = size.h;
      node.x = 80 + (auto % 4) * 200; node.y = 80 + Math.floor(auto / 4) * 130; auto++;
    }
    if (fmAcc[id] && !isFrontmatterEmpty(fmAcc[id])) node.fm = fmAcc[id];
    const kind = kindMap.get(id);
    if (kind) node.kind = kind;
  }
}

// Apply non-group containment (drill-in parent) now that all nodes exist.
function applyContainment(nodes: Record<string, DiagramNode>, parentMap: Map<string, string>): void {
  parentMap.forEach((parentId, childId) => {
    if (nodes[childId] && nodes[parentId]) nodes[childId].parent = parentId;
  });
}

// Apply parsed edge routing metadata (ortho flag, bend point, label position).
function applyEdgeRouting(
  edges: DiagramEdge[],
  orthoSet: Set<string>,
  bendMap: Map<string, Point>,
  labelPosMap: Map<string, Point>,
): void {
  edges.forEach((edge) => { if (orthoSet.has(edge.id)) edge.routing = 'ortho'; });
  edges.forEach((edge) => {
    const bend = bendMap.get(edge.id); if (bend) edge.bend = bend;
    const labelPos = labelPosMap.get(edge.id); if (labelPos) edge.labelPos = labelPos;
  });
}

// Drop hier memberships/parents that point at nodes or groups no longer present.
function pruneHier(hier: Hier, nodes: Record<string, DiagramNode>): void {
  for (const nodeId of Object.keys(hier.memberOf)) {
    if (!nodes[nodeId] || !hier.groups[hier.memberOf[nodeId]]) delete hier.memberOf[nodeId];
  }
  for (const groupId of Object.keys(hier.groups)) {
    const parentId = hier.groups[groupId].parent;
    if (parentId && !hier.groups[parentId]) hier.groups[groupId].parent = null;
  }
}

/** Parse Mermaid text into a model fragment. Pure. */
export function fromMermaid(text: string): ParseResult {
  const nodes: Record<string, DiagramNode> = {};
  const edges: DiagramEdge[] = [];
  const acc: MetaAccum = {
    meta: {}, orthoSet: new Set<string>(), bendMap: new Map<string, Point>(),
    labelPosMap: new Map<string, Point>(), roots: [], hier: { groups: {}, memberOf: {} },
    fmAcc: {}, kindMap: new Map<string, NodeKind>(), parentMap: new Map<string, string>(),
    bumpN: (id: string): void => { const digits = +id.replace(/\D/g, ''); if (digits > maxN) maxN = digits; },
  };
  const groupStack: string[] = [];
  let maxN = 0, maxE = 0;
  let dir: FlowDir = 'TD';

  const ensure = (id: string, label?: string, shape?: ShapeKind): void => {
    acc.bumpN(id);
    if (!nodes[id]) {
      nodes[id] = { id, label: label ?? id, shape: shape ?? 'rect', color: PALETTE[0], x: 0, y: 0, w: 0, h: 0 };
    } else if (label) {
      nodes[id].label = label;
      if (shape) nodes[id].shape = shape;
    }
    if (groupStack.length) nodes[id].parent = groupStack[groupStack.length - 1];
  };

  text.split('\n').forEach((raw) => {
    const line = raw.trim();
    if (parseMetaLine(line, acc)) return;
    const dirMatch = line.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i);
    if (dirMatch) {
      const upper = dirMatch[1].toUpperCase();
      dir = upper === 'TB' ? 'TD' : (upper as FlowDir);
      return;
    }
    if (line === 'end') { groupStack.pop(); return; }
    if (line.startsWith('%%') || /^(flowchart|graph)\b/.test(line)) return;
    if (parseShapeLine(line, ensure, groupStack)) return;
    parseEdgeLine(line, ensure, edges, () => 'e' + (++maxE));
  });

  placeAndAnnotateNodes(nodes, acc.meta, acc.fmAcc, acc.kindMap);
  applyContainment(nodes, acc.parentMap);
  applyEdgeRouting(edges, acc.orthoSet, acc.bendMap, acc.labelPosMap);
  const liveRoots = acc.roots.filter((id) => nodes[id]);
  pruneHier(acc.hier, nodes);
  return { nodes, edges, nextN: maxN + 1, nextE: maxE + 1, dir, roots: liveRoots, hier: acc.hier };
}

/** A function that decides whether a node id is included in a (possibly filtered) render. */
type IncludeFn = (id: string) => boolean;

// layout metadata first
function emitLayoutMeta(state: StateStore, inc: IncludeFn): string {
  let out = '';
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const n = state.nodes[id];
    out += `%% fm ${id} ${Math.round(n.x)} ${Math.round(n.y)} ${Math.round(n.w)} ${Math.round(n.h)} ${n.shape} ${n.color}\n`;
  }
  return out;
}

// frontmatter (public interface, always emitted when present) + semantic kind
function emitFrontmatterAndKindMeta(state: StateStore, inc: IncludeFn): string {
  let out = '';
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    out += frontmatterToMermaid(id, state.nodes[id].fm);
  }
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const k = state.nodes[id].kind;
    if (k) out += `%% kind ${id} ${k}\n`;
  }
  return out;
}

// containment: a node living inside a non-group container node (drill-in
// internals). Group membership is emitted as a subgraph below instead.
function emitContainmentMeta(state: StateStore, inc: IncludeFn): string {
  let out = '';
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const p = state.nodes[id].parent;
    if (p && state.nodes[p] && state.nodes[p].shape !== 'group' && inc(p)) out += `%% parent ${id} ${p}\n`;
  }
  return out;
}

function emitEdgeMeta(state: StateStore, inc: IncludeFn): string {
  let out = '';
  for (const e of state.edges) {
    if (!inc(e.from) || !inc(e.to)) continue;
    if (e.routing === 'ortho') out += `%% edge ${e.id} ortho\n`;
    if (e.bend) out += `%% edge ${e.id} bend ${Math.round(e.bend.x)} ${Math.round(e.bend.y)}\n`;
    if (e.labelPos) out += `%% edge ${e.id} labelpos ${Math.round(e.labelPos.x)} ${Math.round(e.labelPos.y)}\n`;
  }
  return out;
}

// layout roots (Tidy entry nodes) — only those still present — then reading-mode
// grouping: declarations first (sorted), then memberships (sorted)
function emitRootAndGroupMeta(state: StateStore, inc: IncludeFn): string {
  let out = '';
  for (const id of state.roots) {
    if (state.nodes[id] && inc(id)) out += `%% root ${id}\n`;
  }
  for (const gid of Object.keys(state.hier.groups).sort()) {
    const g = state.hier.groups[gid];
    out += `%% group ${gid} "${escM(g.label)}"${g.parent ? ` parent ${g.parent}` : ''}\n`;
  }
  for (const nid of Object.keys(state.hier.memberOf).sort()) {
    if (state.nodes[nid] && inc(nid)) out += `%% group-member ${state.hier.memberOf[nid]} ${nid}\n`;
  }
  return out;
}

// group membership from structural parent (containment already resolved to a group node)
function computeStructuralGroups(state: StateStore, inc: IncludeFn): Record<string, string> {
  const inGroup: Record<string, string> = {};
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const p = state.nodes[id].parent;
    if (p && state.nodes[p]?.shape === 'group' && inc(p)) inGroup[id] = p;
  }
  return inGroup;
}

// assign every ungrouped node fully inside this group's bounds to it
function assignNodeToGroupByGeometry(state: StateStore, inc: IncludeFn, groupId: string, inGroup: Record<string, string>): void {
  const g = state.nodes[groupId];
  for (const oid in state.nodes) {
    if (!inc(oid)) continue;
    if (oid === groupId || inGroup[oid] || state.nodes[oid].shape === 'group') continue;
    const o = state.nodes[oid];
    if (o.x >= g.x && o.y >= g.y && o.x + o.w <= g.x + g.w && o.y + o.h <= g.y + g.h) inGroup[oid] = groupId;
  }
}

// geometry fallback: a node fully inside a group's bounds joins it, unless already assigned
function addGeometryFallbackGroups(state: StateStore, inc: IncludeFn, inGroup: Record<string, string>): void {
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    if (state.nodes[id].shape !== 'group') continue;
    assignNodeToGroupByGeometry(state, inc, id, inGroup);
  }
}

// group membership: structural parent first, geometry as fallback
function computeInGroup(state: StateStore, inc: IncludeFn): Record<string, string> {
  const inGroup = computeStructuralGroups(state, inc);
  addGeometryFallbackGroups(state, inc, inGroup);
  return inGroup;
}

// emit groups with children, then loose nodes
function emitGroupedNodes(state: StateStore, inc: IncludeFn, inGroup: Record<string, string>): string {
  let out = '';
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const n = state.nodes[id];
    if (n.shape !== 'group') continue;
    out += `  subgraph ${id} ["${escM(n.label)}"]\n`;
    for (const oid in inGroup) {
      if (inGroup[oid] === id) out += '    ' + shapeWrap[state.nodes[oid].shape](oid, escM(state.nodes[oid].label)) + '\n';
    }
    out += '  end\n';
  }
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const n = state.nodes[id];
    if (n.shape === 'group' || inGroup[id]) continue;
    out += '  ' + shapeWrap[n.shape](id, escM(n.label)) + '\n';
  }
  return out;
}

// edges
function emitEdges(state: StateStore, inc: IncludeFn): string {
  let out = '';
  for (const e of state.edges) {
    if (!inc(e.from) || !inc(e.to)) continue;
    const arrow = STYLES[e.style] || '-->';
    let conn = arrow;
    if (e.label) {
      conn = e.style === 'dotted' ? `-.->|${escM(e.label)}|`
        : e.style === 'thick' ? `==>|${escM(e.label)}|`
          : `-->|${escM(e.label)}|`;
    }
    out += `  ${e.from} ${conn} ${e.to}\n`;
  }
  return out;
}

// Set up the Mermaid text <-> live-model bridge for one app context.
export function initMermaid(ctx: AppContext, selection: SelectionApi): MermaidApi {
  const { state } = ctx;
  const { mmd } = ctx.dom;

  function toMermaid(opts: { only?: Set<string> } = {}): string {
    const keep = opts.only;
    const inc: IncludeFn = (id) => !keep || keep.has(id);
    let out = `flowchart ${state.dir}\n`;
    out += emitLayoutMeta(state, inc);
    out += emitFrontmatterAndKindMeta(state, inc);
    out += emitContainmentMeta(state, inc);
    out += emitEdgeMeta(state, inc);
    out += emitRootAndGroupMeta(state, inc);
    const inGroup = computeInGroup(state, inc);
    out += emitGroupedNodes(state, inc, inGroup);
    out += emitEdges(state, inc);
    return out;
  }

  function sync(): void { mmd.value = toMermaid(); }

  function applyText(): void {
    try {
      const r = fromMermaid(mmd.value);
      if (!Object.keys(r.nodes).length) { ctx.hooks.toast('No nodes parsed'); return; }
      state.nodes = r.nodes; state.edges = r.edges; state.nid = r.nextN; state.eid = r.nextE; state.dir = r.dir; state.roots = r.roots; state.hier = r.hier;
      selection.clearSel(); ctx.hooks.render(); sync(); ctx.hooks.pushHistory();
      ctx.hooks.toast('Applied');
    } catch { ctx.hooks.toast('Parse error'); }
  }

  return { toMermaid, sync, applyText };
}
