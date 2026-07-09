/* =====================================================================
   plan-apply.ts — apply an accepted plan onto a base model (pure)
   ---------------------------------------------------------------------
   The bridge from a reviewed plan to an enforceable artifact: clone a
   base model and land its accepted changes, producing the PROPOSED model
   the build is contracted against. Split out of plan.ts; re-exported
   from it.

   Pure module: clones, never mutates base. No DOM.
   ===================================================================== */

import type { DiagramEdge, DiagramNode } from '../types/types';
import type { Plan, PlanChange } from './plan-shapes';
import { synthNode } from './plan-analysis';

/** Land a node-target change (add/modify/remove) onto `nodes`; returns the resulting edges. */
function applyNodeChange(
  nodes: Record<string, DiagramNode>,
  edges: DiagramEdge[],
  change: PlanChange,
): DiagramEdge[] {
  if (change.status === 'remove') {
    delete nodes[change.target.ref];
    return edges.filter((edge) => edge.from !== change.target.ref && edge.to !== change.target.ref);
  }
  if (change.status === 'add') {
    const synth = synthNode(change);
    if (synth) nodes[synth.id] = synth;
    return edges;
  }
  if (change.status === 'modify') {
    const node = nodes[change.target.ref];
    if (node && change.fm) node['fm'] = change.fm;
  }
  return edges;
}

/** Append an edge-add change onto `edges`, skipping an exact style-duplicate. */
function applyEdgeAdd(edges: DiagramEdge[], change: PlanChange, nextEdgeId: () => string): DiagramEdge[] {
  const newEdge = change.newEdge;
  if (!newEdge) return edges;
  const style = newEdge.style ?? 'solid';
  const isDup = edges.some((edge) => edge.from === newEdge.from && edge.to === newEdge.to && edge.style === style);
  if (isDup) return edges;
  return [...edges, {
    id: nextEdgeId(), from: newEdge.from, 'to': newEdge.to,
    label: newEdge.label ?? '', style, routing: 'straight',
  }];
}

/** Drop an edge-remove change's targeted edge (identified by its "from->to:style" ref). */
function applyEdgeRemove(edges: DiagramEdge[], change: PlanChange): DiagramEdge[] {
  const [fromTo, style] = change.target.ref.split(':');
  const [from, toId] = fromTo.split('->');
  return edges.filter((edge) => !(edge.from === from && edge.to === toId && edge.style === style));
}

/** Land an edge-target change (add/remove) onto `edges`. */
function applyEdgeChange(edges: DiagramEdge[], change: PlanChange, nextEdgeId: () => string): DiagramEdge[] {
  if (change.status === 'add') return applyEdgeAdd(edges, change, nextEdgeId);
  if (change.status === 'remove') return applyEdgeRemove(edges, change);
  return edges;
}

/**
 * Apply the accepted changes of a plan to a base model, producing the PROPOSED
 * model — the spec the build is contracted against. This is the bridge from a
 * reviewed plan to an enforceable artifact (Phase 1c): the result serialises to
 * the approved `.mmd`, which spec-to-stubs + gate then enforce.
 *
 * Rules: `add` introduces synth nodes / new edges (carrying any proposed fm);
 * `modify` rewrites a node's fm when the change supplies one (structure is
 * unchanged otherwise); `remove` drops the node + its incident edges, or the
 * targeted edge. `accepted(id)` decides which changes land (so the same function
 * serves "preview all" and "export only accepted"). Pure: clones, never mutates base.
 */
export function applyPlan(
  base: { nodes: Record<string, DiagramNode>; edges: DiagramEdge[] },
  plan: Plan,
  accepted: (changeId: string) => boolean,
): { nodes: Record<string, DiagramNode>; edges: DiagramEdge[] } {
  const nodes: Record<string, DiagramNode> = {};
  for (const id in base.nodes) nodes[id] = { ...base.nodes[id] };
  let edges = base.edges.map((edge) => ({ ...edge }));
  let eSeq = 0;
  const nextEdgeId = () => 'eP' + (++eSeq);

  for (const change of plan.changes) {
    if (!accepted(change.id)) continue;
    edges = change.target.kind === 'node'
      ? applyNodeChange(nodes, edges, change)
      : applyEdgeChange(edges, change, nextEdgeId);
  }
  return { nodes, edges };
}
