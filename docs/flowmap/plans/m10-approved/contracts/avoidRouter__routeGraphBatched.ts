import type { ElkGraph, Point } from './__types.generated';

// @flowmap-node avoidRouter__routeGraphBatched kind=function
/** route the graph edges in fixed-size batches to keep libavoid off its pathological path */
export function routeGraphBatched(_graph: ElkGraph): Promise<{ id: string; poly: Point[] }[]> {
  throw new Error('unimplemented');
}
