/*
 * flowmap · architecture auditor — SANDBOX
 * ----------------------------------------
 * A read-only prototype. It REUSES real repo modules:
 *   • io/mermaid.ts   → fromMermaid()  parses the live docs/flowmap/_bundle.mmd
 *   • core/config.ts  → THEMES, KIND_TINT, esc  (the app's real look)
 * It imports one-way, exports nothing, writes nothing. Deleting sandbox/ is a no-op.
 */
import { fromMermaid } from '../src/io/mermaid';
import { THEMES, KIND_TINT, esc } from '../src/core/config/config';
// reuse the app's REAL wire geometry (orthogonal elbow routing + port picking)
import { orthoPath } from '../src/render/wires';
import { portPos, bestSides } from '../src/core/state/state';

// ---- apply the app's real theme so the sandbox matches the editor exactly ----
const theme = THEMES.slate;
for (const [k, v] of Object.entries(theme.vars)) document.documentElement.style.setProperty(k, v);

const VW = 1280, VH = 760;
const stage = document.getElementById('stage')!;
const vc = document.getElementById('vc')!;
const foot = document.getElementById('foot')!;

// muted subsystem palette, drawn from the app's accent family (indigo/teal/violet/rose/amber/steel)
const SUBCOL: Record<string, string> = {
  'Composition root': '#8b94a6', 'Domain model & rules': '#7c8cff', 'History & persistence': '#5aa9a0',
  'Text & file I/O': '#6f9bd8', 'Viewport & camera': '#9a86c9', 'Rendering pipeline': '#c98aae',
  'Direct manipulation': '#d9a066', 'Inspector & chrome': '#b0975a', 'Review & planning': '#cf7f7f', '(other)': '#8b94a6',
};
const SUBORDER = ['Composition root', 'Domain model & rules', 'History & persistence', 'Text & file I/O',
  'Viewport & camera', 'Rendering pipeline', 'Direct manipulation', 'Inspector & chrome', 'Review & planning'];
// functional roles (by what a module does) — the one curated mapping; unknowns fall to (other)
const ROLE: Record<string, string> = {};
const put = (s: string, ms: string[]) => ms.forEach(m => ROLE[m] = s);
put('Domain model & rules', ['types', 'state', 'frontmatter', 'validate', 'config']);
put('History & persistence', ['history', 'persistence', 'seed']);
put('Viewport & camera', ['camera', 'minimap']);
put('Rendering pipeline', ['render', 'wires', 'avoidRouter', 'avoidWorker', 'layout']);
put('Direct manipulation', ['pointer', 'nodes', 'selection', 'clipboard', 'keyboard', 'inlineEdit', 'contextMenu', 'view']);
put('Text & file I/O', ['mermaid', 'files', 'exporter']);
put('Inspector & chrome', ['inspector', 'inspectorFrontmatter', 'tabs', 'styleControls', 'theming', 'navigator', 'slice']);
put('Review & planning', ['diff', 'diffWorkspace', 'plan', 'planner']);
put('Composition root', ['main', 'context', 'runtime']);

// ---------- model (built live from the real parser) ----------
type Iface = { name?: string; accepts?: string[]; returns?: string };
type Node = { id: string; label: string; kind: string; module: string; parent: string | null; desc: string | null; interfaces: Iface[]; isGroup: boolean };
type Edge = { from: string; to: string; style: string; label: string; order: number | null };
let N: Node[] = [], E: Edge[] = [], byId: Record<string, Node> = {}, MODS: string[] = [];
let REL: any = {};

function buildModel(text: string) {
  const p: any = fromMermaid(text);
  N = Object.keys(p.nodes).map((id) => {
    const n = p.nodes[id];
    return {
      id, label: n.label || id, kind: n.kind || (id.includes('__') ? 'function' : 'module'),
      module: id.includes('__') ? id.split('__')[0] : id, parent: n.parent || null,
      desc: n.fm?.desc || null, interfaces: n.fm?.interfaces || [], isGroup: n.shape === 'group' || n.kind === 'group',
    };
  });
  byId = Object.fromEntries(N.map((n) => [n.id, n]));
  MODS = N.filter((n) => !n.id.includes('__') && (n.kind === 'module' || n.kind === 'function')).map((n) => n.id);
  E = p.edges.map((e: any) => {
    const om = (e.label || '').match(/^(\d+)\s/);
    return { from: e.from, to: e.to, style: e.style === 'dotted' ? 'dep' : e.style, label: (e.label || '').trim(), order: om ? +om[1] : null };
  });
  computeRelations();
}

