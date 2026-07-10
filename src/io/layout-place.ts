/* =====================================================================
   layout-place.ts — auto-layout placement phase (see layout.ts header)
   ---------------------------------------------------------------------
   Positions spine nodes within their layer bands, parks satellites beside
   their anchors, inlines mixed-group satellites and wraps group boxes.
   Split out of layout.ts to keep each module under the size cap.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { DiagramNode, FlowDir } from '../core/types/types';
import type { StateStore } from '../core/state/state';
import { snapV } from '../core/state/state';
import { anchorOf, isSpineEdge } from './layout-capture';
import type { SpineLayers } from './layout-order';

/** Gap between siblings within one layer. */
const SIBLING_GAP = 150;
/** Gap between consecutive layers. */
const LAYER_GAP = 200;
/** Canvas origin for the whole layout. */
const ORIGIN_X = 80;
const ORIGIN_Y = 80;
/** Padding between a group box and the members it wraps. */
const GROUP_PAD = 34;
/** Extra top space reserved inside a group box for its title tab. */
const GROUP_LABEL_PAD = 26;

/** Rendered size of a node including its frontmatter card. */
export interface Footprint { w: number; h: number; }

/** Cross-axis extent of the whole spine, footprint-based (card overhang included). */
export function spineCrossBounds(
  state: StateStore, spine: Set<string>, foot: Record<string, Footprint>, horizontal: boolean,
): { min: number; max: number } {
  let min = Infinity, max = -Infinity;
  for (const id of spine) {
    const node = state.nodes[id], size = foot[id];
    const boxC0 = horizontal ? node.y : node.x;
    const boxLen = horizontal ? node.h : node.w;
    const footLen = horizontal ? size.h : size.w;
    const over = (footLen - boxLen) / 2;       // card overhangs the box equally each side
    min = Math.min(min, boxC0 - over);
    max = Math.max(max, boxC0 + boxLen + over);
  }
  return { min, max };
}

/** Split satellites into per-group clusters (kept contiguous) vs loose singles. */
export function partitionSatellites(sats: string[], memberGroup: Record<string, string>): {
  clusters: Record<string, string[]>; loose: string[];
} {
  const clusters: Record<string, string[]> = {};
  const loose: string[] = [];
  for (const sat of sats) {
    const groupId = memberGroup[sat];
    if (groupId) {
      (clusters[groupId] ||= []).push(sat);
    } else {
      loose.push(sat);
    }
  }
  return { clusters, loose };
}

/** One satellite-placement run: shared geometry plus the mutable cross-axis cursors. */
interface PlacementCtx {
  ctx: AppContext;
  spine: Set<string>;
  foot: Record<string, Footprint>;
  horizontal: boolean;
}
interface SatRun extends PlacementCtx {
  afterBase: number;
  beforeBase: number;
  cursor: { after: number; before: number };
  afterCrossEnd: number;
}

/** Lay one satellite at an explicit cross position, stacked along the main axis. */
function laySatellite(run: SatRun, satId: string, mainStart: number, crossPos: number): number {
  const { state } = run.ctx;
  const node = state.nodes[satId];
  const size = run.foot[satId];
  const fCross = run.horizontal ? size.h : size.w;
  const boxDim = run.horizontal ? node.h : node.w;
  const boxCross = crossPos + (fCross - boxDim) / 2;
  if (run.horizontal) {
    node.x = snapV(mainStart, run.ctx.snap);
    node.y = snapV(boxCross, run.ctx.snap);
  } else {
    node.y = snapV(mainStart, run.ctx.snap);
    node.x = snapV(boxCross, run.ctx.snap);
  }
  return mainStart + (run.horizontal ? size.w : size.h);
}

/** Place one satellite beside its anchor, alternating to the far side of the spine. */
function placeSatelliteOne(run: SatRun, satId: string, aMain: number, side: 'after' | 'before'): void {
  const size = run.foot[satId];
  const fCross = run.horizontal ? size.h : size.w;
  const crossPos = side === 'after' ? run.afterBase : run.beforeBase - fCross;
  const start = Math.max(aMain, run.cursor[side] + SIBLING_GAP);
  run.cursor[side] = laySatellite(run, satId, start, crossPos);
  if (side === 'after') run.afterCrossEnd = Math.max(run.afterCrossEnd, run.afterBase + fCross);
}

