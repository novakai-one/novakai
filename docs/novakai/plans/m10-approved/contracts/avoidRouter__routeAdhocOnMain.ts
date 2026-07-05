import type { ElkGraph, RoutedPoly } from './__types.generated';

// @novakai-node avoidRouter__routeAdhocOnMain kind=function
/** main-thread fallback for an ad-hoc request; resolves [] on failure, never throws to the caller */
export function routeAdhocOnMain(_graph: ElkGraph): Promise<RoutedPoly[]> {
  throw new Error('unimplemented');
}
