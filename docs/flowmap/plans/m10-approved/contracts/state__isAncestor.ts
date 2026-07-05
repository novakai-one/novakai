import type { StateStore } from './__types.generated';

// @flowmap-node state__isAncestor kind=function
/** true when anc sits somewhere on a node parent chain (cycle guard) */
export function isAncestor(_state: StateStore, _anc: string, _node: string): boolean {
  throw new Error('unimplemented');
}
