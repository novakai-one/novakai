import type { DiagramEdge } from './__types.generated';

// @flowmap-node diff__edgeKey kind=function
/** stable edge identity from source, target and style, ignoring the volatile id */
export function edgeKey(_e: DiagramEdge): string {
  throw new Error('unimplemented');
}
