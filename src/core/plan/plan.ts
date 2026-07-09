/* =====================================================================
   plan.ts — the build-plan overlay model (pure)
   ---------------------------------------------------------------------
   Responsibility: define the data shapes for a "build plan" — a set of
   PROPOSED changes (status + intent + phase) keyed onto the REAL diagram.
   This is the metadata-overlay model from prototypes/HANDOFF.md: a plan
   is a small architectural diff (~8-14 changes), NOT a pile of new nodes.
   Most changes MODIFY existing nodes/edges; only genuinely-new capabilities
   are added.

   Crucially this overlay is a SIDECAR. It never touches the Mermaid
   serialisation — the user's .mmd carries zero plan syntax. A change
   targets a real node id, or an edge by its stable identity ("from->to:style",
   the same edgeKey core/diff uses), so edges are first-class with no cost
   to the .mmd grammar.

   Pure module: types + pure helpers only. No DOM, no model writes.

   The model is split across siblings (all re-exported here so this file
   stays the single import surface): plan-shapes (types + emptyPlan /
   normalizePlan), plan-analysis (indexing, blast radius, coherence, synth
   nodes, layout, downstream cone, planFromDiff), plan-apply (applyPlan).
   ===================================================================== */

export type {
  ChangeStatus, Verdict, RiskLevel, ChangeTarget, ChangeIntent,
  NewNodeSpec, NewEdgeSpec, PlanChange, PlanPhase, Plan,
} from './plan-shapes';
export { emptyPlan, normalizePlan } from './plan-shapes';

export type { CoherenceWarning, PlanLayoutNode, ConeNode, DownstreamCone } from './plan-analysis';
export {
  indexByRef, indexById, blastRadius, coherenceWarnings, synthNode,
  levelPositions, downstreamCone, planFromDiff,
} from './plan-analysis';

export { applyPlan } from './plan-apply';
