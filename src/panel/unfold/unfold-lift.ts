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
  nodeA: string;
  nodeB: string;
  atomic: boolean;
  hot: boolean;
  adv: boolean;
  fwdWeight: number;   // weight in the nodeA→nodeB direction
  revWeight: number;   // weight in the nodeB→nodeA direction
  edges: LiftEdge[];
  concealSet: Set<string>;
}

/** parents/expanded/hidden bundled once per ufLiftWires call — every helper below
    takes this instead of closing over locals, so each stays a module-scope function. */
interface LiftCtx {
  parents: Record<string, string | null>;
  expanded: Set<string>;
  hidden: Set<string>;
}

function knownId(ctx: LiftCtx, id: string): boolean {
  return Object.prototype.hasOwnProperty.call(ctx.parents, id);
}

/** ancestor chain self→root (cycle-guarded; unknown ids yield an empty chain) */
function ancestorChain(ctx: LiftCtx, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  let cur: string | null = id;
  while (cur != null && knownId(ctx, cur) && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    cur = ctx.parents[cur];
  }
  return out;
}

function isRenderedId(ctx: LiftCtx, id: string): boolean {
  const chain = ancestorChain(ctx, id);
  if (!chain.length || chain.some((entry) => ctx.hidden.has(entry))) return false;
  return chain.slice(1).every((entry) => ctx.expanded.has(entry));
}

function renderedRep(ctx: LiftCtx, id: string): string | null {
  for (const entry of ancestorChain(ctx, id)) if (isRenderedId(ctx, entry)) return entry;
  return null;
}

/** highest ancestor-or-self of `target` that is not an ancestor-or-self of `other` */
function liftAgainst(ctx: LiftCtx, target: string, other: string): string {
  const otherChain = new Set(ancestorChain(ctx, other));
  let anchor = target;
  for (const entry of ancestorChain(ctx, target)) {
    if (otherChain.has(entry)) break;
    anchor = entry;
  }
  return anchor;
}

function inSubtree(ctx: LiftCtx, id: string, root: string): boolean {
  return ancestorChain(ctx, id).includes(root);
}

function containerSet(parents: Record<string, string | null>): Set<string> {
  const containers = new Set<string>();
  for (const id in parents) {
    const parentId = parents[id];
    if (parentId != null) containers.add(parentId);
  }
  return containers;
}

function slotKey(nodeA: string, nodeB: string, atomic: boolean): string {
  if (atomic) return `A|${nodeA}|${nodeB}`;
  return nodeA < nodeB ? `L|${nodeA}|${nodeB}` : `L|${nodeB}|${nodeA}`;
}

function getOrCreateSlot(
  slots: Map<string, Slot>,
  endpoints: { nodeA: string; nodeB: string },
  kind: { atomic: boolean; hot: boolean },
): Slot {
  const { nodeA, nodeB } = endpoints;
  const key = slotKey(nodeA, nodeB, kind.atomic);
  const existing = slots.get(key);
  if (existing) return existing;
  const slot: Slot = {
    nodeA, nodeB, atomic: kind.atomic, hot: kind.hot,
    adv: false, fwdWeight: 0, revWeight: 0, edges: [], concealSet: new Set(),
  };
  slots.set(key, slot);
  return slot;
}

function mergeEdgeIntoSlot(slot: Slot, endpointA: string, edge: LiftEdge, hot: boolean): void {
  if (endpointA === slot.nodeA) slot.fwdWeight += edge.w;
  else slot.revWeight += edge.w;
  slot.hot = slot.hot || hot;
  slot.adv = slot.adv || !!edge.adv;
  slot.edges.push(edge);
  if (edge.from !== slot.nodeA && edge.from !== slot.nodeB) slot.concealSet.add(edge.from);
  if (edge.to !== slot.nodeA && edge.to !== slot.nodeB) slot.concealSet.add(edge.to);
}

function addWireTo(
  slots: Map<string, Slot>,
  endpoints: { nodeA: string; nodeB: string },
  edge: LiftEdge,
  kind: { atomic: boolean; hot: boolean },
): void {
  const slot = getOrCreateSlot(slots, endpoints, kind);
  mergeEdgeIntoSlot(slot, endpoints.nodeA, edge, kind.hot);
}

/** the selection only overrides depth when it is itself the rendered rep —
    selecting something folded away cannot reveal what the view does not show */
function selectionState(
  ctx: LiftCtx, spec: LiftSpec, containers: Set<string>,
): { rep: string | null; isContainer: boolean } {
  const rep = spec.sel != null && knownId(ctx, spec.sel) && renderedRep(ctx, spec.sel) === spec.sel ? spec.sel : null;
  return { rep, isContainer: rep != null && containers.has(rep) };
}

/** parents/expanded/hidden plus the in-progress slot map — bundled so every
    placement helper below stays at or under the 4-param readability limit. */
interface PlaceCtx {
  liftCtx: LiftCtx;
  slots: Map<string, Slot>;
}

function edgeReps(ctx: LiftCtx, edge: LiftEdge): { repFrom: string; repTo: string } | null {
  const repFrom = renderedRep(ctx, edge.from), repTo = renderedRep(ctx, edge.to);
  if (!repFrom || !repTo || repFrom === repTo) return null;
  return { repFrom, repTo };
}

function isAtomicLeafReveal(selection: { rep: string | null; isContainer: boolean }, edge: LiftEdge): boolean {
  return !!selection.rep && !selection.isContainer && (edge.from === selection.rep || edge.to === selection.rep);
}

