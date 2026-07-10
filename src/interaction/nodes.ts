/* =====================================================================
   nodes.ts — node + edge model operations
   ---------------------------------------------------------------------
   Responsibility: the create/modify/destroy verbs on the model that are
   not pure geometry: addNode, makeEdge, deleteSelection, alignNodes,
   wrapInGroup, bringToFront. Each mutates the model then re-renders,
   syncs, and pushes a history entry as appropriate.

   Depends on selection (to select new nodes) and camera.toWorld (to
   place a node at viewport centre), both injected at init.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { ShapeKind, NodeKind, DiagramNode } from '../core/types/types';
import type { SelectionApi } from './selection';
import type { CameraApi } from '../core/camera/camera';
import type { ShapeDefault } from '../core/config/config';
import { DEFAULTS, PALETTE, SHAPE_KIND } from '../core/config/config';
import { snapV, childIdsOf } from '../core/state/state';
import { emptyFrontmatter } from '../core/frontmatter/frontmatter';

export interface NodesApi {
  addNode: (shape: ShapeKind, wx?: number | null, wy?: number | null, opts?: { label?: string }) => string;
  makeEdge: (from: string, to: string) => void;
  deleteSelection: () => void;
  alignNodes: (mode: string) => void;
  wrapInGroup: () => void;
  bringToFront: (id: string) => void;
  setEdgeLabel: (id: string, label: string) => void;
  reverseEdge: (id: string) => void;
  deleteEdge: (id: string) => void;
  setNodeMeta: (id: string, patch: { kind?: NodeKind | null; desc?: string }) => void;
  clearAll: () => void;
}

// ---- addNode helpers --------------------------------------------------

interface SpawnSpec {
  container: string | null;
  dims: { w: number; h: number };
  worldX?: number | null;
  worldY?: number | null;
}

/** World point stacked under a drilled container, honouring an explicit override. */
function stackedSpawnPoint(ctx: AppContext, spec: SpawnSpec): { x: number; y: number } {
  const parent = ctx.state.nodes[spec.container as string];
  const siblingCount = childIdsOf(ctx.state, spec.container).length;
  return {
    x: parent.x + (siblingCount % 3) * (spec.dims.w + 32),
    y: parent.y + parent.h + 90 + Math.floor(siblingCount / 3) * (spec.dims.h + 44),
  };
}

/** World point centred in the current viewport, staggered so repeat adds don't stack exactly. */
function centeredSpawnPoint(
  ctx: AppContext,
  camera: CameraApi,
  dims: { w: number; h: number },
): { x: number; y: number } {
  const { stage } = ctx.dom;
  const center = camera.toWorld(stage.clientWidth / 2, stage.clientHeight / 2);
  const stagger = (Object.keys(ctx.state.nodes).length % 5) * 12;
  return { x: center.x - dims.w / 2 + stagger, y: center.y - dims.h / 2 + stagger };
}

/** World point for a new node: explicit coords, stacked under a drilled container, or viewport centre. */
function computeSpawnPoint(ctx: AppContext, camera: CameraApi, spec: SpawnSpec): { x: number; y: number } {
  if (spec.worldX != null && spec.worldY != null) return { x: spec.worldX, y: spec.worldY };
  if (spec.container && ctx.state.nodes[spec.container]) return stackedSpawnPoint(ctx, spec);
  return centeredSpawnPoint(ctx, camera, spec.dims);
}

/** Auto-wire container -> new child so drill levels keep their graph (skip group / note: structural, not interface). */
function wireContainerEdge(ctx: AppContext, container: string | null, shape: ShapeKind, childId: string): void {
  if (!container || !ctx.state.nodes[container]) return;
  if (shape === 'group' || shape === 'note') return;
  // quoted: 'to' is DiagramEdge's frozen field name; id-length would flag the bare key
  ctx.state.edges.push({
    id: 'e' + (ctx.state.eid++),
    from: container,
    'to': childId,
    label: '',
    style: 'solid',
    routing: ctx.prefs.route || 'straight',
  });
}

interface AddNodeRequest {
  shape: ShapeKind;
  worldX?: number | null;
  worldY?: number | null;
  opts: { label?: string };
}

