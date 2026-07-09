/* =====================================================================
   layout-place.ts — auto-layout placement phase (see layout.ts header)
   ---------------------------------------------------------------------
   Positions spine nodes within their layer bands, parks satellites beside
   their anchors, inlines mixed-group satellites and wraps group boxes.
   Split out of layout.ts to keep each module under the size cap.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { FlowDir } from '../core/types/types';
import type { StateStore } from '../core/state/state';
import { snapV } from '../core/state/state';
import { anchorOf, isSpineEdge } from './layout-capture';

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
export function spineCrossBounds(state: StateStore, spine: Set<string>, foot: Record<string, Footprint>, horizontal: boolean): { min: number; max: number } {
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
    if (groupId) (clusters[groupId] ||= []).push(sat); else loose.push(sat);
  }
  return { clusters, loose };
}

/**
 * Place loose (non-clustered) satellites beside their anchor, in main-axis
 * order, alternating sides so reference links read as short hops off the trunk.
 */
export function placeLooseSatellites(
  state: StateStore, loose: string[], spine: Set<string>, mainOf: (id: string) => number,
  placeOne: (s: string, aMain: number, side: 'after' | 'before') => void,
): void {
  const byAnchor: Record<string, string[]> = {};
  const unanchored: string[] = [];
  for (const sat of loose) {
    const anchorId = anchorOf(state, sat, spine);
    if (anchorId) (byAnchor[anchorId] ||= []).push(sat); else unanchored.push(sat);
  }
  const anchors = Object.keys(byAnchor).sort((a, b) => mainOf(a) - mainOf(b));
  for (const anchorId of anchors) {
    const aMain = mainOf(anchorId);
    byAnchor[anchorId].forEach((s, i) => placeOne(s, aMain, i % 2 === 0 ? 'after' : 'before'));
  }
  unanchored.forEach((s, i) => placeOne(s, ORIGIN_Y, i % 2 === 0 ? 'after' : 'before'));
}

/**
 * Lay out all-satellite group clusters as compact contiguous runs on their
 * own band, clear below the loose satellites and centred under the nodes
 * they serve — a separate, readable zone instead of a box smeared across
 * the whole diagram.
 */
export function placeSatelliteClusters(
  clusters: Record<string, string[]>, anchorMain: (s: string) => number,
  foot: Record<string, Footprint>, horizontal: boolean, clusterBase: number,
  lay: (s: string, mainStart: number, crossPos: number) => number,
): void {
  const clusterIds = Object.keys(clusters);
  if (!clusterIds.length) return;
  const centroid = (members: string[]): number =>
    members.reduce((sum, s) => sum + anchorMain(s), 0) / members.length;
  const runLen = (members: string[]): number =>
    members.reduce((a, s) => a + (horizontal ? foot[s].w : foot[s].h) + SIBLING_GAP, -SIBLING_GAP);
  clusterIds.sort((a, b) => centroid(clusters[a]) - centroid(clusters[b]));
  let clusterCursor = -Infinity;
  for (const groupId of clusterIds) {
    const members = clusters[groupId];
    members.sort((a, b) => anchorMain(a) - anchorMain(b));
    // centre the run on its centroid; never overlap the previous cluster
    let start = Math.max(centroid(members) - runLen(members) / 2, clusterCursor + SIBLING_GAP * 2);
    for (const sat of members) start = lay(sat, start, clusterBase) + SIBLING_GAP;
    clusterCursor = start;
  }
}

/**
 * Park each satellite beside the spine node it references. Satellites never
 * enter the layered band. For each anchor they alternate to the far side of
 * the spine (after/before on the cross axis) and stack along the main axis,
 * so reference links read as short hops off the trunk instead of pulling
 * the trunk out of shape.
 */
export function placeSatellites(
  ctx: AppContext,
  sats: string[], spine: Set<string>, foot: Record<string, Footprint>, horizontal: boolean,
  memberGroup: Record<string, string>,
): void {
  if (!sats.length || !spine.size) return;
  const { state } = ctx;

  const { min: cMin, max: cMax } = spineCrossBounds(state, spine, foot, horizontal);
  const afterBase = cMax + LAYER_GAP;
  const beforeBase = cMin - LAYER_GAP;

  const mainOf = (id: string): number => (horizontal ? state.nodes[id].x : state.nodes[id].y);
  const anchorMain = (s: string): number => {
    const anchorId = anchorOf(state, s, spine);
    return anchorId != null ? mainOf(anchorId) : ORIGIN_Y;
  };

  // satellites that belong to the same group are placed as one contiguous
  // run so their group box stays compact; the rest are parked individually
  // beside the node that references them.
  const { clusters, loose } = partitionSatellites(sats, memberGroup);

  const cursor = { after: -Infinity, before: -Infinity };
  // bottom of the loose 'after' band, so clusters can sit clear below it
  let afterCrossEnd = afterBase;
  // lay one satellite at an explicit cross position, stacked along the main axis
  const lay = (s: string, mainStart: number, crossPos: number): number => {
    const node = state.nodes[s], size = foot[s];
    const fCross = horizontal ? size.h : size.w;
    const boxDim = horizontal ? node.h : node.w;
    const boxCross = crossPos + (fCross - boxDim) / 2;
    if (horizontal) { node.x = snapV(mainStart, ctx.snap); node.y = snapV(boxCross, ctx.snap); }
    else { node.y = snapV(mainStart, ctx.snap); node.x = snapV(boxCross, ctx.snap); }
    return mainStart + (horizontal ? size.w : size.h);
  };
  const placeOne = (s: string, aMain: number, side: 'after' | 'before'): void => {
    const size = foot[s];
    const fCross = horizontal ? size.h : size.w;
    const crossPos = side === 'after' ? afterBase : beforeBase - fCross;
    const start = Math.max(aMain, cursor[side] + SIBLING_GAP);
    cursor[side] = lay(s, start, crossPos);
    if (side === 'after') afterCrossEnd = Math.max(afterCrossEnd, afterBase + fCross);
  };

  // 1) loose satellites beside their anchor
  placeLooseSatellites(state, loose, spine, mainOf, placeOne);

  // 2) all-satellite groups (e.g. the store + persistence bands) become
  //    contiguous clusters on their own band
  const clusterBase = afterCrossEnd > afterBase ? afterCrossEnd + LAYER_GAP : afterBase;
  placeSatelliteClusters(clusters, anchorMain, foot, horizontal, clusterBase, lay);
}

