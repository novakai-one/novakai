import type { DiagramEdge, Issue, NodeMap } from './__types.generated';

// @flowmap-node validate__semanticDiff kind=function
/** semantic round-trip diff: nodes by id and edges by identity must survive serialize-parse */
export function semanticDiff(_before: { nodes: NodeMap; edges: DiagramEdge[] }, _after: { nodes: NodeMap; edges: DiagramEdge[] }): Issue[] {
  throw new Error('unimplemented');
}
