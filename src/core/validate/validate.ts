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

import type { DiagramNode, DiagramEdge, Frontmatter, NodeInterface } from '../types/types';

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
const SEP = '␞';

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
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    out.set(e.id, count ? `${base}${SEP}${count}` : base);
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

/** Parent-link issues for one node: self-parent, dangling parent, or a containment cycle. */
function parentIssues(nodes: NodeMap, id: string): Issue[] {
  const parentId = nodes[id].parent;
  if (parentId == null) return [];
  if (parentId === id) {
    return [{ level: 'error', code: 'self-parent', message: `"${id}" is its own parent`, ids: [id] }];
  }
  if (!nodes[parentId]) {
    return [{
      level: 'error', code: 'dangling-parent',
      message: `"${id}" points to a missing parent "${parentId}"`, ids: [id],
    }];
  }
  if (inParentCycle(nodes, id)) {
    return [{ level: 'error', code: 'parent-cycle', message: `"${id}" sits in a containment cycle`, ids: [id] }];
  }
  return [];
}

/** Missing from/to node references for one edge. */
function orphanEdgeIssues(nodes: NodeMap, edge: DiagramEdge): Issue[] {
  const found: Issue[] = [];
  if (!nodes[edge.from]) {
    found.push({
      level: 'error', code: 'orphan-edge',
      message: `edge "${edge.id}" starts at a missing node "${edge.from}"`, ids: [edge.from],
    });
  }
  if (!nodes[edge.to]) {
    found.push({
      level: 'error', code: 'orphan-edge',
      message: `edge "${edge.id}" ends at a missing node "${edge.to}"`, ids: [edge.to],
    });
  }
  return found;
}

/**
 * Structural integrity of one model. Errors break a clean round-trip or a
 * build (cycles, dangling references, orphan edges); there are no warnings
 * yet but the level is kept for future advisory checks.
 */
export function validateModel(nodes: NodeMap, edges: DiagramEdge[]): Issue[] {
  const issues: Issue[] = [];
  for (const id in nodes) issues.push(...parentIssues(nodes, id));
  for (const edge of edges) issues.push(...orphanEdgeIssues(nodes, edge));
  return issues;
}

/** A frontmatter object that carries no actual content. */
function isEmptyFm(frontmatter: Frontmatter | undefined): boolean {
  if (!frontmatter) return true;
  return !frontmatter.name && !frontmatter.description && frontmatter.state.length === 0 &&
    frontmatter.interfaces.every((i) => !i.name && i.accepts.length === 0 && i.returns.length === 0);
}

/** Order-insensitive equality of two string lists. */
function setEq(listA: string[], listB: string[]): boolean {
  if (listA.length !== listB.length) return false;
  const setA = new Set(listA);
  return listB.every((x) => setA.has(x));
}

/** Order-sensitive equality of two interface-signature lists (name + set-equal accepts/returns). */
function interfacesEqual(ifacesA: NodeInterface[], ifacesB: NodeInterface[]): boolean {
  for (let i = 0; i < ifacesA.length; i++) {
    const ifaceA = ifacesA[i], ifaceB = ifacesB[i];
    if (ifaceA.name !== ifaceB.name) return false;
    if (!setEq(ifaceA.accepts, ifaceB.accepts)) return false;
    if (!setEq(ifaceA.returns, ifaceB.returns)) return false;
  }
  return true;
}

/** Frontmatter equality; list fields compared order-insensitively. */
function fmEqual(fmA: Frontmatter | undefined, fmB: Frontmatter | undefined): boolean {
  const emptyA = isEmptyFm(fmA), emptyB = isEmptyFm(fmB);
  if (emptyA && emptyB) return true;
  if (emptyA !== emptyB) return false;
  const x = fmA as Frontmatter, y = fmB as Frontmatter;
  if (x.name !== y.name || x.description !== y.description) return false;
  if (!setEq(x.state, y.state)) return false;
  if (x.interfaces.length !== y.interfaces.length) return false;
  return interfacesEqual(x.interfaces, y.interfaces);
}

