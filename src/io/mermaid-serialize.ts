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
const shapeWrap: Record<ShapeKind, (id: string, label: string) => string> = {
  rect: (id, label) => `${id}["${label}"]`,
  round: (id, label) => `${id}("${label}")`,
  stadium: (id, label) => `${id}(["${label}"])`,
  cylinder: (id, label) => `${id}[("${label}")]`,
  diamond: (id, label) => `${id}{"${label}"}`,
  circle: (id, label) => `${id}(("${label}"))`,
  hex: (id, label) => `${id}{{"${label}"}}`,
  note: (id, label) => `${id}>"${label}"]`,
  group: (id, label) => `subgraph ${id} ["${label}"]\n  end`,
};

/** A function that decides whether a node id is included in a (possibly filtered) render. */
export type IncludeFn = (id: string) => boolean;

// layout metadata first
export function emitLayoutMeta(state: StateStore, inc: IncludeFn): string {
  let out = '';
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const node = state.nodes[id];
    const size = `${Math.round(node.x)} ${Math.round(node.y)} ${Math.round(node['w'])} ${Math.round(node['h'])}`;
    out += `%% fm ${id} ${size} ${node.shape} ${node.color}\n`;
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
    const parentId = state.nodes[id].parent;
    if (parentId && state.nodes[parentId] && state.nodes[parentId].shape !== 'group' && inc(parentId)) {
      out += `%% parent ${id} ${parentId}\n`;
    }
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
    const group = state.hier.groups[gid];
    const parentPart = group.parent ? ` parent ${group.parent}` : '';
    out += `%% group ${gid} "${escM(group.label)}"${parentPart}\n`;
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
    const parentId = state.nodes[id].parent;
    if (parentId && state.nodes[parentId]?.shape === 'group' && inc(parentId)) inGroup[id] = parentId;
  }
  return inGroup;
}

// assign every ungrouped node fully inside this group's bounds to it
function assignNodeToGroupByGeometry(
  state: StateStore, inc: IncludeFn, groupId: string, inGroup: Record<string, string>,
): void {
  const group = state.nodes[groupId];
  for (const oid in state.nodes) {
    if (!inc(oid)) continue;
    if (oid === groupId || inGroup[oid] || state.nodes[oid].shape === 'group') continue;
    const other = state.nodes[oid];
    const fits = other.x >= group.x && other.y >= group.y
      && other.x + other['w'] <= group.x + group['w'] && other.y + other['h'] <= group.y + group['h'];
    if (fits) inGroup[oid] = groupId;
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

// emit a `subgraph ... end` block per group, with its member nodes indented inside
function emitGroupSubgraphs(state: StateStore, inc: IncludeFn, inGroup: Record<string, string>): string {
  let out = '';
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const node = state.nodes[id];
    if (node.shape !== 'group') continue;
    out += `  subgraph ${id} ["${escM(node.label)}"]\n`;
    for (const oid in inGroup) {
      if (inGroup[oid] !== id) continue;
      const member = state.nodes[oid];
      out += '    ' + shapeWrap[member.shape](oid, escM(member.label)) + '\n';
    }
    out += '  end\n';
  }
  return out;
}

// emit nodes that belong to no group, one Mermaid shape line each
function emitLooseNodes(state: StateStore, inc: IncludeFn, inGroup: Record<string, string>): string {
  let out = '';
  for (const id in state.nodes) {
    if (!inc(id)) continue;
    const node = state.nodes[id];
    if (node.shape === 'group' || inGroup[id]) continue;
    out += '  ' + shapeWrap[node.shape](id, escM(node.label)) + '\n';
  }
  return out;
}

// emit groups with children, then loose nodes
export function emitGroupedNodes(state: StateStore, inc: IncludeFn, inGroup: Record<string, string>): string {
  return emitGroupSubgraphs(state, inc, inGroup) + emitLooseNodes(state, inc, inGroup);
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
