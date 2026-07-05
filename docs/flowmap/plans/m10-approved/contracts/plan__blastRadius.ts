import type { DiagramEdge } from './__types.generated';

// @flowmap-node plan__blastRadius kind=function
/** who consumes a node (callers, at-risk) and what it depends on, from the real edge list */
export function blastRadius(_edges: DiagramEdge[], _ref: string): { consumers: string[]; dependencies: string[] } {
  throw new Error('unimplemented');
}
