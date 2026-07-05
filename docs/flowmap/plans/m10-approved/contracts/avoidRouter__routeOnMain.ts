import type { ElkGraph } from './__types.generated';

// @flowmap-node avoidRouter__routeOnMain kind=function
/** main-thread routing fallback, tagging each route with the request-time signature */
export function routeOnMain(_graph: ElkGraph, _scope: Set<string> | null, _sig: string): Promise<void> {
  throw new Error('unimplemented');
}
