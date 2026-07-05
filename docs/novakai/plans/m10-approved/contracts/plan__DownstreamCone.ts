import type { DiagramEdge, DownstreamCone } from './__types.generated';

// @novakai-node plan__downstreamCone kind=function
/** transitive downstream cone of a node change: every node that consumes ref, BFS backward over the edge list */
export function downstreamCone(_edges: DiagramEdge[], _ref: string, _opts: { roots?: string[]; maxDepth?: number }): DownstreamCone {
  throw new Error('unimplemented');
}
