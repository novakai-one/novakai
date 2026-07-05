import type { ViewAction } from './__types.generated';

// @novakai-node unfold__ufCommit kind=function
/** the ONLY view-mutation entry (M3): apply the pure reduceView to the spec, install the result frozen, then paint the per-action render subset — no handler touches view state or the DOM directly */
export function commit(_a: ViewAction): void {
  throw new Error('unimplemented');
}
