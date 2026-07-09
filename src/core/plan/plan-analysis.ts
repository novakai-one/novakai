/* =====================================================================
   plan-analysis.ts — plan analysis + derivation (pure)
   ---------------------------------------------------------------------
   Pure read-only analysis over a Plan and the real diagram: indexing,
   blast radius, coherence checks, synth-node derivation, review-canvas
   layout positions, downstream cones, and deriving a Plan from a raw
   before/after diff. Split out of plan.ts; re-exported from it.

   Pure module: no DOM, no model writes.
   ===================================================================== */

import type { EdgeStyle, DiagramEdge, DiagramNode } from '../types/types';
import { diffModels, type DiffInput } from '../diff/diff';
import type { Plan, PlanChange, Verdict } from './plan-shapes';

/** Index changes by their target ref (node id or edgeKey). One change per ref. */
export function indexByRef(plan: Plan): Record<string, PlanChange> {
  const idx: Record<string, PlanChange> = {};
  for (const c of plan.changes) idx[c.target.ref] = c;
  return idx;
}

/** Index changes by their own change id. */
export function indexById(plan: Plan): Record<string, PlanChange> {
  const idx: Record<string, PlanChange> = {};
  for (const c of plan.changes) idx[c.id] = c;
  return idx;
}

/**
 * Blast radius of a node change: who consumes it (edges INTO ref = callers,
 * the at-risk set) and what it depends on (edges OUT of ref = callees).
 * Pure: computed from the real edge list. This is the "what untouched code
 * does this change ripple into" the reviewer needs and prose plans hide.
 */
export function blastRadius(edges: DiagramEdge[], ref: string): { consumers: string[]; dependencies: string[] } {
  const consumers = new Set<string>();
  const dependencies = new Set<string>();
  for (const e of edges) {
    if (e.to === ref) consumers.add(e.from);
    if (e.from === ref) dependencies.add(e.to);
  }
  return { consumers: [...consumers].sort(), dependencies: [...dependencies].sort() };
}

/** A coherence problem produced by partial acceptance of a dependency chain. */
export interface CoherenceWarning {
  changeId: string;
  message: string;
}

/**
 * Find incoherent verdicts: a change accepted while one of its dependencies is
 * rejected (the accepted change would be stranded). This is the check that
 * per-change review otherwise lacks — accept A, reject what A needs, ship a
 * broken plan.
 */
export function coherenceWarnings(plan: Plan, verdicts: Record<string, Verdict | undefined>): CoherenceWarning[] {
  const byId = indexById(plan);
  const out: CoherenceWarning[] = [];
  for (const c of plan.changes) {
    if (verdicts[c.id] !== 'accept' || !c.dependsOn?.length) continue;
    for (const depId of c.dependsOn) {
      const dep = byId[depId];
      if (!dep) continue;
      if (verdicts[depId] === 'reject') {
        out.push({ changeId: c.id, message: `accepted, but depends on "${dep.id}" which is rejected` });
      }
    }
  }
  return out;
}

/** Synthesize a DiagramNode for an add-node change (lives only in the planner view). */
export function synthNode(c: PlanChange): DiagramNode | null {
  if (c.status !== 'add' || c.target.kind !== 'node' || !c.newNode) return null;
  const id = c.target.ref;
  return {
    id,
    label: c.newNode.label,
    shape: 'rect',
    kind: c.newNode.kind ?? 'module',
    color: null,
    x: 0, y: 0, w: 180, h: 54,
    parent: c.newNode.parent ?? null,
    fm: c.fm,
  };
}

/** One node's identity + position for the planner review-canvas layout. */
export interface PlanLayoutNode {
  id: string;
  /** the node's real ctx.state position (used verbatim for real nodes) */
  x: number;
  y: number;
  /** drill-in parent (used to place a synth node near its parent) */
  parent?: string | null;
  /** true when this is a synthesised add-node (not present in ctx.state) */
  synth?: boolean;
}

/**
 * Positions for one drill level of the planner review canvas.
 *
 * D1 — layout fidelity (the human layer): every REAL node renders at its exact
 * ctx.state (x, y) — the very layout the human sees on the live canvas — never a
 * re-simulated force-sim position. Only synthesised add-nodes (not yet in
 * ctx.state) get a computed slot: beside their parent when it has one, else
 * parked in a column to the right of the real bounding box, so additions read as
 * deltas without ever displacing or overlapping the real map. Pure.
 */
export function levelPositions(nodes: PlanLayoutNode[]): Record<string, { x: number; y: number }> {
  const pos: Record<string, { x: number; y: number }> = {};
  const reals = nodes.filter((n) => !n.synth);
  for (const n of reals) pos[n.id] = { x: n.x, y: n.y };
  const maxX = reals.length ? Math.max(...reals.map((n) => n.x)) : 0;
  const minY = reals.length ? Math.min(...reals.map((n) => n.y)) : 0;
  let col = 0;
  for (const n of nodes.filter((n) => n.synth)) {
    const pp = n.parent ? pos[n.parent] : undefined;
    pos[n.id] = pp ? { x: pp.x + 240, y: pp.y + col * 72 } : { x: maxX + 260, y: minY + 120 + col * 120 };
    col++;
  }
  return pos;
}

