/* unfold-lift.ts — the pure wire-picture decision for the primary surface
   (M5 P-wires). Kept in its own wasm-free module so the behavioural contract
   can execute outside the browser (the E2/H1 factor-to-pure rule: unfold.ts's
   import chain reaches libavoid.wasm and cannot be imported by the acceptance
   runner). The painter (drawWires) and the inspector both consume this one
   decision, so they cannot disagree.

   Rules, in order:
   - endpoints resolve to their nearest RENDERED ancestor-or-self (visibleRep
     semantics preserved: hidden kills the chain, every ancestor must be
     expanded);
   - default anchors lift each side to its outermost ancestor below the lowest
     common container — anchors are always siblings, so a wire never crosses a
     boundary it does not belong to;
   - an ancestor↔descendant pair draws as-is (a container wiring its own child
     crosses nothing);
   - the LOWEST SELECTED POINT sets the travel depth: a rendered selected leaf
     reveals its incident edges atomically (true anchors, arrowed, hot); a
     selected container anchors edges leaving its subtree AT its own border
     (hot, no arrow); a selected aggregate wire (matched as an unordered pair)
     explodes into its underlying edges, atomic;
   - non-atomic aggregates merge opposite directions into ONE wire (orientation
     by weight majority, tie → lexicographic) — direction is unreadable without
     arrowheads, and arrowheads exist only on atomic reveals;
   - concealed = distinct real endpoints hidden behind the anchors (the badge;
     0 = nothing concealed, no badge). */

export interface LiftEdge {
  from: string;
  to: string;
  call: boolean;
  dep: boolean;
  w: number;
  adv?: boolean;
}

export interface LiftSpec {
  parents: Record<string, string | null>;
  expanded: string[];
  hidden: string[];
  sel: string | null;
  selWire: { a: string; b: string } | null;
  layers: { calls: boolean; deps: boolean };
}

export interface LiftedWire {
  a: string;
  b: string;
  w: number;
  concealed: number;
  atomic: boolean;
  hot: boolean;
  adv: boolean;
  underlying: { from: string; to: string }[];
}

interface Slot {
  a: string;
  b: string;
  atomic: boolean;
  hot: boolean;
  adv: boolean;
  fwd: number;   // weight in the a→b direction
  rev: number;   // weight in the b→a direction
  edges: LiftEdge[];
  conceal: Set<string>;
}

