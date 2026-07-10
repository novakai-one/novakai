/* =====================================================================
   mermaid-parse.ts — Mermaid text -> model (see mermaid.ts header)
   ---------------------------------------------------------------------
   Parses Mermaid flowchart text (plus the custom %% metadata comments)
   back into a model fragment. Split out of mermaid.ts to keep each module
   under the size cap; re-exported from there.
   ===================================================================== */

import type {
  DiagramNode, DiagramEdge, ShapeKind, FlowDir, Point, Hier, NodeKind, Frontmatter,
} from '../core/types/types';
import { DEFAULTS, PALETTE } from '../core/config/config';
import {
  matchFrontmatterLine, applyFrontmatterLine, isFrontmatterEmpty,
} from '../core/frontmatter/frontmatter';

interface ParseResult {
  nodes: Record<string, DiagramNode>;
  edges: DiagramEdge[];
  nextN: number;
  nextE: number;
  dir: FlowDir;
  roots: string[];
  hier: Hier;
}

/** Parse one `%% group <gid> "<label>" [parent <gid>]` or `%% group-member
    <gid> <nodeId>` line into the hier overlay. Returns true when the line was
    consumed. The pipeline parser (tools/buildspec/mmd-parse.mjs) mirrors this
    grammar; parser-conformance.test.mjs holds the two together (A3). */
export function parseGroupDirective(line: string, hier: Hier): boolean {
  let match: RegExpMatchArray | null;
  if ((match = line.match(/^%% group (\w+) "([^"]*)"(?: parent (\w+))?$/))) {
    hier.groups[match[1]] = { id: match[1], label: match[2], parent: match[3] ?? null };
    return true;
  }
  if ((match = line.match(/^%% group-member (\w+) (\w+)$/))) {
    hier.memberOf[match[2]] = match[1];
    return true;
  }
  return false;
}

type FmMeta = { x: number; y: number; w: number; h: number; shape: ShapeKind; color: string | null };

// Mutable accumulator threaded through the per-line `%%` metadata parsers below,
// so each parser stays a small module-private function instead of a giant closure.
interface MetaAccum {
  meta: Record<string, FmMeta>;
  orthoSet: Set<string>;
  bendMap: Map<string, Point>;
  labelPosMap: Map<string, Point>;
  roots: string[];
  hier: Hier;
  fmAcc: Record<string, Frontmatter>;
  kindMap: Map<string, NodeKind>;
  parentMap: Map<string, string>;
  maxN: number;
  bumpN: (id: string) => void;
}

// Build a fresh accumulator, including a `bumpN` that tracks the highest
// numeric node-id suffix seen so `fromMermaid` can hand back the next free id.
function makeMetaAccum(): MetaAccum {
  const acc: MetaAccum = {
    meta: {}, orthoSet: new Set<string>(), bendMap: new Map<string, Point>(),
    labelPosMap: new Map<string, Point>(), roots: [], hier: { groups: {}, memberOf: {} },
    fmAcc: {}, kindMap: new Map<string, NodeKind>(), parentMap: new Map<string, string>(),
    maxN: 0, bumpN: () => {},
  };
  acc.bumpN = (id: string): void => {
    const digits = +id.replace(/\D/g, '');
    if (digits > acc.maxN) acc.maxN = digits;
  };
  return acc;
}

