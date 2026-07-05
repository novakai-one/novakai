import type { AppContext, ElkEdge } from './__types.generated';

// @flowmap-node avoidRouter__routableEdges kind=function
/** every non-group, non-manual-bend edge; spine too, so straight lines never cross a card */
export function routableEdges(_ctx: AppContext): ElkEdge[] {
  throw new Error('unimplemented');
}
