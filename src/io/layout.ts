/* =====================================================================
   layout.ts — automatic layered-tree layout
   ---------------------------------------------------------------------
   Responsibility: the "Tidy" auto-layout. Pipeline per press:
     1. capture group membership (structural parent, geometry fallback)
     2. split spine nodes (endpoints of solid/thick edges + declared roots)
        from satellites (everything else); only the spine is layered
     3. find back-edges (DFS) on spine edges so cycles do not collapse layering
     4. layer the forward spine graph via longest-path (Kahn); declared
        `%% root` nodes are forced to layer 0
     5. order each layer by barycenter to reduce edge crossings
     6. position spine nodes by their rendered footprint (box + frontmatter
        card) along the flow direction (state.dir: TD/BT/LR/RL)
     7. park each satellite beside the spine node it references
     8. resize each group box to wrap its captured members

   Edge roles: solid/thick edges are structural (drive the tree); dotted
   edges are references (drawn, but never move a node).

   Mutates node x/y (and group x/y/w/h) only, never a node's own w/h.
   Re-renders, syncs, pushes history, zoom-to-fits.
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { CameraApi } from '../core/camera';
import type { FlowDir, DiagramEdge } from '../core/types';
import { snapV } from '../core/state';
import { routeReferences } from '../render/avoidRouter';

export interface LayoutApi {
  autoLayout: () => Promise<void>;
}

/** Gap between siblings within one layer. */
const SIBLING_GAP = 120;
/** Gap between consecutive layers. */
const LAYER_GAP = 150;
/** Gap between a node box and its frontmatter card (CSS uses 6). */
const CARD_GAP = 6;
/** Canvas origin for the whole layout. */
const ORIGIN_X = 80;
const ORIGIN_Y = 80;
/** Padding between a group box and the members it wraps. */
const GROUP_PAD = 24;
/** Barycenter ordering sweeps (down-only; more = tidier, slower). */
const CROSS_SWEEPS = 2;

/** Rendered size of a node including its frontmatter card. */
interface Footprint { w: number; h: number; }

/** Forward graph (cycle-free) used for layering + ordering. */
interface Forward {
  out: Record<string, string[]>;
  indeg: Record<string, number>;
  parents: Record<string, string[]>;
}

/** Key for one directed edge, used in the back-edge set. */
const edgeKey = (from: string, to: string): string => from + '\u0000' + to;

