// @flowmap-node unfold__ufPersistView kind=function
/** the reading session persists per diagram (sorted containment roots as identity) as the full v1 ViewSpec; load goes through normalizeViewSpec and applies the durable trio (expanded/hidden/layers) — a pre-M3 stored entry is a valid subset, migration is branch-free */
export function persistView(_dir: 'save' | 'load'): void {
  throw new Error('unimplemented');
}
