import type { StateStore } from './__types.generated';

// @novakai-node state__worldBounds kind=function
/** bounding box of all nodes in the model, or null when empty */
export function worldBounds(_state: StateStore): { minX: number; minY: number; maxX: number; maxY: number } | null {
  throw new Error('unimplemented');
}
