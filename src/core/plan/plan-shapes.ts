/* =====================================================================
   plan-shapes.ts — the build-plan overlay data model (types + coercion)
   ---------------------------------------------------------------------
   The data shapes for a "build plan" — a set of PROPOSED changes
   (status + intent + phase) keyed onto the REAL diagram — plus the pure
   constructors/coercers (emptyPlan, normalizePlan) that produce a valid
   Plan. Split out of plan.ts; re-exported from it.

   Pure module: types + pure helpers only. No DOM, no model writes.
   ===================================================================== */

import type { NodeKind, EdgeStyle, Frontmatter } from '../types/types';
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
  /**
   * The human's per-change review decisions (H2). Written by the editor on
   * approve into the decision artifact (approved-plan.json) and consumed by
   * approve-export.mjs --accepted-only. Optional: absent until a review lands.
   */
  verdicts?: Record<string, Verdict>;
}

/* ---------- pure helpers ---------- */

export function emptyPlan(): Plan {
  return { base: '', phases: [], changes: [] };
}

function normalizePhases(rawPhases: unknown): PlanPhase[] {
  if (!Array.isArray(rawPhases)) return [];
  return (rawPhases as unknown[])
    .map((entry) => entry as Record<string, unknown>)
    .filter((entry) => typeof entry.id === 'number' && typeof entry.title === 'string')
    .map((entry) => ({
      id: entry.id as number,
      title: entry.title as string,
      subtitle: typeof entry.subtitle === 'string' ? entry.subtitle : undefined,
    }));
}

function isValidChangeShape(entry: Record<string, unknown>): boolean {
  return typeof entry.id === 'string'
    && (entry.status === 'add' || entry.status === 'modify' || entry.status === 'remove')
    && !!entry.target && typeof entry.target === 'object'
    && !!entry.intent && typeof entry.intent === 'object';
}

/** coerce any proposed signature into a valid Frontmatter so the apply step can
 *  trust it (drops malformed interfaces, never throws). */
function normalizeChangeFm(entry: Record<string, unknown>, change: PlanChange): void {
  if (entry.fm && typeof entry.fm === 'object') change['fm'] = normalizeFrontmatter(entry.fm);
  else delete change.fm;
}

function normalizeChanges(rawChanges: unknown): PlanChange[] {
  if (!Array.isArray(rawChanges)) return [];
  return (rawChanges as unknown[])
    .map((entry) => entry as Record<string, unknown>)
    .filter(isValidChangeShape)
    .map((entry) => {
      const change = entry as unknown as PlanChange;
      normalizeChangeFm(entry, change);
      return change;
    });
}

/**
 * Preserve a decision artifact's verdicts on reload (H2): a reloaded
 * approved-plan.json keeps the human's accept/reject decisions. Only valid
 * verdict values survive; anything else is dropped (never throws).
 */
function normalizeVerdicts(rawVerdicts: unknown): Record<string, Verdict> | undefined {
  if (!rawVerdicts || typeof rawVerdicts !== 'object') return undefined;
  const verdicts: Record<string, Verdict> = {};
  for (const [changeId, val] of Object.entries(rawVerdicts as Record<string, unknown>)) {
    if (val === 'accept' || val === 'reject') verdicts[changeId] = val;
  }
  return Object.keys(verdicts).length ? verdicts : undefined;
}

/** Coerce loaded JSON into a valid Plan, dropping malformed changes. */
export function normalizePlan(raw: unknown): Plan {
  const out = emptyPlan();
  if (!raw || typeof raw !== 'object') return out;
  const source = raw as Record<string, unknown>;
  if (typeof source.base === 'string') out.base = source.base;
  out.phases = normalizePhases(source.phases);
  out.changes = normalizeChanges(source.changes);
  const verdicts = normalizeVerdicts(source.verdicts);
  if (verdicts) out.verdicts = verdicts;
  return out;
}
