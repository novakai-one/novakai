import type { Plan } from './__types.generated';

// @flowmap-node plan__normalizePlan kind=function
/** coerce loaded JSON into a valid Plan, dropping malformed changes */
export function normalizePlan(_raw: unknown): Plan {
  throw new Error('unimplemented');
}