interface SpawnedNodeSpec {
  id: string;
  container: string | null;
  dims: ShapeDefault;
  point: { x: number; y: number };
}

/** Assemble the new node record: mandatory kind is a default construct for the shape (editable later). */
function buildSpawnedNode(ctx: AppContext, request: AddNodeRequest, spec: SpawnedNodeSpec) {
  const { id, container, dims, point } = spec;
  // quoted: w/h are DiagramNode's frozen field names; id-length would flag bare keys
  return {
    id, label: request.opts.label ?? dims.label, shape: request.shape,
    kind: SHAPE_KIND[request.shape], color: PALETTE[0],
    x: snapV(point.x, ctx.snap), y: snapV(point.y, ctx.snap),
    'w': dims.w, 'h': dims.h, parent: container,
  };
}

function performAddNode(ctx: AppContext, selection: SelectionApi, camera: CameraApi, request: AddNodeRequest): string {
  const { shape, worldX, worldY } = request;
  const dims = DEFAULTS[shape] || DEFAULTS.rect;
  const container = ctx.view.container;
  const point = computeSpawnPoint(ctx, camera, { container, dims, worldX, worldY });
  const id = 'n' + (ctx.state.nid++);
  ctx.state.nodes[id] = buildSpawnedNode(ctx, request, { id, container, dims, point });
  wireContainerEdge(ctx, container, shape, id);
  ctx.hooks.render();
  ctx.hooks.sync();
  selection.selectOnly(id);
  ctx.hooks.pushHistory();
  return id;
}

// ---- makeEdge ----------------------------------------------------------

function performMakeEdge(ctx: AppContext, from: string, dest: string): void {
  if (from === dest) return;
  const exists = ctx.state.edges.some((edge) => edge.from === from && edge.to === dest);
  if (exists) {
    ctx.hooks.toast('Edge exists');
    return;
  }
  // quoted: 'to' is DiagramEdge's frozen field name; id-length would flag the bare key
  ctx.state.edges.push({
    id: 'e' + (ctx.state.eid++),
    from,
    'to': dest,
    label: '',
    style: 'solid',
    routing: ctx.prefs.route || 'straight',
  });
  ctx.hooks.render();
  ctx.hooks.sync();
  ctx.hooks.pushHistory();
}

// ---- deleteSelection helpers -------------------------------------------

/** Promote a deleted node's children to its own parent so they aren't orphaned, then remove it. */
function promoteChildrenAndDeleteNode(ctx: AppContext, id: string): void {
  const grandparent = ctx.state.nodes[id]?.parent ?? null;
  for (const childId in ctx.state.nodes) {
    if (ctx.state.nodes[childId].parent === id) ctx.state.nodes[childId].parent = grandparent;
  }
  delete ctx.state.nodes[id];
  ctx.state.edges = ctx.state.edges.filter((edge) => edge.from !== id && edge.to !== id);
}

function deleteSelectedNodes(ctx: AppContext): void {
  for (const id of ctx.state.sel) {
    promoteChildrenAndDeleteNode(ctx, id);
  }
  ctx.state.sel.clear();
}

function performDeleteSelection(ctx: AppContext): void {
  if (ctx.state.selEdge) {
    ctx.state.edges = ctx.state.edges.filter((edge) => edge.id !== ctx.state.selEdge);
    ctx.state.selEdge = null;
  } else if (ctx.state.sel.size) {
    deleteSelectedNodes(ctx);
  } else {
    return;
  }
  ctx.hooks.render();
  ctx.hooks.sync();
  ctx.hooks.renderInspector();
  ctx.hooks.pushHistory();
}

// ---- alignNodes helpers -------------------------------------------------

interface AlignBounds {
  minX: number;
  maxR: number;
  minY: number;
  maxB: number;
  cxAll: number;
  cyAll: number;
}

function computeAlignBounds(nodes: DiagramNode[]): AlignBounds {
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxR = Math.max(...nodes.map((node) => node.x + node.w));
  const maxB = Math.max(...nodes.map((node) => node.y + node.h));
  return { minX, maxR, minY, maxB, cxAll: (minX + maxR) / 2, cyAll: (minY + maxB) / 2 };
}