/** Shape diff issue for one node present in both before/after. */
function shapeChangeIssues(id: string, before: DiagramNode, after: DiagramNode): Issue[] {
  if (before.shape === after.shape) return [];
  return [{
    level: 'error', code: 'rt-shape',
    message: `"${id}" shape ${before.shape} -> ${after.shape}`, ids: [id],
  }];
}

/** Kind diff issue for one node present in both before/after. */
function kindChangeIssues(id: string, before: DiagramNode, after: DiagramNode): Issue[] {
  if ((before.kind ?? null) === (after.kind ?? null)) return [];
  return [{
    level: 'error', code: 'rt-kind',
    message: `"${id}" kind ${before.kind ?? 'none'} -> ${after.kind ?? 'none'}`, ids: [id],
  }];
}

/** Parent diff issue for one node present in both before/after. */
function parentChangeIssues(id: string, before: DiagramNode, after: DiagramNode): Issue[] {
  if ((before.parent ?? null) === (after.parent ?? null)) return [];
  return [{
    level: 'error', code: 'rt-parent',
    message: `"${id}" parent ${before.parent ?? 'none'} -> ${after.parent ?? 'none'}`, ids: [id],
  }];
}

/** Kind/parent diff issues for one node present in both before/after. */
function lineageChangeIssues(id: string, before: DiagramNode, after: DiagramNode): Issue[] {
  return [...kindChangeIssues(id, before, after), ...parentChangeIssues(id, before, after)];
}

/** Shape/kind/parent diff issues for one node present in both before/after. */
function structuralChangeIssues(id: string, before: DiagramNode, after: DiagramNode): Issue[] {
  return [...shapeChangeIssues(id, before, after), ...lineageChangeIssues(id, before, after)];
}

/** Label/frontmatter diff issues for one node present in both before/after. */
function contentChangeIssues(id: string, before: DiagramNode, after: DiagramNode): Issue[] {
  const found: Issue[] = [];
  if (before.label !== after.label) {
    found.push({ level: 'error', code: 'rt-label', message: `"${id}" label changed on round-trip`, ids: [id] });
  }
  if (!fmEqual(before.fm, after.fm)) {
    found.push({
      level: 'error', code: 'rt-frontmatter',
      message: `"${id}" frontmatter changed on round-trip`, ids: [id],
    });
  }
  return found;
}

/** Diff issues for one node present in both before/after (shape/kind/parent/label/frontmatter). */
function nodeChangeIssues(id: string, before: DiagramNode, after: DiagramNode): Issue[] {
  return [...structuralChangeIssues(id, before, after), ...contentChangeIssues(id, before, after)];
}

/** Node-level round-trip issues: dropped, added, or changed-in-place. */
function nodeDiffIssues(before: { nodes: NodeMap }, after: { nodes: NodeMap }): Issue[] {
  const issues: Issue[] = [];
  for (const id in before.nodes) {
    const afterNode = after.nodes[id];
    if (!afterNode) {
      issues.push({ level: 'error', code: 'rt-node-dropped', message: `node "${id}" lost on round-trip`, ids: [id] });
      continue;
    }
    issues.push(...nodeChangeIssues(id, before.nodes[id], afterNode));
  }
  for (const id in after.nodes) {
    if (!before.nodes[id]) {
      issues.push({ level: 'error', code: 'rt-node-added', message: `node "${id}" appeared on round-trip`, ids: [id] });
    }
  }
  return issues;
}

/** Edge-identity round-trip issues: dropped or added relationships. */
function edgeDiffIssues(before: DiagramEdge[], after: DiagramEdge[]): Issue[] {
  const issues: Issue[] = [];
  const beforeKeys = new Set(edgeIdentities(before).values());
  const afterKeys = new Set(edgeIdentities(after).values());
  const human = (key: string): string => key.split(SEP).join(' ');
  for (const key of beforeKeys) {
    if (afterKeys.has(key)) continue;
    issues.push({ level: 'error', code: 'rt-edge-dropped', message: `edge [${human(key)}] lost on round-trip` });
  }
  for (const key of afterKeys) {
    if (beforeKeys.has(key)) continue;
    issues.push({ level: 'error', code: 'rt-edge-added', message: `edge [${human(key)}] appeared on round-trip` });
  }
  return issues;
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
  return [...nodeDiffIssues(before, after), ...edgeDiffIssues(before.edges, after.edges)];
}
