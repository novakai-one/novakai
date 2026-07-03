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
import type { DiagramNode, DiagramEdge, ShapeKind, FlowDir, Point, Hier } from '../core/types/types';
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

/** Parse Mermaid text into a model fragment. Pure. */
export function fromMermaid(text: string): ParseResult {
  const nodes: Record<string, DiagramNode> = {};
  const edges: DiagramEdge[] = [];
  const meta: Record<string, { x: number; y: number; w: number; h: number; shape: ShapeKind; color: string | null }> = {};
  const orthoSet = new Set<string>();
  const bendMap = new Map<string, Point>();
  const labelPosMap = new Map<string, Point>();
  const roots: string[] = [];
  const hier: Hier = { groups: {}, memberOf: {} };
  const groupStack: string[] = [];
  const fmAcc: Record<string, import('../core/types/types').Frontmatter> = {};
  const kindMap = new Map<string, import('../core/types/types').NodeKind>();
  const parentMap = new Map<string, string>();
  let maxN = 0, maxE = 0;
  let dir: FlowDir = 'TD';

  const bumpN = (id: string): void => { const n = +id.replace(/\D/g, ''); if (n > maxN) maxN = n; };
  const ensure = (id: string, label?: string, shape?: ShapeKind): void => {
    bumpN(id);
    if (!nodes[id]) {
      nodes[id] = { id, label: label ?? id, shape: shape ?? 'rect', color: PALETTE[0], x: 0, y: 0, w: 0, h: 0 };
    } else if (label) {
      nodes[id].label = label;
      if (shape) nodes[id].shape = shape;
    }
    if (groupStack.length) nodes[id].parent = groupStack[groupStack.length - 1];
  };

  text.split('\n').forEach((raw) => {
    const t = raw.trim();
    let m: RegExpMatchArray | null;

    if ((m = t.match(/^%% fm (\w+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\w+) (#?\w+)/))) {
      meta[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5], shape: m[6] as ShapeKind, color: m[7] === 'null' ? null : m[7] };
      bumpN(m[1]); return;
    }
    const fmLine = matchFrontmatterLine(t);
    if (fmLine) { applyFrontmatterLine(fmAcc, fmLine); bumpN(fmLine.id); return; }
    if ((m = t.match(/^%% edge (\w+) ortho/))) { orthoSet.add(m[1]); return; }
    if ((m = t.match(/^%% edge (\w+) bend (-?\d+) (-?\d+)/))) { bendMap.set(m[1], { x: +m[2], y: +m[3] }); return; }
    if ((m = t.match(/^%% edge (\w+) labelpos (-?\d+) (-?\d+)/))) { labelPosMap.set(m[1], { x: +m[2], y: +m[3] }); return; }
    if ((m = t.match(/^%% root (\w+)/))) { roots.push(m[1]); bumpN(m[1]); return; }
    if (parseGroupDirective(t, hier)) return;
    if ((m = t.match(/^%% kind (\w+) (\w+)/))) { kindMap.set(m[1], m[2] as import('../core/types/types').NodeKind); bumpN(m[1]); return; }
    if ((m = t.match(/^%% parent (\w+) (\w+)/))) { parentMap.set(m[1], m[2]); bumpN(m[1]); bumpN(m[2]); return; }
    if ((m = t.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i))) {
      const d = m[1].toUpperCase();
      dir = d === 'TB' ? 'TD' : (d as FlowDir);
      return;
    }
    if (t === 'end') { groupStack.pop(); return; }
    if (t.startsWith('%%') || /^(flowchart|graph)\b/.test(t)) return;

    if ((m = t.match(/^subgraph\s+(\w+)\s*\["?([^"\]]*)"?\]/))) { ensure(m[1], m[2], 'group'); groupStack.push(m[1]); return; }
    if ((m = t.match(/^(\w+)\(\["?([^"\)]*)"?\]\)/))) { ensure(m[1], m[2], 'stadium'); return; }
    if ((m = t.match(/^(\w+)\[\("?([^"\)]*)"?\)\]/))) { ensure(m[1], m[2], 'cylinder'); return; }
    if ((m = t.match(/^(\w+)\{\{"?([^"\}]*)"?\}\}/))) { ensure(m[1], m[2], 'hex'); return; }
    if ((m = t.match(/^(\w+)\(\("?([^"\)]*)"?\)\)/))) { ensure(m[1], m[2], 'circle'); return; }
    if ((m = t.match(/^(\w+)\{"?([^"\}]*)"?\}/))) { ensure(m[1], m[2], 'diamond'); return; }
    if ((m = t.match(/^(\w+)>"?([^"\]]*)"?\]/))) { ensure(m[1], m[2], 'note'); return; }
    if ((m = t.match(/^(\w+)\("?([^"\)]*)"?\)/))) { ensure(m[1], m[2], 'round'); return; }
    if ((m = t.match(/^(\w+)\["?([^"\]]*)"?\]/))) { ensure(m[1], m[2], 'rect'); return; }

    const em = t.match(/^(\w+)\s*(-\.->|==>|-->|---)\s*(?:\|([^|]*)\|)?\s*(\w+)/);
    if (em) {
      ensure(em[1]); ensure(em[4]);
      const style = em[2] === '-.->' ? 'dotted' : em[2] === '==>' ? 'thick' : 'solid';
      edges.push({ id: 'e' + (++maxE), from: em[1], to: em[4], label: (em[3] || '').trim(), style, routing: 'straight' });
    }
  });

  // apply metadata or auto-place
  let auto = 0;
  for (const id in nodes) {
    const n = nodes[id], md = meta[id];
    if (md) { Object.assign(n, md); }
    else {
      const d = DEFAULTS[n.shape] || DEFAULTS.rect;
      n.w = d.w; n.h = d.h;
      n.x = 80 + (auto % 4) * 200; n.y = 80 + Math.floor(auto / 4) * 130; auto++;
    }
    // attach frontmatter if any non-empty was parsed for this node
    if (fmAcc[id] && !isFrontmatterEmpty(fmAcc[id])) n.fm = fmAcc[id];
    // attach semantic kind if declared
    const k = kindMap.get(id);
    if (k) n.kind = k;
  }
  // apply containment (non-group parents) after all nodes exist
  parentMap.forEach((p, c) => { if (nodes[c] && nodes[p]) nodes[c].parent = p; });
  edges.forEach((e) => { if (orthoSet.has(e.id)) e.routing = 'ortho'; });
  edges.forEach((e) => {
    const bp = bendMap.get(e.id); if (bp) e.bend = bp;
    const lp = labelPosMap.get(e.id); if (lp) e.labelPos = lp;
  });
  const liveRoots = roots.filter((id) => nodes[id]);
  // keep only memberships whose node exists and whose group is declared
  for (const nid of Object.keys(hier.memberOf)) {
    if (!nodes[nid] || !hier.groups[hier.memberOf[nid]]) delete hier.memberOf[nid];
  }
  for (const gid of Object.keys(hier.groups)) {
    const p = hier.groups[gid].parent;
    if (p && !hier.groups[p]) hier.groups[gid].parent = null;
  }
  return { nodes, edges, nextN: maxN + 1, nextE: maxE + 1, dir, roots: liveRoots, hier };
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