export function ufLiftWires(edges: LiftEdge[], spec: LiftSpec): LiftedWire[] {
  const parents = spec.parents;
  const expanded = new Set(spec.expanded);
  const hidden = new Set(spec.hidden);
  const known = (id: string): boolean => Object.prototype.hasOwnProperty.call(parents, id);

  /** ancestor chain self→root (cycle-guarded; unknown ids yield an empty chain) */
  const chainOf = (id: string): string[] => {
    const out: string[] = [];
    const seen = new Set<string>();
    let cur: string | null = id;
    while (cur != null && known(cur) && !seen.has(cur)) {
      seen.add(cur);
      out.push(cur);
      cur = parents[cur];
    }
    return out;
  };
  const isRendered = (id: string): boolean => {
    const chain = chainOf(id);
    if (!chain.length || chain.some((x) => hidden.has(x))) return false;
    return chain.slice(1).every((x) => expanded.has(x));
  };
  const rep = (id: string): string | null => {
    for (const x of chainOf(id)) if (isRendered(x)) return x;
    return null;
  };
  /** highest ancestor-or-self of `x` that is not an ancestor-or-self of `other` */
  const liftAgainst = (x: string, other: string): string => {
    const otherChain = new Set(chainOf(other));
    let anchor = x;
    for (const c of chainOf(x)) {
      if (otherChain.has(c)) break;
      anchor = c;
    }
    return anchor;
  };
  const inSubtree = (id: string, root: string): boolean => chainOf(id).includes(root);

  const containers = new Set<string>();
  for (const id in parents) {
    const p = parents[id];
    if (p != null) containers.add(p);
  }
  // the selection only overrides depth when it is itself the rendered rep —
  // selecting something folded away cannot reveal what the view does not show
  const selRendered = spec.sel != null && known(spec.sel) && rep(spec.sel) === spec.sel ? spec.sel : null;
  const selIsContainer = selRendered != null && containers.has(selRendered);

  const slots = new Map<string, Slot>();
  const addWire = (a: string, b: string, e: LiftEdge, atomic: boolean, hot: boolean): void => {
    const key = atomic ? `A|${a}|${b}` : a < b ? `L|${a}|${b}` : `L|${b}|${a}`;
    let s = slots.get(key);
    if (!s) {
      s = { a, b, atomic, hot, adv: false, fwd: 0, rev: 0, edges: [], conceal: new Set() };
      slots.set(key, s);
    }
    if (a === s.a) s.fwd += e.w; else s.rev += e.w;
    s.hot = s.hot || hot;
    s.adv = s.adv || !!e.adv;
    s.edges.push(e);
    if (e.from !== s.a && e.from !== s.b) s.conceal.add(e.from);
    if (e.to !== s.a && e.to !== s.b) s.conceal.add(e.to);
  };

  const place = (e: LiftEdge): void => {
    const ra = rep(e.from), rb = rep(e.to);
    if (!ra || !rb || ra === rb) return;
    if (selRendered && !selIsContainer && (e.from === selRendered || e.to === selRendered)) {
      addWire(ra, rb, e, true, true);   // atomic reveal: the selected leaf's true wires
      return;
    }
    if (chainOf(ra).includes(rb) || chainOf(rb).includes(ra)) {
      addWire(ra, rb, e, false, false); // ancestor↔descendant: draws as-is
      return;
    }
    if (selIsContainer) {
      const fi = inSubtree(e.from, selRendered as string), ti = inSubtree(e.to, selRendered as string);
      if (fi !== ti) {
        // the selected container is the travel depth: its side anchors AT it
        const g = selRendered as string;
        if (fi) addWire(g, liftAgainst(rb, g), e, false, true);
        else addWire(liftAgainst(ra, g), g, e, false, true);
        return;
      }
    }
    addWire(liftAgainst(ra, rb), liftAgainst(rb, ra), e, false, false);
  };

  for (const e of edges) {
    if (!((e.call && spec.layers.calls) || (e.dep && spec.layers.deps))) continue;
    place(e);
  }

  // a selected aggregate explodes into its underlying edges (atomic, hot)
  if (spec.selWire) {
    const { a, b } = spec.selWire;
    for (const [key, s] of slots) {
      if (s.atomic) continue;
      if ((s.a === a && s.b === b) || (s.a === b && s.b === a)) {
        slots.delete(key);
        for (const e of s.edges) {
          const ra = rep(e.from), rb = rep(e.to);
          if (ra && rb && ra !== rb) addWire(ra, rb, e, true, true);
        }
        break;
      }
    }
  }

  const out: LiftedWire[] = [];
  for (const s of slots.values()) {
    // aggregates orient by weight majority (tie → lexicographic); atomic wires
    // keep their real direction
    const flip = !s.atomic && (s.rev > s.fwd || (s.rev === s.fwd && s.b < s.a));
    out.push({
      a: flip ? s.b : s.a,
      b: flip ? s.a : s.b,
      w: s.fwd + s.rev,
      concealed: s.conceal.size,
      atomic: s.atomic,
      hot: s.hot,
      adv: s.adv,
      underlying: s.edges
        .map((e) => ({ from: e.from, to: e.to }))
        .sort((x, y) => (x.from + ' ' + x.to < y.from + ' ' + y.to ? -1 : 1)),
    });
  }
  return out.sort((x, y) => (x.a === y.a ? (x.b < y.b ? -1 : 1) : x.a < y.a ? -1 : 1));
}
