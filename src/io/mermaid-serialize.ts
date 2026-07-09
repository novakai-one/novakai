/* =====================================================================
   mermaid-serialize.ts — model -> Mermaid text (see mermaid.ts header)
   ---------------------------------------------------------------------
   Serializes the model to Mermaid flowchart text with %% fm layout
   metadata so positions round-trip. Split out of mermaid.ts to keep each
   module under the size cap; wired into toMermaid there.
   ===================================================================== */

import type { ShapeKind } from '../core/types/types';
import type { StateStore } from '../core/state/state';
import { STYLES, escM } from '../core/config/config';
import { frontmatterToMermaid } from '../core/frontmatter/frontmatter';

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

/** A function that decides whether a node id is included in a (possibly filtered) render. */
export type IncludeFn = (id: string) => boolean;

// layout metadata first
export function emitLayoutMeta(state: StateStore, inc: IncludeFn): string {
  let out = '';
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const n = state.nodes[id];
    out += `%% fm ${id} ${Math.round(n.x)} ${Math.round(n.y)} ${Math.round(n.w)} ${Math.round(n.h)} ${n.shape} ${n.color}\n`;
  }
  return out;
}

// frontmatter (public interface, always emitted when present) + semantic kind
export function emitFrontmatterAndKindMeta(state: StateStore, inc: IncludeFn): string {
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
export function emitContainmentMeta(state: StateStore, inc: IncludeFn): string {
  let out = '';
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const p = state.nodes[id].parent;
    if (p && state.nodes[p] && state.nodes[p].shape !== 'group' && inc(p)) out += `%% parent ${id} ${p}\n`;
  }
  return out;
}

export function emitEdgeMeta(state: StateStore, inc: IncludeFn): string {
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
export function emitRootAndGroupMeta(state: StateStore, inc: IncludeFn): string {
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
export function computeInGroup(state: StateStore, inc: IncludeFn): Record<string, string> {
  const inGroup = computeStructuralGroups(state, inc);
  addGeometryFallbackGroups(state, inc, inGroup);
  return inGroup;
}

// emit groups with children, then loose nodes
export function emitGroupedNodes(state: StateStore, inc: IncludeFn, inGroup: Record<string, string>): string {
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
export function emitEdges(state: StateStore, inc: IncludeFn): string {
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
