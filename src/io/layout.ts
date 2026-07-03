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

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { FlowDir, DiagramEdge } from '../core/types/types';
import { snapV, nodeFootprint } from '../core/state/state';
import { routeReferences } from '../render/avoidRouter';

export interface LayoutApi {
  autoLayout: () => Promise<void>;
}

/** Gap between siblings within one layer. */
const SIBLING_GAP = 150;
/** Gap between consecutive layers. */
const LAYER_GAP = 200;
/** Canvas origin for the whole layout. */
const ORIGIN_X = 80;
const ORIGIN_Y = 80;
/** Padding between a group box and the members it wraps. */
const GROUP_PAD = 34;
/** Extra top space reserved inside a group box for its title tab. */
const GROUP_LABEL_PAD = 26;
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

// Wires the auto-layout pipeline (see the module header) to a live context + camera.
export function initLayout(ctx: AppContext, camera: CameraApi): LayoutApi {
  const { state } = ctx;

  /**
   * A node's on-canvas footprint in layout pixels (box + frontmatter card).
   * Sizes come from the model (state.measured, populated by render's measure
   * pass) via nodeFootprint — never read live from the DOM. The card hangs
   * below the node and is centred on it: width = max(box, card), height = box
   * + gap + card. Nodes not currently rendered (off-level) have no measured
   * card, so they fall back to the box — exactly as the old DOM query did when
   * the element wasn't present.
   */
  function footprint(id: string): Footprint {
    const node = state.nodes[id];
    const size = nodeFootprint(state, node, ctx.prefs.showFrontmatter);
    return { w: size.w, h: size.h };
  }

  /** Which non-group nodes belong to each group: structural parent first, geometry as fallback. */
  function captureGroups(): Record<string, string[]> {
    const groups = Object.keys(state.nodes).filter((id) => state.nodes[id].shape === 'group');
    const groupSet = new Set(groups);
    const mem: Record<string, string[]> = {};
    for (const groupId of groups) {
      const groupNode = state.nodes[groupId];
      mem[groupId] = Object.keys(state.nodes).filter((id) => {
        const member = state.nodes[id];
        if (member.shape === 'group') return false;
        // structural: a valid parent decides membership, position ignored
        if (member.parent && groupSet.has(member.parent)) return member.parent === groupId;
        // geometric fallback: unparented node whose centre sits in the box
        const cx = member.x + member.w / 2, cy = member.y + member.h / 2;
        return cx >= groupNode.x && cx <= groupNode.x + groupNode.w && cy >= groupNode.y && cy <= groupNode.y + groupNode.h;
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
    for (const edge of state.edges) {
      if (!isSpineEdge(edge)) continue;
      if (idSet.has(edge.from) && idSet.has(edge.to)) { spine.add(edge.from); spine.add(edge.to); }
    }
    for (const rootId of state.roots) if (idSet.has(rootId)) spine.add(rootId);
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
    for (const edge of state.edges) {
      if (edge.from === s && spine.has(edge.to)) return edge.to;
      if (edge.to === s && spine.has(edge.from)) return edge.from;
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
          const next = out[top.id][top.i++];
          if (color[next] === 1) back.add(edgeKey(top.id, next));
          else if (color[next] === 0) { color[next] = 1; stack.push({ id: next, i: 0 }); }
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
    const queue = ids.filter((id) => deg[id] === 0);
    const seen = new Set<string>();
    let guard = 0;
    while (queue.length && guard++ < 99999) {
      const id = queue.shift() as string;
      if (seen.has(id)) continue; seen.add(id);
      for (const nx of fwd.out[id]) {
        layer[nx] = Math.max(layer[nx], layer[id] + 1);
        if (--deg[nx] <= 0) queue.push(nx);
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
    for (let sweep = 0; sweep < CROSS_SWEEPS; sweep++) {
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

  /** Cross-axis extent of the whole spine, footprint-based (card overhang included). */
  function spineCrossBounds(spine: Set<string>, foot: Record<string, Footprint>, horizontal: boolean): { min: number; max: number } {
    let min = Infinity, max = -Infinity;
    for (const id of spine) {
      const node = state.nodes[id], size = foot[id];
      const boxC0 = horizontal ? node.y : node.x;
      const boxLen = horizontal ? node.h : node.w;
      const footLen = horizontal ? size.h : size.w;
      const over = (footLen - boxLen) / 2;       // card overhangs the box equally each side
      min = Math.min(min, boxC0 - over);
      max = Math.max(max, boxC0 + boxLen + over);
    }
    return { min, max };
  }

  /** Split satellites into per-group clusters (kept contiguous) vs loose singles. */
  function partitionSatellites(sats: string[], memberGroup: Record<string, string>): {
    clusters: Record<string, string[]>; loose: string[];
  } {
    const clusters: Record<string, string[]> = {};
    const loose: string[] = [];
    for (const sat of sats) {
      const groupId = memberGroup[sat];
      if (groupId) (clusters[groupId] ||= []).push(sat); else loose.push(sat);
    }
    return { clusters, loose };
  }

  /**
   * Place loose (non-clustered) satellites beside their anchor, in main-axis
   * order, alternating sides so reference links read as short hops off the trunk.
   */
  function placeLooseSatellites(
    loose: string[], spine: Set<string>, mainOf: (id: string) => number,
    placeOne: (s: string, aMain: number, side: 'after' | 'before') => void,
  ): void {
    const byAnchor: Record<string, string[]> = {};
    const unanchored: string[] = [];
    for (const sat of loose) {
      const anchorId = anchorOf(sat, spine);
      if (anchorId) (byAnchor[anchorId] ||= []).push(sat); else unanchored.push(sat);
    }
    const anchors = Object.keys(byAnchor).sort((a, b) => mainOf(a) - mainOf(b));
    for (const anchorId of anchors) {
      const aMain = mainOf(anchorId);
      byAnchor[anchorId].forEach((s, i) => placeOne(s, aMain, i % 2 === 0 ? 'after' : 'before'));
    }
    unanchored.forEach((s, i) => placeOne(s, ORIGIN_Y, i % 2 === 0 ? 'after' : 'before'));
  }

  /**
   * Lay out all-satellite group clusters as compact contiguous runs on their
   * own band, clear below the loose satellites and centred under the nodes
   * they serve — a separate, readable zone instead of a box smeared across
   * the whole diagram.
   */
  function placeSatelliteClusters(
    clusters: Record<string, string[]>, anchorMain: (s: string) => number,
    foot: Record<string, Footprint>, horizontal: boolean, clusterBase: number,
    lay: (s: string, mainStart: number, crossPos: number) => number,
  ): void {
    const clusterIds = Object.keys(clusters);
    if (!clusterIds.length) return;
    const centroid = (members: string[]): number =>
      members.reduce((sum, s) => sum + anchorMain(s), 0) / members.length;
    const runLen = (members: string[]): number =>
      members.reduce((a, s) => a + (horizontal ? foot[s].w : foot[s].h) + SIBLING_GAP, -SIBLING_GAP);
    clusterIds.sort((a, b) => centroid(clusters[a]) - centroid(clusters[b]));
    let clusterCursor = -Infinity;
    for (const groupId of clusterIds) {
      const members = clusters[groupId];
      members.sort((a, b) => anchorMain(a) - anchorMain(b));
      // centre the run on its centroid; never overlap the previous cluster
      let start = Math.max(centroid(members) - runLen(members) / 2, clusterCursor + SIBLING_GAP * 2);
      for (const sat of members) start = lay(sat, start, clusterBase) + SIBLING_GAP;
      clusterCursor = start;
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

    const { min: cMin, max: cMax } = spineCrossBounds(spine, foot, horizontal);
    const afterBase = cMax + LAYER_GAP;
    const beforeBase = cMin - LAYER_GAP;

    const mainOf = (id: string): number => (horizontal ? state.nodes[id].x : state.nodes[id].y);
    const anchorMain = (s: string): number => {
      const anchorId = anchorOf(s, spine);
      return anchorId != null ? mainOf(anchorId) : ORIGIN_Y;
    };

    // satellites that belong to the same group are placed as one contiguous
    // run so their group box stays compact; the rest are parked individually
    // beside the node that references them.
    const { clusters, loose } = partitionSatellites(sats, memberGroup);

    const cursor = { after: -Infinity, before: -Infinity };
    // bottom of the loose 'after' band, so clusters can sit clear below it
    let afterCrossEnd = afterBase;
    // lay one satellite at an explicit cross position, stacked along the main axis
    const lay = (s: string, mainStart: number, crossPos: number): number => {
      const node = state.nodes[s], size = foot[s];
      const fCross = horizontal ? size.h : size.w;
      const boxDim = horizontal ? node.h : node.w;
      const boxCross = crossPos + (fCross - boxDim) / 2;
      if (horizontal) { node.x = snapV(mainStart, ctx.snap); node.y = snapV(boxCross, ctx.snap); }
      else { node.y = snapV(mainStart, ctx.snap); node.x = snapV(boxCross, ctx.snap); }
      return mainStart + (horizontal ? size.w : size.h);
    };
    const placeOne = (s: string, aMain: number, side: 'after' | 'before'): void => {
      const size = foot[s];
      const fCross = horizontal ? size.h : size.w;
      const crossPos = side === 'after' ? afterBase : beforeBase - fCross;
      const start = Math.max(aMain, cursor[side] + SIBLING_GAP);
      cursor[side] = lay(s, start, crossPos);
      if (side === 'after') afterCrossEnd = Math.max(afterCrossEnd, afterBase + fCross);
    };

    // 1) loose satellites beside their anchor
    placeLooseSatellites(loose, spine, mainOf, placeOne);

    // 2) all-satellite groups (e.g. the store + persistence bands) become
    //    contiguous clusters on their own band
    const clusterBase = afterCrossEnd > afterBase ? afterCrossEnd + LAYER_GAP : afterBase;
    placeSatelliteClusters(clusters, anchorMain, foot, horizontal, clusterBase, lay);
  }

  /** Grow each group box to wrap members at full footprint (box + card). */
  function wrapGroups(mem: Record<string, string[]>, foot: Record<string, Footprint>): void {
    for (const groupId in mem) {
      const members = mem[groupId];
      if (!members.length) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const id of members) {
        const node = state.nodes[id];
        const size = foot[id] ?? { w: node.w, h: node.h };
        const overX = (size.w - node.w) / 2;   // card is centred under the box
        minX = Math.min(minX, node.x - overX);
        minY = Math.min(minY, node.y);
        maxX = Math.max(maxX, node.x - overX + size.w);
        maxY = Math.max(maxY, node.y + size.h);
      }
      const groupNode = state.nodes[groupId];
      groupNode.x = snapV(minX - GROUP_PAD, ctx.snap);
      // extra top pad so the title tab sits clear above the first member
      groupNode.y = snapV(minY - GROUP_PAD - GROUP_LABEL_PAD, ctx.snap);
      groupNode.w = (maxX - minX) + GROUP_PAD * 2;
      groupNode.h = (maxY - minY) + GROUP_PAD * 2 + GROUP_LABEL_PAD;
    }
  }

  /** Spine set, declared roots within it, and DFS order (roots first, so the DFS keeps their forward tree and cuts loops back into it). */
  function resolveSpine(ids: string[]): { spine: Set<string>; rootSet: Set<string>; spineIds: string[] } {
    let spine = spineNodeSet(ids);
    if (!spine.size) spine = new Set(ids);         // untagged file: treat all as spine
    const rootSet = new Set(resolveRoots(spine));
    const spineIds = [...spine].sort(
      (a, b) => (rootSet.has(b) ? 1 : 0) - (rootSet.has(a) ? 1 : 0));
    return { spine, rootSet, spineIds };
  }

  /** Assign a layer index to every spine node and order each layer to reduce crossings. */
  function layerSpine(spineIds: string[], spine: Set<string>, rootSet: Set<string>): {
    byLayer: Record<number, string[]>; layers: number[]; layer: Record<string, number>;
  } {
    const back = findBackEdges(spineIds, spine);
    const fwd = forwardGraph(spineIds, spine, back, rootSet);
    const layer = assignLayers(spineIds, fwd);

    const byLayer: Record<number, string[]> = {};
    spineIds.forEach((id) => { (byLayer[layer[id]] ||= []).push(id); });
    const layers = Object.keys(byLayer).map(Number).sort((a, b) => a - b);

    orderByBarycenter(layers, byLayer, fwd.parents);
    return { byLayer, layers, layer };
  }

  /**
   * Mixed groups (some spine members, some satellites): inline each satellite
   * into the band right beside a groupmate. It gets a real cross slot — so no
   * overlaps — and the group box stays as tight as its spine block instead of
   * stretching out to wherever the satellite would otherwise be parked.
   */
  function inlineMixedGroupSatellites(
    groupMem: Record<string, string[]>, spine: Set<string>, layer: Record<string, number>,
    byLayer: Record<number, string[]>,
  ): Set<string> {
    const groupOfNode: Record<string, string> = {};
    for (const groupId in groupMem) for (const id of groupMem[groupId]) groupOfNode[id] = groupId;

    const inlineSet = new Set<string>();
    for (const groupId in groupMem) {
      const spineMembers = groupMem[groupId].filter((id) => spine.has(id));
      const satMembers = groupMem[groupId].filter((id) => !spine.has(id));
      if (!spineMembers.length || !satMembers.length) continue; // mixed groups only
      // attach to the satellite's own anchor when that anchor is a groupmate,
      // else to the group's first spine member (lowest layer) as a stable host
      const fallbackHost = spineMembers.slice().sort((a, b) => layer[a] - layer[b])[0];
      for (const sat of satMembers) {
        const anchorId = anchorOf(sat, spine);
        const host = anchorId != null && groupOfNode[anchorId] === groupId ? anchorId : fallbackHost;
        const row = byLayer[layer[host]];
        row.splice(row.indexOf(host) + 1, 0, sat);
        layer[sat] = layer[host];
        inlineSet.add(sat);
      }
    }
    return inlineSet;
  }

  /** Position each spine node within its layer band, along the flow direction. Returns whether layers advance along X. */
  function positionSpineLayers(
    layers: number[], byLayer: Record<number, string[]>, foot: Record<string, Footprint>, dir: FlowDir,
  ): boolean {
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
        const node = state.nodes[id];
        const size = foot[id];
        if (horizontal) {
          // layers along X (centre box in band), siblings along Y (top-align)
          node.x = snapV(ORIGIN_X + band + (thickness[i] - node.w) / 2, ctx.snap);
          node.y = snapV(ORIGIN_Y + cross, ctx.snap);
          cross += size.h + SIBLING_GAP;
        } else {
          // layers along Y (top-align box in band), siblings along X (centre slot)
          node.x = snapV(ORIGIN_X + cross + (size.w - node.w) / 2, ctx.snap);
          node.y = snapV(ORIGIN_Y + band, ctx.snap);
          cross += size.w + SIBLING_GAP;
        }
      }
    });
    return horizontal;
  }

  /**
   * Groups whose members are ALL satellites become clustering candidates for
   * placeSatellites (e.g. the store and persistence bands). A group that also
   * holds spine nodes keeps its satellites parked beside their anchors, so
   * adding a clustered member can't stretch the box across the whole diagram.
   */
  function clusterCandidateGroups(groupMem: Record<string, string[]>, spine: Set<string>): Record<string, string> {
    const memberGroup: Record<string, string> = {};
    for (const groupId in groupMem) {
      const members = groupMem[groupId];
      if (members.length && members.every((id) => !spine.has(id))) {
        for (const id of members) memberGroup[id] = groupId;
      }
    }
    return memberGroup;
  }

  /** Reference edges route as right-angle elbows so they branch off the trunk. */
  function markReferenceEdgesOrtho(): void {
    for (const edge of state.edges) {
      if (!isSpineEdge(edge)) edge.routing = 'ortho';
    }
  }

  async function autoLayout(): Promise<void> {
    const ids = Object.keys(state.nodes).filter((id) => state.nodes[id].shape !== 'group');
    if (!ids.length) return;

    const groupMem = captureGroups();              // before anything moves

    const { spine, rootSet, spineIds } = resolveSpine(ids);
    const { byLayer, layers, layer } = layerSpine(spineIds, spine, rootSet);
    const inlineSet = inlineMixedGroupSatellites(groupMem, spine, layer, byLayer);

    const foot: Record<string, Footprint> = {};
    ids.forEach((id) => { foot[id] = footprint(id); });

    const dir: FlowDir = state.dir;
    const horizontal = positionSpineLayers(layers, byLayer, foot, dir);

    const memberGroup = clusterCandidateGroups(groupMem, spine);

    const satellites = ids.filter((id) => !spine.has(id) && !inlineSet.has(id));
    placeSatellites(satellites, spine, foot, horizontal, memberGroup);

    markReferenceEdgesOrtho();

    wrapGroups(groupMem, foot);

    // obstacle-avoiding routes for reference edges (positions are final now)
    await routeReferences(ctx);

    ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory();
    camera.zoomToFit();
    ctx.hooks.toast('Tidied · ' + dir);
  }

  return { autoLayout };
}
