import type { DiagramEdge, DiagramNode } from './__types.generated';

// @novakai-node state__StateStore kind=type
/** source-of-truth model: nodes, edges, selection, id counters, dir, roots, measured cards */
export interface StateStore {
  nodes: Record<string, DiagramNode>;
  edges: DiagramEdge[];
  sel: Set<string>;
  roots: string[];
}