/** Group loose satellites by the spine node that anchors them (unanchored ones separate). */
function groupByAnchor(
  state: StateStore, spine: Set<string>, loose: string[],
): { byAnchor: Record<string, string[]>; unanchored: string[] } {
  const byAnchor: Record<string, string[]> = {};
  const unanchored: string[] = [];
  for (const sat of loose) {
    const anchorId = anchorOf(state, sat, spine);
    if (anchorId) {
      (byAnchor[anchorId] ||= []).push(sat);
    } else {
      unanchored.push(sat);
    }
  }
  return { byAnchor, unanchored };
}

/**
 * Place loose (non-clustered) satellites beside their anchor, in main-axis
 * order, alternating sides so reference links read as short hops off the trunk.
 */
function placeLooseSatellites(
  run: SatRun, spine: Set<string>, loose: string[], mainOf: (id: string) => number,
): void {
  const { byAnchor, unanchored } = groupByAnchor(run.ctx.state, spine, loose);
  const anchors = Object.keys(byAnchor).sort((idA, idB) => mainOf(idA) - mainOf(idB));
  for (const anchorId of anchors) {
    const aMain = mainOf(anchorId);
    byAnchor[anchorId].forEach((sat, i) => placeSatelliteOne(run, sat, aMain, i % 2 === 0 ? 'after' : 'before'));
  }
  unanchored.forEach((sat, i) => placeSatelliteOne(run, sat, ORIGIN_Y, i % 2 === 0 ? 'after' : 'before'));
}

/** Total main-axis run length of a contiguous cluster, footprint-based, gap between members. */
function clusterRunLength(members: string[], run: SatRun): number {
  return members.reduce(
    (total, sat) => total + (run.horizontal ? run.foot[sat].w : run.foot[sat].h) + SIBLING_GAP,
    -SIBLING_GAP,
  );
}

/**
 * Lay out all-satellite group clusters as compact contiguous runs on their
 * own band, clear below the loose satellites and centred under the nodes
 * they serve — a separate, readable zone instead of a box smeared across
 * the whole diagram.
 */
function placeSatelliteClusters(
  run: SatRun, clusters: Record<string, string[]>, anchorMain: (satId: string) => number, clusterBase: number,
): void {
  const clusterIds = Object.keys(clusters);
  if (!clusterIds.length) return;
  const centroid = (members: string[]): number =>
    members.reduce((sum, sat) => sum + anchorMain(sat), 0) / members.length;
  clusterIds.sort((idA, idB) => centroid(clusters[idA]) - centroid(clusters[idB]));
  let clusterCursor = -Infinity;
  for (const groupId of clusterIds) {
    const members = clusters[groupId];
    members.sort((idA, idB) => anchorMain(idA) - anchorMain(idB));
    // centre the run on its centroid; never overlap the previous cluster
    let start = Math.max(centroid(members) - clusterRunLength(members, run) / 2, clusterCursor + SIBLING_GAP * 2);
    for (const sat of members) start = laySatellite(run, sat, start, clusterBase) + SIBLING_GAP;
    clusterCursor = start;
  }
}

/** Build one satellite-placement run's starting geometry from the spine's cross bounds. */
function buildSatRun(placement: PlacementCtx, cMin: number, cMax: number): SatRun {
  const afterBase = cMax + LAYER_GAP;
  return {
    ...placement, afterBase, beforeBase: cMin - LAYER_GAP,
    cursor: { after: -Infinity, before: -Infinity }, afterCrossEnd: afterBase,
  };
}

/**
 * Park each satellite beside the spine node it references. Satellites never
 * enter the layered band. For each anchor they alternate to the far side of
 * the spine (after/before on the cross axis) and stack along the main axis,
 * so reference links read as short hops off the trunk instead of pulling
 * the trunk out of shape. Satellites sharing a group are kept as one
 * contiguous cluster; the rest are parked individually beside their anchor.
 */
export function placeSatellites(
  sats: string[], memberGroup: Record<string, string>, placement: PlacementCtx,
): void {
  if (!sats.length || !placement.spine.size) return;
  const { state } = placement.ctx;

  const { min: cMin, max: cMax } = spineCrossBounds(state, placement.spine, placement.foot, placement.horizontal);
  const run = buildSatRun(placement, cMin, cMax);

  const mainOf = (id: string): number => (placement.horizontal ? state.nodes[id].x : state.nodes[id].y);
  const anchorMain = (satId: string): number => {
    const anchorId = anchorOf(state, satId, placement.spine);
    return anchorId != null ? mainOf(anchorId) : ORIGIN_Y;
  };

  const { clusters, loose } = partitionSatellites(sats, memberGroup);
  placeLooseSatellites(run, placement.spine, loose, mainOf);

  const clusterBase = run.afterCrossEnd > run.afterBase ? run.afterCrossEnd + LAYER_GAP : run.afterBase;
  placeSatelliteClusters(run, clusters, anchorMain, clusterBase);
}

