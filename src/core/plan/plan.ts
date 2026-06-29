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
   ===================================================================== */

import type { NodeKind, EdgeStyle, DiagramEdge, DiagramNode, Frontmatter } from '../types/types';
import { normalizeFrontmatter } from '../frontmatter/frontmatter';

/** A proposed change's disposition against the current code. */
export type ChangeStatus = 'add' | 'modify' | 'remove';

/** A reviewer's per-change decision. */
export type Verdict = 'accept' | 'reject';

export type RiskLevel = 'low' | 'med' | 'high';

/** What a change is about: a node, or an edge identified by its stable key. */
export interface ChangeTarget {
  kind: 'node' | 'edge';
  /** node id, or edgeKey "from->to:style" for an edge target */
  ref: string;
}

/** The WHY of a change — the layer today's frontmatter cannot hold. */
export interface ChangeIntent {
  /** what's wrong / missing today */
  problem: string;
  /** what this change does about it */
  approach: string;
  /** why this approach (optional) */
  rationale?: string;
  /** an option considered and not taken (optional) */
  alternative?: string;
  /** the cost this change accepts (optional) */
  tradeoff?: string;
}

/** Spec for a node a change introduces (status === 'add', target.kind === 'node'). */
export interface NewNodeSpec {
  label: string;
  kind?: NodeKind;
  /** drill-in parent (a real unit id) or null for a new top-level module */
  parent?: string | null;
}

/** Spec for an edge a change introduces (target.kind === 'edge', status === 'add'). */
export interface NewEdgeSpec {
  from: string;
  to: string;
  style?: EdgeStyle;
  label?: string;
}

/** One proposed change in a plan. */
export interface PlanChange {
  /** stable change id (referenced by dependsOn) */
  id: string;
  status: ChangeStatus;
  target: ChangeTarget;
  /** phase / milestone this change belongs to (1-based) */
  phase?: number;
  risk?: RiskLevel;
  intent: ChangeIntent;
  /** present when status==='add' && target.kind==='node' */
  newNode?: NewNodeSpec;
  /** present when target.kind==='edge' */
  newEdge?: NewEdgeSpec;
  /** change ids that must land before this one (coherence) */
  dependsOn?: string[];
  /** when true the panel quotes the target node's real fm.desc as "code today" */
  quoteReal?: boolean;
  /**
   * The PROPOSED public interface this change introduces (add) or rewrites
   * (modify). This is what turns an approved change from intent prose into an
   * enforceable contract: applyPlan writes this fm onto the spec, spec-to-stubs
   * emits the new signatures, and the gate enforces them. Absent = structure-only
   * change (no signature commitment).
   */
  fm?: Frontmatter;
}

export interface PlanPhase {
  id: number;
  title: string;
  subtitle?: string;
}

export interface Plan {
  /** human label for the base map this plan is authored against */
  base: string;
  phases?: PlanPhase[];
  changes: PlanChange[];
}

/* ---------- pure helpers ---------- */

export function emptyPlan(): Plan {
  return { base: '', phases: [], changes: [] };
}

/** Coerce loaded JSON into a valid Plan, dropping malformed changes. */
export function normalizePlan(raw: unknown): Plan {
  const out = emptyPlan();
  if (!raw || typeof raw !== 'object') return out;
  const p = raw as Record<string, unknown>;
  if (typeof p.base === 'string') out.base = p.base;
  if (Array.isArray(p.phases)) {
    out.phases = (p.phases as unknown[])
      .map((x) => x as Record<string, unknown>)
      .filter((x) => typeof x.id === 'number' && typeof x.title === 'string')
      .map((x) => ({ id: x.id as number, title: x.title as string, subtitle: typeof x.subtitle === 'string' ? x.subtitle : undefined }));
  }
  if (Array.isArray(p.changes)) {
    out.changes = (p.changes as unknown[])
      .map((x) => x as Record<string, unknown>)
      .filter((x) =>
        typeof x.id === 'string'
        && (x.status === 'add' || x.status === 'modify' || x.status === 'remove')
        && x.target && typeof x.target === 'object'
        && x.intent && typeof x.intent === 'object')
      .map((x) => {
        const c = x as unknown as PlanChange;
        // coerce any proposed signature into a valid Frontmatter so the apply
        // step can trust it (drops malformed interfaces, never throws).
        if (x.fm && typeof x.fm === 'object') c.fm = normalizeFrontmatter(x.fm);
        else delete c.fm;
        return c;
      });
  }
  return out;
}

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