/** One affected node in a downstream cone, with its hop distance from the change. */
export interface ConeNode {
  id: string;
  depth: number;
}

export interface DownstreamCone {
  /** every transitively-affected consumer, nearest first */
  affected: ConeNode[];
  /** affected nodes that are public entry points (layout roots) the change reaches */
  entryPoints: string[];
  /** the deepest hop distance reached */
  maxDepth: number;
}

/**
 * Transitive downstream cone of a node change: every node that (transitively)
 * CONSUMES `ref`, i.e. would be at risk if ref's contract changes. Walks edges
 * backward — an edge `from -> to` means `from depends on to`, so the consumers of
 * a node X are the `from`s of edges whose `to` is X. BFS outward by that relation.
 *
 * This replaces the misleading 1-hop blastRadius for impact analysis: a change to a
 * core node (state / types / render) ripples through dozens of modules transitively,
 * and a reviewer must see the true cone, not just direct callers (PLANNER_HANDOVER #1).
 * Pure: computed from the real edge list.
 */
export function downstreamCone(
  edges: DiagramEdge[],
  ref: string,
  opts: { roots?: string[]; maxDepth?: number } = {},
): DownstreamCone {
  const maxDepth = opts.maxDepth ?? Infinity;
  // consumers index: node -> who points AT it (edges into it)
  const consumersOf = new Map<string, string[]>();
  for (const e of edges) {
    if (!consumersOf.has(e.to)) consumersOf.set(e.to, []);
    consumersOf.get(e.to)!.push(e.from);
  }
  const depthOf = new Map<string, number>();
  const queue: ConeNode[] = [{ id: ref, depth: 0 }];
  while (queue.length) {
    const { id, depth } = queue.shift()!;
    if (depth >= maxDepth) continue;
    for (const consumer of consumersOf.get(id) ?? []) {
      if (consumer === ref || depthOf.has(consumer)) continue; // BFS: first visit = shortest
      depthOf.set(consumer, depth + 1);
      queue.push({ id: consumer, depth: depth + 1 });
    }
  }
  const affected = [...depthOf.entries()]
    .map(([id, depth]) => ({ id, depth }))
    .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  const rootSet = new Set(opts.roots ?? []);
  const entryPoints = affected.filter((a) => rootSet.has(a.id)).map((a) => a.id);
  const maxReached = affected.reduce((mx, a) => Math.max(mx, a.depth), 0);
  return { affected, entryPoints, maxDepth: maxReached };
}

/**
 * Derive a Plan from a raw before/after diff of two maps — the bridge that lets
 * the ONE review surface (the planner) review a pasted proposal `.mmd`, not only
 * a hand-authored plan.json (D2 — unified review). Every structural delta from
 * diffModels becomes a PlanChange: added/removed/modified nodes, added/removed
 * edges, each with a derived intent describing the delta. The result flows
 * through the exact same review path (accept/reject, blast radius, export) as an
 * authored plan, so the diff-workspace and the planner collapse into one path.
 * Pure: derived solely from the two inputs.
 */
export function planFromDiff(before: DiffInput, after: DiffInput, base: string = 'pasted proposal'): Plan {
  const d = diffModels(before, after);
  const changes: PlanChange[] = [];

  for (const id of d.addedNodes) {
    const n = after.nodes[id];
    changes.push({
      id: `add-${id}`, status: 'add', target: { kind: 'node', ref: id },
      newNode: { label: n.label, kind: n.kind ?? 'module', parent: n.parent ?? null },
      fm: n.fm,
      intent: { problem: 'not present in the base map', approach: `add ${n.kind ?? 'node'} "${n.label}"` },
    });
  }
  for (const id of d.removedNodes) {
    changes.push({
      id: `rem-${id}`, status: 'remove', target: { kind: 'node', ref: id },
      intent: { problem: 'present in the base, dropped by the proposal', approach: `remove "${id}"` },
    });
  }
  for (const id of [...new Set(d.changedNodes.map((c) => c.id))]) {
    const fields = d.changedNodes.filter((c) => c.id === id).map((c) => c.field).join(', ');
    changes.push({
      id: `mod-${id}`, status: 'modify', target: { kind: 'node', ref: id }, fm: after.nodes[id]?.fm,
      intent: { problem: `differs from the base map (${fields})`, approach: `update ${fields} of "${id}"` },
    });
  }
  for (const k of d.addedEdges) {
    const [ft, style] = k.split(':');
    const [from, to] = ft.split('->');
    changes.push({
      id: `eadd-${from}-${to}`, status: 'add', target: { kind: 'edge', ref: k },
      newEdge: { from, to, style: (style as EdgeStyle) || 'solid' },
      intent: { problem: 'dependency not in the base map', approach: `add edge ${from} → ${to}` },
    });
  }
  for (const k of d.removedEdges) {
    const [ft] = k.split(':');
    const [from, to] = ft.split('->');
    changes.push({
      id: `erem-${from}-${to}`, status: 'remove', target: { kind: 'edge', ref: k },
      intent: { problem: 'dependency dropped by the proposal', approach: `remove edge ${from} → ${to}` },
    });
  }
  return { base, phases: [], changes };
}
