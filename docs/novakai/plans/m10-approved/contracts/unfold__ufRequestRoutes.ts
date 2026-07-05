import type { Box, LiftedWire } from './__types.generated';

// @novakai-node unfold__ufRequestRoutes kind=function
/** obstacle-avoided routes for the lifted wire picture via the shared libavoid worker (render/avoidRouter routeGraph), one call per containment scope: sibling cards AND group boxes are the obstacles for that scope's lifted wires, while atomic reveals route against cards only; elbows paint first, routed polylines upgrade in place; a layout signature drops stale replies */
export function requestRoutes(_pos: Record<string, Box>, _wires: LiftedWire[]): void {
  throw new Error('unimplemented');
}