function computeRelations() {
  const sub = (m: string) => ROLE[m] || '(other)';
  // module-level dependency graph (dotted edges), with labels
  const out: Record<string, Set<string>> = {}, inn: Record<string, Set<string>> = {}, elab: Record<string, Set<string>> = {};
  const depSet = new Set<string>(); const depEdges: any[] = [];
  for (const e of E) {
    if (e.style !== 'dep') continue;
    const a = byId[e.from]?.module, b = byId[e.to]?.module;
    if (!a || !b || a === b) continue;
    (out[a] ||= new Set()).add(b); (inn[b] ||= new Set()).add(a);
    const k = a + '' + b; (elab[k] ||= new Set()); if (e.label) elab[k].add(e.label);
    if (!depSet.has(k)) { depSet.add(k); depEdges.push({ from: a, to: b, labels: [] as string[] }); }
  }
  for (const de of depEdges) de.labels = [...(elab[de.from + '' + de.to] || [])];
  const closure = (s: string, adj: Record<string, Set<string>>) => {
    const seen = new Set<string>(), st = [s];
    while (st.length) { const x = st.pop()!; for (const y of (adj[x] || [])) if (!seen.has(y)) { seen.add(y); st.push(y); } }
    seen.delete(s); return [...seen];
  };
  const dmemo: Record<string, number> = {}, inst: Record<string, boolean> = {};
  const depth = (m: string): number => { if (dmemo[m] != null) return dmemo[m]; if (inst[m]) return 0; inst[m] = true; let mx = 0; for (const y of (out[m] || [])) mx = Math.max(mx, depth(y) + 1); inst[m] = false; return dmemo[m] = mx; };
  const modules: Record<string, any> = {};
  for (const m of MODS) {
    modules[m] = {
      id: m, label: byId[m]?.label || m, desc: byId[m]?.desc || null, subsystem: sub(m), depth: depth(m),
      fanIn: (inn[m] || new Set()).size, fanOut: (out[m] || new Set()).size,
      directDeps: [...(out[m] || [])], directDependents: [...(inn[m] || [])],
      dependsOn: closure(m, out), blast: closure(m, inn), blastN: closure(m, inn).length,
      symbols: N.filter((n) => n.module === m && n.id !== m && !n.isGroup).length,
    };
  }
  // subsystems
  const subsystems: Record<string, string[]> = {};
  for (const m of MODS) (subsystems[sub(m)] ||= []).push(m);
  // state readers with labels
  const stateReaders = [...(inn['state'] || [])].map((m) => ({ module: m, uses: [...(elab[m + 'state'] || [])] }));
  // type flow
  const reFor = (l: string) => new RegExp('(^|[^A-Za-z0-9_])' + l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9_]|$)');
  const typeUse: any[] = [];
  for (const t of N.filter((n) => n.kind === 'type')) {
    const re = reFor(t.label); const prod = new Set<string>(), cons = new Set<string>();
    for (const n of N) { if (!n.module) continue; for (const i of n.interfaces) { if (i.returns && re.test(i.returns)) prod.add(n.module); if ((i.accepts || []).some((a) => re.test(a))) cons.add(n.module); } }
    const mods = new Set([...prod, ...cons]);
    if (mods.size) typeUse.push({ label: t.label, owner: t.module, producers: [...prod], consumers: [...cons], modules: [...mods], n: mods.size });
  }
  typeUse.sort((a, b) => b.n - a.n);
  // sibling cross-talk
  const subCross: Record<string, any> = {};
  for (const s in subsystems) { const ms = subsystems[s]; const intra = depEdges.filter((e) => ms.includes(e.from) && ms.includes(e.to)); subCross[s] = { members: ms.length, intraEdges: intra.length, siblingsNoCrossTalk: ms.length >= 3 && intra.length === 0 }; }
  REL = { modules, subsystems, depEdges, stateReaders, typeUse, subCross };
}
const mrel = (m: string) => REL.modules[m];
const subColOf = (m: string) => SUBCOL[mrel(m)?.subsystem] || '#8b94a6';

