// Circular layout: three concentric rings with degree-based tier assignment
// and a layered barycenter crossing-reduction algorithm (forward + backward
// sweeps) that aligns each ring's angular order with the barycentres of its
// neighbours on adjacent rings.
export const title = 'Circular';
export const principle =
  'Degree-tiered concentric rings with iterative layered-barycenter ordering: each ring is re-sorted toward the angle-barycentre of its connected neighbours, cutting inter-ring chord crossings.';

export function layout(nodes, edges) {
  const n = nodes.length;

  // ── adjacency ────────────────────────────────────────────────────────────
  const idxOf = Object.fromEntries(nodes.map((nd, i) => [nd.id, i]));
  const adj   = Array.from({ length: n }, () => []);
  for (const e of edges) {
    const a = idxOf[e.from], b = idxOf[e.to];
    if (a !== undefined && b !== undefined && a !== b) { adj[a].push(b); adj[b].push(a); }
  }
  const deg = adj.map(a => a.length);

  // ── Fiedler vector (for initial intra-ring order) ─────────────────────
  const alpha   = 2 * Math.max(...deg) + 4;
  const dot     = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
  const norm2   = v => Math.sqrt(dot(v, v));
  const scalev  = (v, s) => v.map(x => x * s);
  const deflate = v => { const m = v.reduce((a, b) => a + b, 0) / n; return v.map(x => x - m); };
  const normalise = v => { const nm = norm2(v); return nm > 1e-12 ? scalev(v, 1 / nm) : v; };

  let fv = Array.from({ length: n }, (_, i) => Math.sin((i + 1) * 1.7));
  fv = normalise(deflate(fv));
  for (let k = 0; k < 600; k++) {
    const w = fv.map((vi, i) => {
      let Lvi = deg[i] * vi;
      for (const j of adj[i]) Lvi -= fv[j];
      return alpha * vi - Lvi;
    });
    fv = normalise(deflate(w));
  }

  // ── ring assignment: top 10 by degree → inner, next 15 → mid, last 15 → outer
  const RING_SIZES = [10, 15, 15];
  const byDeg = nodes.map((_, i) => i).sort((a, b) => deg[b] - deg[a]);
  const ringOf = new Array(n);
  let cursor = 0;
  for (let r = 0; r < RING_SIZES.length; r++)
    for (let k = 0; k < RING_SIZES[r]; k++) ringOf[byDeg[cursor++]] = r;

  // initial intra-ring order: by Fiedler value (preserves graph-spectral adjacency)
  const ringNodes = RING_SIZES.map((_, r) =>
    nodes.map((_, i) => i).filter(i => ringOf[i] === r).sort((a, b) => fv[a] - fv[b])
  );

  // ── angle helpers ─────────────────────────────────────────────────────────
  // Evenly redistribute m nodes on a ring starting from offset angle `start`.
  // Returns an array of m angles.
  const evenAngles = (m, start = -Math.PI / 2) =>
    Array.from({ length: m }, (_, k) => start + (2 * Math.PI * k) / m);

  // Circular mean of a set of angles (handles wrap-around).
  const circMean = angles => {
    let sx = 0, sy = 0;
    for (const a of angles) { sx += Math.cos(a); sy += Math.sin(a); }
    return Math.atan2(sy / angles.length, sx / angles.length);
  };

  // Current angle of each node (will be updated by the algorithm).
  const θ = new Array(n);

  // Assign initial evenly-spaced angles to each ring.
  for (let r = 0; r < RING_SIZES.length; r++) {
    const a = evenAngles(RING_SIZES[r]);
    ringNodes[r].forEach((ni, k) => { θ[ni] = a[k]; });
  }

  // ── layered barycenter iterations ─────────────────────────────────────────
  // For each ring: sort nodes by the circular mean of their connected
  // neighbours' current angles (on ALL rings, not just adjacent).
  // Then re-assign even spacing anchored to that sorted order.
  const ITERS = 80;

  for (let iter = 0; iter < ITERS; iter++) {
    // alternate forward / backward ring order each iteration
    const ringOrder = iter % 2 === 0 ? [0, 1, 2] : [2, 1, 0];

    for (const r of ringOrder) {
      const rn = ringNodes[r];
      const m  = rn.length;
      if (m < 2) continue;

      // Compute barycentre angle for each node in this ring.
      const bary = rn.map(ni => {
        const nbAngles = adj[ni].map(j => θ[j]);
        if (!nbAngles.length) return θ[ni]; // isolated: keep current angle
        return circMean(nbAngles);
      });

      // Sort by barycentre angle.
      const paired = rn.map((ni, k) => ({ ni, b: bary[k] }));
      paired.sort((a, b) => a.b - b.b);

      // Re-distribute evenly, anchoring start to mean barycentre of the ring.
      const startAngle = paired[0].b;
      paired.forEach(({ ni }, k) => {
        θ[ni] = startAngle + (2 * Math.PI * k) / m;
      });
      ringNodes[r] = paired.map(p => p.ni);
    }
  }

  // ── radii ─────────────────────────────────────────────────────────────────
  const maxW = Math.max(...nodes.map(nd => nd.w));
  const maxH = Math.max(...nodes.map(nd => nd.h));
  const diag  = Math.hypot(maxW, maxH); // ≈ 169.5 px for 160×56 boxes

  // chord between adjacent box-centres must exceed diagonal for no overlap
  const minRadius = m => Math.ceil(diag / (2 * Math.sin(Math.PI / m))) + 10;
  const RING_GAP  = Math.ceil(diag) + 5; // 175 px — safe inter-ring gap

  const radii = [];
  for (let r = 0; r < RING_SIZES.length; r++) {
    const rMin = minRadius(RING_SIZES[r]);
    radii.push(r === 0 ? rMin : Math.max(rMin, radii[r - 1] + RING_GAP));
  }
  // radii ≈ [284, 459, 634]

  // ── emit positions ────────────────────────────────────────────────────────
  const out = {};
  for (let r = 0; r < RING_SIZES.length; r++) {
    const R = radii[r];
    for (const ni of ringNodes[r]) {
      const nd = nodes[ni];
      out[nd.id] = {
        x: R * Math.cos(θ[ni]) - nd.w / 2,
        y: R * Math.sin(θ[ni]) - nd.h / 2,
      };
    }
  }
  return out;
}
