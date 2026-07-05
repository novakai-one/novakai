import type { StateStore } from './__types.generated';

// @flowmap-node state__sliceIds kind=function
/** neighbourhood id set of a node: transitive solid up/down plus 1-hop dotted refs (the slice panel's keep set) */
export function sliceIds(_state: StateStore, _id: string): Set<string> {
  throw new Error('unimplemented');
}
