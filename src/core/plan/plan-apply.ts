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
import type { Plan } from './plan-shapes';
import { synthNode } from './plan-analysis';

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
  let edges = base.edges.map((e) => ({ ...e }));
  let eSeq = 0;

  for (const c of plan.changes) {
    if (!accepted(c.id)) continue;
    if (c.target.kind === 'node') {
      if (c.status === 'remove') {
        delete nodes[c.target.ref];
        edges = edges.filter((e) => e.from !== c.target.ref && e.to !== c.target.ref);
      } else if (c.status === 'add') {
        const sn = synthNode(c);
        if (sn) nodes[sn.id] = sn;
      } else if (c.status === 'modify') {
        const n = nodes[c.target.ref];
        if (n && c.fm) n.fm = c.fm;
      }
    } else { // edge target
      if (c.status === 'add' && c.newEdge) {
        const style = c.newEdge.style ?? 'solid';
        const dup = edges.some((e) => e.from === c.newEdge!.from && e.to === c.newEdge!.to && e.style === style);
        if (!dup) {
          edges.push({
            id: 'eP' + (++eSeq), from: c.newEdge.from, to: c.newEdge.to,
            label: c.newEdge.label ?? '', style, routing: 'straight',
          });
        }
      } else if (c.status === 'remove') {
        const [ft, style] = c.target.ref.split(':');
        const [from, to] = ft.split('->');
        edges = edges.filter((e) => !(e.from === from && e.to === to && e.style === style));
      }
    }
  }
  return { nodes, edges };
}
