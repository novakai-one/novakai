import type { AppContext } from './__types.generated';

// @flowmap-node wires__initWires kind=function
/** build the edge renderer: drawWires plus the live-drag scoped updater */
export function initWires(_ctx: AppContext): { drawWires: () => void; updateWiresFor: (movedIds: Set<string>) => void } {
  throw new Error('unimplemented');
}
