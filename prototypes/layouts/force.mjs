export const title = 'Force-directed';
export const principle =
  'Hub-centric radial layout: max-degree hub at origin, ring-1 neighbours sorted by Fiedler vector of ring subgraph to minimise chord crossings, outer rings placed by parent angle, then FR refinement and box-separation de-overlap.';

// ---- Power iteration to find Fiedler vector of a subgraph ----
// Returns the 2nd smallest eigenvector of the subgraph Laplacian.
// Uses shifted power iteration: iterate (degMax*I - L) and deflate constant.
function fiedlerVector(subN, subAdj, subDeg) {
  const degMax = Math.max(...subDeg) + 0.1;
  // v = initial vector (not constant): use index-based cosine wave
  let v = new Float64Array(subN);
  for (let i = 0; i < subN; i++) v[i] = Math.cos(Math.PI * i / subN);
  // Deflate constant component
  let sum = 0; for (let i = 0; i < subN; i++) sum += v[i];
  sum /= subN; for (let i = 0; i < subN; i++) v[i] -= sum;
  // Normalize
  let norm = 0; for (let i = 0; i < subN; i++) norm += v[i] * v[i];
  norm = Math.sqrt(norm); for (let i = 0; i < subN; i++) v[i] /= norm;

  for (let iter = 0; iter < 300; iter++) {
    // w = (degMax*I - L)*v = degMax*v - L*v = degMax*v - (D*v - A*v)
    const w = new Float64Array(subN);
    for (let i = 0; i < subN; i++) {
      w[i] = (degMax - subDeg[i]) * v[i];
      for (const j of subAdj[i]) w[i] += v[j]; // + A*v component
    }
    // Deflate constant
    let s = 0; for (let i = 0; i < subN; i++) s += w[i]; s /= subN;
    for (let i = 0; i < subN; i++) w[i] -= s;
    // Normalize
    let nn = 0; for (let i = 0; i < subN; i++) nn += w[i] * w[i];
    nn = Math.sqrt(nn); if (nn < 1e-12) break;
    for (let i = 0; i < subN; i++) v[i] = w[i] / nn;
  }
  return v;
}