// ---------- svg helpers ----------
const NS = 'http://www.w3.org/2000/svg';
// the app's own arrow markers (copied 1:1 from render/wires.ts, recoloured per role)
const ARROW_DEFS = `<defs>
  <marker id="arrow" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="var(--edge)"/></marker>
  <marker id="arrowHot" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="var(--accent-2)"/></marker>
  <marker id="arrowUp" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="var(--accent)"/></marker>
  <marker id="arrowDown" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="var(--danger)"/></marker>
  <marker id="arrowSteel" markerWidth="8" markerHeight="8" refX="6.5" refY="3" orient="auto" markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="var(--accent-3)"/></marker>
</defs>`;
function svg() { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', `0 0 ${VW} ${VH}`); s.setAttribute('preserveAspectRatio', 'xMidYMid meet'); s.innerHTML = ARROW_DEFS; return s; }
function el(t: string, a: Record<string, any> = {}, p?: Element) { const e = document.createElementNS(NS, t); for (const k in a) e.setAttribute(k, String(a[k])); if (p) p.appendChild(e); return e as SVGElement; }
// a rect around a centre point, in the shape state.portPos() expects
const box = (cx: number, cy: number, w: number, h: number): any => ({ x: cx - w / 2, y: cy - h / 2, w, h });
// draw ONE directional wire the way the real canvas does: pick best sides, port
// positions and an orthogonal elbow path — all from the app's own geometry — with an arrowhead.
function wire(parent: Element, A: any, B: any, o: { stroke?: string; marker?: string; width?: number; opacity?: number; dash?: string } = {}) {
  const [sa, sb] = bestSides(A, B); const p = portPos(A, sa), q = portPos(B, sb); const d = orthoPath(p, sa, q, sb);
  const path = el('path', { d, fill: 'none', stroke: o.stroke || 'var(--edge)', 'stroke-width': o.width ?? 1.2, 'stroke-opacity': o.opacity ?? 0.75, 'stroke-linejoin': 'round', 'marker-end': `url(#${o.marker || 'arrow'})` }, parent);
  if (o.dash) path.setAttribute('stroke-dasharray', o.dash);
  return { path, mid: { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 } };
}
function txt(e: SVGElement, s: string) { e.textContent = s; return e; }
function clip(s: string, n: number) { s = s || ''; return s.length > n ? s.slice(0, n - 1) + '…' : s; }
function curve(x1: number, y1: number, x2: number, y2: number) { const mx = (x1 + x2) / 2, my = (y1 + y2) / 2; return `M${x1} ${y1} Q ${mx} ${my} ${x2} ${y2}`; }
function hint(html: string) { foot.innerHTML = html; }
let popEl: HTMLElement | null = null;
function pop(html: string, x: number, y: number) { unpop(); popEl = document.createElement('div'); popEl.className = 'pop'; popEl.innerHTML = html; stage.appendChild(popEl); const r = stage.getBoundingClientRect(); popEl.style.left = Math.min(x + 12, r.width - 290) + 'px'; popEl.style.top = Math.min(y + 12, r.height - 120) + 'px'; }
function unpop() { if (popEl) { popEl.remove(); popEl = null; } }

// ---------- views ----------
const VIEWS = [
  { id: 'sections', n: '01', name: 'Sections', title: 'Functional Sections — what the app is made of & how they talk', q: 'What are the main sections? What flows between them?', fn: renderSections },
  { id: 'map', n: '02', name: 'System Map', title: 'System Map — dependency wiring, the state hub & blast radius', q: 'What connects to what? What deliberately doesn’t? Blast radius?', fn: renderMap },
  { id: 'types', n: '03', name: 'Type Flow', title: 'Type Flow — follow a data contract through the whole app', q: 'Where does this type go? Which contract is the shared currency?', fn: renderTypeFlow },
  { id: 'flow', n: '04', name: 'Behavior Flow', title: 'Behavior Flow — how a feature actually runs, step by step', q: 'How does a feature actually work? (the only time-axis view)', fn: renderFlow },
  { id: 'hub', n: '05', name: 'State Hub', title: 'The state Hub — the source of truth & who reads what', q: 'What’s interconnected & why? Field-level blast radius.', fn: renderHub },
  { id: 'blast', n: '06', name: 'Blast Simulator', title: 'Blast Radius Simulator — plan a change, see the impact', q: 'If I change X, exactly what must I retest?', fn: renderBlast },
];
let CUR = 'sections';
let jTimer: any = null, flowTimer: any = null;
function setTabs() { const nav = document.getElementById('tabs')!; nav.innerHTML = ''; for (const v of VIEWS) { const b = document.createElement('button'); b.innerHTML = `<span class="n">${v.n}</span>${v.name}`; b.className = v.id === CUR ? 'on' : ''; b.onclick = () => { CUR = v.id; render(); }; nav.appendChild(b); } }
function render() {
  if (jTimer) { clearInterval(jTimer); jTimer = null; } if (flowTimer) { clearInterval(flowTimer); flowTimer = null; }
  const v = VIEWS.find((x) => x.id === CUR)!;
  document.getElementById('vt')!.textContent = v.title;
  document.getElementById('vq')!.innerHTML = 'Answers: ' + esc(v.q);
  vc.innerHTML = ''; stage.innerHTML = ''; foot.innerHTML = ''; setTabs(); v.fn();
}

/* ---- 01 Sections ---- */
function renderSections() {
  const rib = new Map<string, any>();
  for (const de of REL.depEdges) { const a = mrel(de.from).subsystem, b = mrel(de.to).subsystem; if (a === b) continue; const k = a + '' + b; const o = rib.get(k) || { from: a, to: b, n: 0, labels: new Set() }; o.n++; de.labels.forEach((l: string) => l && o.labels.add(l)); rib.set(k, o); }
  const ribs = [...rib.values()];
  // layer subsystems by dependency depth (foundation = depended-upon = bottom row)
  const sout: Record<string, Set<string>> = {}; for (const r of ribs) (sout[r.from] ||= new Set()).add(r.to);
  const dm: Record<string, number> = {}, inst: Record<string, boolean> = {};
  const depth = (s2: string): number => { if (dm[s2] != null) return dm[s2]; if (inst[s2]) return 0; inst[s2] = true; let mx = 0; for (const y of (sout[s2] || [])) mx = Math.max(mx, depth(y) + 1); inst[s2] = false; return dm[s2] = mx; };
  const present = SUBORDER.filter((x) => REL.subsystems[x]?.length);
  const dMax = Math.max(1, ...present.map(depth));
  const W = 194, H = 56, pad = 96, yFor = (d: number) => VH - 82 - d * ((VH - 150) / dMax);
  const byD: Record<number, string[]> = {}; for (const x of present) (byD[depth(x)] ||= []).push(x);
  const pos: Record<string, any> = {};
  for (const d in byD) { const arr = byD[d], n = arr.length; arr.forEach((x, i) => { pos[x] = { cx: pad + (i + 0.5) * (VW - 2 * pad) / n, cy: yFor(+d) }; }); }
  const s = svg(); stage.appendChild(s);
  for (let d = 0; d <= dMax; d++) txt(el('text', { x: 10, y: yFor(d) - H / 2 - 7, 'font-size': 9, fill: 'var(--ink-faint)', class: 'mono' }, s), d === 0 ? 'foundation' : d === dMax ? 'entry' : 'layer ' + d);
  let sel: string | null = null;
  const gE = el('g', {}, s), gN = el('g', {}, s), gL = el('g', {}, s);
  function draw() {
    gE.innerHTML = ''; gN.innerHTML = ''; gL.innerHTML = '';
    for (const r of ribs) {
      const A = box(pos[r.from].cx, pos[r.from].cy, W, H), B = box(pos[r.to].cx, pos[r.to].cy, W, H);
      const hot = !!sel && (r.from === sel || r.to === sel);
      const w2 = wire(gE, A, B, { stroke: hot ? SUBCOL[r.from] : 'var(--edge)', marker: hot ? 'arrowHot' : 'arrow', width: hot ? Math.min(1.6 + r.n * 0.5, 3.6) : Math.min(1 + r.n * 0.3, 2.2), opacity: sel ? (hot ? 0.95 : 0.06) : 0.42 });
      if (hot) txt(el('text', { x: w2.mid.x, y: w2.mid.y - 4, 'font-size': 10, fill: SUBCOL[r.from], 'text-anchor': 'middle', class: 'mono' }, gL), clip([...r.labels].slice(0, 2).join(', '), 22));
    }
    for (const sb of present) {
      const p = pos[sb], mods = REL.subsystems[sb] || [], dim = !!sel && sel !== sb && !ribs.some((r) => (r.from === sel && r.to === sb) || (r.to === sel && r.from === sb));
      const g = el('g', {}, gN) as SVGGElement; (g as any).style.cursor = 'pointer'; (g as any).style.opacity = dim ? '0.28' : '1';
      el('rect', { x: p.cx - W / 2, y: p.cy - H / 2, width: W, height: H, rx: 9, fill: 'var(--node-bg)', stroke: sel === sb ? SUBCOL[sb] : 'var(--node-stroke)', 'stroke-width': sel === sb ? 2 : 1 }, g);
      el('rect', { x: p.cx - W / 2, y: p.cy - H / 2, width: 4, height: H, rx: 2, fill: SUBCOL[sb] }, g);
      txt(el('text', { x: p.cx - W / 2 + 15, y: p.cy - 7, 'font-size': 12.5, 'font-weight': 600 }, g), clip(sb, 24));
      txt(el('text', { x: p.cx - W / 2 + 15, y: p.cy + 11, 'font-size': 10.5, fill: 'var(--ink-dim)', class: 'mono' }, g), mods.length + ' modules');
      g.onclick = (ev) => { ev.stopPropagation(); sel = sel === sb ? null : sb; draw(); showSide(); };
    }
  }
  function showSide() {
    let sd = document.getElementById('secside'); if (!sel) { if (sd) sd.remove(); return; }
    if (!sd) { sd = document.createElement('div'); sd.className = 'side'; sd.id = 'secside'; stage.appendChild(sd); }
    const mods = REL.subsystems[sel], sc = REL.subCross[sel], outR = ribs.filter((r) => r.from === sel), inR = ribs.filter((r) => r.to === sel);
    sd.innerHTML = `<h3><span class="chip" style="background:${SUBCOL[sel]}">${esc(sel)}</span></h3>`
      + (sc?.siblingsNoCrossTalk ? `<div style="color:var(--accent-2);font-size:11px;margin-bottom:8px">◇ ${sc.members} siblings, <b>no cross-talk</b> — they don’t wire to each other</div>` : (sc?.intraEdges ? `<div class="k" style="color:var(--ink-dim);font-size:11px;margin-bottom:8px">${sc.intraEdges} internal wire(s) between members</div>` : ''))
      + `<div style="margin:4px 0;font-weight:600">Modules (${mods.length})</div>`
      + mods.map((m: string) => `<div style="padding:4px 0;border-top:1px solid var(--line)"><b>${esc(m)}</b> <span class="tag">blast ${mrel(m).blastN}</span><br><span style="color:var(--ink-dim);font-size:11px">${esc(clip(mrel(m).desc || '', 62))}</span></div>`).join('')
      + `<div style="margin:12px 0 4px;color:var(--accent-2);font-weight:600">→ depends on</div>`
      + (outR.length ? outR.map((r) => `<div style="font-size:11px">${esc(r.to)} <span class="k mono" style="color:var(--ink-dim)">${esc(clip([...r.labels].join(', '), 30))}</span></div>`).join('') : '<div class="k" style="color:var(--ink-faint)">nothing (foundational/entry)</div>')
      + `<div style="margin:10px 0 4px;color:var(--accent-3);font-weight:600">← depended on by</div>`
      + (inR.length ? inR.map((r) => `<div style="font-size:11px">${esc(r.from)}</div>`).join('') : '<div class="k" style="color:var(--ink-faint)">nothing</div>');
  }
  draw(); s.addEventListener('click', () => { sel = null; draw(); showSide(); });
  hint('<b>9 functional sections</b> (named by what they do, not folders). Ribbon width = real dependencies. <span class="em">Click a section</span> for members + what flows in/out.');
}

/* ---- shared depth layout for map & type flow ---- */
function depthLayout() {
  const margin = 80, depthMax = Math.max(...MODS.map((m) => mrel(m).depth));
  const yFor = (dp: number) => VH - 120 - dp * ((VH - 210) / depthMax);
  const pos: Record<string, any> = {}, byDepth: Record<number, string[]> = {};
  for (const m of MODS) { const dp = mrel(m).depth; (byDepth[dp] ||= []).push(m); }
  for (const dp in byDepth) { const arr = byDepth[dp].sort((a, b) => SUBORDER.indexOf(mrel(a).subsystem) - SUBORDER.indexOf(mrel(b).subsystem) || a.localeCompare(b)); const n = arr.length; arr.forEach((m, i) => { pos[m] = { x: margin + (i + 0.5) * (VW - 2 * margin) / n, y: yFor(dp) }; }); }
  return { pos, yFor, depthMax };
}

/* ---- 02 System Map ---- */
let mapDir = 'breaks';
function renderMap() {
  vc.innerHTML = `<span class="legend" id="lg"></span>
    <button class="btn ${mapDir === 'breaks' ? 'on' : ''}" id="dB">↑ what breaks if I change it</button>
    <button class="btn ${mapDir === 'needs' ? 'on' : ''}" id="dN">↓ what it depends on</button>`;
  (document.getElementById('lg')!).innerHTML = SUBORDER.map((sb) => `<span><i style="background:${SUBCOL[sb]}"></i>${clip(sb, 13)}</span>`).join('');
  document.getElementById('dB')!.onclick = () => { mapDir = 'breaks'; render(); };
  document.getElementById('dN')!.onclick = () => { mapDir = 'needs'; render(); };
  const s = svg(); stage.appendChild(s);
  const { pos, yFor, depthMax } = depthLayout();
  for (let dp = 0; dp <= depthMax; dp++) { el('line', { x1: 0, y1: yFor(dp), x2: VW, y2: yFor(dp), stroke: 'var(--grid)' }, s); txt(el('text', { x: 8, y: yFor(dp) - 4, 'font-size': 9, fill: 'var(--ink-faint)', class: 'mono' }, s), dp === 0 ? 'base' : dp === depthMax ? 'entry' : 'depth ' + dp); }
  const gE = el('g', {}, s), gN = el('g', {}, s), gL = el('g', {}, s);
  let sel: string | null = null;
  function draw() {
    gE.innerHTML = ''; gN.innerHTML = ''; gL.innerHTML = '';
    const r = sel ? mrel(sel) : null; const set = sel ? new Set([sel, ...(mapDir === 'needs' ? r.dependsOn : r.blast)]) : null;
    for (const de of REL.depEdges) { const A = pos[de.from], B = pos[de.to]; if (!A || !B) continue; const on = !!set && set.has(de.from) && set.has(de.to); el('path', { d: curve(A.x, A.y, B.x, B.y), fill: 'none', stroke: on ? (mapDir === 'needs' ? 'var(--accent)' : 'var(--danger)') : 'var(--edge)', 'stroke-width': on ? 1.6 : 0.6, 'stroke-opacity': sel ? (on ? 0.85 : 0.05) : 0.14, 'marker-end': on ? (mapDir === 'needs' ? 'url(#arrowUp)' : 'url(#arrowDown)') : 'none' }, gE); if (on && (de.from === sel || de.to === sel) && de.labels.filter(Boolean).length) { const sp = de.from === sel ? A : B, ot = de.from === sel ? B : A; const lx = sp.x + 0.68 * (ot.x - sp.x), ly = sp.y + 0.68 * (ot.y - sp.y); txt(el('text', { x: lx, y: ly - 2, 'font-size': 9, fill: 'var(--accent-2)', 'text-anchor': 'middle', class: 'mono' }, gL), clip(de.labels.filter(Boolean).join(','), 16)); } }
    for (const m of MODS) {
      const p = pos[m], rad = 5 + Math.sqrt(mrel(m).blastN) * 2.2, isHub = m === 'state', dim = !!set && !set.has(m);
      const g = el('g', {}, gN) as SVGGElement; (g as any).style.cursor = 'pointer'; (g as any).style.opacity = dim ? '0.18' : '1';
      el('circle', { cx: p.x, cy: p.y, r: rad, fill: sel === m ? 'var(--ink)' : subColOf(m), stroke: isHub ? 'var(--ink)' : subColOf(m), 'stroke-width': isHub ? 2 : 1, 'fill-opacity': sel === m ? 1 : 0.82 }, g);
      if (isHub) el('circle', { cx: p.x, cy: p.y, r: rad + 4, fill: 'none', stroke: 'var(--ink-dim)', 'stroke-width': 0.7, 'stroke-dasharray': '2 2' }, g);
      txt(el('text', { x: p.x, y: p.y + rad + 11, 'font-size': isHub ? 11 : 9.5, fill: sel === m ? 'var(--ink)' : (dim ? 'var(--ink-faint)' : 'var(--ink)'), 'text-anchor': 'middle', 'font-weight': isHub ? 700 : 400 }, g), m);
      g.onclick = (ev) => { ev.stopPropagation(); sel = sel === m ? null : m; draw(); ro(); };
      g.onmouseenter = (ev: any) => { const rr = mrel(m); pop(`<h4>${esc(m)}</h4><div class="k">${esc(rr.subsystem)} · depth ${rr.depth}</div><div>${esc(clip(rr.desc || '', 80))}</div><div class="k" style="margin-top:4px">breaks ${rr.blastN} · needs ${rr.dependsOn.length} · used-by ${rr.fanIn}</div>`, ev.offsetX, ev.offsetY); };
      g.onmouseleave = unpop;
    }
  }
  function ro() { let r = document.getElementById('mapro'); if (!sel) { if (r) r.remove(); return; } if (!r) { r = document.createElement('div'); r.className = 'readout'; r.id = 'mapro'; stage.appendChild(r); } r.innerHTML = readout(sel, mapDir === 'needs' ? 'needs' : 'breaks'); }
  draw(); s.addEventListener('click', () => { sel = null; draw(); ro(); });
  hint('Vertical = <b>dependency depth</b> (base → entry). Node size = <b>blast radius</b>. <span class="em">Click a module</span> → real wiring + what it does <b>not</b> connect to. <b>state</b> = the hub (dashed).');
}
function readout(m: string, dir: string) {
  const r = mrel(m), set = dir === 'needs' ? r.dependsOn : r.blast, subs = new Set(set.map((x: string) => mrel(x).subsystem)), sc = REL.subCross[r.subsystem];
  const wire = (arr: string[], lbl: string, col: string) => `<div class="row"><span class="k">${lbl}</span><span style="color:${col};text-align:right">${arr.length ? esc(clip(arr.join(', '), 34)) : '—'}</span></div>`;
  return `<h4><span class="chip" style="background:${subColOf(m)}">${esc(r.subsystem)}</span></h4>
    <div class="name">${esc(m)}</div><div class="desc">${esc(r.desc || '')}</div>
    <div class="big" style="color:${dir === 'needs' ? 'var(--accent)' : 'var(--danger)'}">${set.length}</div>
    <div class="k" style="color:var(--ink-dim);margin-bottom:4px">${dir === 'needs' ? 'modules it depends on (transitive)' : 'modules that BREAK if you change it'} · ${subs.size} subsystems</div>
    ${wire(r.directDeps, 'wires to →', 'var(--accent)')}${wire(r.directDependents, '← wired from', 'var(--accent-3)')}
    ${sc?.siblingsNoCrossTalk ? `<div class="warn">◇ its section “${esc(r.subsystem)}” has <b>no internal wiring</b> — ${sc.members} siblings, no cross-talk</div>` : ''}`;
}

/* ---- 03 Type Flow ---- */
let selT: string | null = null;
function reHas(str: string, l: string) { return new RegExp('(^|[^A-Za-z0-9_])' + l.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^A-Za-z0-9_]|$)').test(str || ''); }
function renderTypeFlow() {
  const types = REL.typeUse; if (!types.length) { hint('no typed interfaces'); return; }
  if (!selT || !types.find((t: any) => t.label === selT)) selT = types[0].label;
  const { pos } = depthLayout();
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:absolute;inset:0;display:flex';
  const list = document.createElement('div'); list.style.cssText = 'width:225px;border-right:1px solid var(--line);overflow:auto;background:var(--panel);padding:9px';
  list.innerHTML = '<div class="k" style="color:var(--ink-dim);margin-bottom:8px;font-size:11px">Types ranked by how many modules touch them. #1 is the app’s <b>shared currency</b>.</div>';
  const canvas = document.createElement('div'); canvas.style.cssText = 'flex:1;position:relative';
  wrap.appendChild(list); wrap.appendChild(canvas); stage.appendChild(wrap);
  types.forEach((t: any) => { const r = document.createElement('div'); r.className = 'row2' + (t.label === selT ? ' on' : ''); r.dataset.t = t.label; r.innerHTML = `<div style="display:flex;justify-content:space-between"><b class="mono">${esc(t.label)}</b><span class="tag">${t.n}</span></div><div style="height:3px;background:var(--accent-3);opacity:.6;width:${Math.round(t.n / types[0].n * 100)}%;border-radius:2px;margin-top:4px"></div>`; r.onclick = () => { selT = t.label; list.querySelectorAll('.row2').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.t === selT)); draw(); }; list.appendChild(r); });
  function draw() {
    canvas.querySelectorAll('svg,.readout').forEach((n) => n.remove()); const s = svg(); canvas.appendChild(s);
    const t = types.find((x: any) => x.label === selT); const prod = new Set(t.producers), cons = new Set(t.consumers), touch = new Set(t.modules);
    for (const p of t.producers) for (const c of t.consumers) { if (p === c) continue; const A = pos[p], B = pos[c]; if (!A || !B) continue; el('path', { d: curve(A.x, A.y, B.x, B.y), fill: 'none', stroke: 'var(--accent-3)', 'stroke-width': 1, 'stroke-opacity': 0.45, 'marker-end': 'url(#arrowSteel)' }, s); }
    for (const m of MODS) { const p = pos[m], on = touch.has(m), isP = prod.has(m), g = el('g', {}, s) as SVGGElement; (g as any).style.opacity = on ? '1' : '0.14'; el('circle', { cx: p.x, cy: p.y, r: on ? 8 : 5, fill: on ? (isP ? '#5aa9a0' : 'var(--accent-3)') : subColOf(m), stroke: on ? 'var(--ink)' : subColOf(m), 'stroke-width': on ? 1.4 : 1 }, g); if (on) txt(el('text', { x: p.x, y: p.y - 11, 'font-size': 9, 'text-anchor': 'middle', fill: isP ? '#5aa9a0' : 'var(--accent-3)', class: 'mono' }, g), isP ? '▲ makes' : '▼ uses'); txt(el('text', { x: p.x, y: p.y + (on ? 20 : 14), 'font-size': on ? 10 : 8.5, 'text-anchor': 'middle', fill: on ? 'var(--ink)' : 'var(--ink-faint)' }, g), m); }
    const sigs: string[] = []; for (const n of N) { for (const i of n.interfaces) { const acc = (i.accepts || []).some((a) => reHas(a, selT!)), ret = reHas(i.returns || '', selT!); if (acc || ret) sigs.push(`${n.module}·${i.name || n.label} ${ret ? '→' + selT : ''}${acc ? ' («' + selT + '»)' : ''}`); } }
    const r = document.createElement('div'); r.className = 'readout'; canvas.appendChild(r);
    r.innerHTML = `<h4 style="color:var(--accent-3)" class="mono">${esc(selT!)}</h4><div class="k">defined in: ${esc(t.owner || '—')}</div><div class="big" style="color:var(--accent-3)">${t.n}</div><div class="k" style="color:var(--ink-dim)">of ${MODS.length} modules touch it · ${t.producers.length} make ▲ · ${t.consumers.length} use ▼</div><div style="margin-top:8px;max-height:190px;overflow:auto;border-top:1px solid var(--line);padding-top:6px" class="mono">${sigs.slice(0, 12).map((x) => `<div style="font-size:10.5px;padding:1px 0">${esc(x)}</div>`).join('')}${sigs.length > 12 ? `<div class="k" style="color:var(--ink-faint)">+${sigs.length - 12} more</div>` : ''}</div>`;
  }
  draw();
  hint(`<b>Follow a data contract.</b> Pick a type → every module that <b style="color:#5aa9a0">▲ makes</b> or <b style="color:var(--accent-3)">▼ uses</b> it lights up. #1 (<b>${esc(types[0].label)}</b>, ${types[0].n} modules) is this app’s shared currency — its <span class="em">DocDraft</span>.`);
}

