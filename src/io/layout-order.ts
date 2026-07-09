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

/**
 * Build the cycle-free spine forward graph. Skips reference edges, group
 * edges, back-edges, and any edge whose target is a declared root (so a
 * declared root always lands at layer 0).
 */
export function forwardGraph(state: StateStore, spineIds: string[], spine: Set<string>, back: Set<string>, rootSet: Set<string>): Forward {
  const out: Record<string, string[]> = {};
  const indeg: Record<string, number> = {};
  const parents: Record<string, string[]> = {};
  spineIds.forEach((id) => { out[id] = []; indeg[id] = 0; parents[id] = []; });
  state.edges.forEach((e) => {
    if (!isSpineEdge(e) || !out[e.from] || !spine.has(e.to)) return;
    if (back.has(edgeKey(e.from, e.to)) || rootSet.has(e.to)) return;
    out[e.from].push(e.to); indeg[e.to]++; parents[e.to].push(e.from);
  });
  return { out, indeg, parents };
}

/** Longest-path layer index per node (Kahn) on the forward graph. */
export function assignLayers(ids: string[], fwd: Forward): Record<string, number> {
  const layer: Record<string, number> = {};
  ids.forEach((id) => { layer[id] = 0; });
  const deg = { ...fwd.indeg };
  const queue = ids.filter((id) => deg[id] === 0);
  const seen = new Set<string>();
  let guard = 0;
  while (queue.length && guard++ < 99999) {
    const id = queue.shift() as string;
    if (seen.has(id)) continue; seen.add(id);
    for (const nx of fwd.out[id]) {
      layer[nx] = Math.max(layer[nx], layer[id] + 1);
      if (--deg[nx] <= 0) queue.push(nx);
    }
  }
  return layer;
}

/**
 * Reorder each layer by the mean position of its parents in the layer
 * above (barycenter). Reduces edge crossings versus insertion order.
 * Down-only sweep: layer 0 keeps its order, each lower layer follows.
 */
export function orderByBarycenter(layers: number[], byLayer: Record<number, string[]>, parents: Record<string, string[]>): void {
  const pos: Record<string, number> = {};
  (byLayer[layers[0]] || []).forEach((id, i) => { pos[id] = i; });
  for (let sweep = 0; sweep < CROSS_SWEEPS; sweep++) {
    for (let li = 1; li < layers.length; li++) {
      const row = byLayer[layers[li]];
      const key: Record<string, number> = {};
      row.forEach((id, i) => {
        const ps = parents[id].filter((p) => p in pos);
        key[id] = ps.length ? ps.reduce((a, p) => a + pos[p], 0) / ps.length : i;
      });
      row.sort((a, b) => key[a] - key[b]);
      row.forEach((id, i) => { pos[id] = i; });
    }
  }
}

/** Assign a layer index to every spine node and order each layer to reduce crossings. */
export function layerSpine(state: StateStore, spineIds: string[], spine: Set<string>, rootSet: Set<string>): {
  byLayer: Record<number, string[]>; layers: number[]; layer: Record<string, number>;
} {
  const back = findBackEdges(state, spineIds, spine);
  const fwd = forwardGraph(state, spineIds, spine, back, rootSet);
  const layer = assignLayers(spineIds, fwd);

  const byLayer: Record<number, string[]> = {};
  spineIds.forEach((id) => { (byLayer[layer[id]] ||= []).push(id); });
  const layers = Object.keys(byLayer).map(Number).sort((a, b) => a - b);

  orderByBarycenter(layers, byLayer, fwd.parents);
  return { byLayer, layers, layer };
}