/** Axis-aligned bounds of a set of member nodes at full footprint (box + card). */
interface Bounds { minX: number; minY: number; maxX: number; maxY: number; }

/** Bounding box of every member at full footprint (box + card, card centred under the box). */
function memberBounds(state: StateStore, members: string[], foot: Record<string, Footprint>): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of members) {
    const node = state.nodes[id];
    const size = foot[id] ?? { 'w': node.w, 'h': node.h };
    const overX = (size.w - node.w) / 2;   // card is centred under the box
    minX = Math.min(minX, node.x - overX);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x - overX + size.w);
    maxY = Math.max(maxY, node.y + size.h);
  }
  return { minX, minY, maxX, maxY };
}

/** Resize one group box (position + extra top pad for the title tab) to fit its bounds. */
function applyGroupBox(ctx: AppContext, groupNode: DiagramNode, bounds: Bounds): void {
  groupNode.x = snapV(bounds.minX - GROUP_PAD, ctx.snap);
  // extra top pad so the title tab sits clear above the first member
  groupNode.y = snapV(bounds.minY - GROUP_PAD - GROUP_LABEL_PAD, ctx.snap);
  groupNode['w'] = (bounds.maxX - bounds.minX) + GROUP_PAD * 2;
  groupNode['h'] = (bounds.maxY - bounds.minY) + GROUP_PAD * 2 + GROUP_LABEL_PAD;
}

/** Grow each group box to wrap members at full footprint (box + card). */
export function wrapGroups(ctx: AppContext, mem: Record<string, string[]>, foot: Record<string, Footprint>): void {
  const { state } = ctx;
  for (const groupId in mem) {
    const members = mem[groupId];
    if (!members.length) continue;
    const bounds = memberBounds(state, members, foot);
    applyGroupBox(ctx, state.nodes[groupId], bounds);
  }
}

/** Which group (if any) owns each node, across all groups. */
function groupOfNodeMap(groupMem: Record<string, string[]>): Record<string, string> {
  const groupOfNode: Record<string, string> = {};
  for (const groupId in groupMem) {
    for (const id of groupMem[groupId]) groupOfNode[id] = groupId;
  }
  return groupOfNode;
}

/** Shared state for inlining one group's satellites into its spine layer row. */
interface InlineCtx {
  state: StateStore;
  spine: Set<string>;
  layers: SpineLayers;
  groupOfNode: Record<string, string>;
  inlineSet: Set<string>;
}

/** Inline one mixed group's satellites beside a groupmate in the spine band. */
function inlineGroupSatellites(ictx: InlineCtx, groupId: string, groupMem: Record<string, string[]>): void {
  const spineMembers = groupMem[groupId].filter((id) => ictx.spine.has(id));
  const satMembers = groupMem[groupId].filter((id) => !ictx.spine.has(id));
  if (!spineMembers.length || !satMembers.length) return; // mixed groups only
  // attach to the satellite's own anchor when that anchor is a groupmate,
  // else to the group's first spine member (lowest layer) as a stable host
  const fallbackHost = spineMembers.slice().sort((idA, idB) => ictx.layers.layer[idA] - ictx.layers.layer[idB])[0];
  for (const sat of satMembers) {
    const anchorId = anchorOf(ictx.state, sat, ictx.spine);
    const host = anchorId != null && ictx.groupOfNode[anchorId] === groupId ? anchorId : fallbackHost;
    const row = ictx.layers.byLayer[ictx.layers.layer[host]];
    row.splice(row.indexOf(host) + 1, 0, sat);
    ictx.layers.layer[sat] = ictx.layers.layer[host];
    ictx.inlineSet.add(sat);
  }
}

/**
 * Mixed groups (some spine members, some satellites): inline each satellite
 * into the band right beside a groupmate. It gets a real cross slot — so no
 * overlaps — and the group box stays as tight as its spine block instead of
 * stretching out to wherever the satellite would otherwise be parked.
 */
export function inlineMixedGroupSatellites(
  state: StateStore, groupMem: Record<string, string[]>, spine: Set<string>, layers: SpineLayers,
): Set<string> {
  const groupOfNode = groupOfNodeMap(groupMem);
  const inlineSet = new Set<string>();
  const ictx: InlineCtx = { state, spine, layers, groupOfNode, inlineSet };
  for (const groupId in groupMem) inlineGroupSatellites(ictx, groupId, groupMem);
  return inlineSet;
}

