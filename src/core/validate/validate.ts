/* =====================================================================
   validate.ts — pure model integrity + round-trip checks
   ---------------------------------------------------------------------
   Responsibility: tell whether a model is structurally sound, and whether
   it survives a serialize -> parse round-trip without semantic loss. No
   DOM, no serializer dependency. Imports types only.

   This is the keystone of Tier 1: the file must be trustworthy before any
   Claude workflow is built on it. `edgeIdentities` + `semanticDiff` are
   also the foundation the later diff / merge-by-id features reuse.
   ===================================================================== */

import type { DiagramNode, DiagramEdge, Frontmatter } from '../types/types';

export type IssueLevel = 'error' | 'warn';
export interface Issue {
  level: IssueLevel;
  /** stable machine code, e.g. 'dangling-parent', 'rt-edge-dropped' */
  code: string;
  message: string;
  /** node/edge ids the issue points at, for click-to-highlight later */
  ids?: string[];
}

type NodeMap = Record<string, DiagramNode>;

/** field delimiter that cannot appear in an id or a style enum value */
const SEP = '\u241e';

/**
 * Stable, content-derived identity per edge: from␞to␞style, plus an
 * occurrence index for true parallel duplicates. Lets diff/merge match the
 * same relationship across a save/reload without storing edge ids in the
 * file. Returns edge.id -> identity. Label is intentionally excluded so an
 * edge keeps its identity through a label edit (a relabel reads as a change,
 * not a delete + add).
 */
export function edgeIdentities(edges: DiagramEdge[]): Map<string, string> {
  const seen = new Map<string, number>();
  const out = new Map<string, string>();
  for (const e of edges) {
    const base = `${e.from}${SEP}${e.to}${SEP}${e.style}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.set(e.id, n ? `${base}${SEP}${n}` : base);
  }
  return out;
}

/** True when following parent links from `start` ever returns to `start`. */
function inParentCycle(nodes: NodeMap, start: string): boolean {
  let cur: string | null | undefined = nodes[start]?.parent ?? null;
  const seen = new Set<string>([start]);
  while (cur) {
    if (cur === start) return true;
    if (seen.has(cur)) return false; // a cycle exists, but not through start
    seen.add(cur);
    cur = nodes[cur]?.parent ?? null;
  }
  return false;
}

/**
 * Structural integrity of one model. Errors break a clean round-trip or a
 * build (cycles, dangling references, orphan edges); there are no warnings
 * yet but the level is kept for future advisory checks.
 */
export function validateModel(nodes: NodeMap, edges: DiagramEdge[]): Issue[] {
  const issues: Issue[] = [];

  for (const id in nodes) {
    const p = nodes[id].parent;
    if (p == null) continue;
    if (p === id) {
      issues.push({ level: 'error', code: 'self-parent', message: `"${id}" is its own parent`, ids: [id] });
      continue;
    }
    if (!nodes[p]) {
      issues.push({ level: 'error', code: 'dangling-parent', message: `"${id}" points to a missing parent "${p}"`, ids: [id] });
      continue;
    }
    if (inParentCycle(nodes, id)) {
      issues.push({ level: 'error', code: 'parent-cycle', message: `"${id}" sits in a containment cycle`, ids: [id] });
    }
  }

  for (const e of edges) {
    if (!nodes[e.from]) issues.push({ level: 'error', code: 'orphan-edge', message: `edge "${e.id}" starts at a missing node "${e.from}"`, ids: [e.from] });
    if (!nodes[e.to]) issues.push({ level: 'error', code: 'orphan-edge', message: `edge "${e.id}" ends at a missing node "${e.to}"`, ids: [e.to] });
  }

  return issues;
}

/** A frontmatter object that carries no actual content. */
function isEmptyFm(f: Frontmatter | undefined): boolean {
  if (!f) return true;
  return !f.name && !f.description && f.state.length === 0 &&
    f.interfaces.every((i) => !i.name && i.accepts.length === 0 && i.returns.length === 0);
}

/** Order-insensitive equality of two string lists. */
function setEq(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

/** Frontmatter equality; list fields compared order-insensitively. */
function fmEqual(a: Frontmatter | undefined, b: Frontmatter | undefined): boolean {
  const ea = isEmptyFm(a), eb = isEmptyFm(b);
  if (ea && eb) return true;
  if (ea !== eb) return false;
  const x = a as Frontmatter, y = b as Frontmatter;
  if (x.name !== y.name || x.description !== y.description) return false;
  if (!setEq(x.state, y.state)) return false;
  if (x.interfaces.length !== y.interfaces.length) return false;
  for (let i = 0; i < x.interfaces.length; i++) {
    const ix = x.interfaces[i], iy = y.interfaces[i];
    if (ix.name !== iy.name) return false;
    if (!setEq(ix.accepts, iy.accepts)) return false;
    if (!setEq(ix.returns, iy.returns)) return false;
  }
  return true;
}

/**
 * Semantic round-trip diff. The invariant a round-trip must hold is NOT
 * literal equality — geometry (x/y/w/h) and the nid/eid counters are allowed
 * to change. What must be preserved: every node by id with the same
 * shape / kind / parent / label / frontmatter, and every edge by identity.
 *
 * Call as semanticDiff(model, fromMermaid(toMermaid(model))). An empty result
 * means the file round-trips losslessly.
 */
export function semanticDiff(
  before: { nodes: NodeMap; edges: DiagramEdge[] },
  after: { nodes: NodeMap; edges: DiagramEdge[] },
): Issue[] {
  const issues: Issue[] = [];

  for (const id in before.nodes) {
    const a = before.nodes[id], b = after.nodes[id];
    if (!b) { issues.push({ level: 'error', code: 'rt-node-dropped', message: `node "${id}" lost on round-trip`, ids: [id] }); continue; }
    if (a.shape !== b.shape) issues.push({ level: 'error', code: 'rt-shape', message: `"${id}" shape ${a.shape} -> ${b.shape}`, ids: [id] });
    if ((a.kind ?? null) !== (b.kind ?? null)) issues.push({ level: 'error', code: 'rt-kind', message: `"${id}" kind ${a.kind ?? 'none'} -> ${b.kind ?? 'none'}`, ids: [id] });
    if ((a.parent ?? null) !== (b.parent ?? null)) issues.push({ level: 'error', code: 'rt-parent', message: `"${id}" parent ${a.parent ?? 'none'} -> ${b.parent ?? 'none'}`, ids: [id] });
    if (a.label !== b.label) issues.push({ level: 'error', code: 'rt-label', message: `"${id}" label changed on round-trip`, ids: [id] });
    if (!fmEqual(a.fm, b.fm)) issues.push({ level: 'error', code: 'rt-frontmatter', message: `"${id}" frontmatter changed on round-trip`, ids: [id] });
  }
  for (const id in after.nodes) {
    if (!before.nodes[id]) issues.push({ level: 'error', code: 'rt-node-added', message: `node "${id}" appeared on round-trip`, ids: [id] });
  }

  const beforeKeys = new Set(edgeIdentities(before.edges).values());
  const afterKeys = new Set(edgeIdentities(after.edges).values());
  const human = (k: string): string => k.split(SEP).join(' ');
  for (const k of beforeKeys) if (!afterKeys.has(k)) issues.push({ level: 'error', code: 'rt-edge-dropped', message: `edge [${human(k)}] lost on round-trip` });
  for (const k of afterKeys) if (!beforeKeys.has(k)) issues.push({ level: 'error', code: 'rt-edge-added', message: `edge [${human(k)}] appeared on round-trip` });

  return issues;
}