/* ---- 04 Behavior Flow ---- */
const SCEN = [
  { name: 'Cold boot (app start)', type: 'boot' as const },
  { name: 'Drag a node', entry: 'pointer', verb: 'user drags on the canvas' },
  { name: 'Edit a node’s frontmatter', entry: 'inspectorFrontmatter', verb: 'user edits the inspector' },
  { name: 'Undo', entry: 'history', verb: 'user presses ⌘Z' },
  { name: 'Save / load a .mmd', entry: 'files', verb: 'user saves or loads a file' },
  { name: 'Review a plan', entry: 'planner', verb: 'user reviews a change plan' },
];
let scIdx = 1, flowStep = 0;
function boot() { return E.filter((e) => e.order != null).sort((a, b) => (a.order! - b.order!)).map((e) => ({ mods: [e.to], why: (e.label || '').replace(/^\d+\s*/, '') })).filter((b) => MODS.includes(b.mods[0])); }
function stages(sc: any) {
  if (sc.type === 'boot') return boot();
  const r = mrel(sc.entry), deps = r.directDeps.filter((x: string) => x !== 'state');
  const st: any[] = [{ mods: [sc.entry], why: sc.verb }];
  if (deps.length) st.push({ mods: deps, why: 'calls ' + deps.map((d: string) => { const de = REL.depEdges.find((e: any) => e.from === sc.entry && e.to === d); return d + (de?.labels[0] ? '·' + de.labels[0] : ''); }).join(', ') });
  st.push({ mods: ['state'], why: 'mutates the shared model (source of truth)' });
  const readers = ['render', 'wires', 'camera', 'minimap', 'layout', 'selection'].filter((x) => REL.stateReaders.some((s: any) => s.module === x));
  st.push({ mods: readers, why: 'everything that reads state re-derives → screen updates' });
  return st;
}
function renderFlow() {
  vc.innerHTML = `<select class="sel" id="scSel">${SCEN.map((s, i) => `<option value="${i}" ${i === scIdx ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    <button class="btn" id="fPrev">◂ prev</button><button class="btn" id="fPlay">▶ play</button><button class="btn" id="fNext">next ▸</button>`;
  (document.getElementById('scSel') as HTMLSelectElement).onchange = (e: any) => { scIdx = +e.target.value; flowStep = 0; render(); };
  const sc = SCEN[scIdx], st = stages(sc), s = svg(); stage.appendChild(s);
  const lanes = SUBORDER, laneH = (VH - 60) / lanes.length, laneY = (sb: string) => 46 + lanes.indexOf(sb) * laneH + laneH / 2;
  lanes.forEach((sb, i) => { el('rect', { x: 0, y: 46 + i * laneH, width: VW, height: laneH, fill: i % 2 ? 'var(--panel)' : 'var(--bg)', 'fill-opacity': 0.5 }, s); txt(el('text', { x: 12, y: 46 + i * laneH + laneH / 2, 'font-size': 10.5, fill: SUBCOL[sb], 'dominant-baseline': 'middle' }, s), clip(sb, 18)); });
  const x0 = 190, x1 = VW - 40, stepX = (x1 - x0) / Math.max(1, st.length - 1);
  function draw() {
    s.querySelectorAll('.dyn').forEach((n) => n.remove()); const g = el('g', { class: 'dyn' }, s);
    for (let i = 0; i < st.length - 1; i++) { const a = st[i], b = st[i + 1]; for (const ma of a.mods) for (const mb of b.mods) { const ax = x0 + i * stepX, bx = x0 + (i + 1) * stepX; el('path', { d: curve(ax, laneY(mrel(ma).subsystem), bx, laneY(mrel(mb).subsystem)), fill: 'none', stroke: 'var(--edge)', 'stroke-width': 1, 'stroke-opacity': i < flowStep ? 0.5 : 0.14, 'marker-end': i < flowStep ? 'url(#arrow)' : 'none' }, g); } }
    st.forEach((stg: any, i: number) => {
      const on = i === flowStep, past = i < flowStep, x = x0 + i * stepX;
      el('circle', { cx: x, cy: 28, r: on ? 11 : 8, fill: on ? 'var(--ink)' : (past ? 'var(--accent)' : 'var(--panel-2)'), stroke: 'var(--accent)', 'stroke-width': 1.4 }, g);
      txt(el('text', { x, y: 28, 'font-size': on ? 11 : 9, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: on ? 'var(--bg)' : 'var(--ink)', 'font-weight': 700 }, g), String(i + 1));
      const lg: Record<string, string[]> = {}; stg.mods.forEach((mm: string) => (lg[mrel(mm).subsystem] ||= []).push(mm));
      for (const m of stg.mods) { const lane = mrel(m).subsystem, grp = lg[lane], gi = grp.indexOf(m), mx = x + (gi - (grp.length - 1) / 2) * 62, y = laneY(lane), w = Math.max(48, m.length * 7 + 16); const gg = el('g', {}, g) as SVGGElement; (gg as any).style.opacity = on ? '1' : (past ? '0.6' : '0.32'); el('rect', { x: mx - w / 2, y: y - 12, width: w, height: 24, rx: 6, fill: on ? 'var(--panel-2)' : 'var(--node-bg)', stroke: subColOf(m), 'stroke-width': on ? 2 : 1 }, gg); txt(el('text', { x: mx, y, 'font-size': 11, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: on ? 'var(--ink)' : 'var(--ink-dim)' }, gg), m); }
    });
    let cap = document.getElementById('flowcap'); if (!cap) { cap = document.createElement('div'); cap.className = 'readout'; cap.id = 'flowcap'; stage.appendChild(cap); } cap.style.top = 'auto'; (cap.style as any).bottom = '14px'; cap.style.left = 'auto'; (cap.style as any).right = '16px';
    cap.innerHTML = `<h4>step ${flowStep + 1}/${st.length} — ${esc(sc.name)}</h4><div>${esc(st[flowStep].mods.join(', '))}</div><div class="k" style="color:var(--ink-dim);margin-top:3px">${esc(st[flowStep].why || '')}</div>`;
  }
  draw();
  document.getElementById('fPrev')!.onclick = () => { flowStep = Math.max(0, flowStep - 1); draw(); };
  document.getElementById('fNext')!.onclick = () => { flowStep = Math.min(st.length - 1, flowStep + 1); draw(); };
  document.getElementById('fPlay')!.onclick = function (this: any) { if (flowTimer) { clearInterval(flowTimer); flowTimer = null; this.textContent = '▶ play'; return; } this.textContent = '❚❚ pause'; flowTimer = setInterval(() => { if (flowStep >= st.length - 1) { clearInterval(flowTimer); flowTimer = null; const b = document.getElementById('fPlay'); if (b) b.textContent = '▶ play'; return; } flowStep++; draw(); }, 900); };
  hint('<b>How it works, as a sequence.</b> Pick a scenario; each step shows which modules fire and <span class="em">why</span>. Cold boot uses the real numbered call-order; interactions trace entry → <b>state</b> → re-derive.');
}

/* ---- 05 State Hub ---- */
function renderHub() {
  const readers = REL.stateReaders; const s = svg(); stage.appendChild(s);
  const cx = VW / 2 - 140, cy = VH / 2, R = 268;
  el('circle', { cx, cy, r: 62, fill: 'var(--node-bg)', stroke: 'var(--ink)', 'stroke-width': 2 }, s);
  txt(el('text', { x: cx, y: cy - 6, 'font-size': 18, 'font-weight': 700, 'text-anchor': 'middle', fill: 'var(--ink)' }, s), 'state');
  txt(el('text', { x: cx, y: cy + 13, 'font-size': 10, fill: 'var(--ink-dim)', 'text-anchor': 'middle' }, s), 'source of truth');
  txt(el('text', { x: cx, y: cy + 27, 'font-size': 10, fill: 'var(--accent-2)', 'text-anchor': 'middle', class: 'mono' }, s), readers.length + ' readers · blast ' + (mrel('state')?.blastN ?? ''));
  const gE = el('g', {}, s), gN = el('g', {}, s); const slices = [...new Set(readers.flatMap((r: any) => r.uses))].filter(Boolean) as string[]; let sl: string | null = null;
  function draw() {
    gE.innerHTML = ''; gN.innerHTML = '';
    readers.forEach((rd: any, i: number) => { const a = -Math.PI / 2 + (i / readers.length) * Math.PI * 2, x = cx + R * Math.cos(a), y = cy + R * Math.sin(a), hot = !!sl && rd.uses.includes(sl), dim = !!sl && !hot; el('path', { d: curve(cx + 62 * Math.cos(a), cy + 62 * Math.sin(a), x, y), fill: 'none', stroke: hot ? 'var(--accent-2)' : subColOf(rd.module), 'stroke-width': hot ? 2.2 : 1.1, 'stroke-opacity': dim ? 0.12 : 0.65, 'marker-end': hot ? 'url(#arrowHot)' : 'url(#arrow)' }, gE); const mx = cx + (62 + R) / 2 * Math.cos(a), my = cy + (62 + R) / 2 * Math.sin(a); txt(el('text', { x: mx, y: my, 'font-size': 9, fill: hot ? 'var(--accent-2)' : 'var(--ink-dim)', 'text-anchor': 'middle', class: 'mono' }, gE), clip(rd.uses.join(','), 16)); const g = el('g', {}, gN) as SVGGElement; (g as any).style.opacity = dim ? '0.3' : '1'; const w = Math.max(52, rd.module.length * 7 + 14); el('rect', { x: x - w / 2, y: y - 12, width: w, height: 24, rx: 6, fill: 'var(--node-bg)', stroke: subColOf(rd.module), 'stroke-width': hot ? 2 : 1 }, g); txt(el('text', { x, y, 'font-size': 10.5, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, g), rd.module); });
  }
  draw();
  const sd = document.createElement('div'); sd.className = 'side'; sd.innerHTML = '<h3>state slices</h3><div class="k" style="color:var(--ink-dim);margin-bottom:8px;font-size:11px">Click a slice → the modules that read it light up. Changing that field’s shape breaks exactly those.</div>' + slices.map((s2) => { const who = readers.filter((r: any) => r.uses.includes(s2)).map((r: any) => r.module); return `<div class="row2" data-sl="${esc(s2)}"><b class="mono" style="color:var(--accent-2)">${esc(s2)}</b> <span class="tag">${who.length}</span><br><span style="font-size:10.5px;color:var(--ink-dim)">${esc(who.join(', '))}</span></div>`; }).join('');
  stage.appendChild(sd);
  sd.querySelectorAll('[data-sl]').forEach((e2: any) => e2.onclick = () => { sl = sl === e2.dataset.sl ? null : e2.dataset.sl; draw(); sd.querySelectorAll('[data-sl]').forEach((x: any) => x.classList.toggle('on', x.dataset.sl === sl)); });
  hint('The app’s architecture in one picture: <b>no module imports another</b> — they all read one shared <b>state</b>. Each spoke = <span class="em">what slice</span> that module reads.');
}

/* ---- 06 Blast Simulator ---- */
let blastSel = new Set<string>(['state']);
function renderBlast() {
  const ranked = [...MODS].sort((a, b) => mrel(b).blastN - mrel(a).blastN);
  vc.innerHTML = '<span class="legend"><i style="background:var(--danger)"></i>impact ripple · pick module(s) on the left</span>';
  const wrap = document.createElement('div'); wrap.style.cssText = 'position:absolute;inset:0;display:flex';
  const list = document.createElement('div'); list.style.cssText = 'width:250px;border-right:1px solid var(--line);overflow:auto;background:var(--panel);padding:9px';
  list.innerHTML = '<div class="k" style="color:var(--ink-dim);margin-bottom:8px;font-size:11px">Modules ranked by blast radius. Toggle any (multi-select a refactor).</div>'
    + ranked.map((m) => { const r = mrel(m), on = blastSel.has(m), bw = Math.round(r.blastN / (mrel(ranked[0]).blastN || 1) * 90); return `<div class="row2" data-m="${m}" style="border-color:${on ? 'var(--danger)' : 'transparent'};background:${on ? 'color-mix(in srgb,var(--danger) 12%,transparent)' : 'transparent'}"><div style="display:flex;justify-content:space-between"><b>${esc(m)}</b><span class="tag">${r.blastN}</span></div><div style="height:4px;background:var(--danger);opacity:.55;width:${bw}%;border-radius:2px;margin-top:3px"></div><span style="font-size:10px;color:var(--ink-dim)">${esc(r.subsystem)}${r.blastN === 0 ? ' · safe to edit' : ''}</span></div>`; }).join('');
  const canvas = document.createElement('div'); canvas.style.cssText = 'flex:1;position:relative';
  wrap.appendChild(list); wrap.appendChild(canvas); stage.appendChild(wrap);
  list.querySelectorAll('[data-m]').forEach((e2: any) => e2.onclick = () => { const m = e2.dataset.m; if (blastSel.has(m)) blastSel.delete(m); else blastSel.add(m); if (!blastSel.size) blastSel.add(m); render(); });
  drawBlast(canvas);
  hint('<b>Plan a change.</b> Select module(s) → the union of everything transitively impacted ripples outward by hop distance, coloured by subsystem.');
}
function drawBlast(canvas: HTMLElement) {
  const s = svg(); canvas.appendChild(s); const sel = [...blastSel];
  const inAdj: Record<string, string[]> = {}; for (const de of REL.depEdges) (inAdj[de.to] ||= []).push(de.from);
  const hop: Record<string, number> = {}; for (const m of sel) hop[m] = 0; let fr = [...sel], h = 0;
  while (fr.length) { h++; const nx: string[] = []; for (const x of fr) for (const y of (inAdj[x] || [])) if (hop[y] == null) { hop[y] = h; nx.push(y); } fr = nx; }
  const impacted = Object.keys(hop).filter((m) => !blastSel.has(m)), maxHop = Math.max(1, ...Object.values(hop)), cx = 380, cy = VH / 2;
  for (let r = 1; r <= maxHop; r++) { el('circle', { cx, cy, r: r * 120, fill: 'none', stroke: 'var(--line)', 'stroke-dasharray': '3 4' }, s); txt(el('text', { x: cx, y: cy - r * 120 + 13, 'font-size': 10, fill: 'var(--ink-faint)', 'text-anchor': 'middle', class: 'mono' }, s), 'hop ' + r); }
  sel.forEach((m, i) => { const a = -Math.PI / 2 + i / sel.length * Math.PI * 2, x = cx + (sel.length > 1 ? 26 : 0) * Math.cos(a), y = cy + (sel.length > 1 ? 26 : 0) * Math.sin(a); el('circle', { cx: x, cy: y, r: 15, fill: 'var(--ink)', stroke: 'var(--danger)', 'stroke-width': 2 }, s); txt(el('text', { x, y: y - 22, 'font-size': 11, 'text-anchor': 'middle', fill: 'var(--ink)', 'font-weight': 700 }, s), m); });
  const byHop: Record<number, string[]> = {}; impacted.forEach((m) => (byHop[hop[m]] ||= []).push(m));
  for (const hh in byHop) { const arr = byHop[hh]; arr.forEach((m, k) => { const a = -Math.PI / 2 + (k / arr.length) * Math.PI * 2 + (+hh) * 0.3, x = cx + (+hh) * 120 * Math.cos(a), y = cy + (+hh) * 120 * Math.sin(a); el('circle', { cx: x, cy: y, r: 6, fill: subColOf(m) }, s); txt(el('text', { x, y: y - 9, 'font-size': 9, 'text-anchor': 'middle', fill: 'var(--ink)' }, s), m); }); }
  const r = document.createElement('div'); r.className = 'readout'; r.style.right = '16px'; r.style.left = 'auto'; const subs = new Set(impacted.map((m) => mrel(m).subsystem));
  r.innerHTML = `<h4>change ${sel.map(esc).join(' + ')}</h4><div class="big" style="color:var(--danger)">${impacted.length}</div><div class="k" style="color:var(--ink-dim)">modules to retest · ${subs.size} subsystems · ${maxHop} hops deep</div><div style="margin-top:8px">${[...subs].map((sb) => `<span class="chip" style="background:${SUBCOL[sb]};margin:2px 3px 0 0">${esc(clip(sb, 14))}</span>`).join('')}</div>`;
  canvas.appendChild(r);
}

// ---------- boot ----------
(async () => {
  try {
    const text = await fetch('/docs/flowmap/_bundle.mmd').then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
    buildModel(text);
    document.getElementById('src')!.innerHTML = `live <b>_bundle.mmd</b> · <b>${N.length}</b> units · <b>${E.length}</b> edges · <b>${MODS.length}</b> modules · parsed by the repo’s own <b class="mono">fromMermaid()</b>`;
    setTabs(); render();
  } catch (e: any) {
    stage.innerHTML = `<div class="loading">Could not load the live map (${esc(e.message)}).<br>Run the dev server: <b>npm run dev</b>, then open <b>/sandbox/</b>.</div>`;
  }
})();
