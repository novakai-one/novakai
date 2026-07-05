import type { DiagramEdge } from './__types.generated';

// @flowmap-node validate__edgeIdentities kind=function
/** stable content-derived identity per edge (from, to, style) for diff/merge matching */
export function edgeIdentities(_edges: DiagramEdge[]): Map<string, string> {
  throw new Error('unimplemented');
}
