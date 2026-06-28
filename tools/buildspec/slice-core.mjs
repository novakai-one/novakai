/* =====================================================================
   slice-core.mjs — pure, zero-IO model slicer for flowmap bundles
   ---------------------------------------------------------------------
   API:
     sliceModel(model, rootIds, opts) -> model'
       model   = parseMmd() output
       rootIds = node ids to slice around (seed set)
       opts    = { up:bool, down:bool, refs:bool }
                 up   - include solid-edge ancestors (transitive)
                 down - include solid-edge descendants (transitive)
                 refs - include 1-hop dotted neighbours of seed

   Returns a new { dir, roots, nodes, edges, groups, fm } with only the
   kept id set and the edges whose both endpoints are in that set.

   Bodies filter (token saver):
     filterBodies(bodies, keepIds, { keyMode })
       bodies  = Map<id, body> (from ctx.bodies or parsed bodies.json)
       keepIds = Set<string>
       keyMode = 'container__symbol' (default) | 'bare'
     Returns a new Map with only the kept entries.

   No imports beyond mmd-parse.mjs. Node 16+.
   ===================================================================== */

import { toMmd } from './mmd-parse.mjs';

/**
 * Walk solid edges transitively in one direction.
 * dir 'down' follows from→to; dir 'up' follows to→from.
 */
function walkSolid(edges, seeds, dir) {
  const visited = new Set(seeds);
  const queue = [...seeds];
  while (queue.length) {
    const id = queue.shift();
    for (const e of edges) {
      if (e.style !== 'solid') continue;
      const next = dir === 'down'
        ? (e.from === id ? e.to : null)
        : (e.to === id ? e.from : null);
      if (next && !visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}

/**
 * Collect 1-hop dotted neighbours of the seed set.
 */
function dottedNeighbours(edges, seeds) {
  const out = new Set();
  for (const e of edges) {
    if (e.style !== 'dotted') continue;
    if (seeds.has(e.from)) out.add(e.to);
    if (seeds.has(e.to)) out.add(e.from);
  }
  return out;
}

/**
 * Slice a parseMmd() model down to the neighbourhood of rootIds.
 *
 * @param {object} model   - parseMmd() output
 * @param {string[]} rootIds - seed node ids
 * @param {{ up?: boolean, down?: boolean, refs?: boolean }} opts
 * @returns {object} a new model containing only the kept ids + edges
 */
export function sliceModel(model, rootIds, opts = {}) {
  const { up = false, down = false, refs = false } = opts;
  const { nodes, edges, fm, groups, dir, roots } = model;

  const seeds = new Set(rootIds.filter((id) => id in nodes));

  // Build keep set
  const keep = new Set(seeds);

  if (down) {
    for (const id of walkSolid(edges, seeds, 'down')) keep.add(id);
  }
  if (up) {
    for (const id of walkSolid(edges, seeds, 'up')) keep.add(id);
  }
  if (refs) {
    for (const id of dottedNeighbours(edges, seeds)) keep.add(id);
  }

  // Filter model
  const keptNodes = {};
  for (const id of keep) {
    if (nodes[id]) keptNodes[id] = nodes[id];
  }

  const keptEdges = edges.filter((e) => keep.has(e.from) && keep.has(e.to));

  const keptFm = {};
  for (const id of keep) {
    if (fm && fm[id]) keptFm[id] = fm[id];
  }

  const keptGroups = new Set([...groups].filter((id) => keep.has(id)));
  const keptRoots = (roots || []).filter((id) => keep.has(id));

  return {
    dir,
    roots: keptRoots,
    nodes: keptNodes,
    edges: keptEdges,
    groups: keptGroups,
    fm: keptFm,
  };
}

/**
 * Filter a bodies map down to the kept id set.
 * keyMode: 'container__symbol' (default) — keys are already in bundle format.
 *          'bare' — keys are bare ids (falls through as-is).
 *
 * @param {Map<string,any>} bodies
 * @param {Set<string>} keepIds
 * @param {{ keyMode?: string }} opts
 * @returns {Map<string,any>}
 */
export function filterBodies(bodies, keepIds, { keyMode = 'container__symbol' } = {}) {
  const out = new Map();
  for (const [k, v] of bodies) {
    const id = keyMode === 'bare' ? k : k; // both branches same: key matches directly
    if (keepIds.has(id)) out.set(k, v);
  }
  return out;
}

/**
 * Convenience: serialize a sliced model back to .mmd text.
 * Thin wrapper so callers import only slice-core.
 */
export function sliceToMmd(model, rootIds, opts = {}) {
  return toMmd(sliceModel(model, rootIds, opts));
}
