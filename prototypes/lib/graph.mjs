// Shared graph derivation — the SINGLE source of the comparison subgraph.
// Every layout (today + all candidates) receives identical input from here,
// so the comparison is fair. Do not fork this per-layout.

// The root level: the 40 top-level modules a user sees first, plus the
// module-to-module edges (any leaf edge projected up to its owning module).
export function rootLevel(graph) {
  const N = Object.fromEntries(graph.nodes.map((n) => [n.id, n]));
  const root = graph.nodes.filter((n) => !n.parent);
  const rootIds = new Set(root.map((n) => n.id));
  const rootAnc = (id) => {
    let c = id, guard = 0;
    while (N[c] && N[c].parent && guard++ < 50) c = N[c].parent;
    return c;
  };
  const seen = new Set();
  const edges = [];
  for (const e of graph.edges) {
    const a = rootAnc(e.from), b = rootAnc(e.to);
    if (a && b && a !== b && rootIds.has(a) && rootIds.has(b)) {
      const k = a + '>' + b;
      if (!seen.has(k)) { seen.add(k); edges.push({ from: a, to: b }); }
    }
  }
  // Return shallow copies so a layout cannot mutate the shared source.
  const nodes = root.map((n) => ({ id: n.id, w: n.w, h: n.h, kind: n.kind, shape: n.shape, label: n.label, x: n.x, y: n.y }));
  return { nodes, edges };
}
