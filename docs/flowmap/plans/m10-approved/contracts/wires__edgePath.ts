import type { DiagramEdge, DiagramNode } from './__types.generated';

// @flowmap-node wires__edgePath kind=function
/** geometry for one edge: manual bend, else cached avoid-route, else elbow */
export function edgePath(_e: DiagramEdge, _a: DiagramNode, _b: DiagramNode, _sig: string): string {
  throw new Error('unimplemented');
}
