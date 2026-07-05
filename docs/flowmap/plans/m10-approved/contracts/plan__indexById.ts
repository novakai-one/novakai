import type { Plan, PlanChange } from './__types.generated';

// @flowmap-node plan__indexById kind=function
/** index changes by their own change id */
export function indexById(_plan: Plan): Record<string, PlanChange> {
  throw new Error('unimplemented');
}
