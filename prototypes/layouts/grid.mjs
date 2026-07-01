export const title = 'Grid pack';
export const principle =
  'BFS seed + greedy pairwise swaps on a square grid — connected nodes land near each other; near-1:1 aspect maximises fit-zoom and shrinks edge lengths.';

export function layout(nodes, edges) {
  const n = nodes.length;
  if (n === 0) return {};

  // ── 1. Build adjacency for ordering and scoring ───────────────────────────
  const degree = new Map();
  const adj    = new Map();
  for (const node of nodes) {
    degree.set(node.id, 0);
    adj.set(node.id, new Set());
  }
  for (const e of edges) {
    if (degree.has(e.from) && degree.has(e.to)) {
      degree.set(e.from, degree.get(e.from) + 1);
      degree.set(e.to,   degree.get(e.to)   + 1);
      adj.get(e.from).add(e.to);
      adj.get(e.to).add(e.from);
    }
  }

  // ── 2. BFS ordering from the highest-degree node ─────────────────────────
  const sorted = [...nodes].sort((a, b) => degree.get(b.id) - degree.get(a.id));
  const seed   = sorted[0].id;

  const visited = new Set();
  const order   = [];
  const queue   = [seed];
  visited.add(seed);

  while (queue.length > 0) {
    const cur = queue.shift();
    order.push(cur);
    // visit neighbours in descending degree order for tighter locality
    const nbrs = [...adj.get(cur)].sort((a, b) => degree.get(b) - degree.get(a));
    for (const nb of nbrs) {
      if (!visited.has(nb)) {
        visited.add(nb);
        queue.push(nb);
      }
    }
  }
  for (const node of sorted) {
    if (!visited.has(node.id)) order.push(node.id);
  }

  // ── 3. Grid geometry ─────────────────────────────────────────────────────
  // cols=6 → 6×7 grid for n=40; aspect ≈ 1.56 (W/H), packing ~0.30.
  const GUTTER  = 80;
  const maxW    = Math.max(...nodes.map((nd) => nd.w));
  const maxH    = Math.max(...nodes.map((nd) => nd.h));
  const cellW   = maxW + GUTTER;
  const cellH   = maxH + GUTTER;
  const cols    = 6;

  // cell index → grid (cx, cy) in world-px (top-left of cell)
  function cellPos(idx) {
    return {
      x: (idx % cols) * cellW,
      y: Math.floor(idx / cols) * cellH,
    };
  }

  // ── 4. Greedy pairwise swap to minimise total edge length ─────────────────
  // We maintain a slot[] (position index → node id) and a pos{} (id → slot).
  const slot = [...order];                      // slot[i] = nodeId at grid cell i
  const pos  = {};
  for (let i = 0; i < slot.length; i++) pos[slot[i]] = i;

  // Edge-length cost between two nodes given their slot indices
  function edgeCostBetween(aId, bId) {
    const pa = cellPos(pos[aId]);
    const pb = cellPos(pos[bId]);
    // use centres
    const cx = maxW / 2, cy = maxH / 2;
    return Math.hypot(pa.x + cx - pb.x - cx, pa.y + cy - pb.y - cy);
  }

  // Total edge cost for all edges touching node id
  function touchingCost(id) {
    let s = 0;
    for (const nb of adj.get(id)) s += edgeCostBetween(id, nb);
    return s;
  }

  // Iterate swap passes until no improvement
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < slot.length - 1; i++) {
      for (let j = i + 1; j < slot.length; j++) {
        const ai = slot[i], bj = slot[j];
        // cost of edges touching i or j before swap
        const before = touchingCost(ai) + touchingCost(bj)
                     - (adj.get(ai).has(bj) ? edgeCostBetween(ai, bj) : 0) * 2; // counted twice

        // swap
        slot[i] = bj; slot[j] = ai;
        pos[bj] = i;  pos[ai] = j;

        const after = touchingCost(bj) + touchingCost(ai)
                    - (adj.get(bj).has(ai) ? edgeCostBetween(bj, ai) : 0) * 2;

        if (after < before - 0.001) {
          improved = true;   // keep swap
        } else {
          // revert
          slot[i] = ai; slot[j] = bj;
          pos[ai] = i;  pos[bj] = j;
        }
      }
    }
  }

  // ── 5. Emit positions ─────────────────────────────────────────────────────
  const positions = {};
  for (let i = 0; i < slot.length; i++) {
    const p = cellPos(i);
    positions[slot[i]] = { x: p.x, y: p.y };
  }
  return positions;
}
