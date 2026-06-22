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
import { snapV } from '../core/state';
import { routeReferences } from '../render/avoidRouter';
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
/** Key for one directed edge, used in the back-edge set. */
const edgeKey = (from, to) => from + '\u0000' + to;
export function initLayout(ctx, camera) {
    const { state } = ctx;
    /**
     * Measure a node's on-canvas footprint in layout pixels. offsetWidth/
     * Height are unscaled by camera zoom, so they are true world sizes. The
     * card hangs below the node and is centred on it: width = max(box, card),
     * height = box + card.
     */
    function footprint(id) {
        const n = state.nodes[id];
        const el = ctx.dom.world.querySelector(`.node[data-id="${id}"]`);
        if (!el)
            return { w: n.w, h: n.h };
        const card = el.querySelector('.fmcard');
        if (!card)
            return { w: el.offsetWidth, h: el.offsetHeight };
        return {
            w: Math.max(el.offsetWidth, card.offsetWidth),
            h: el.offsetHeight + CARD_GAP + card.offsetHeight,
        };
    }
    /** Which non-group nodes belong to each group: structural parent first, geometry as fallback. */
    function captureGroups() {
        const groups = Object.keys(state.nodes).filter((id) => state.nodes[id].shape === 'group');
        const groupSet = new Set(groups);
        const mem = {};
        for (const g of groups) {
            const G = state.nodes[g];
            mem[g] = Object.keys(state.nodes).filter((id) => {
                const n = state.nodes[id];
                if (n.shape === 'group')
                    return false;
                // structural: a valid parent decides membership, position ignored
                if (n.parent && groupSet.has(n.parent))
                    return n.parent === g;
                // geometric fallback: unparented node whose centre sits in the box
                const cx = n.x + n.w / 2, cy = n.y + n.h / 2;
                return cx >= G.x && cx <= G.x + G.w && cy >= G.y && cy <= G.y + G.h;
            });
        }
        return mem;
    }
    /** True for edges that define hierarchy (solid/thick). Dotted = reference. */
    const isSpineEdge = (e) => e.style !== 'dotted';
    /**
     * Spine = every node that is an endpoint of a spine edge, plus any declared
     * root. Only spine nodes are layered into the band; the rest are satellites
     * parked beside their anchor. Group nodes never join the spine.
     */
    function spineNodeSet(ids) {
        const idSet = new Set(ids);
        const spine = new Set();
        for (const e of state.edges) {
            if (!isSpineEdge(e))
                continue;
            if (idSet.has(e.from) && idSet.has(e.to)) {
                spine.add(e.from);
                spine.add(e.to);
            }
        }
        for (const r of state.roots)
            if (idSet.has(r))
                spine.add(r);
        return spine;
    }
    /** Declared roots that exist in the spine, in written order. */
    function resolveRoots(spine) {
        return state.roots.filter((id) => spine.has(id));
    }
    /**
     * First spine node connected to satellite `s` by any edge (either
     * direction). Used to park the satellite beside the thing that uses it.
     */
    function anchorOf(s, spine) {
        for (const e of state.edges) {
            if (e.from === s && spine.has(e.to))
                return e.to;
            if (e.to === s && spine.has(e.from))
                return e.from;
        }
        return null;
    }
    /**
     * Classify cycle-closing spine edges via DFS colouring, within the spine
     * set. An edge into a node still on the active stack (grey) closes a loop
     * and is a back-edge. Reference and group edges are never considered.
     */
    function findBackEdges(spineIds, spine) {
        const out = {};
        spineIds.forEach((id) => { out[id] = []; });
        state.edges.forEach((e) => {
            if (isSpineEdge(e) && out[e.from] && spine.has(e.to))
                out[e.from].push(e.to);
        });
        const back = new Set();
        const color = {}; // 0 = unseen, 1 = on stack, 2 = done
        spineIds.forEach((id) => { color[id] = 0; });
        const stack = [];
        for (const root of spineIds) {
            if (color[root] !== 0)
                continue;
            stack.push({ id: root, i: 0 });
            color[root] = 1;
            while (stack.length) {
                const top = stack[stack.length - 1];
                if (top.i < out[top.id].length) {
                    const v = out[top.id][top.i++];
                    if (color[v] === 1)
                        back.add(edgeKey(top.id, v));
                    else if (color[v] === 0) {
                        color[v] = 1;
                        stack.push({ id: v, i: 0 });
                    }
                }
                else {
                    color[top.id] = 2;
                    stack.pop();
                }
            }
        }
        return back;
    }
    /**
     * Build the cycle-free spine forward graph. Skips reference edges, group
     * edges, back-edges, and any edge whose target is a declared root (so a
     * declared root always lands at layer 0).
     */
    function forwardGraph(spineIds, spine, back, rootSet) {
        const out = {};
        const indeg = {};
        const parents = {};
        spineIds.forEach((id) => { out[id] = []; indeg[id] = 0; parents[id] = []; });
        state.edges.forEach((e) => {
            if (!isSpineEdge(e) || !out[e.from] || !spine.has(e.to))
                return;
            if (back.has(edgeKey(e.from, e.to)) || rootSet.has(e.to))
                return;
            out[e.from].push(e.to);
            indeg[e.to]++;
            parents[e.to].push(e.from);
        });
        return { out, indeg, parents };
    }
    /** Longest-path layer index per node (Kahn) on the forward graph. */
    function assignLayers(ids, fwd) {
        const layer = {};
        ids.forEach((id) => { layer[id] = 0; });
        const deg = { ...fwd.indeg };
        const q = ids.filter((id) => deg[id] === 0);
        const seen = new Set();
        let guard = 0;
        while (q.length && guard++ < 99999) {
            const id = q.shift();
            if (seen.has(id))
                continue;
            seen.add(id);
            for (const nx of fwd.out[id]) {
                layer[nx] = Math.max(layer[nx], layer[id] + 1);
                if (--deg[nx] <= 0)
                    q.push(nx);
            }
        }
        return layer;
    }
    /**
     * Reorder each layer by the mean position of its parents in the layer
     * above (barycenter). Reduces edge crossings versus insertion order.
     * Down-only sweep: layer 0 keeps its order, each lower layer follows.
     */
    function orderByBarycenter(layers, byLayer, parents) {
        const pos = {};
        (byLayer[layers[0]] || []).forEach((id, i) => { pos[id] = i; });
        for (let s = 0; s < CROSS_SWEEPS; s++) {
            for (let li = 1; li < layers.length; li++) {
                const row = byLayer[layers[li]];
                const key = {};
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
    function placeSatellites(sats, spine, foot, horizontal) {
        if (!sats.length || !spine.size)
            return;
        let cMin = Infinity, cMax = -Infinity;
        for (const id of spine) {
            const n = state.nodes[id], f = foot[id];
            const boxC0 = horizontal ? n.y : n.x;
            const boxLen = horizontal ? n.h : n.w;
            const footLen = horizontal ? f.h : f.w;
            const over = (footLen - boxLen) / 2; // card overhangs the box equally each side
            cMin = Math.min(cMin, boxC0 - over);
            cMax = Math.max(cMax, boxC0 + boxLen + over);
        }
        const afterBase = cMax + LAYER_GAP;
        const beforeBase = cMin - LAYER_GAP;
        const byAnchor = {};
        const unanchored = [];
        for (const s of sats) {
            const a = anchorOf(s, spine);
            if (a)
                (byAnchor[a] ||= []).push(s);
            else
                unanchored.push(s);
        }
        const cursor = { after: -Infinity, before: -Infinity };
        const placeOne = (s, aMain, side) => {
            const n = state.nodes[s], f = foot[s];
            const fMain = horizontal ? f.w : f.h;
            const fCross = horizontal ? f.h : f.w;
            const boxDim = horizontal ? n.h : n.w;
            const mainStart = Math.max(aMain, cursor[side] + SIBLING_GAP);
            const crossPos = side === 'after' ? afterBase : beforeBase - fCross;
            const boxCross = crossPos + (fCross - boxDim) / 2;
            if (horizontal) {
                n.x = snapV(mainStart, ctx.snap);
                n.y = snapV(boxCross, ctx.snap);
            }
            else {
                n.y = snapV(mainStart, ctx.snap);
                n.x = snapV(boxCross, ctx.snap);
            }
            cursor[side] = mainStart + fMain;
        };
        // place anchors in main-axis order so each anchor's satellites cluster at
        // the anchor instead of drifting down a shared column (the "wide fan")
        const mainOf = (id) => (horizontal ? state.nodes[id].x : state.nodes[id].y);
        const anchors = Object.keys(byAnchor).sort((a, b) => mainOf(a) - mainOf(b));
        for (const a of anchors) {
            const aMain = mainOf(a);
            byAnchor[a].forEach((s, i) => placeOne(s, aMain, i % 2 === 0 ? 'after' : 'before'));
        }
        unanchored.forEach((s, i) => placeOne(s, ORIGIN_Y, i % 2 === 0 ? 'after' : 'before'));
    }
    /** Grow each group box to wrap members at full footprint (box + card). */
    function wrapGroups(mem, foot) {
        for (const g in mem) {
            const members = mem[g];
            if (!members.length)
                continue;
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const id of members) {
                const n = state.nodes[id];
                const f = foot[id] ?? { w: n.w, h: n.h };
                const overX = (f.w - n.w) / 2; // card is centred under the box
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
    async function autoLayout() {
        const ids = Object.keys(state.nodes).filter((id) => state.nodes[id].shape !== 'group');
        if (!ids.length)
            return;
        const groupMem = captureGroups(); // before anything moves
        let spine = spineNodeSet(ids);
        if (!spine.size)
            spine = new Set(ids); // untagged file: treat all as spine
        const rootSet = new Set(resolveRoots(spine));
        // roots first so the DFS keeps their forward tree and cuts loops back into it
        const spineIds = [...spine].sort((a, b) => (rootSet.has(b) ? 1 : 0) - (rootSet.has(a) ? 1 : 0));
        const back = findBackEdges(spineIds, spine);
        const fwd = forwardGraph(spineIds, spine, back, rootSet);
        const layer = assignLayers(spineIds, fwd);
        const byLayer = {};
        spineIds.forEach((id) => { (byLayer[layer[id]] ||= []).push(id); });
        const layers = Object.keys(byLayer).map(Number).sort((a, b) => a - b);
        orderByBarycenter(layers, byLayer, fwd.parents);
        const foot = {};
        ids.forEach((id) => { foot[id] = footprint(id); });
        const dir = state.dir;
        const horizontal = dir === 'LR' || dir === 'RL'; // layers advance along X
        const reversed = dir === 'BT' || dir === 'RL'; // layer 0 placed last
        const thickness = layers.map((L) => Math.max(...byLayer[L].map((id) => (horizontal ? foot[id].w : foot[id].h))));
        const crossRun = layers.map((L) => {
            const sizes = byLayer[L].map((id) => (horizontal ? foot[id].h : foot[id].w));
            return sizes.reduce((a, b) => a + b, 0) + SIBLING_GAP * Math.max(0, byLayer[L].length - 1);
        });
        const maxCross = Math.max(...crossRun);
        const mainStart = [];
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
                }
                else {
                    // layers along Y (top-align box in band), siblings along X (centre slot)
                    n.x = snapV(ORIGIN_X + cross + (f.w - n.w) / 2, ctx.snap);
                    n.y = snapV(ORIGIN_Y + band, ctx.snap);
                    cross += f.w + SIBLING_GAP;
                }
            }
        });
        const satellites = ids.filter((id) => !spine.has(id));
        placeSatellites(satellites, spine, foot, horizontal);
        // reference edges route as right-angle elbows so they branch off the trunk
        for (const e of state.edges) {
            if (!isSpineEdge(e))
                e.routing = 'ortho';
        }
        wrapGroups(groupMem, foot);
        // obstacle-avoiding routes for reference edges (positions are final now)
        await routeReferences(ctx);
        ctx.hooks.render();
        ctx.hooks.sync();
        ctx.hooks.pushHistory();
        camera.zoomToFit();
        ctx.hooks.toast('Tidied · ' + dir);
    }
    return { autoLayout };
}
