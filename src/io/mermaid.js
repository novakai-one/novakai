/* =====================================================================
   mermaid.ts — two-way Mermaid text <-> model
   ---------------------------------------------------------------------
   Responsibility: serialize the model to Mermaid flowchart text
   (toMermaid, with %% fm layout metadata so positions round-trip),
   parse Mermaid text back into a model (fromMermaid), apply parsed text
   to the live model (applyText), and keep the textarea in sync (sync).

   This is the only module that knows the Mermaid grammar + the custom
   metadata comments. Pure transform on one side, model write on the other.
   ===================================================================== */
import { STYLES, DEFAULTS, PALETTE, escM } from '../core/config';
import { frontmatterToMermaid, matchFrontmatterLine, applyFrontmatterLine, isFrontmatterEmpty, } from '../core/frontmatter';
/** Per-shape Mermaid wrappers. */
const shapeWrap = {
    rect: (id, l) => `${id}["${l}"]`,
    round: (id, l) => `${id}("${l}")`,
    stadium: (id, l) => `${id}(["${l}"])`,
    cylinder: (id, l) => `${id}[("${l}")]`,
    diamond: (id, l) => `${id}{"${l}"}`,
    circle: (id, l) => `${id}(("${l}"))`,
    hex: (id, l) => `${id}{{"${l}"}}`,
    note: (id, l) => `${id}>"${l}"]`,
    group: (id, l) => `subgraph ${id} ["${l}"]\n  end`,
};
/** Parse Mermaid text into a model fragment. Pure. */
export function fromMermaid(text) {
    const nodes = {};
    const edges = [];
    const meta = {};
    const orthoSet = new Set();
    const roots = [];
    const groupStack = [];
    const fmAcc = {};
    let maxN = 0, maxE = 0;
    let dir = 'TD';
    const bumpN = (id) => { const n = +id.replace(/\D/g, ''); if (n > maxN)
        maxN = n; };
    const ensure = (id, label, shape) => {
        bumpN(id);
        if (!nodes[id]) {
            nodes[id] = { id, label: label ?? id, shape: shape ?? 'rect', color: PALETTE[0], x: 0, y: 0, w: 0, h: 0 };
        }
        else if (label) {
            nodes[id].label = label;
            if (shape)
                nodes[id].shape = shape;
        }
        if (groupStack.length)
            nodes[id].parent = groupStack[groupStack.length - 1];
    };
    text.split('\n').forEach((raw) => {
        const t = raw.trim();
        let m;
        if ((m = t.match(/^%% fm (\w+) (-?\d+) (-?\d+) (-?\d+) (-?\d+) (\w+) (#?\w+)/))) {
            meta[m[1]] = { x: +m[2], y: +m[3], w: +m[4], h: +m[5], shape: m[6], color: m[7] === 'null' ? null : m[7] };
            bumpN(m[1]);
            return;
        }
        const fmLine = matchFrontmatterLine(t);
        if (fmLine) {
            applyFrontmatterLine(fmAcc, fmLine);
            bumpN(fmLine.id);
            return;
        }
        if ((m = t.match(/^%% edge (\w+) ortho/))) {
            orthoSet.add(m[1]);
            return;
        }
        if ((m = t.match(/^%% root (\w+)/))) {
            roots.push(m[1]);
            bumpN(m[1]);
            return;
        }
        if ((m = t.match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)\b/i))) {
            const d = m[1].toUpperCase();
            dir = d === 'TB' ? 'TD' : d;
            return;
        }
        if (t === 'end') {
            groupStack.pop();
            return;
        }
        if (t.startsWith('%%') || /^(flowchart|graph)\b/.test(t))
            return;
        if ((m = t.match(/^subgraph\s+(\w+)\s*\["?([^"\]]*)"?\]/))) {
            ensure(m[1], m[2], 'group');
            groupStack.push(m[1]);
            return;
        }
        if ((m = t.match(/^(\w+)\(\["?([^"\)]*)"?\]\)/))) {
            ensure(m[1], m[2], 'stadium');
            return;
        }
        if ((m = t.match(/^(\w+)\[\("?([^"\)]*)"?\)\]/))) {
            ensure(m[1], m[2], 'cylinder');
            return;
        }
        if ((m = t.match(/^(\w+)\{\{"?([^"\}]*)"?\}\}/))) {
            ensure(m[1], m[2], 'hex');
            return;
        }
        if ((m = t.match(/^(\w+)\(\("?([^"\)]*)"?\)\)/))) {
            ensure(m[1], m[2], 'circle');
            return;
        }
        if ((m = t.match(/^(\w+)\{"?([^"\}]*)"?\}/))) {
            ensure(m[1], m[2], 'diamond');
            return;
        }
        if ((m = t.match(/^(\w+)>"?([^"\]]*)"?\]/))) {
            ensure(m[1], m[2], 'note');
            return;
        }
        if ((m = t.match(/^(\w+)\("?([^"\)]*)"?\)/))) {
            ensure(m[1], m[2], 'round');
            return;
        }
        if ((m = t.match(/^(\w+)\["?([^"\]]*)"?\]/))) {
            ensure(m[1], m[2], 'rect');
            return;
        }
        const em = t.match(/^(\w+)\s*(-\.->|==>|-->|---)\s*(?:\|([^|]*)\|)?\s*(\w+)/);
        if (em) {
            ensure(em[1]);
            ensure(em[4]);
            const style = em[2] === '-.->' ? 'dotted' : em[2] === '==>' ? 'thick' : 'solid';
            edges.push({ id: 'e' + (++maxE), from: em[1], to: em[4], label: (em[3] || '').trim(), style, routing: 'straight' });
        }
    });
    // apply metadata or auto-place
    let auto = 0;
    for (const id in nodes) {
        const n = nodes[id], md = meta[id];
        if (md) {
            Object.assign(n, md);
        }
        else {
            const d = DEFAULTS[n.shape] || DEFAULTS.rect;
            n.w = d.w;
            n.h = d.h;
            n.x = 80 + (auto % 4) * 200;
            n.y = 80 + Math.floor(auto / 4) * 130;
            auto++;
        }
        // attach frontmatter if any non-empty was parsed for this node
        if (fmAcc[id] && !isFrontmatterEmpty(fmAcc[id]))
            n.fm = fmAcc[id];
    }
    edges.forEach((e) => { if (orthoSet.has(e.id))
        e.routing = 'ortho'; });
    const liveRoots = roots.filter((id) => nodes[id]);
    return { nodes, edges, nextN: maxN + 1, nextE: maxE + 1, dir, roots: liveRoots };
}
export function initMermaid(ctx, selection) {
    const { state } = ctx;
    const { mmd } = ctx.dom;
    function toMermaid() {
        let out = `flowchart ${state.dir}\n`;
        // layout metadata first
        for (const id in state.nodes) {
            const n = state.nodes[id];
            out += `%% fm ${id} ${Math.round(n.x)} ${Math.round(n.y)} ${Math.round(n.w)} ${Math.round(n.h)} ${n.shape} ${n.color}\n`;
        }
        // frontmatter metadata (public interface) — always emitted when present;
        // the on/off toggle is visibility-only, the data is never stripped here
        for (const id in state.nodes) {
            out += frontmatterToMermaid(id, state.nodes[id].fm);
        }
        for (const e of state.edges) {
            if (e.routing === 'ortho')
                out += `%% edge ${e.id} ortho\n`;
        }
        // layout roots (Tidy entry nodes) — only those still present
        for (const id of state.roots) {
            if (state.nodes[id])
                out += `%% root ${id}\n`;
        }
        // group membership: structural parent first, geometry as fallback
        const inGroup = {};
        for (const id in state.nodes) {
            const p = state.nodes[id].parent;
            if (p && state.nodes[p]?.shape === 'group')
                inGroup[id] = p;
        }
        for (const id in state.nodes) {
            if (state.nodes[id].shape !== 'group')
                continue;
            const g = state.nodes[id];
            for (const oid in state.nodes) {
                if (oid === id || inGroup[oid] || state.nodes[oid].shape === 'group')
                    continue;
                const o = state.nodes[oid];
                if (o.x >= g.x && o.y >= g.y && o.x + o.w <= g.x + g.w && o.y + o.h <= g.y + g.h)
                    inGroup[oid] = id;
            }
        }
        // emit groups with children, then loose nodes
        for (const id in state.nodes) {
            const n = state.nodes[id];
            if (n.shape !== 'group')
                continue;
            out += `  subgraph ${id} ["${escM(n.label)}"]\n`;
            for (const oid in inGroup) {
                if (inGroup[oid] === id)
                    out += '    ' + shapeWrap[state.nodes[oid].shape](oid, escM(state.nodes[oid].label)) + '\n';
            }
            out += '  end\n';
        }
        for (const id in state.nodes) {
            const n = state.nodes[id];
            if (n.shape === 'group' || inGroup[id])
                continue;
            out += '  ' + shapeWrap[n.shape](id, escM(n.label)) + '\n';
        }
        // edges
        for (const e of state.edges) {
            const arrow = STYLES[e.style] || '-->';
            let conn = arrow;
            if (e.label) {
                conn = e.style === 'dotted' ? `-.->|${escM(e.label)}|`
                    : e.style === 'thick' ? `==>|${escM(e.label)}|`
                        : `-->|${escM(e.label)}|`;
            }
            out += `  ${e.from} ${conn} ${e.to}\n`;
        }
        return out;
    }
    function sync() { mmd.value = toMermaid(); }
    function applyText() {
        try {
            const r = fromMermaid(mmd.value);
            if (!Object.keys(r.nodes).length) {
                ctx.hooks.toast('No nodes parsed');
                return;
            }
            state.nodes = r.nodes;
            state.edges = r.edges;
            state.nid = r.nextN;
            state.eid = r.nextE;
            state.dir = r.dir;
            state.roots = r.roots;
            selection.clearSel();
            ctx.hooks.render();
            sync();
            ctx.hooks.pushHistory();
            ctx.hooks.toast('Applied');
        }
        catch {
            ctx.hooks.toast('Parse error');
        }
    }
    return { toMermaid, sync, applyText };
}
