import type { ViewSpec } from './__types.generated';

// @novakai-node viewspec__normalizeViewSpec kind=function
/** tolerant schema boundary: coerce unknown JSON (a full v1 spec, the legacy expanded/hidden/layers shape, or garbage) into a valid ViewSpec field-by-field; a known-id list confines the spec to a real model; idempotent on a valid spec */
export function normalizeViewSpec(_raw: unknown, _known: string[] | null): ViewSpec {
  throw new Error('unimplemented');
}