// `%% fm <id> <x> <y> <w> <h> <shape> <color>` — layout metadata.
function tryParseFmLine(line: string, acc: MetaAccum): boolean {
  const match = line.match(/^%% fm (\w+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\w+) (#?\w+)/);
  if (!match) return false;
  acc.meta[match[1]] = {
    x: +match[2], y: +match[3], 'w': +match[4], 'h': +match[5],
    shape: match[6] as ShapeKind, color: match[7] === 'null' ? null : match[7],
  };
  acc.bumpN(match[1]);
  return true;
}

// Public-interface frontmatter line (shared grammar lives in core/frontmatter).
function tryApplyFrontmatterLine(line: string, acc: MetaAccum): boolean {
  const fmLine = matchFrontmatterLine(line);
  if (!fmLine) return false;
  applyFrontmatterLine(acc.fmAcc, fmLine);
  acc.bumpN(fmLine.id);
  return true;
}

// `%% edge <id> ortho`
function tryParseEdgeOrtho(line: string, acc: MetaAccum): boolean {
  const match = line.match(/^%% edge (\w+) ortho/);
  if (!match) return false;
  acc.orthoSet.add(match[1]);
  return true;
}

// `%% edge <id> bend <x> <y>`
function tryParseEdgeBend(line: string, acc: MetaAccum): boolean {
  const match = line.match(/^%% edge (\w+) bend (-?\d+) (-?\d+)/);
  if (!match) return false;
  acc.bendMap.set(match[1], { x: +match[2], y: +match[3] });
  return true;
}

// `%% edge <id> labelpos <x> <y>`
function tryParseEdgeLabelPos(line: string, acc: MetaAccum): boolean {
  const match = line.match(/^%% edge (\w+) labelpos (-?\d+) (-?\d+)/);
  if (!match) return false;
  acc.labelPosMap.set(match[1], { x: +match[2], y: +match[3] });
  return true;
}

// `%% root <id>`
function tryParseRoot(line: string, acc: MetaAccum): boolean {
  const match = line.match(/^%% root (\w+)/);
  if (!match) return false;
  acc.roots.push(match[1]);
  acc.bumpN(match[1]);
  return true;
}

// `%% kind <id> <nodeKind>`
function tryParseKind(line: string, acc: MetaAccum): boolean {
  const match = line.match(/^%% kind (\w+) (\w+)/);
  if (!match) return false;
  acc.kindMap.set(match[1], match[2] as NodeKind);
  acc.bumpN(match[1]);
  return true;
}

// `%% parent <childId> <parentId>` (drill-in containment, not group membership)
function tryParseParent(line: string, acc: MetaAccum): boolean {
  const match = line.match(/^%% parent (\w+) (\w+)/);
  if (!match) return false;
  acc.parentMap.set(match[1], match[2]);
  acc.bumpN(match[1]);
  acc.bumpN(match[2]);
  return true;
}

// Parse one `%% ...` metadata comment line into the accumulator. Returns true
// when the line was a recognized directive (fm/edge/root/group/kind/parent).
function parseMetaLine(line: string, acc: MetaAccum): boolean {
  if (tryParseFmLine(line, acc)) return true;
  if (tryApplyFrontmatterLine(line, acc)) return true;
  if (tryParseEdgeOrtho(line, acc)) return true;
  if (tryParseEdgeBend(line, acc)) return true;
  if (tryParseEdgeLabelPos(line, acc)) return true;
  if (tryParseRoot(line, acc)) return true;
  if (parseGroupDirective(line, acc.hier)) return true;
  if (tryParseKind(line, acc)) return true;
  return tryParseParent(line, acc);
}

// Ordered most-specific-first: stadium/cylinder/hex/circle/diamond/note must be
// tried before the looser round/rect patterns they'd otherwise be swallowed by.
const SHAPE_RULES: { regex: RegExp; shape: ShapeKind }[] = [
  { regex: /^(\w+)\(\["?([^"\)]*)"?\]\)/, shape: 'stadium' },
  { regex: /^(\w+)\[\("?([^"\)]*)"?\)\]/, shape: 'cylinder' },
  { regex: /^(\w+)\{\{"?([^"\}]*)"?\}\}/, shape: 'hex' },
  { regex: /^(\w+)\(\("?([^"\)]*)"?\)\)/, shape: 'circle' },
  { regex: /^(\w+)\{"?([^"\}]*)"?\}/, shape: 'diamond' },
  { regex: /^(\w+)>"?([^"\]]*)"?\]/, shape: 'note' },
  { regex: /^(\w+)\("?([^"\)]*)"?\)/, shape: 'round' },
  { regex: /^(\w+)\["?([^"\]]*)"?\]/, shape: 'rect' },
];

