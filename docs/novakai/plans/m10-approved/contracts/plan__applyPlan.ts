import type { DiagramEdge, DiagramNode, Plan } from './__types.generated';

// @novakai-node plan__applyPlan kind=function
/** apply a plan's accepted changes to a base model, producing the proposed model that serialises to the approved spec (Phase 1c bridge) */
export function applyPlan(_base: { nodes: Record<string, DiagramNode>; edges: DiagramEdge[] }, _plan: Plan, _accepted: (changeId: string) => boolean): { nodes: Record<string, DiagramNode>; edges: DiagramEdge[] } {
  throw new Error('unimplemented');
}