/** Grow each group box to wrap members at full footprint (box + card). */
export function wrapGroups(ctx: AppContext, mem: Record<string, string[]>, foot: Record<string, Footprint>): void {
  const { state } = ctx;
  for (const groupId in mem) {
    const members = mem[groupId];
    if (!members.length) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of members) {
      const node = state.nodes[id];
      const size = foot[id] ?? { w: node.w, h: node.h };
      const overX = (size.w - node.w) / 2;   // card is centred under the box
      minX = Math.min(minX, node.x - overX);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x - overX + size.w);
      maxY = Math.max(maxY, node.y + size.h);
    }
    const groupNode = state.nodes[groupId];
    groupNode.x = snapV(minX - GROUP_PAD, ctx.snap);
    // extra top pad so the title tab sits clear above the first member
    groupNode.y = snapV(minY - GROUP_PAD - GROUP_LABEL_PAD, ctx.snap);
    groupNode.w = (maxX - minX) + GROUP_PAD * 2;
    groupNode.h = (maxY - minY) + GROUP_PAD * 2 + GROUP_LABEL_PAD;
  }
}

/**
 * Mixed groups (some spine members, some satellites): inline each satellite
 * into the band right beside a groupmate. It gets a real cross slot — so no
 * overlaps — and the group box stays as tight as its spine block instead of
 * stretching out to wherever the satellite would otherwise be parked.
 */
export function inlineMixedGroupSatellites(
  state: StateStore, groupMem: Record<string, string[]>, spine: Set<string>, layer: Record<string, number>,
  byLayer: Record<number, string[]>,
): Set<string> {
  const groupOfNode: Record<string, string> = {};
  for (const groupId in groupMem) for (const id of groupMem[groupId]) groupOfNode[id] = groupId;

  const inlineSet = new Set<string>();
  for (const groupId in groupMem) {
    const spineMembers = groupMem[groupId].filter((id) => spine.has(id));
    const satMembers = groupMem[groupId].filter((id) => !spine.has(id));
    if (!spineMembers.length || !satMembers.length) continue; // mixed groups only
    // attach to the satellite's own anchor when that anchor is a groupmate,
    // else to the group's first spine member (lowest layer) as a stable host
    const fallbackHost = spineMembers.slice().sort((a, b) => layer[a] - layer[b])[0];
    for (const sat of satMembers) {
      const anchorId = anchorOf(state, sat, spine);
      const host = anchorId != null && groupOfNode[anchorId] === groupId ? anchorId : fallbackHost;
      const row = byLayer[layer[host]];
      row.splice(row.indexOf(host) + 1, 0, sat);
      layer[sat] = layer[host];
      inlineSet.add(sat);
    }
  }
  return inlineSet;
}

/** Position each spine node within its layer band, along the flow direction. Returns whether layers advance along X. */
export function positionSpineLayers(
  ctx: AppContext, layers: number[], byLayer: Record<number, string[]>, foot: Record<string, Footprint>, dir: FlowDir,
): boolean {
  const { state } = ctx;
  const horizontal = dir === 'LR' || dir === 'RL'; // layers advance along X
  const reversed = dir === 'BT' || dir === 'RL';    // layer 0 placed last

  const thickness = layers.map((L) =>
    Math.max(...byLayer[L].map((id) => (horizontal ? foot[id].w : foot[id].h))));
  const crossRun = layers.map((L) => {
    const sizes = byLayer[L].map((id) => (horizontal ? foot[id].h : foot[id].w));
    return sizes.reduce((a, b) => a + b, 0) + SIBLING_GAP * Math.max(0, byLayer[L].length - 1);
  });
  const maxCross = Math.max(...crossRun);

  const mainStart: number[] = [];
  let acc = 0;
  layers.forEach((_, i) => { mainStart[i] = acc; acc += thickness[i] + LAYER_GAP; });
  const mainTotal = acc - LAYER_GAP;

  layers.forEach((L, i) => {
    const band = reversed ? mainTotal - mainStart[i] - thickness[i] : mainStart[i];
    let cross = (maxCross - crossRun[i]) / 2;
    for (const id of byLayer[L]) {
      const node = state.nodes[id];
      const size = foot[id];
      if (horizontal) {
        // layers along X (centre box in band), siblings along Y (top-align)
        node.x = snapV(ORIGIN_X + band + (thickness[i] - node.w) / 2, ctx.snap);
        node.y = snapV(ORIGIN_Y + cross, ctx.snap);
        cross += size.h + SIBLING_GAP;
      } else {
        // layers along Y (top-align box in band), siblings along X (centre slot)
        node.x = snapV(ORIGIN_X + cross + (size.w - node.w) / 2, ctx.snap);
        node.y = snapV(ORIGIN_Y + band, ctx.snap);
        cross += size.w + SIBLING_GAP;
      }
    }
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
