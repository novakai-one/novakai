import type { LiftEdge, LiftSpec, LiftedWire } from './__types.generated';

// @novakai-node unfold__ufLiftWires kind=function
/** pure wire-picture decision for the primary surface: every wire lifts to sibling anchors under the lowest common container (never crossing a foreign boundary), concealed endpoints counted for the badge; the lowest selected point sets the travel depth — a selected leaf reveals true wires (atomic, arrowed, hot), a selected container anchors its crossing wires at its own border (hot), a selected wire explodes into its underlying relations; opposite directions merge (weight-majority orientation) since arrowheads exist only on atomic reveals */
export function ufLiftWires(_edges: LiftEdge[], _spec: LiftSpec): LiftedWire[] {
  throw new Error('unimplemented');
}
