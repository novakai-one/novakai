import type { AdhocEdge, AdhocRect, RoutedPoly } from './__types.generated';

// @novakai-node avoidRouter__routeGraph kind=function
/** ad-hoc routing for other surfaces (reading mode): same worker and wasm, promise-based, outside the ctx cache; resolves [] on failure so elbows stay */
export function routeGraph(_rects: AdhocRect[], _edges: AdhocEdge[]): Promise<RoutedPoly[]> {
  throw new Error('unimplemented');
}
