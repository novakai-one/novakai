import type { DiagramEdge, Issue, NodeMap } from './__types.generated';

// @novakai-node validate__validateModel kind=function
/** structural integrity of one model: self-parent, dangling parent, cycles, orphan edges */
export function validateModel(_nodes: NodeMap, _edges: DiagramEdge[]): Issue[] {
  throw new Error('unimplemented');
}
