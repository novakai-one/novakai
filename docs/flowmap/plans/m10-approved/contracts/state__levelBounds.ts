import type { StateStore } from './__types.generated';

// @flowmap-node state__levelBounds kind=function
/** bounding box of just the nodes at a container level, or null when empty */
export function levelBounds(_state: StateStore, _container: string | null): { minX: number; minY: number; maxX: number; maxY: number } | null {
  throw new Error('unimplemented');
}