// Parse a node/subgraph declaration line, calling `ensure` to create/update the
// node. Returns true when the line matched a known shape syntax.
function parseShapeLine(
  line: string,
  ensure: (id: string, label?: string, shape?: ShapeKind) => void,
  groupStack: string[],
): boolean {
  const subgraphMatch = line.match(/^subgraph\s+(\w+)\s*\["?([^"\]]*)"?\]/);
  if (subgraphMatch) {
    ensure(subgraphMatch[1], subgraphMatch[2], 'group');
    groupStack.push(subgraphMatch[1]);
    return true;
  }
  for (const rule of SHAPE_RULES) {
    const shapeMatch = line.match(rule.regex);
    if (!shapeMatch) continue;
    ensure(shapeMatch[1], shapeMatch[2], rule.shape);
    return true;
  }
  return false;
}

// Parse an edge line (arrow between two node ids, optional label). Returns
// true when the line matched; pushes the parsed edge onto `edges`.
function parseEdgeLine(
  line: string,
  ensure: (id: string, label?: string, shape?: ShapeKind) => void,
  edges: DiagramEdge[],
  nextEdgeId: () => string,
): boolean {
  const edgeMatch = line.match(/^(\w+)\s*(-\.->|==>|-->|---)\s*(?:\|([^|]*)\|)?\s*(\w+)/);
  if (!edgeMatch) return false;
  ensure(edgeMatch[1]);
  ensure(edgeMatch[4]);
  const style = edgeMatch[2] === '-.->' ? 'dotted' : edgeMatch[2] === '==>' ? 'thick' : 'solid';
  edges.push({
    id: nextEdgeId(), from: edgeMatch[1], 'to': edgeMatch[4],
    label: (edgeMatch[3] || '').trim(), style, routing: 'straight',
  });
  return true;
}

// Assign this node's fm-metadata position, or auto-place it in a grid when
// none was recorded (a new/undecorated node). Mutates `node` in place.
function placeNode(node: DiagramNode, placed: FmMeta | undefined, autoIndex: number): void {
  if (placed) {
    Object.assign(node, placed);
    return;
  }
  const size = DEFAULTS[node.shape] || DEFAULTS.rect;
  node['w'] = size['w'];
  node['h'] = size['h'];
  node.x = 80 + (autoIndex % 4) * 200;
  node.y = 80 + Math.floor(autoIndex / 4) * 130;
}

// Attach any parsed frontmatter/semantic kind onto `node`.
function annotateNode(
  node: DiagramNode, id: string, fmAcc: Record<string, Frontmatter>, kindMap: Map<string, NodeKind>,
): void {
  if (fmAcc[id] && !isFrontmatterEmpty(fmAcc[id])) node['fm'] = fmAcc[id];
  const kind = kindMap.get(id);
  if (kind) node.kind = kind;
}

// Assign fm-metadata positions or auto-place nodes lacking them; attach any
// parsed frontmatter/semantic kind. Mutates `nodes` in place.
function placeAndAnnotateNodes(
  nodes: Record<string, DiagramNode>,
  meta: Record<string, FmMeta>,
  fmAcc: Record<string, Frontmatter>,
  kindMap: Map<string, NodeKind>,
): void {
  let auto = 0;
  for (const id in nodes) {
    const node = nodes[id];
    placeNode(node, meta[id], auto);
    if (!meta[id]) auto++;
    annotateNode(node, id, fmAcc, kindMap);
  }
}

// Apply non-group containment (drill-in parent) now that all nodes exist.
function applyContainment(nodes: Record<string, DiagramNode>, parentMap: Map<string, string>): void {
  parentMap.forEach((parentId, childId) => {
    if (nodes[childId] && nodes[parentId]) nodes[childId].parent = parentId;
  });
}

// Apply parsed edge routing metadata (ortho flag, bend point, label position).
function applyEdgeRouting(
  edges: DiagramEdge[],
  orthoSet: Set<string>,
  bendMap: Map<string, Point>,
  labelPosMap: Map<string, Point>,
): void {
  edges.forEach((edge) => {
    if (orthoSet.has(edge.id)) edge.routing = 'ortho';
  });
  edges.forEach((edge) => {
    const bend = bendMap.get(edge.id);
    if (bend) edge.bend = bend;
    const labelPos = labelPosMap.get(edge.id);
    if (labelPos) edge.labelPos = labelPos;
  });
}

