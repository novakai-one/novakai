import type { Plan, PlanChange } from './__types.generated';

// @novakai-node plan__indexByRef kind=function
/** index changes by their target ref (node id or edgeKey); one change per ref */
export function indexByRef(_plan: Plan): Record<string, PlanChange> {
  throw new Error('unimplemented');
}