export function layout(nodes, edges) {
  const n = nodes.length;
  if (n === 0) return {};

  // ---- Build adjacency ----
  const idxOf = new Map(nodes.map((nd, i) => [nd.id, i]));
  const ePairs = [];
  const adjList = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const fi = idxOf.get(e.from), ti = idxOf.get(e.to);
    if (fi != null && ti != null && fi !== ti) {
      ePairs.push([fi, ti]);
      adjList[fi].push(ti);
      adjList[ti].push(fi);
    }
  }
  const degree = adjList.map((a) => a.length);
  const rootIdx = degree.indexOf(Math.max(...degree));

  // ---- BFS layer assignment ----
  const layerOf = new Int32Array(n).fill(-1);
  const layers = [];
  const parentOf = new Int32Array(n).fill(-1);
  layerOf[rootIdx] = 0;
  let front = [rootIdx];
  while (front.length) {
    layers.push(front.slice());
    const next = [];
    for (const cur of front) {
      for (const nb of adjList[cur]) {
        if (layerOf[nb] === -1) {
          layerOf[nb] = layers.length;
          parentOf[nb] = cur;
          next.push(nb);
        }
      }
    }
    front = next;
  }
  for (let i = 0; i < n; i++) {
    if (layerOf[i] === -1) { layerOf[i] = layers.length; parentOf[i] = rootIdx; layers.push([i]); }
  }

  // ---- Layer 1: sort by Fiedler vector of ring-1 subgraph ----
  let layer1 = layers[1] || [];

  if (layer1.length > 3) {
    // Build sub-adjacency for ring-1 nodes
    const ring1Set = new Set(layer1);
    const subIdxOf = new Map(layer1.map((v, i) => [v, i]));
    const subN = layer1.length;
    const subAdj = Array.from({ length: subN }, () => []);
    const subDeg = new Int32Array(subN);
    for (const [fi, ti] of ePairs) {
      if (ring1Set.has(fi) && ring1Set.has(ti)) {
        const si = subIdxOf.get(fi), sj = subIdxOf.get(ti);
        subAdj[si].push(sj); subAdj[sj].push(si);
        subDeg[si]++; subDeg[sj]++;
      }
    }
    const fvec = fiedlerVector(subN, subAdj, subDeg);
    // Sort layer1 nodes by Fiedler component
    layer1 = layer1.slice().sort((a, b) => fvec[subIdxOf.get(a)] - fvec[subIdxOf.get(b)]);
  }

  // ---- Assign radial positions ----
  const R1 = 360; // radius of ring-1
  const R_STEP = 220; // additional radius per outer ring
  const cx = new Float64Array(n);
  const cy = new Float64Array(n);

  // Hub at origin
  cx[rootIdx] = 0; cy[rootIdx] = 0;

  // Ring-1: equally spaced around circle in Fiedler order
  const r1AngleOf = new Map();
  for (let slot = 0; slot < layer1.length; slot++) {
    const idx = layer1[slot];
    const a = (2 * Math.PI * slot) / layer1.length;
    cx[idx] = R1 * Math.cos(a);
    cy[idx] = R1 * Math.sin(a);
    r1AngleOf.set(idx, a);
  }

  // Outer rings: each node placed near its parent's angular position
  for (let li = 2; li < layers.length; li++) {
    const layer = layers[li];
    // Group by parent, then spread within each parent's angular sector
    const byParent = new Map();
    for (const idx of layer) {
      const par = parentOf[idx];
      if (!byParent.has(par)) byParent.set(par, []);
      byParent.get(par).push(idx);
    }
    const r = R1 + (li - 1) * R_STEP;
    for (const [par, children] of byParent) {
      // Find parent's angle
      const parAngle = Math.atan2(cy[par], cx[par]);
      const spread = (0.5 * Math.PI) / Math.max(children.length, 1);
      const startAngle = parAngle - spread * (children.length - 1) * 0.5;
      for (let ci = 0; ci < children.length; ci++) {
        const a = startAngle + ci * spread;
        cx[children[ci]] = r * Math.cos(a);
        cy[children[ci]] = r * Math.sin(a);
      }
    }
  }

  // ---- FR refinement (short, to smooth positions while preserving radial structure) ----
  const k = 150;
  const k2 = k * k;
  const ITERS = 600;
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const halfDiag = nodes.map((nd) => Math.hypot(nd.w, nd.h) * 0.4);

  for (let iter = 0; iter < ITERS; iter++) {
    dx.fill(0); dy.fill(0);

    // Repulsion (all pairs)
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let ddx = cx[i] - cx[j], ddy = cy[i] - cy[j];
        let dist = Math.hypot(ddx, ddy);
        if (dist < 1) { ddx = 1; ddy = 0; dist = 1; }
        const gap = (halfDiag[i] + halfDiag[j]) * 0.2;
        const effDist = Math.max(dist - gap, 1);
        const f = k2 / (effDist * dist);
        const fx = (ddx / dist) * f, fy = (ddy / dist) * f;
        dx[i] += fx; dy[i] += fy;
        dx[j] -= fx; dy[j] -= fy;
      }
    }

    // Attraction (edges)
    for (const [fi, ti] of ePairs) {
      const ddx = cx[ti] - cx[fi], ddy = cy[ti] - cy[fi];
      const dist = Math.hypot(ddx, ddy);
      if (dist < 0.1) continue;
      const f = dist / k;
      const fx = (ddx / dist) * f, fy = (ddy / dist) * f;
      dx[fi] += fx; dy[fi] += fy;
      dx[ti] -= fx; dy[ti] -= fy;
    }

    const temp = Math.max(100 * (1 - iter / ITERS), 0.5);
    for (let i = 0; i < n; i++) {
      const d = Math.hypot(dx[i], dy[i]);
      if (d > 0) {
        const move = Math.min(d, temp);
        cx[i] += (dx[i] / d) * move;
        cy[i] += (dy[i] / d) * move;
      }
    }
  }

  // ---- Convert centres → top-left ----
  const pos = {};
  for (let i = 0; i < n; i++) {
    pos[nodes[i].id] = {
      x: cx[i] - nodes[i].w / 2,
      y: cy[i] - nodes[i].h / 2,
    };
  }

  // ---- Iterative box-separation de-overlap ----
  const PAD = 4;
  for (let iter = 0; iter < 300; iter++) {
    let anyOverlap = false;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const a = pos[nodes[i].id], b = pos[nodes[j].id];
        const wiE = nodes[i].w + PAD, hiE = nodes[i].h + PAD;
        const wjE = nodes[j].w + PAD, hjE = nodes[j].h + PAD;
        const penXab = (a.x + wiE) - b.x, penXba = (b.x + wjE) - a.x;
        const penYab = (a.y + hiE) - b.y, penYba = (b.y + hjE) - a.y;
        if (penXab > 0 && penXba > 0 && penYab > 0 && penYba > 0) {
          anyOverlap = true;
          const minPenX = Math.min(penXab, penXba);
          const minPenY = Math.min(penYab, penYba);
          if (minPenX <= minPenY) {
            const push = minPenX * 0.5 + 1;
            if (penXab <= penXba) { a.x -= push; b.x += push; }
            else                   { a.x += push; b.x -= push; }
          } else {
            const push = minPenY * 0.5 + 1;
            if (penYab <= penYba) { a.y -= push; b.y += push; }
            else                   { a.y += push; b.y -= push; }
          }
        }
      }
    }
    if (!anyOverlap) break;
  }

  return pos;
}