// Drop hier memberships/parents that point at nodes or groups no longer present.
function pruneHier(hier: Hier, nodes: Record<string, DiagramNode>): void {
  for (const nodeId of Object.keys(hier.memberOf)) {
    if (!nodes[nodeId] || !hier.groups[hier.memberOf[nodeId]]) delete hier.memberOf[nodeId];
  }
  for (const groupId of Object.keys(hier.groups)) {
    const parentId = hier.groups[groupId].parent;
    if (parentId && !hier.groups[parentId]) hier.groups[groupId].parent = null;
  }
}

// Mutable working set threaded through one `fromMermaid` parse pass.
interface ParseCtx {
  nodes: Record<string, DiagramNode>;
  edges: DiagramEdge[];
  groupStack: string[];
  acc: MetaAccum;
  dir: FlowDir;
  maxE: number;
}

// Create or update a node by id: set label/shape on first sight, update them
// if re-declared with one, and thread it into whichever group is in scope.
function ensureNode(ctx: ParseCtx, id: string, label?: string, shape?: ShapeKind): void {
  ctx.acc.bumpN(id);
  if (!ctx.nodes[id]) {
    ctx.nodes[id] = {
      id, label: label ?? id, shape: shape ?? 'rect', color: PALETTE[0],
      x: 0, y: 0, 'w': 0, 'h': 0,
    };
  } else if (label) {
    ctx.nodes[id].label = label;
    if (shape) ctx.nodes[id].shape = shape;
  }
  if (ctx.groupStack.length) ctx.nodes[id].parent = ctx.groupStack[ctx.groupStack.length - 1];
}

// Handle a `flowchart DIR` declaration or a subgraph-closing `end` line.
// Returns true when the line was consumed as one of these.
function applyDirectiveLine(line: string, ctx: ParseCtx): boolean {
  const dirMatch = line.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i);
  if (dirMatch) {
    const upper = dirMatch[1].toUpperCase();
    ctx.dir = upper === 'TB' ? 'TD' : (upper as FlowDir);
    return true;
  }
  if (line === 'end') {
    ctx.groupStack.pop();
    return true;
  }
  return false;
}

// Parse one already-trimmed line into `ctx`: metadata comment, direction
// declaration, group close, comment/keyword line to skip, shape decl, or edge.
function processLine(
  line: string, ctx: ParseCtx, ensure: (id: string, label?: string, shape?: ShapeKind) => void,
): void {
  if (parseMetaLine(line, ctx.acc)) return;
  if (applyDirectiveLine(line, ctx)) return;
  if (line.startsWith('%%') || /^(flowchart|graph)\b/.test(line)) return;
  if (parseShapeLine(line, ensure, ctx.groupStack)) return;
  parseEdgeLine(line, ensure, ctx.edges, () => 'e' + (++ctx.maxE));
}

/** Parse Mermaid text into a model fragment. Pure. */
export function fromMermaid(text: string): ParseResult {
  const ctx: ParseCtx = {
    nodes: {}, edges: [], groupStack: [], acc: makeMetaAccum(), dir: 'TD', maxE: 0,
  };
  const ensure = (id: string, label?: string, shape?: ShapeKind): void => ensureNode(ctx, id, label, shape);
  text.split('\n').forEach((raw) => processLine(raw.trim(), ctx, ensure));

  placeAndAnnotateNodes(ctx.nodes, ctx.acc.meta, ctx.acc.fmAcc, ctx.acc.kindMap);
  applyContainment(ctx.nodes, ctx.acc.parentMap);
  applyEdgeRouting(ctx.edges, ctx.acc.orthoSet, ctx.acc.bendMap, ctx.acc.labelPosMap);
  const liveRoots = ctx.acc.roots.filter((id) => ctx.nodes[id]);
  pruneHier(ctx.acc.hier, ctx.nodes);
  return {
    nodes: ctx.nodes, edges: ctx.edges, nextN: ctx.acc.maxN + 1, nextE: ctx.maxE + 1,
    dir: ctx.dir, roots: liveRoots, hier: ctx.acc.hier,
  };
}