function isAncestorDescendant(ctx: LiftCtx, repFrom: string, repTo: string): boolean {
  return ancestorChain(ctx, repFrom).includes(repTo) || ancestorChain(ctx, repTo).includes(repFrom);
}

/** the selected container is the travel depth: its side anchors AT it */
function placeInsideSelectedContainer(
  pctx: PlaceCtx,
  selRep: string,
  edge: LiftEdge,
  reps: { repFrom: string; repTo: string },
): boolean {
  const fromInside = inSubtree(pctx.liftCtx, edge.from, selRep);
  const toInside = inSubtree(pctx.liftCtx, edge.to, selRep);
  if (fromInside === toInside) return false;
  if (fromInside) {
    const nodeB = liftAgainst(pctx.liftCtx, reps.repTo, selRep);
    addWireTo(pctx.slots, { nodeA: selRep, nodeB }, edge, { atomic: false, hot: true });
  } else {
    const nodeA = liftAgainst(pctx.liftCtx, reps.repFrom, selRep);
    addWireTo(pctx.slots, { nodeA, nodeB: selRep }, edge, { atomic: false, hot: true });
  }
  return true;
}

function placeEdge(pctx: PlaceCtx, selection: { rep: string | null; isContainer: boolean }, edge: LiftEdge): void {
  const reps = edgeReps(pctx.liftCtx, edge);
  if (!reps) return;
  const { repFrom, repTo } = reps;
  if (isAtomicLeafReveal(selection, edge)) { // atomic reveal: the selected leaf's true wires
    addWireTo(pctx.slots, { nodeA: repFrom, nodeB: repTo }, edge, { atomic: true, hot: true });
    return;
  }
  if (isAncestorDescendant(pctx.liftCtx, repFrom, repTo)) { // ancestor↔descendant: draws as-is
    addWireTo(pctx.slots, { nodeA: repFrom, nodeB: repTo }, edge, { atomic: false, hot: false });
    return;
  }
  if (selection.isContainer && selection.rep && placeInsideSelectedContainer(pctx, selection.rep, edge, reps)) return;
  const nodeA = liftAgainst(pctx.liftCtx, repFrom, repTo), nodeB = liftAgainst(pctx.liftCtx, repTo, repFrom);
  addWireTo(pctx.slots, { nodeA, nodeB }, edge, { atomic: false, hot: false });
}

function matchesSelectedPair(slot: Slot, selWire: { a: string; b: string }): boolean {
  return (slot.nodeA === selWire.a && slot.nodeB === selWire.b)
    || (slot.nodeA === selWire.b && slot.nodeB === selWire.a);
}

function explodeEdgeAtomic(ctx: LiftCtx, slots: Map<string, Slot>, edge: LiftEdge): void {
  const reps = edgeReps(ctx, edge);
  if (reps) addWireTo(slots, { nodeA: reps.repFrom, nodeB: reps.repTo }, edge, { atomic: true, hot: true });
}

/** a selected aggregate explodes into its underlying edges (atomic, hot) */
function explodeSelectedWire(pctx: PlaceCtx, selWire: { a: string; b: string }): void {
  for (const [key, slot] of pctx.slots) {
    if (slot.atomic || !matchesSelectedPair(slot, selWire)) continue;
    pctx.slots.delete(key);
    for (const edge of slot.edges) explodeEdgeAtomic(pctx.liftCtx, pctx.slots, edge);
    return;
  }
}

function underlyingOf(slot: Slot): { from: string; to: string }[] {
  return slot.edges
    .map((edge) => {
      const entry = {} as { from: string; to: string };
      entry.from = edge.from;
      entry['to'] = edge.to;
      return entry;
    })
    .sort((x, y) => (x.from + ' ' + x.to < y.from + ' ' + y.to ? -1 : 1));
}

// aggregates orient by weight majority (tie → lexicographic); atomic wires keep their real direction
function buildLiftedWire(slot: Slot): LiftedWire {
  const tieLexicographic = slot.revWeight === slot.fwdWeight && slot.nodeB < slot.nodeA;
  const flip = !slot.atomic && (slot.revWeight > slot.fwdWeight || tieLexicographic);
  const wire = {} as LiftedWire;
  wire['a'] = flip ? slot.nodeB : slot.nodeA;
  wire['b'] = flip ? slot.nodeA : slot.nodeB;
  wire['w'] = slot.fwdWeight + slot.revWeight;
  wire.concealed = slot.concealSet.size;
  wire.atomic = slot.atomic;
  wire.hot = slot.hot;
  wire.adv = slot.adv;
  wire.underlying = underlyingOf(slot);
  return wire;
}

export function ufLiftWires(edges: LiftEdge[], spec: LiftSpec): LiftedWire[] {
  const ctx: LiftCtx = { parents: spec.parents, expanded: new Set(spec.expanded), hidden: new Set(spec.hidden) };
  const selection = selectionState(ctx, spec, containerSet(spec.parents));
  const pctx: PlaceCtx = { liftCtx: ctx, slots: new Map<string, Slot>() };

  for (const edge of edges) {
    if ((edge.call && spec.layers.calls) || (edge.dep && spec.layers.deps)) placeEdge(pctx, selection, edge);
  }
  if (spec.selWire) explodeSelectedWire(pctx, spec.selWire);

  const out = Array.from(pctx.slots.values(), buildLiftedWire);
  return out.sort((x, y) => (x.a === y.a ? (x.b < y.b ? -1 : 1) : x.a < y.a ? -1 : 1));
}