/** Max element footprint along the layering axis for one layer. */
function layerThickness(
  layerIdx: number, byLayer: Record<number, string[]>, foot: Record<string, Footprint>, horizontal: boolean,
): number {
  return Math.max(...byLayer[layerIdx].map((id) => (horizontal ? foot[id].w : foot[id].h)));
}

/** Total cross-axis run (siblings side by side, with gaps) for one layer. */
function layerCrossRun(
  layerIdx: number, byLayer: Record<number, string[]>, foot: Record<string, Footprint>, horizontal: boolean,
): number {
  const sizes = byLayer[layerIdx].map((id) => (horizontal ? foot[id].h : foot[id].w));
  return sizes.reduce((sum, size) => sum + size, 0) + SIBLING_GAP * Math.max(0, byLayer[layerIdx].length - 1);
}

/** Main-axis start offset of each layer band, and the total main-axis span. */
function layerMainStarts(layers: number[], thickness: number[]): { mainStart: number[]; mainTotal: number } {
  const mainStart: number[] = [];
  let acc = 0;
  layers.forEach((_, i) => {
    mainStart[i] = acc;
    acc += thickness[i] + LAYER_GAP;
  });
  return { mainStart, mainTotal: acc - LAYER_GAP };
}

/** Geometry needed to place every node of one layer band. */
interface BandPlacement {
  ctx: AppContext;
  foot: Record<string, Footprint>;
  horizontal: boolean;
  band: number;
  thickness: number;
  startCross: number;
}

/** Position every node of one layer band along the flow direction. */
function placeLayerNodes(ids: string[], placement: BandPlacement): void {
  const { state } = placement.ctx;
  let cross = placement.startCross;
  for (const id of ids) {
    const node = state.nodes[id];
    const size = placement.foot[id];
    if (placement.horizontal) {
      // layers along X (centre box in band), siblings along Y (top-align)
      node.x = snapV(ORIGIN_X + placement.band + (placement.thickness - node.w) / 2, placement.ctx.snap);
      node.y = snapV(ORIGIN_Y + cross, placement.ctx.snap);
      cross += size.h + SIBLING_GAP;
    } else {
      // layers along Y (top-align box in band), siblings along X (centre slot)
      node.x = snapV(ORIGIN_X + cross + (size.w - node.w) / 2, placement.ctx.snap);
      node.y = snapV(ORIGIN_Y + placement.band, placement.ctx.snap);
      cross += size.w + SIBLING_GAP;
    }
  }
}

/** Position each spine node within its layer band, along the flow direction. Returns whether layers advance along X. */
export function positionSpineLayers(
  ctx: AppContext, spine: SpineLayers, foot: Record<string, Footprint>, dir: FlowDir,
): boolean {
  const horizontal = dir === 'LR' || dir === 'RL'; // layers advance along X
  const reversed = dir === 'BT' || dir === 'RL';    // layer 0 placed last
  const { layers, byLayer } = spine;

  const thickness = layers.map((layerIdx) => layerThickness(layerIdx, byLayer, foot, horizontal));
  const crossRun = layers.map((layerIdx) => layerCrossRun(layerIdx, byLayer, foot, horizontal));
  const maxCross = Math.max(...crossRun);
  const { mainStart, mainTotal } = layerMainStarts(layers, thickness);

  layers.forEach((layerIdx, i) => {
    const band = reversed ? mainTotal - mainStart[i] - thickness[i] : mainStart[i];
    const startCross = (maxCross - crossRun[i]) / 2;
    placeLayerNodes(byLayer[layerIdx], { ctx, foot, horizontal, band, thickness: thickness[i], startCross });
  });
  return horizontal;
}

/**
 * Groups whose members are ALL satellites become clustering candidates for
 * placeSatellites (e.g. the store and persistence bands). A group that also
 * holds spine nodes keeps its satellites parked beside their anchors, so
 * adding a clustered member can't stretch the box across the whole diagram.
 */
export function clusterCandidateGroups(groupMem: Record<string, string[]>, spine: Set<string>): Record<string, string> {
  const memberGroup: Record<string, string> = {};
  for (const groupId in groupMem) {
    const members = groupMem[groupId];
    if (members.length && members.every((id) => !spine.has(id))) {
      for (const id of members) memberGroup[id] = groupId;
    }
  }
  return memberGroup;
}

/** Reference edges route as right-angle elbows so they branch off the trunk. */
export function markReferenceEdgesOrtho(state: StateStore): void {
  for (const edge of state.edges) {
    if (!isSpineEdge(edge)) edge.routing = 'ortho';
  }
}
