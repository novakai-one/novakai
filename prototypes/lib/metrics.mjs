// The ONE metrics implementation. Trusted, shared by the gallery (browser) and
// check.mjs (node). Layout candidates never compute their own metrics — this
// recomputes from their raw positions so the numbers cannot be faked.

export const VIEWPORT = { w: 900, h: 740 }; // a realistic on-screen canvas panel

// Objective design principles. `good` is the direction; `target` is the bar a
// candidate should clear to count as a real improvement over today.
export const PRINCIPLES = [
  { key: 'aspect',        label: 'Aspect (W/H)',        good: 'near 1.3',  target: (v) => v >= 0.6 && v <= 1.9, fmt: (v) => v.toFixed(2) },
  { key: 'fitZoomPct',    label: 'Fit-zoom %',          good: 'higher',    target: (v) => v >= 40,             fmt: (v) => v.toFixed(0) + '%' },
  { key: 'medianEdgeLen', label: 'Median edge px',      good: 'lower',     target: (v) => v <= 450,            fmt: (v) => Math.round(v) },
  { key: 'maxEdgeLen',    label: 'Max edge px',         good: 'lower',     target: (v) => v <= 2500,           fmt: (v) => Math.round(v) },
  { key: 'totalEdgeLen',  label: 'Total edge px',       good: 'lower',     target: (v) => v <= 120000,         fmt: (v) => Math.round(v) },
  { key: 'crossings',     label: 'Edge crossings',      good: 'lower',     target: (v) => v <= 150,            fmt: (v) => v },
  { key: 'packing',       label: 'Packing density',     good: '0.06–0.30', target: (v) => v >= 0.06 && v <= 0.35, fmt: (v) => v.toFixed(3) },
];

// positions: { id: {x, y} } top-left in any consistent coordinate space.
export function metrics(nodes, edges, positions, viewport = VIEWPORT) {
  const P = {};
  for (const n of nodes) {
    const p = positions[n.id];
    if (!p) throw new Error('layout missing position for node ' + n.id);
    P[n.id] = { x: p.x, y: p.y, w: n.w, h: n.h };
  }
  const xs = nodes.map((n) => P[n.id].x);
  const ys = nodes.map((n) => P[n.id].y);
  const x2 = nodes.map((n) => P[n.id].x + n.w);
  const y2 = nodes.map((n) => P[n.id].y + n.h);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  const maxX = Math.max(...x2), maxY = Math.max(...y2);
  const W = maxX - minX, H = maxY - minY;

  const cx = {};
  for (const n of nodes) cx[n.id] = { x: P[n.id].x + n.w / 2, y: P[n.id].y + n.h / 2 };

  const lens = edges.map((e) => {
    const a = cx[e.from], b = cx[e.to];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : NaN;
  }).filter((v) => !isNaN(v));
  lens.sort((a, b) => a - b);
  const med = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  const total = lens.reduce((a, b) => a + b, 0);
  const max = lens[lens.length - 1] || 0;

  const nodeArea = nodes.reduce((s, n) => s + n.w * n.h, 0);
  const packing = W * H > 0 ? nodeArea / (W * H) : 0;

  // edge crossings on node-center segments
  const ccw = (A, B, C) => (C.y - A.y) * (B.x - A.x) > (B.y - A.y) * (C.x - A.x);
  const inter = (p1, p2, p3, p4) =>
    ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
  const segs = edges.map((e) => (cx[e.from] && cx[e.to] ? [cx[e.from], cx[e.to]] : null)).filter(Boolean);
  let crossings = 0;
  for (let i = 0; i < segs.length; i++)
    for (let j = i + 1; j < segs.length; j++)
      if (inter(segs[i][0], segs[i][1], segs[j][0], segs[j][1])) crossings++;

  // node-node overlaps (a layout that overlaps boxes is cheating on density)
  let overlaps = 0;
  for (let i = 0; i < nodes.length; i++)
    for (let j = i + 1; j < nodes.length; j++) {
      const a = P[nodes[i].id], b = P[nodes[j].id];
      if (a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y) overlaps++;
    }

  const fitZ = Math.min(viewport.w / W, viewport.h / H, 1);

  return {
    nodes: nodes.length, edges: edges.length,
    W: Math.round(W), H: Math.round(H),
    aspect: +(W / H).toFixed(3),
    fitZoomPct: +(fitZ * 100).toFixed(1),
    medianEdgeLen: Math.round(med),
    maxEdgeLen: Math.round(max),
    totalEdgeLen: Math.round(total),
    crossings,
    overlaps,
    packing: +packing.toFixed(4),
  };
}
