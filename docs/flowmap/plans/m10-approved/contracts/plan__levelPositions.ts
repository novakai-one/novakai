import type { PlanLayoutNode } from './__types.generated';

// @flowmap-node plan__levelPositions kind=function
/** D1 layout fidelity — real nodes render at their verbatim ctx.state position; only synth add-nodes get a computed slot */
export function levelPositions(_nodes: PlanLayoutNode[]): Record<string, { x: number; y: number }> {
  throw new Error('unimplemented');
}
