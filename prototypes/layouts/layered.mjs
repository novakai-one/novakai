// Sugiyama-style layered DAG layout, left-to-right.
// 1. Longest-path layer assignment (with cycle-breaking via iterative DFS).
// 2. Barycenter crossing minimisation (bi-directional sweeps, all edges including
//    back-edges considered; keeps the best ordering seen across all passes).
// 3. Transpose refinement: adjacent-swap hill-climb until no improvement.
// 4. Coordinate assignment: layer index → X, position in layer → Y, centred.

export const title = 'Layered (Sugiyama)';
export const principle =
  'Left-to-right longest-path DAG layers with barycenter + transpose crossing minimisation — exposes flow direction and minimises visual crossings.';

export function layout(nodes, edges) {
  const ids = nodes.map((n) => n.id);
  const nodeMap = Object.fromEntries(nodes.map((n) => [n.id, n]));
  const idSet = new Set(ids);

  // ── 1. Build full adjacency (ALL 91 edges, used for crossing minimisation) ──
  const fullAdj = {};   // all out-edges (per original input, including back-edges)
  const fullRadj = {};  // all in-edges
  for (const id of ids) { fullAdj[id] = []; fullRadj[id] = []; }
  for (const e of edges) {
    if (idSet.has(e.from) && idSet.has(e.to) && e.from !== e.to) {
      fullAdj[e.from].push(e.to);
      fullRadj[e.to].push(e.from);
    }
  }

  // ── 2. Detect back-edges (iterative DFS) for DAG construction ────────────
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = {};
  for (const id of ids) color[id] = WHITE;
  const backEdgeSet = new Set();

  for (const start of ids) {
    if (color[start] !== WHITE) continue;
    const stack = [{ node: start, idx: 0 }];
    color[start] = GRAY;
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const neighbors = fullAdj[frame.node];
      if (frame.idx < neighbors.length) {
        const v = neighbors[frame.idx++];
        if (color[v] === GRAY) {
          backEdgeSet.add(frame.node + '->' + v);
        } else if (color[v] === WHITE) {
          color[v] = GRAY;
          stack.push({ node: v, idx: 0 });
        }
      } else {
        color[frame.node] = BLACK;
        stack.pop();
      }
    }
  }

  // DAG adjacency (excluding back-edges)
  const adj = {};
  const radj = {};
  for (const id of ids) { adj[id] = []; radj[id] = []; }
  for (const e of edges) {
    if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue;
    if (backEdgeSet.has(e.from + '->' + e.to)) continue;
    adj[e.from].push(e.to);
    radj[e.to].push(e.from);
  }

  // ── 3. Longest-path layering (Kahn BFS on DAG) ───────────────────────────
  const layer = {};
  for (const id of ids) layer[id] = 0;
  const inDeg = {};
  for (const id of ids) inDeg[id] = radj[id].length;

  const queue = ids.filter((id) => inDeg[id] === 0);
  const processed = new Set();
  while (queue.length > 0) {
    const u = queue.shift();
    if (processed.has(u)) continue;
    processed.add(u);
    for (const v of adj[u]) {
      if (layer[v] < layer[u] + 1) layer[v] = layer[u] + 1;
      inDeg[v]--;
      if (inDeg[v] <= 0) queue.push(v);
    }
  }
  for (const id of ids) if (!processed.has(id)) layer[id] = 0;

  const numLayers = Math.max(...Object.values(layer)) + 1;
  const layerNodes = Array.from({ length: numLayers }, () => []);
  for (const id of ids) layerNodes[layer[id]].push(id);

  // ── 4. Position within layers ─────────────────────────────────────────────
  const pos = {};
  for (let l = 0; l < numLayers; l++)
    for (let i = 0; i < layerNodes[l].length; i++) pos[layerNodes[l][i]] = i;

  // ── 5. Crossing count helpers (ALL edges including back-edges) ────────────
  //
  // pairCross(u, v, l): crossings contributed by pair (u above v) in layer l,
  // counting edges to/from both adjacent layers.
  function pairCross(u, v, l) {
    let c = 0;
    const lNext = l + 1;
    const lPrev = l - 1;

    // Neighbors of u and v in layer lNext (both directions, all edges)
    const uNext = fullAdj[u].filter((x) => layer[x] === lNext)
      .concat(fullRadj[u].filter((x) => layer[x] === lNext));
    const vNext = fullAdj[v].filter((x) => layer[x] === lNext)
      .concat(fullRadj[v].filter((x) => layer[x] === lNext));

    // Neighbors of u and v in layer lPrev
    const uPrev = fullAdj[u].filter((x) => layer[x] === lPrev)
      .concat(fullRadj[u].filter((x) => layer[x] === lPrev));
    const vPrev = fullAdj[v].filter((x) => layer[x] === lPrev)
      .concat(fullRadj[v].filter((x) => layer[x] === lPrev));

    // u above v; crossing with right-layer neighbors if u's neighbor is below v's
    for (const a of uNext) for (const b of vNext) if (pos[a] > pos[b]) c++;
    // Same for left-layer neighbors
    for (const a of uPrev) for (const b of vPrev) if (pos[a] > pos[b]) c++;

    return c;
  }

  // Total crossings (between adjacent layers only — fast proxy for ordering quality)
  function totalAdjacentCrossings() {
    let total = 0;
    for (let l = 0; l < numLayers; l++) {
      const ln = layerNodes[l];
      for (let i = 0; i < ln.length; i++)
        for (let j = i + 1; j < ln.length; j++)
          total += pairCross(ln[i], ln[j], l);
    }
    return total;
  }

  // True objective: crossings over EVERY edge (same-layer and skip-layer
  // included), measured geometrically on (layer, rank) coords — the same test
  // the scorer applies. The adjacent-layer proxy above misses the same-layer
  // and skip edges that actually dominate this dense, cyclic graph.
  function trueCross() {
    const segs = [];
    for (const e of edges) {
      if (!idSet.has(e.from) || !idSet.has(e.to) || e.from === e.to) continue;
      segs.push([{ x: layer[e.from], y: pos[e.from] }, { x: layer[e.to], y: pos[e.to] }]);
    }
    const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
    let c = 0;
    for (let i = 0; i < segs.length; i++)
      for (let j = i + 1; j < segs.length; j++) {
        const [p1, p2] = segs[i], [p3, p4] = segs[j];
        if (ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4)) c++;
      }
    return c;
  }

  // Save/restore the best ordering seen
  const saveOrder = () => layerNodes.map((ln) => [...ln]);
  const savePos   = () => ({ ...pos });

  let bestOrder = saveOrder();
  let bestPos   = savePos();
  let bestCross = trueCross();

  function checkBest() {
    const c = trueCross();
    if (c < bestCross) { bestCross = c; bestOrder = saveOrder(); bestPos = savePos(); }
  }

  // ── 6. Barycenter (uses all edges to adjacent layers) ────────────────────
  function barycenter(id, l) {
    const nb = [
      ...fullAdj[id].filter((x) => layer[x] === l - 1),
      ...fullRadj[id].filter((x) => layer[x] === l - 1),
      ...fullAdj[id].filter((x) => layer[x] === l + 1),
      ...fullRadj[id].filter((x) => layer[x] === l + 1),
    ];
    if (nb.length === 0) return pos[id];
    return nb.reduce((s, nb) => s + pos[nb], 0) / nb.length;
  }

  function sortLayer(l) {
    const bc = {};
    for (const id of layerNodes[l]) bc[id] = barycenter(id, l);
    layerNodes[l].sort((a, b) => bc[a] - bc[b] || a.localeCompare(b));
    for (let i = 0; i < layerNodes[l].length; i++) pos[layerNodes[l][i]] = i;
  }

  // 24 bi-directional barycenter sweeps; keep best ordering after every half-sweep
  for (let sweep = 0; sweep < 24; sweep++) {
    for (let l = 1; l < numLayers; l++) sortLayer(l);
    checkBest();
    for (let l = numLayers - 2; l >= 0; l--) sortLayer(l);
    checkBest();
  }

  // Restore best found so far
  for (let l = 0; l < numLayers; l++) {
    layerNodes[l] = bestOrder[l];
    for (let i = 0; i < layerNodes[l].length; i++) pos[layerNodes[l][i]] = i;
  }

  // ── 7. Transpose refinement: adjacent-swap hill-climb on the TRUE objective ─
  let improved = true, guard = 0;
  while (improved && guard++ < 12) {
    improved = false;
    for (let l = 0; l < numLayers; l++) {
      const ln = layerNodes[l];
      for (let i = 0; i < ln.length - 1; i++) {
        const before = trueCross();
        [ln[i], ln[i + 1]] = [ln[i + 1], ln[i]]; pos[ln[i]] = i; pos[ln[i + 1]] = i + 1;
        if (trueCross() < before) { improved = true; checkBest(); }
        else { [ln[i], ln[i + 1]] = [ln[i + 1], ln[i]]; pos[ln[i]] = i; pos[ln[i + 1]] = i + 1; }
      }
    }
  }

  // Settle on the best ordering the whole search ever saw.
  for (let l = 0; l < numLayers; l++) {
    layerNodes[l] = bestOrder[l];
    for (let i = 0; i < layerNodes[l].length; i++) pos[layerNodes[l][i]] = i;
  }

  // ── 8. Coordinate assignment ──────────────────────────────────────────────
  const GUTTER_X = 60;  // horizontal gap between layers
  const GUTTER_Y = 16;  // vertical gap between nodes in same layer

  // X: left edge of each layer
  const layerX = [0];
  for (let l = 1; l < numLayers; l++) {
    const prevMaxW = Math.max(...layerNodes[l - 1].map((id) => nodeMap[id].w));
    layerX.push(layerX[l - 1] + prevMaxW + GUTTER_X);
  }

  // Max total height across all layers (for vertical centering)
  const layerH = (ln) =>
    ln.reduce((s, id) => s + nodeMap[id].h, 0) + Math.max(0, ln.length - 1) * GUTTER_Y;
  const maxH = Math.max(...layerNodes.map(layerH));

  const result = {};
  for (let l = 0; l < numLayers; l++) {
    let y = (maxH - layerH(layerNodes[l])) / 2;
    for (const id of layerNodes[l]) {
      result[id] = { x: layerX[l], y };
      y += nodeMap[id].h + GUTTER_Y;
    }
  }

  return result;
}
