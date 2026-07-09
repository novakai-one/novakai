/* =====================================================================
   diff.ts — compare two parsed diagram models
   ---------------------------------------------------------------------
   Responsibility: given a "before" and "after" model (each from
   io/mermaid.ts fromMermaid), compute the semantic delta — which nodes
   were added/removed/changed and which edges added/removed. Pure: no DOM,
   no state writes. The single source of truth for "what does this
   proposal change".

   Identity rules (deliberate, see BUILD_PLAN_DIFF_WORKSPACE.md):
     - Node identity   = node id.
     - Node "changed"  = same id, different label | shape | kind | fm.
                         Position (x/y/w/h) is layout, NOT a semantic change.
     - Edge identity   = "from->to:style". Edge .id (e1/e2..) is volatile
                         across a re-paste, so it is NOT used as the key.
   ===================================================================== */

import type { DiagramNode, DiagramEdge, Frontmatter } from '../types/types';

/** Minimal shape this module needs from a parsed model. */
export interface DiffInput {
  nodes: Record<string, DiagramNode>;
  edges: DiagramEdge[];
}

export interface NodeChange {
  id: string;
  field: string;   // which attribute differs (label | shape | kind | fm)
  before: string;
  after: string;
}

export interface MmdDiff {
  addedNodes: string[];
  removedNodes: string[];
  changedNodes: NodeChange[];
  addedEdges: string[];     // "from->to:style"
  removedEdges: string[];
  counts: {
    nAdd: number; nRem: number; nChg: number;
    eAdd: number; eRem: number;
    nUnchanged: number; eUnchanged: number;
  };
}

/** Stable edge key. Volatile .id is intentionally excluded. */
export function edgeKey(e: DiagramEdge): string {
  return `${e.from}->${e.to}:${e.style}`;
}

/** Stable frontmatter signature for change detection. */
function fmSig(frontmatter?: Frontmatter): string {
  if (!frontmatter) return '';
  const ifaces = (frontmatter.interfaces ?? [])
    .map((i) => `${i.name}(${(i.accepts ?? []).join(',')})->(${(i.returns ?? []).join(',')})`)
    .join('|');
  return `${frontmatter.name}\u00a7${frontmatter.description}\u00a7`
    + `${(frontmatter.state ?? []).join(',')}\u00a7${ifaces}`;
}

/** Added/removed node ids, plus the lookups the changed-node pass needs. */
function diffNodeSets(before: DiffInput, after: DiffInput) {
  const beforeIds = Object.keys(before.nodes), afterIds = Object.keys(after.nodes);
  const beforeSet = new Set(beforeIds), afterSet = new Set(afterIds);
  const addedNodes = afterIds.filter((id) => !beforeSet.has(id)).sort();
  const removedNodes = beforeIds.filter((id) => !afterSet.has(id)).sort();
  return { addedNodes, removedNodes, beforeSet, afterIds };
}

/** Which fields differ between one node pair. */
function diffNodeFields(id: string, beforeNode: DiagramNode, afterNode: DiagramNode): NodeChange[] {
  const fields: [string, string, string][] = [
    ['label', beforeNode.label ?? '', afterNode.label ?? ''],
    ['shape', beforeNode.shape ?? '', afterNode.shape ?? ''],
    ['kind', (beforeNode.kind ?? '') as string, (afterNode.kind ?? '') as string],
    ['fm', fmSig(beforeNode.fm), fmSig(afterNode.fm)],
  ];
  return fields
    .filter(([, beforeValue, afterValue]) => beforeValue !== afterValue)
    .map(([field, beforeValue, afterValue]) => ({ id, field, before: beforeValue, after: afterValue }));
}

/** Which fields differ, id-by-id, for nodes present on both sides. */
function diffChangedNodes(
  before: DiffInput, after: DiffInput, afterIds: string[], beforeSet: Set<string>,
): { changedNodes: NodeChange[]; nUnchanged: number } {
  const changedNodes: NodeChange[] = [];
  let nUnchanged = 0;
  for (const id of afterIds) {
    if (!beforeSet.has(id)) continue;           // added, handled separately
    const fieldChanges = diffNodeFields(id, before.nodes[id], after.nodes[id]);
    if (fieldChanges.length === 0) {
      nUnchanged++;
    } else {
      changedNodes.push(...fieldChanges);
    }
  }
  changedNodes.sort((x, y) => x.id.localeCompare(y.id) || x.field.localeCompare(y.field));
  return { changedNodes, nUnchanged };
}

/** Key every edge by its stable identity. */
function buildEdgeMap(edges: DiagramEdge[]): Map<string, DiagramEdge> {
  const map = new Map<string, DiagramEdge>();
  for (const edge of edges) map.set(edgeKey(edge), edge);
  return map;
}

/** Added/removed edges by stable key. */
function diffEdgeSets(before: DiffInput, after: DiffInput) {
  const beforeEdges = buildEdgeMap(before.edges);
  const afterEdges = buildEdgeMap(after.edges);
  const addedEdges = [...afterEdges.keys()].filter((key) => !beforeEdges.has(key)).sort();
  const removedEdges = [...beforeEdges.keys()].filter((key) => !afterEdges.has(key)).sort();
  const eUnchanged = [...afterEdges.keys()].filter((key) => beforeEdges.has(key)).length;
  return { addedEdges, removedEdges, eUnchanged };
}

/** Compare two models. Pure. */
export function diffModels(before: DiffInput, after: DiffInput): MmdDiff {
  const { addedNodes, removedNodes, beforeSet, afterIds } = diffNodeSets(before, after);
  const { changedNodes, nUnchanged } = diffChangedNodes(before, after, afterIds, beforeSet);
  const { addedEdges, removedEdges, eUnchanged } = diffEdgeSets(before, after);

  return {
    addedNodes, removedNodes, changedNodes, addedEdges, removedEdges,
    counts: {
      nAdd: addedNodes.length,
      nRem: removedNodes.length,
      nChg: new Set(changedNodes.map((change) => change.id)).size,
      eAdd: addedEdges.length,
      eRem: removedEdges.length,
      nUnchanged,
      eUnchanged,
    },
  };
}