export function initLayout(ctx: AppContext, camera: CameraApi): LayoutApi {
  const { state } = ctx;

  /**
   * Measure a node's on-canvas footprint in layout pixels. offsetWidth/
   * Height are unscaled by camera zoom, so they are true world sizes. The
   * card hangs below the node and is centred on it: width = max(box, card),
   * height = box + card.
   */
  function footprint(id: string): Footprint {
    const n = state.nodes[id];
    const el = ctx.dom.world.querySelector<HTMLElement>(`.node[data-id="${id}"]`);
    if (!el) return { w: n.w, h: n.h };
    const card = el.querySelector<HTMLElement>('.fmcard');
    if (!card) return { w: el.offsetWidth, h: el.offsetHeight };
    return {
      w: Math.max(el.offsetWidth, card.offsetWidth),
      h: el.offsetHeight + CARD_GAP + card.offsetHeight,
    };
  }

  /** Which non-group nodes belong to each group: structural parent first, geometry as fallback. */
  function captureGroups(): Record<string, string[]> {
    const groups = Object.keys(state.nodes).filter((id) => state.nodes[id].shape === 'group');
    const groupSet = new Set(groups);
    const mem: Record<string, string[]> = {};
    for (const g of groups) {
      const G = state.nodes[g];
      mem[g] = Object.keys(state.nodes).filter((id) => {
        const n = state.nodes[id];
        if (n.shape === 'group') return false;
        // structural: a valid parent decides membership, position ignored
        if (n.parent && groupSet.has(n.parent)) return n.parent === g;
        // geometric fallback: unparented node whose centre sits in the box
        const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
        return cx >= G.x && cx <= G.x + G.w && cy >= G.y && cy <= G.y + G.h;
      });
    }
    return mem;
  }

  /** True for edges that define hierarchy (solid/thick). Dotted = reference. */
  const isSpineEdge = (e: DiagramEdge): boolean => e.style !== 'dotted';

  /**
   * Spine = every node that is an endpoint of a spine edge, plus any declared
   * root. Only spine nodes are layered into the band; the rest are satellites
   * parked beside their anchor. Group nodes never join the spine.
   */
  function spineNodeSet(ids: string[]): Set<string> {
    const idSet = new Set(ids);
    const spine = new Set<string>();
    for (const e of state.edges) {
      if (!isSpineEdge(e)) continue;
      if (idSet.has(e.from) && idSet.has(e.to)) { spine.add(e.from); spine.add(e.to); }
    }
    for (const r of state.roots) if (idSet.has(r)) spine.add(r);
    return spine;
  }

  /** Declared roots that exist in the spine, in written order. */
  function resolveRoots(spine: Set<string>): string[] {
    return state.roots.filter((id) => spine.has(id));
  }

  /**
   * First spine node connected to satellite `s` by any edge (either
   * direction). Used to park the satellite beside the thing that uses it.
   */
  function anchorOf(s: string, spine: Set<string>): string | null {
    for (const e of state.edges) {
      if (e.from === s && spine.has(e.to)) return e.to;
      if (e.to === s && spine.has(e.from)) return e.from;
    }
    return null;
  }

  /**
   * Classify cycle-closing spine edges via DFS colouring, within the spine
   * set. An edge into a node still on the active stack (grey) closes a loop
   * and is a back-edge. Reference and group edges are never considered.
   */
  function findBackEdges(spineIds: string[], spine: Set<string>): Set<string> {
    const out: Record<string, string[]> = {};
    spineIds.forEach((id) => { out[id] = []; });
    state.edges.forEach((e) => {
      if (isSpineEdge(e) && out[e.from] && spine.has(e.to)) out[e.from].push(e.to);
    });

    const back = new Set<string>();
    const color: Record<string, number> = {}; // 0 = unseen, 1 = on stack, 2 = done
    spineIds.forEach((id) => { color[id] = 0; });

    const stack: { id: string; i: number }[] = [];
    for (const root of spineIds) {
      if (color[root] !== 0) continue;
      stack.push({ id: root, i: 0 }); color[root] = 1;
      while (stack.length) {
        const top = stack[stack.length - 1];
        if (top.i < out[top.id].length) {
          const v = out[top.id][top.i++];
          if (color[v] === 1) back.add(edgeKey(top.id, v));
          else if (color[v] === 0) { color[v] = 1; stack.push({ id: v, i: 0 }); }
        } else { color[top.id] = 2; stack.pop(); }
      }
    }
    return back;
  }

  /**
   * Build the cycle-free spine forward graph. Skips reference edges, group
   * edges, back-edges, and any edge whose target is a declared root (so a
   * declared root always lands at layer 0).
   */
  function forwardGraph(spineIds: string[], spine: Set<string>, back: Set<string>, rootSet: Set<string>): Forward {
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
  function assignLayers(ids: string[], fwd: Forward): Record<string, number> {
    const layer: Record<string, number> = {};
    ids.forEach((id) => { layer[id] = 0; });
    const deg = { ...fwd.indeg };
    const q = ids.filter((id) => deg[id] === 0);
    const seen = new Set<string>();
    let guard = 0;
    while (q.length && guard++ < 99999) {
      const id = q.shift() as string;
      if (seen.has(id)) continue; seen.add(id);
      for (const nx of fwd.out[id]) {
        layer[nx] = Math.max(layer[nx], layer[id] + 1);
        if (--deg[nx] <= 0) q.push(nx);
      }
    }
    return layer;
  }

  /**
   * Reorder each layer by the mean position of its parents in the layer
   * above (barycenter). Reduces edge crossings versus insertion order.
   * Down-only sweep: layer 0 keeps its order, each lower layer follows.
   */
  function orderByBarycenter(layers: number[], byLayer: Record<number, string[]>, parents: Record<string, string[]>): void {
    const pos: Record<string, number> = {};
    (byLayer[layers[0]] || []).forEach((id, i) => { pos[id] = i; });
    for (let s = 0; s < CROSS_SWEEPS; s++) {
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

  /**
   * Park each satellite beside the spine node it references. Satellites never
   * enter the layered band. For each anchor they alternate to the far side of
   * the spine (after/before on the cross axis) and stack along the main axis,
   * so reference links read as short hops off the trunk instead of pulling
   * the trunk out of shape.
   */
  function placeSatellites(
    sats: string[], spine: Set<string>, foot: Record<string, Footprint>, horizontal: boolean,
    memberGroup: Record<string, string>,
  ): void {
    if (!sats.length || !spine.size) return;

    let cMin = Infinity, cMax = -Infinity;
    for (const id of spine) {
      const n = state.nodes[id], f = foot[id];
      const boxC0 = horizontal ? n.y : n.x;
      const boxLen = horizontal ? n.h : n.w;
      const footLen = horizontal ? f.h : f.w;
      const over = (footLen - boxLen) / 2;       // card overhangs the box equally each side
      cMin = Math.min(cMin, boxC0 - over);
      cMax = Math.max(cMax, boxC0 + boxLen + over);
    }
    const afterBase = cMax + LAYER_GAP;
    const beforeBase = cMin - LAYER_GAP;

    const mainOf = (id: string): number => (horizontal ? state.nodes[id].x : state.nodes[id].y);
    const anchorMain = (s: string): number => {
      const a = anchorOf(s, spine);
      return a != null ? mainOf(a) : ORIGIN_Y;
    };

    // satellites that belong to the same group are placed as one contiguous
    // run so their group box stays compact; the rest are parked individually
    // beside the node that references them.
    const clusters: Record<string, string[]> = {};
    const loose: string[] = [];
    for (const s of sats) {
      const g = memberGroup[s];
      if (g) (clusters[g] ||= []).push(s); else loose.push(s);
    }

    const cursor = { after: -Infinity, before: -Infinity };
    // bottom of the loose 'after' band, so clusters can sit clear below it
    let afterCrossEnd = afterBase;
    // lay one satellite at an explicit cross position, stacked along the main axis
    const lay = (s: string, mainStart: number, crossPos: number): number => {
      const n = state.nodes[s], f = foot[s];
      const fCross = horizontal ? f.h : f.w;
      const boxDim = horizontal ? n.h : n.w;
      const boxCross = crossPos + (fCross - boxDim) / 2;
      if (horizontal) { n.x = snapV(mainStart, ctx.snap); n.y = snapV(boxCross, ctx.snap); }
      else { n.y = snapV(mainStart, ctx.snap); n.x = snapV(boxCross, ctx.snap); }
      return mainStart + (horizontal ? f.w : f.h);
    };
    const placeOne = (s: string, aMain: number, side: 'after' | 'before'): void => {
      const f = foot[s];
      const fCross = horizontal ? f.h : f.w;
      const crossPos = side === 'after' ? afterBase : beforeBase - fCross;
      const start = Math.max(aMain, cursor[side] + SIBLING_GAP);
      cursor[side] = lay(s, start, crossPos);
      if (side === 'after') afterCrossEnd = Math.max(afterCrossEnd, afterBase + fCross);
    };

    // 1) loose satellites beside their anchor, in main-axis order, alternating
    //    sides so reference links read as short hops off the trunk
    const byAnchor: Record<string, string[]> = {};
    const unanchored: string[] = [];
    for (const s of loose) {
      const a = anchorOf(s, spine);
      if (a) (byAnchor[a] ||= []).push(s); else unanchored.push(s);
    }
    const anchors = Object.keys(byAnchor).sort((a, b) => mainOf(a) - mainOf(b));
    for (const a of anchors) {
      const aMain = mainOf(a);
      byAnchor[a].forEach((s, i) => placeOne(s, aMain, i % 2 === 0 ? 'after' : 'before'));
    }
    unanchored.forEach((s, i) => placeOne(s, ORIGIN_Y, i % 2 === 0 ? 'after' : 'before'));

    // 2) all-satellite groups (e.g. the store + persistence bands) become
    //    contiguous clusters on their OWN band, clear below the loose satellites
    //    and centred under the nodes they serve — a separate, readable zone
    //    instead of a box smeared across the whole diagram.
    const clusterIds = Object.keys(clusters);
    if (clusterIds.length) {
      const centroid = (members: string[]): number =>
        members.reduce((sum, s) => sum + anchorMain(s), 0) / members.length;
      const runLen = (members: string[]): number =>
        members.reduce((a, s) => a + (horizontal ? foot[s].w : foot[s].h) + SIBLING_GAP, -SIBLING_GAP);
      const clusterBase = afterCrossEnd > afterBase ? afterCrossEnd + LAYER_GAP : afterBase;
      clusterIds.sort((a, b) => centroid(clusters[a]) - centroid(clusters[b]));
      let clusterCursor = -Infinity;
      for (const g of clusterIds) {
        const members = clusters[g];
        members.sort((a, b) => anchorMain(a) - anchorMain(b));
        // centre the run on its centroid; never overlap the previous cluster
        let start = Math.max(centroid(members) - runLen(members) / 2, clusterCursor + SIBLING_GAP * 2);
        for (const s of members) start = lay(s, start, clusterBase) + SIBLING_GAP;
        clusterCursor = start;
      }
    }
  }

  /** Grow each group box to wrap members at full footprint (box + card). */
  function wrapGroups(mem: Record<string, string[]>, foot: Record<string, Footprint>): void {
    for (const g in mem) {
      const members = mem[g];
      if (!members.length) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of members) {
        const n = state.nodes[id];
        const f = foot[id] ?? { w: n.w, h: n.h };
        const overX = (f.w - n.w) / 2;   // card is centred under the box
        minX = Math.min(minX, n.x - overX);
        minY = Math.min(minY, n.y);
        maxX = Math.max(maxX, n.x - overX + f.w);
        maxY = Math.max(maxY, n.y + f.h);
      }
      const G = state.nodes[g];
      G.x = snapV(minX - GROUP_PAD, ctx.snap);
      G.y = snapV(minY - GROUP_PAD, ctx.snap);
      G.w = (maxX - minX) + GROUP_PAD * 2;
      G.h = (maxY - minY) + GROUP_PAD * 2;
    }
  }

  async function autoLayout(): Promise<void> {
    const ids = Object.keys(state.nodes).filter((id) => state.nodes[id].shape !== 'group');
    if (!ids.length) return;

    const groupMem = captureGroups();              // before anything moves

    let spine = spineNodeSet(ids);
    if (!spine.size) spine = new Set(ids);         // untagged file: treat all as spine
    const rootSet = new Set(resolveRoots(spine));

    // roots first so the DFS keeps their forward tree and cuts loops back into it
    const spineIds = [...spine].sort(
      (a, b) => (rootSet.has(b) ? 1 : 0) - (rootSet.has(a) ? 1 : 0));

    const back = findBackEdges(spineIds, spine);
    const fwd = forwardGraph(spineIds, spine, back, rootSet);
    const layer = assignLayers(spineIds, fwd);

    const byLayer: Record<number, string[]> = {};
    spineIds.forEach((id) => { (byLayer[layer[id]] ||= []).push(id); });
    const layers = Object.keys(byLayer).map(Number).sort((a, b) => a - b);

    orderByBarycenter(layers, byLayer, fwd.parents);

    // Mixed groups (some spine members, some satellites): inline each satellite
    // into the band right beside a groupmate. It gets a real cross slot — so no
    // overlaps — and the group box stays as tight as its spine block instead of
    // stretching out to wherever the satellite would otherwise be parked.
    const groupOfNode: Record<string, string> = {};
    for (const g in groupMem) for (const id of groupMem[g]) groupOfNode[id] = g;
    const inlineSet = new Set<string>();
    for (const g in groupMem) {
      const spineMembers = groupMem[g].filter((id) => spine.has(id));
      const satMembers = groupMem[g].filter((id) => !spine.has(id));
      if (!spineMembers.length || !satMembers.length) continue; // mixed groups only
      // attach to the satellite's own anchor when that anchor is a groupmate,
      // else to the group's first spine member (lowest layer) as a stable host
      const fallbackHost = spineMembers.slice().sort((a, b) => layer[a] - layer[b])[0];
      for (const s of satMembers) {
        const a = anchorOf(s, spine);
        const host = a != null && groupOfNode[a] === g ? a : fallbackHost;
        const row = byLayer[layer[host]];
        row.splice(row.indexOf(host) + 1, 0, s);
        layer[s] = layer[host];
        inlineSet.add(s);
      }
    }

    const foot: Record<string, Footprint> = {};
    ids.forEach((id) => { foot[id] = footprint(id); });

    const dir: FlowDir = state.dir;
    const horizontal = dir === 'LR' || dir === 'RL'; // layers advance along X
    const reversed = dir === 'BT' || dir === 'RL';    // layer 0 placed last

    const thickness = layers.map((L) =>
      Math.max(...byLayer[L].map((id) => (horizontal ? foot[id].w : foot[id].h))));
    const crossRun = layers.map((L) => {
      const sizes = byLayer[L].map((id) => (horizontal ? foot[id].h : foot[id].w));
      return sizes.reduce((a, b) => a + b, 0) + SIBLING_GAP * Math.max(0, byLayer[L].length - 1);
    });
    const maxCross = Math.max(...crossRun);

    const mainStart: number[] = [];
    let acc = 0;
    layers.forEach((_, i) => { mainStart[i] = acc; acc += thickness[i] + LAYER_GAP; });
    const mainTotal = acc - LAYER_GAP;

    layers.forEach((L, i) => {
      const band = reversed ? mainTotal - mainStart[i] - thickness[i] : mainStart[i];
      let cross = (maxCross - crossRun[i]) / 2;
      for (const id of byLayer[L]) {
        const n = state.nodes[id];
        const f = foot[id];
        if (horizontal) {
          // layers along X (centre box in band), siblings along Y (top-align)
          n.x = snapV(ORIGIN_X + band + (thickness[i] - n.w) / 2, ctx.snap);
          n.y = snapV(ORIGIN_Y + cross, ctx.snap);
          cross += f.h + SIBLING_GAP;
        } else {
          // layers along Y (top-align box in band), siblings along X (centre slot)
          n.x = snapV(ORIGIN_X + cross + (f.w - n.w) / 2, ctx.snap);
          n.y = snapV(ORIGIN_Y + band, ctx.snap);
          cross += f.w + SIBLING_GAP;
        }
      }
    });

    // Cluster only groups whose members are ALL satellites (e.g. the store
    // and persistence bands). A group that also holds spine nodes keeps its
    // satellites parked beside their anchors, so adding a clustered member
    // can't stretch the box across the whole diagram.
    const memberGroup: Record<string, string> = {};
    for (const g in groupMem) {
      const members = groupMem[g];
      if (members.length && members.every((id) => !spine.has(id))) {
        for (const id of members) memberGroup[id] = g;
      }
    }

    const satellites = ids.filter((id) => !spine.has(id) && !inlineSet.has(id));
    placeSatellites(satellites, spine, foot, horizontal, memberGroup);

    // reference edges route as right-angle elbows so they branch off the trunk
    for (const e of state.edges) {
      if (!isSpineEdge(e)) e.routing = 'ortho';
    }

    wrapGroups(groupMem, foot);

    // obstacle-avoiding routes for reference edges (positions are final now)
    await routeReferences(ctx);

    ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory();
    camera.zoomToFit();
    ctx.hooks.toast('Tidied · ' + dir);
  }

  return { autoLayout };
}
