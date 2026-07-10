/* =====================================================================
   layout-order.ts — auto-layout layering + ordering (see layout.ts header)
   ---------------------------------------------------------------------
   Builds the cycle-free forward spine graph, assigns longest-path layers
   (Kahn) and orders each layer by barycenter to reduce crossings. Split
   out of layout.ts to keep each module under the size cap.
   ===================================================================== */

import type { StateStore } from '../core/state/state';
import { isSpineEdge, edgeKey, findBackEdges } from './layout-capture';

/** Barycenter ordering sweeps (down-only; more = tidier, slower). */
const CROSS_SWEEPS = 2;

/** Forward graph (cycle-free) used for layering + ordering. */
export interface Forward {
  out: Record<string, string[]>;
  indeg: Record<string, number>;
  parents: Record<string, string[]>;
}

/** Spine set, its declared roots, and DFS order — bundled so forwardGraph stays under the param cap. */
export interface SpineInfo {
  spineIds: string[];
  spine: Set<string>;
  rootSet: Set<string>;
}

/**
 * Build the cycle-free spine forward graph. Skips reference edges, group
 * edges, back-edges, and any edge whose target is a declared root (so a
 * declared root always lands at layer 0).
 */
export function forwardGraph(state: StateStore, info: SpineInfo, back: Set<string>): Forward {
  const out: Record<string, string[]> = {};
  const indeg: Record<string, number> = {};
  const parents: Record<string, string[]> = {};
  info.spineIds.forEach((id) => {
    out[id] = [];
    indeg[id] = 0;
    parents[id] = [];
  });
  state.edges.forEach((e) => {
    if (!isSpineEdge(e) || !out[e.from] || !info.spine.has(e.to)) return;
    if (back.has(edgeKey(e.from, e.to)) || info.rootSet.has(e.to)) return;
    out[e.from].push(e.to);
    indeg[e.to]++;
    parents[e.to].push(e.from);
  });
  return { out, indeg, parents };
}

/** Mutable Kahn-traversal state, bundled so relaxEdge stays under the param cap. */
interface KahnState {
  layer: Record<string, number>;
  deg: Record<string, number>;
  queue: string[];
}

/** Advance one forward edge's layer relaxation during Kahn's algorithm. */
function relaxEdge(nextId: string, fromId: string, kahn: KahnState): void {
  kahn.layer[nextId] = Math.max(kahn.layer[nextId], kahn.layer[fromId] + 1);
  if (--kahn.deg[nextId] <= 0) kahn.queue.push(nextId);
}

/** Longest-path layer index per node (Kahn) on the forward graph. */
export function assignLayers(ids: string[], fwd: Forward): Record<string, number> {
  const layer: Record<string, number> = {};
  ids.forEach((id) => {
    layer[id] = 0;
  });
  const deg = { ...fwd.indeg };
  const queue = ids.filter((id) => deg[id] === 0);
  const seen = new Set<string>();
  let guard = 0;
  while (queue.length && guard++ < 99999) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const nextId of fwd.out[id]) relaxEdge(nextId, id, { layer, deg, queue });
  }
  return layer;
}

/** Barycenter position for one node: mean position of its parents in the layer above. */
function barycenterKey(
  id: string, parents: Record<string, string[]>, pos: Record<string, number>, fallback: number,
): number {
  const parentPositions = parents[id].filter((parentId) => parentId in pos);
  if (!parentPositions.length) return fallback;
  return parentPositions.reduce((sum, parentId) => sum + pos[parentId], 0) / parentPositions.length;
}

/** Reorder one layer row by barycenter key and record the new positions. */
function reorderRow(row: string[], parents: Record<string, string[]>, pos: Record<string, number>): void {
  const key: Record<string, number> = {};
  row.forEach((id, i) => {
    key[id] = barycenterKey(id, parents, pos, i);
  });
  row.sort((idA, idB) => key[idA] - key[idB]);
  row.forEach((id, i) => {
    pos[id] = i;
  });
}

/**
 * Reorder each layer by the mean position of its parents in the layer
 * above (barycenter). Reduces edge crossings versus insertion order.
 * Down-only sweep: layer 0 keeps its order, each lower layer follows.
 */
export function orderByBarycenter(
  layers: number[], byLayer: Record<number, string[]>, parents: Record<string, string[]>,
): void {
  const pos: Record<string, number> = {};
  (byLayer[layers[0]] || []).forEach((id, i) => {
    pos[id] = i;
  });
  for (let sweep = 0; sweep < CROSS_SWEEPS; sweep++) {
    for (let layerIdx = 1; layerIdx < layers.length; layerIdx++) {
      reorderRow(byLayer[layers[layerIdx]], parents, pos);
    }
  }
}

/** Per-node layer index, nodes grouped by layer, and the ordered layer list. */
export interface SpineLayers {
  byLayer: Record<number, string[]>;
  layers: number[];
  layer: Record<string, number>;
}

/** Assign a layer index to every spine node and order each layer to reduce crossings. */
export function layerSpine(
  state: StateStore, spineIds: string[], spine: Set<string>, rootSet: Set<string>,
): SpineLayers {
  const back = findBackEdges(state, spineIds, spine);
  const fwd = forwardGraph(state, { spineIds, spine, rootSet }, back);
  const layer = assignLayers(spineIds, fwd);

  const byLayer: Record<number, string[]> = {};
  spineIds.forEach((id) => {
    (byLayer[layer[id]] ||= []).push(id);
  });
  const layers = Object.keys(byLayer).map(Number).sort((numA, numB) => numA - numB);

  orderByBarycenter(layers, byLayer, fwd.parents);
  return { byLayer, layers, layer };
}
