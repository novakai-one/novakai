import type { DiagramNode, PlanChange } from './__types.generated';

// @flowmap-node plan__synthNode kind=function
/** synthesize a DiagramNode for an add-node change (lives only in the planner view) */
export function synthNode(_c: PlanChange): DiagramNode | null {
  throw new Error('unimplemented');
}