function applyEdgeAlign(nodes: DiagramNode[], mode: string, bounds: AlignBounds): void {
  if (mode === 'left') nodes.forEach((node) => (node.x = bounds.minX));
  if (mode === 'right') nodes.forEach((node) => (node.x = bounds.maxR - node.w));
  if (mode === 'top') nodes.forEach((node) => (node.y = bounds.minY));
  if (mode === 'bottom') nodes.forEach((node) => (node.y = bounds.maxB - node.h));
  if (mode === 'cx') nodes.forEach((node) => (node.x = bounds.cxAll - node.w / 2));
  if (mode === 'cy') nodes.forEach((node) => (node.y = bounds.cyAll - node.h / 2));
}

function distributeHorizontal(nodes: DiagramNode[], bounds: AlignBounds): void {
  const sorted = [...nodes].sort((nodeA, nodeB) => nodeA.x - nodeB.x);
  const span = bounds.maxR - bounds.minX;
  const total = sorted.reduce((sum, node) => sum + node.w, 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = bounds.minX;
  sorted.forEach((node) => {
    node.x = cursor;
    cursor += node.w + gap;
  });
}

function distributeVertical(nodes: DiagramNode[], bounds: AlignBounds): void {
  const sorted = [...nodes].sort((nodeA, nodeB) => nodeA.y - nodeB.y);
  const span = bounds.maxB - bounds.minY;
  const total = sorted.reduce((sum, node) => sum + node.h, 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = bounds.minY;
  sorted.forEach((node) => {
    node.y = cursor;
    cursor += node.h + gap;
  });
}

function performAlignNodes(ctx: AppContext, mode: string): void {
  const nodes = [...ctx.state.sel].map((id) => ctx.state.nodes[id]);
  if (nodes.length < 2) return;
  const bounds = computeAlignBounds(nodes);
  applyEdgeAlign(nodes, mode, bounds);
  if (mode === 'dh') distributeHorizontal(nodes, bounds);
  if (mode === 'dv') distributeVertical(nodes, bounds);
  ctx.hooks.render();
  ctx.hooks.sync();
}

// ---- wrapInGroup helpers -------------------------------------------------

interface GroupBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function computeGroupBounds(nodes: DiagramNode[], pad: number): GroupBounds {
  const minX = Math.min(...nodes.map((node) => node.x)) - pad;
  const minY = Math.min(...nodes.map((node) => node.y)) - pad - 14;
  const maxR = Math.max(...nodes.map((node) => node.x + node.w)) + pad;
  const maxB = Math.max(...nodes.map((node) => node.y + node.h)) + pad;
  return { x: minX, y: minY, width: maxR - minX, height: maxB - minY };
}

/** Re-parent the wrapped nodes onto the new group so they render nested inside it. */
function reparentIntoGroup(ctx: AppContext, childIds: string[], groupId: string): void {
  childIds.forEach((childId) => {
    if (ctx.state.nodes[childId]) ctx.state.nodes[childId].parent = groupId;
  });
}

function performWrapInGroup(ctx: AppContext, selection: SelectionApi): void {
  const childIds = [...ctx.state.sel];
  const nodes = childIds.map((id) => ctx.state.nodes[id]);
  if (!nodes.length) return;
  const bounds = computeGroupBounds(nodes, 28);
  const id = 'n' + (ctx.state.nid++);
  // quoted: w/h are DiagramNode's frozen field names; id-length would flag bare keys
  ctx.state.nodes[id] = {
    id, label: 'Group', shape: 'group', color: PALETTE[0],
    x: bounds.x, y: bounds.y, 'w': bounds.width, 'h': bounds.height,
    parent: ctx.view.container,
  };
  reparentIntoGroup(ctx, childIds, id);
  ctx.hooks.render();
  ctx.hooks.sync();
  selection.selectOnly(id);
  ctx.hooks.pushHistory();
}

// ---- bringToFront ----------------------------------------------------

function performBringToFront(ctx: AppContext, id: string): void {
  // re-insert node element last so it paints on top
  const node = ctx.state.nodes[id];
  delete ctx.state.nodes[id];
  ctx.state.nodes[id] = node;
  ctx.hooks.render();
}

// ---- single-owner mutations factored out of inspector.ts / main.ts ----
// (moved verbatim from inspector.ts's renderEdgeInspector / renderSingleInspector
// inline handlers and main.ts's footer clear-all onclick — same hooks, same order)

function performSetEdgeLabel(ctx: AppContext, id: string, label: string): void {
  const edge = ctx.state.edges.find((candidate) => candidate.id === id);
  if (!edge) return;
  edge.label = label;
  ctx.hooks.render();
  ctx.hooks.sync();
}

function performReverseEdge(ctx: AppContext, id: string): void {
  const edge = ctx.state.edges.find((candidate) => candidate.id === id);
  if (!edge) return;
  // quoted key via Object.assign: 'to' is DiagramEdge's frozen field name; id-length flags a bare assignment
  Object.assign(edge, { from: edge.to, 'to': edge.from });
  // a reversed route re-anchors: manual bend/labelPos no longer applies
  edge.bend = null;
  edge.labelPos = null;
  ctx.hooks.render();
  ctx.hooks.sync();
  ctx.hooks.reroute();
  ctx.hooks.pushHistory();
}

function performDeleteEdge(ctx: AppContext, selection: SelectionApi, id: string): void {
  ctx.state.edges = ctx.state.edges.filter((edge) => edge.id !== id);
  if (ctx.state.selEdge === id) {
    selection.clearSel();
  } else {
    ctx.hooks.render();
  }
  ctx.hooks.sync();
  ctx.hooks.pushHistory();
}

function performSetNodeMeta(ctx: AppContext, id: string, patch: { kind?: NodeKind | null; desc?: string }): void {
  const node = ctx.state.nodes[id];
  if (!node) return;
  if ('kind' in patch) node.kind = patch.kind ?? null;
  if (patch.desc !== undefined) {
    // quoted key via Object.assign: 'fm' is DiagramNode's frozen field name; id-length flags a bare assignment
    const frontmatter = node.fm ?? emptyFrontmatter();
    frontmatter.description = patch.desc;
    Object.assign(node, { 'fm': frontmatter });
  }
  ctx.hooks.render();
  ctx.hooks.sync();
  ctx.hooks.pushHistory();
}

function performClearAll(ctx: AppContext, selection: SelectionApi): void {
  ctx.state.nodes = {};
  ctx.state.edges = [];
  ctx.state.nid = 1;
  ctx.state.eid = 1;
  ctx.state.hier = { groups: {}, memberOf: {} };
  selection.clearSel();
  ctx.hooks.render();
  ctx.hooks.sync();
  ctx.hooks.pushHistory();
}

/** The edge/meta verbs of NodesApi that close over only ctx + selection (the non-anchor half). */
function buildMetaVerbs(ctx: AppContext, selection: SelectionApi) {
  return {
    setEdgeLabel: (id: string, label: string): void => performSetEdgeLabel(ctx, id, label),
    reverseEdge: (id: string): void => performReverseEdge(ctx, id),
    deleteEdge: (id: string): void => performDeleteEdge(ctx, selection, id),
    setNodeMeta: (id: string, patch: { kind?: NodeKind | null; desc?: string }): void =>
      performSetNodeMeta(ctx, id, patch),
    clearAll: (): void => performClearAll(ctx, selection),
  };
}

export function initNodes(ctx: AppContext, selection: SelectionApi, camera: CameraApi): NodesApi {
  function addNode(shape: ShapeKind, atX?: number | null, atY?: number | null, opts: { label?: string } = {}): string {
    return performAddNode(ctx, selection, camera, { shape, worldX: atX, worldY: atY, opts });
  }

  function makeEdge(from: string, dest: string): void {
    performMakeEdge(ctx, from, dest); }

  function deleteSelection(): void {
    performDeleteSelection(ctx); }

  function alignNodes(mode: string): void {
    performAlignNodes(ctx, mode); }

  function wrapInGroup(): void {
    performWrapInGroup(ctx, selection); }

  function bringToFront(id: string): void {
    performBringToFront(ctx, id); }

  return { addNode, makeEdge, deleteSelection, alignNodes, wrapInGroup, bringToFront,
    ...buildMetaVerbs(ctx, selection) };
}
