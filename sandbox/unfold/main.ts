/* =====================================================================
   sandbox/unfold/main.ts — a folded map you open only where you look.
   ---------------------------------------------------------------------
   SANDBOX. Imported by sandbox/unfold/index.html only; exports nothing;
   deleting sandbox/unfold/ is a no-op for the app.

   The .mmd maps are parsed by the app's OWN parser (io/mermaid
   fromMermaid) — the same grammar the editor and the A3 conformance test
   cover, so this surface cannot drift from the app's reading of the
   syntax. The only supplementary scan is `%% src` — a tooling directive
   the app parser ignores by design (CLAUDE.md conventions), lifted here
   with one regex, not a second grammar. hierarchy.json overlays the
   two-region responsibility grouping; everything else is the live maps.
   ===================================================================== */

import { fromMermaid } from '../../src/io/mermaid';
import type { DiagramNode } from '../../src/core/types/types';

type Parsed = ReturnType<typeof fromMermaid>;

/* ===================== small DOM helpers ===================== */
const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
const h = (t: string, c?: string, html?: string): HTMLElement => {
  const e = document.createElement(t);
  if (c) e.className = c;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s: unknown): string =>
  (s == null ? '' : String(s)).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const NS = 'http://www.w3.org/2000/svg';
function keyable(el: HTMLElement, fn?: (e: KeyboardEvent) => void): void {
  el.tabIndex = 0;
  el.setAttribute('role', 'button');
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn ? fn(e) : el.click(); }
  });
}
const stage = $('stage'), world = $('world'), wires = $('wires') as unknown as SVGSVGElement, content = $('content');

/* ===================== hierarchy.json shapes ===================== */
interface HierGroups { [name: string]: HierGroups | string[] }
interface HierRegion { id: string; label: string; note?: string; kind: string; groups?: HierGroups; subsystemOrder?: string[] }
interface Hier { regions: HierRegion[] }

/* ===================== MODEL (unified folded tree) ===================== */
type Region = 'app' | 'tooling';
interface Unit {
  id: string; label: string; kind: string; desc: string;
  accepts: string[]; returns: string[]; state: string[];
  src: string; body: string;
  children: string[]; parent: string | null; region: Region | null;
  depth: number; fanIn: number; symCount: number;
  _par?: string;
}
interface UEdge { from: string; to: string; label: string; w: number; call: boolean; dep: boolean; advisory: boolean }

const U = new Map<string, Unit>();
let ROOTS: string[] = [];
let EDGES: UEdge[] = [];
const OUT: Record<string, UEdge[]> = {}, IN: Record<string, UEdge[]> = {};
let ALLOW = new Set<string>();      // A5 advisory edges, `from->to` (docs/flowmap/edge-advisory-allowlist.txt)

function unit(id: string, o: Partial<Unit>): Unit {
  const u = U.get(id) ?? {
    id, label: id, kind: 'group', desc: '', accepts: [], returns: [], state: [], src: '', body: '',
    children: [], parent: null, region: null, depth: 0, fanIn: 0, symCount: 0,
  };
  Object.assign(u, o);
  U.set(id, u);
  return u;
}
const G = (id: string): Unit => U.get(id) as Unit;
function attach(childId: string, parentId: string): void {
  if (childId === parentId) return;
  const c = U.get(childId), p = U.get(parentId);
  if (!c || !p) return;
  c.parent = parentId;
  if (!p.children.includes(childId)) p.children.push(childId);
}
const moduleOf = (id: string): string => (id.includes('__') ? id.slice(0, id.indexOf('__')) : id);

/** Flatten a parsed node's frontmatter into display fields (returns drops 'void'). */
function fmOf(n: DiagramNode | undefined): { name: string; desc: string; state: string[]; accepts: string[]; returns: string[] } {
  const fm = n?.fm;
  const accepts: string[] = [], returns: string[] = [];
  for (const i of fm?.interfaces ?? []) {
    accepts.push(...i.accepts);
    returns.push(...i.returns.filter((r) => r && r !== 'void'));
  }
  return { name: fm?.name ?? '', desc: fm?.description ?? '', state: fm?.state ?? [], accepts, returns };
}

/** `%% src` is a tooling directive the app parser deliberately ignores — one regex, not a grammar. */
function srcDirectives(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split('\n')) {
    const m = line.trim().match(/^%% src (\S+) (.+)$/);
    if (m) out.set(m[1], m[2].trim());
  }
  return out;
}

function buildModel(
  rootT: string, bundleT: string, rtoolsT: string, toolingT: string,
  hier: Hier, bodies: Record<string, { body?: string }>, allowT: string,
): void {
  const R: Parsed = fromMermaid(rootT);
  const B: Parsed = fromMermaid(bundleT);
  const RT: Parsed = fromMermaid(rtoolsT);
  const T: Parsed = fromMermaid(toolingT);
  const bundleSrc = srcDirectives(bundleT), toolingSrc = srcDirectives(toolingT);

  ALLOW = new Set(
    allowT.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#') && l.includes('->')),
  );

  /* ---- APP side: two-region overlay + responsibility groups from hierarchy.json ---- */
  const appReg = hier.regions.find((r) => r.id === 'region-app') as HierRegion;
  unit('region-app', { label: appReg.label, kind: 'region', region: 'app' });
  (function walkGroups(obj: HierGroups, parentId: string, pathParts: string[]): void {
    for (const name in obj) {
      const val = obj[name], gid = 'g:' + pathParts.concat(name).join('/');
      unit(gid, { label: name, kind: 'group', region: 'app' });
      attach(gid, parentId);
      if (Array.isArray(val)) {
        for (const mid of val) {
          const rn = R.nodes[mid], f = fmOf(rn);
          unit(mid, { label: f.name || (rn ? rn.label : mid), kind: rn?.kind ?? 'module', desc: f.desc, region: 'app' });
          attach(mid, gid);
        }
      } else walkGroups(val, gid, pathParts.concat(name));
    }
  })(appReg.groups as HierGroups, 'region-app', ['region-app']);

  /* ---- APP symbols + intra-module clusters (the bundle's own subgraphs) ---- */
  // clusters first: a bundle subgraph like camera__c_transform ["Viewport transform"] is real
  // architectural grouping from the map — one more unfold level, straight from the source.
  for (const id in B.nodes) {
    const n = B.nodes[id];
    if (n.shape !== 'group' || !id.includes('__') || !U.has(moduleOf(id))) continue;
    unit(id, { label: n.label, kind: 'cluster', region: 'app' });
    attach(id, moduleOf(id));
  }
  const symByMod: Record<string, string[]> = {};
  for (const id in B.nodes) {
    const n = B.nodes[id];
    if (!id.includes('__') || n.shape === 'group') continue;
    const mid = moduleOf(id);
    if (!U.has(mid)) continue;                       // only symbols of curated modules
    const f = fmOf(n);
    unit(id, {
      label: f.name || n.label, kind: n.kind ?? 'function', desc: f.desc,
      accepts: f.accepts, returns: f.returns, state: f.state,
      src: bundleSrc.get(id) ?? '', body: bodies[id]?.body ?? '', region: 'app',
    });
    const par = n.parent && U.has(n.parent) && G(n.parent).kind === 'cluster' && moduleOf(n.parent) === mid ? n.parent : mid;
    attach(id, par);
    (symByMod[mid] = symByMod[mid] ?? []).push(id);
  }

  /* ---- TOOLING side: subsystems from root-tools, members from _tooling subgraphs ---- */
  const toolReg = hier.regions.find((r) => r.id === 'region-tooling') as HierRegion;
  unit('region-tooling', { label: toolReg.label, kind: 'region', region: 'tooling' });
  const isTool = (id: string): boolean => /^flowmap/.test(id);
  for (const sid of toolReg.subsystemOrder ?? []) {
    const rn = RT.nodes[sid] ?? T.nodes[sid], f = fmOf(rn);
    unit(sid, { label: f.name || (rn ? rn.label : sid), kind: 'module', desc: f.desc, region: 'tooling' });
    attach(sid, 'region-tooling');
  }
  for (const id in T.nodes) {
    const n = T.nodes[id];
    if (!isTool(id) || U.has(id)) continue;
    const f = fmOf(n);
    unit(id, {
      label: f.name || n.label,
      kind: n.shape === 'group' ? 'group' : (n.kind ?? 'function'),
      desc: f.desc, accepts: f.accepts, returns: f.returns, state: f.state,
      src: toolingSrc.get(id) ?? '', region: 'tooling',
      _par: n.parent ?? moduleOf(id),
    });
  }
  for (const id in T.nodes) {                        // second pass: parents now all exist
    const u = U.get(id);
    if (u && u._par && U.has(u._par) && !u.parent) { attach(id, u._par); delete u._par; }
  }

  ROOTS = ['region-app', 'region-tooling'];

  /* ---- EDGES: merge all four maps, de-dup, keep only edges between units ---- */
  const raw = [...R.edges, ...B.edges, ...RT.edges, ...T.edges];
  const seen = new Map<string, UEdge>();
  for (const e of raw) {
    if (e.from === e.to || !U.has(e.from) || !U.has(e.to)) continue;
    const k = e.from + ' ' + e.to;
    if (!seen.has(k)) seen.set(k, { from: e.from, to: e.to, label: '', w: 0, call: false, dep: false, advisory: ALLOW.has(e.from + '->' + e.to) });
    const s = seen.get(k) as UEdge;
    s.w++;
    if (e.style === 'dotted') s.dep = true; else s.call = true;
    if (e.label && s.label.length < 40) s.label = [s.label, e.label].filter(Boolean).join(', ');
  }
  EDGES = [...seen.values()];
  for (const id of U.keys()) { OUT[id] = []; IN[id] = []; }
  for (const e of EDGES) { OUT[e.from].push(e); IN[e.to].push(e); }

  /* ---- metrics: depth, fanIn (distinct source units), symbol count ---- */
  for (const rid of ROOTS) {
    (function depth(id: string, d: number): void {
      const u = G(id); u.depth = d; u.children.forEach((c) => depth(c, d + 1));
    })(rid, 0);
  }
  for (const id of U.keys()) {
    const u = G(id);
    u.fanIn = new Set(IN[id].map((e) => e.from)).size;
    u.symCount = (symByMod[id] ?? []).length;
  }
}

const isContainer = (u: Unit | undefined): boolean => !!u && u.children.length > 0;
const REGION_HUE: Record<Region, string> = { app: '--hue-app', tooling: '--hue-tooling' };
const KIND_COL: Record<string, string> = {
  type: '--k-type', function: '--k-function', module: '--k-module', group: '--k-module',
  cluster: '--k-module', store: '--k-store', class: '--k-class',
};
function pathOf(id: string): { region: Region | null; parts: string[] } {
  const p: string[] = [];
  let u: Unit | undefined = U.get(id);
  while (u && u.parent) { u = U.get(u.parent); if (u && u.kind !== 'region') p.unshift(u.label); }
  const r = U.get(id);
  return { region: r ? r.region : null, parts: p };
}

/* ===================== VIEW STATE ===================== */
const expanded = new Set<string>();  // container ids currently unfolded (canvas + tree share this)
const hidden = new Set<string>();    // individually removed from view
let SEL: string | null = null, QUERY = '';
// every reveal is opt-in and starts OFF — the default is stillness
const layers: Record<string, boolean> = {
  calls: false, deps: false, desc: false, iface: false,
  metrics: false, color: false, trust: false, blast: false,
};

function isRendered(id: string): boolean {  // rendered iff every ancestor is expanded and nothing on the chain is hidden
  let u = U.get(id);
  const seen = new Set<string>();          // seen-guard: a malformed map with a parent cycle can't hang the UI
  while (u) {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    if (hidden.has(u.id)) return false;
    if (!u.parent) return true;            // reached a region root (always open)
    if (!expanded.has(u.parent)) return false;
    u = U.get(u.parent);
  }
  return true;
}
function visibleRep(id: string): string | null {  // the shown card standing in for id (itself, or nearest folded ancestor)
  let u = U.get(id);
  const seen = new Set<string>();
  while (u) {
    if (seen.has(u.id)) return null;
    seen.add(u.id);
    if (isRendered(u.id)) return u.id;
    u = u.parent ? U.get(u.parent) : undefined;
  }
  return null;
}
function revealNode(id: string): void {  // ensure a node is on-canvas: open every ancestor, un-hide the chain
  let u = U.get(id);
  const chain: string[] = [], seen = new Set<string>();
  while (u && !seen.has(u.id)) { seen.add(u.id); chain.push(u.id); u = u.parent ? U.get(u.parent) : undefined; }
  chain.forEach((cid) => hidden.delete(cid));
  chain.slice(1).forEach((cid) => expanded.add(cid));  // open all ancestors (not the node itself)
}

/* ---- blast radius (opt-in layer): who transitively depends on the selection ---- */
let BLAST_N = 0;
let REP_HOPS = new Map<string, number>();   // visible card -> min hop distance from the selection
function computeBlast(): void {
  REP_HOPS = new Map(); BLAST_N = 0;
  if (!layers.blast || !SEL) return;
  const hop = new Map<string, number>([[SEL, 0]]);
  const q: string[] = [SEL];
  while (q.length) {
    const x = q.shift() as string;
    for (const e of IN[x] ?? []) {
      if (!hop.has(e.from)) { hop.set(e.from, (hop.get(x) ?? 0) + 1); q.push(e.from); }
    }
  }
  hop.delete(SEL);
  BLAST_N = hop.size;
  const selRep = visibleRep(SEL);
  for (const [id, hp] of hop) {
    const rep = visibleRep(id);
    if (!rep || rep === selRep) continue;
    const cur = REP_HOPS.get(rep);
    if (cur == null || hp < cur) REP_HOPS.set(rep, hp);
  }
}

/* ===================== CAMERA (bounded — you cannot get lost) ===================== */
const Z = { x: 0, y: 0, k: 1 };
function setT(anim?: boolean): void {
  world.classList.toggle('animate', !!anim);
  world.style.transform = `translate(${Z.x}px,${Z.y}px) scale(${Z.k})`;
}
function contentSize(): { w: number; h: number } { return { w: content.scrollWidth || 1, h: content.scrollHeight || 1 }; }
function clampPan(): void {
  const { w, h } = contentSize(), sw = stage.clientWidth, sh = stage.clientHeight, cw = w * Z.k, ch = h * Z.k, m = 120;
  // keep at least `m` px of content within the stage on every side → content can never leave the screen
  Z.x = Math.min(sw - m, Math.max(m - cw, Z.x));
  Z.y = Math.min(sh - m, Math.max(m - ch, Z.y));
}
function fitView(anim?: boolean): void {
  const { w, h } = contentSize(), sw = stage.clientWidth, sh = stage.clientHeight, pad = 72;
  Z.k = Math.max(.15, Math.min(1.15, Math.min((sw - pad * 2) / w, (sh - pad * 2) / h)));
  Z.x = (sw - w * Z.k) / 2;
  Z.y = Math.max(pad, (sh - h * Z.k) / 2);
  setT(anim);
}
stage.addEventListener('wheel', (e) => {
  e.preventDefault();
  const r = stage.getBoundingClientRect(), px = e.clientX - r.left, py = e.clientY - r.top;
  const k2 = Math.max(.15, Math.min(2.5, Z.k * (e.deltaY < 0 ? 1.1 : 0.9)));
  Z.x = px - (px - Z.x) * (k2 / Z.k);
  Z.y = py - (py - Z.y) * (k2 / Z.k);
  Z.k = k2;
  clampPan(); setT(false);
}, { passive: false });
// wires are drawn against the current transform; after an animated fit the transform keeps moving
// for ~420ms, so redraw them once the transition lands (otherwise they sit in a stale frame)
world.addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') drawWires(); });
let pan: { sx: number; sy: number; x: number; y: number } | null = null;
stage.addEventListener('pointerdown', (e) => {
  if ((e.target as HTMLElement).closest('.card,.ghead,.unfold,#dock')) return;
  pan = { sx: e.clientX, sy: e.clientY, x: Z.x, y: Z.y };
  stage.classList.add('grab');
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener('pointermove', (e) => {
  if (!pan) return;
  Z.x = pan.x + (e.clientX - pan.sx);
  Z.y = pan.y + (e.clientY - pan.sy);
  clampPan(); setT(false);
});
stage.addEventListener('pointerup', () => { pan = null; stage.classList.remove('grab'); });
$('zin').onclick = () => { Z.k = Math.min(2.5, Z.k * 1.15); clampPan(); setT(true); };
$('zout').onclick = () => { Z.k = Math.max(.15, Z.k / 1.15); clampPan(); setT(true); };
$('zfit').onclick = () => fitView(true);
let resizeT: ReturnType<typeof setTimeout> | undefined;
window.addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => { fitView(false); drawWires(); }, 140);
});

/* ===================== CANVAS RENDER ===================== */
const orient = (depth: number): string => (depth % 2 === 0 ? 'row' : 'col');  // alternate packing → balanced nesting
function renderCanvas(): void {
  content.innerHTML = '';
  const wrap = h('div');
  wrap.style.cssText = 'display:flex;gap:40px;align-items:flex-start;padding:56px';
  for (const rid of ROOTS) { if (isRendered(rid)) wrap.appendChild(nodeEl(rid)); }
  content.appendChild(wrap);
}
function nodeEl(id: string): HTMLElement {
  const u = G(id);
  const open = expanded.has(id) && isContainer(u);
  return open ? groupEl(u) : cardEl(u);
}
function groupEl(u: Unit): HTMLElement {
  const isRegion = u.kind === 'region';
  const kids = u.children.filter((c) => !hidden.has(c));
  const allLeaf = kids.every((c) => !(expanded.has(c) && isContainer(U.get(c))));
  const cls = 'node grp open ' + (isRegion ? 'region ' : '') + (allLeaf ? 'leaf' : orient(u.depth));
  const g = h('div', cls);
  g.dataset.id = u.id;
  if (u.region) g.style.setProperty('--rc', `var(${REGION_HUE[u.region]})`);
  const head = h('div', 'ghead');
  head.innerHTML = `<span class="tw"><svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg></span>
    <span class="gname">${esc(u.label)}</span>
    <span class="gcount">${descCount(u)}</span>`;
  head.onclick = () => { toggleExpand(u.id); };
  keyable(head);
  g.appendChild(head);
  const body = h('div', 'gbody');
  for (const cid of kids) body.appendChild(nodeEl(cid));
  g.appendChild(body);
  return g;
}
function descCount(u: Unit): string {
  const n = u.children.filter((c) => !hidden.has(c)).length, tot = u.children.length;
  return tot ? `${n}/${tot}` : '';
}
const SYM_KINDS = new Set(['type', 'function', 'class', 'store', 'hook', 'service', 'event', 'component']);
function cardEl(u: Unit): HTMLElement {
  const canUnfold = isContainer(u);
  // regions + groups + clusters unfold on a plain click (the whole card is the target);
  // modules/symbols keep click-to-inspect + ⤢/dblclick to unfold.
  const clickUnfolds = canUnfold && (u.kind === 'region' || u.kind === 'group' || u.kind === 'cluster');
  const sel = SEL === u.id;
  const blastOn = layers.blast && !!SEL;
  const hop = blastOn ? REP_HOPS.get(u.id) : undefined;
  const nbr = !blastOn && SEL ? !sel && isNeighbour(SEL, u.id) : false;
  const dim = blastOn ? (!sel && hop == null) : (SEL ? !sel && !nbr : false);
  const hub = u.region === 'app' && u.kind === 'module' && u.fanIn >= 6;
  const c = h('div', 'card ' + (SYM_KINDS.has(u.kind) ? 'sym ' : '')
    + ((canUnfold && !clickUnfolds) ? 'can-unfold ' : '') + (hub ? 'hub ' : '') + (sel ? 'sel ' : '')
    + (nbr ? 'nbr ' : '') + (hop != null ? 'bh' + Math.min(3, hop) + ' ' : '') + (dim ? 'dim' : ''));
  c.dataset.id = u.id;
  if (layers.color) c.style.setProperty('--kc', `var(${KIND_COL[u.kind] ?? '--k-function'})`);
  const meta = cardMeta(u);
  c.innerHTML = `<div class="crow"><span class="dot"></span><span class="cname">${esc(u.label)}</span></div>
    ${meta ? `<div class="cmeta">${meta}</div>` : ''}
    ${u.desc ? `<div class="cdesc">${esc(u.desc)}</div>` : ''}
    ${ifaceHtml(u)}
    ${hop != null ? `<span class="bhop">${hop}</span>` : ''}
    ${canUnfold && !clickUnfolds ? `<span class="unfold" title="Unfold"><svg viewBox="0 0 16 16"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg></span>` : ''}`;
  c.onclick = (ev) => {
    if ((ev.target as HTMLElement).closest('.unfold')) return;
    if (clickUnfolds) toggleExpand(u.id); else select(u.id);
  };
  if (canUnfold && !clickUnfolds) {
    const uf = c.querySelector('.unfold') as HTMLElement;
    uf.onclick = (ev) => { ev.stopPropagation(); toggleExpand(u.id); };
  }
  c.ondblclick = () => { if (canUnfold) toggleExpand(u.id); };
  keyable(c, () => (clickUnfolds ? toggleExpand(u.id) : select(u.id)));
  return c;
}
function cardMeta(u: Unit): string {
  if (u.kind === 'region') return `${countLeaves(u.id)} modules`;
  if (u.region === 'app' && u.kind === 'module') return `${u.symCount} symbols · fan-in ${u.fanIn}`;
  if (u.kind === 'cluster') return `${u.children.length} symbols`;
  if (u.region === 'tooling' && u.parent === 'region-tooling') return `${countLeafDesc(u.id)} tools`;
  if (u.kind === 'group' && u.region === 'app') return `${countLeaves(u.id)} modules`;
  if (isContainer(u)) return `${countLeafDesc(u.id)} tools`;
  return u.kind;
}
function countLeaves(id: string): number {
  let n = 0;
  (function w(x: string): void { const u = G(x); if (u.kind === 'module') { n++; return; } u.children.forEach(w); })(id);
  return n;
}
function countLeafDesc(id: string): number {
  let n = 0;
  (function w(x: string): void { const u = G(x); if (!u.children.length) { n++; return; } u.children.forEach(w); })(id);
  return n;
}
function ifaceHtml(u: Unit): string {
  if (!SYM_KINDS.has(u.kind)) return '';
  const rows: string[] = [];
  const R = (l: string, a: string[]): void => {
    if (a && a.length) rows.push(`<div class="ilab">${l}</div>` + a.slice(0, 4).map((x) => `<div class="irow">${ifaceLine(x)}</div>`).join(''));
  };
  R('accepts', u.accepts); R('returns', u.returns); R('state', u.state);
  return rows.length ? `<div class="iface">${rows.join('')}</div>` : '';
}
function ifaceLine(raw: string): string {
  const i = raw.indexOf(':');
  if (i < 0) return esc(raw);
  return `<span class="vn">${esc(raw.slice(0, i))}:</span>${esc(raw.slice(i + 1))}`;
}
function isNeighbour(a: string, b: string): boolean {
  const ra = visibleRep(a);
  return EDGES.some((e) =>
    (visibleRep(e.from) === ra && visibleRep(e.to) === b) || (visibleRep(e.to) === ra && visibleRep(e.from) === b));
}

/* ===================== WIRES (orthogonal, aggregated to what's visible) ===================== */
interface Box { x: number; y: number; w: number; h: number; cx: number; cy: number }
function box(el: HTMLElement): Box {
  const r = el.getBoundingClientRect(), cr = content.getBoundingClientRect(), k = Z.k;
  return {
    x: (r.left - cr.left) / k, y: (r.top - cr.top) / k, w: r.width / k, h: r.height / k,
    cx: (r.left - cr.left) / k + r.width / k / 2, cy: (r.top - cr.top) / k + r.height / k / 2,
  };
}
function ortho(a: Box, b: Box, r: number): { p: string } {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  if (Math.abs(dx) >= Math.abs(dy)) {
    const x1 = dx > 0 ? a.x + a.w : a.x, x2 = dx > 0 ? b.x : b.x + b.w, mx = (x1 + x2) / 2, y1 = a.cy, y2 = b.cy;
    return { p: `M${x1} ${y1} L${mx - Math.sign(mx - x1) * r} ${y1} Q${mx} ${y1} ${mx} ${y1 + Math.sign(y2 - y1) * r} L${mx} ${y2 - Math.sign(y2 - y1) * r} Q${mx} ${y2} ${mx + Math.sign(x2 - mx) * r} ${y2} L${x2} ${y2}` };
  }
  const y1 = dy > 0 ? a.y + a.h : a.y, y2 = dy > 0 ? b.y : b.y + b.h, my = (y1 + y2) / 2, x1 = a.cx, x2 = b.cx;
  return { p: `M${x1} ${y1} L${x1} ${my - Math.sign(my - y1) * r} Q${x1} ${my} ${x1 + Math.sign(x2 - x1) * r} ${my} L${x2 - Math.sign(x2 - x1) * r} ${my} Q${x2} ${my} ${x2} ${my + Math.sign(y2 - my) * r} L${x2} ${y2}` };
}
const cvar = (n: string): string =>
  getComputedStyle(document.documentElement).getPropertyValue(n).trim() || getComputedStyle(document.body).getPropertyValue(n).trim();
interface Agg { a: string; b: string; w: number; call: boolean; dep: boolean; adv: boolean }
function drawWires(): void {
  wires.innerHTML = '';
  if (!layers.calls && !layers.deps) return;
  const { w, h: hh } = contentSize();
  wires.setAttribute('width', String(w));
  wires.setAttribute('height', String(hh));
  const edgeCol = cvar('--dim') || '#948f84', selCol = cvar('--accent') || '#4a6b8a', advCol = cvar('--advisory') || '#a8824a';
  const defs = document.createElementNS(NS, 'defs');
  const mk = (id: string, col: string, sw: number): SVGMarkerElement => {
    const m = document.createElementNS(NS, 'marker');
    m.setAttribute('id', id); m.setAttribute('viewBox', '0 0 8 8');
    m.setAttribute('refX', '6.2'); m.setAttribute('refY', '4');
    m.setAttribute('markerWidth', '6'); m.setAttribute('markerHeight', '6');
    m.setAttribute('orient', 'auto-start-reverse');
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', 'M1.4 1.6 L6 4 L1.4 6.4'); p.setAttribute('fill', 'none');
    p.setAttribute('stroke', col); p.setAttribute('stroke-width', String(sw));
    p.setAttribute('stroke-linecap', 'round'); p.setAttribute('stroke-linejoin', 'round');
    m.appendChild(p);
    return m;
  };
  defs.appendChild(mk('ah', edgeCol, 1.4)); defs.appendChild(mk('ahh', selCol, 1.8)); defs.appendChild(mk('aha', advCol, 1.6));
  wires.appendChild(defs);
  // positions of every rendered card / group
  const pos: Record<string, Box> = {};
  content.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => { pos[el.dataset.id as string] = box(el); });
  // aggregate edges to their visible representatives, honouring the per-kind toggles
  const agg = new Map<string, Agg>();
  for (const e of EDGES) {
    if (!((e.call && layers.calls) || (e.dep && layers.deps))) continue;
    const a = visibleRep(e.from), b = visibleRep(e.to);
    if (!a || !b || a === b || !pos[a] || !pos[b]) continue;
    const k = a + ' ' + b;
    if (!agg.has(k)) agg.set(k, { a, b, w: 0, call: false, dep: false, adv: false });
    const s = agg.get(k) as Agg;
    s.w += e.w; s.call = s.call || e.call; s.dep = s.dep || e.dep; s.adv = s.adv || e.advisory;
  }
  const selRep = SEL ? visibleRep(SEL) : null;
  const blastOn = layers.blast && !!selRep;
  const maxw = Math.max(1, ...[...agg.values()].map((x) => x.w));
  // draw cold first, hot last
  const items = [...agg.values()].sort((x, y) => {
    const hx = selRep && (x.a === selRep || x.b === selRep), hy = selRep && (y.a === selRep || y.b === selRep);
    return (hx ? 1 : 0) - (hy ? 1 : 0);
  });
  for (const it of items) {
    const hot = !!selRep && (it.a === selRep || it.b === selRep);
    const inBlast = blastOn && (REP_HOPS.has(it.a) || it.a === selRep) && (REP_HOPS.has(it.b) || it.b === selRep);
    const advisory = layers.trust && it.adv;
    const width = 1 + (it.w / maxw) * 2.2;
    const op = selRep ? (hot ? .95 : inBlast ? .55 : .13) : .62;
    const o = ortho(pos[it.a], pos[it.b], 7);
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', o.p);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', hot ? selCol : advisory ? advCol : edgeCol);
    p.setAttribute('stroke-width', String(hot ? Math.max(1.6, width) : width));
    p.setAttribute('stroke-opacity', String(advisory ? Math.max(op, .5) : op));
    p.setAttribute('stroke-linecap', 'round');
    if (advisory || (it.dep && !it.call)) p.setAttribute('stroke-dasharray', advisory ? '4 3' : '6 4');
    p.setAttribute('marker-end', hot ? 'url(#ahh)' : advisory ? 'url(#aha)' : 'url(#ah)');
    wires.appendChild(p);
  }
}

/* ===================== ORCHESTRATION ===================== */
let _first = true;
function render(refit: boolean): void {
  computeBlast();
  renderCanvas();
  renderTree();
  renderInspector();
  updateHint();
  $('revCount').textContent = [...U.keys()].filter((id) => isRendered(id) && G(id).kind !== 'region').length + ' shown';
  // layout is synchronous after the DOM swap; rAF can be throttled to a standstill in an
  // occluded window, so schedule with plain timers and redraw again after the fit animation
  setTimeout(() => {
    if (refit) fitView(!_first);
    _first = false;
    drawWires();
    setTimeout(drawWires, refit ? 480 : 80);
  }, 0);
}
function toggleExpand(id: string): void {
  const u = U.get(id);
  if (!isContainer(u)) return;
  if (expanded.has(id)) collapse(id); else expanded.add(id);
  render(true);
}
function collapse(id: string): void {  // folding a node also folds its descendants so re-opening starts clean & calm
  expanded.delete(id);
  (function w(x: string): void { G(x).children.forEach((c) => { expanded.delete(c); w(c); }); })(id);
}
function select(id: string): void { SEL = SEL === id ? null : id; render(false); }
function foldAll(): void {
  expanded.clear(); hidden.clear(); SEL = null; QUERY = '';
  ($('search') as HTMLInputElement).value = '';
  render(true);
}

/* ===================== BROWSE TREE (panel mirror of the same state) ===================== */
function renderTree(): void {
  const t = $('tree');
  t.innerHTML = '';
  for (const rid of ROOTS) t.appendChild(treeRow(rid));
  if (QUERY) openMatches();
}
function treeRow(id: string): HTMLElement {
  const u = G(id), wrap = h('div');
  const canOpen = isContainer(u), on = isRendered(id) && !hidden.has(id), open = expanded.has(id);
  const row = h('div', 'trow ' + (canOpen ? '' : 'leaf ') + (on ? 'on ' : '') + (open ? 'open ' : '') + (SEL === id ? 'sel' : ''));
  row.dataset.id = id;
  if (layers.color) row.style.setProperty('--kc', `var(${KIND_COL[u.kind] ?? '--k-function'})`);
  row.innerHTML = `<span class="ttw">${canOpen ? '<svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg>' : ''}</span>
    <span class="tdot"></span>
    <span class="tlabel">${esc(u.label)}</span>
    <span class="tchk" title="Show / hide on canvas"></span>`;
  (row.querySelector('.ttw') as HTMLElement).onclick = (e) => {
    e.stopPropagation();
    if (canOpen) { revealNode(id); if (expanded.has(id)) collapse(id); else expanded.add(id); render(true); }
  };
  (row.querySelector('.tchk') as HTMLElement).onclick = (e) => { e.stopPropagation(); toggleReveal(id); };
  (row.querySelector('.tlabel') as HTMLElement).onclick = (e) => { e.stopPropagation(); revealNode(id); SEL = id; render(true); };
  wrap.appendChild(row);
  if (canOpen) {
    const kidsBox = h('div', 'tchildren' + (open ? ' open' : ''));
    for (const c of u.children) kidsBox.appendChild(treeRow(c));
    wrap.appendChild(kidsBox);
  }
  return wrap;
}
function toggleReveal(id: string): void {
  if (isRendered(id) && !hidden.has(id)) {
    // never let the canvas go fully empty — keep at least one top-level region on screen
    if (ROOTS.includes(id) && ROOTS.filter((r) => !hidden.has(r)).length <= 1) return;
    hidden.add(id);
    if (SEL === id) SEL = null;
  } else revealNode(id);
  render(true);
}
function openMatches(): void {  // when searching, auto-open tree branches that contain a match (panel only)
  const q = QUERY;
  const hits = new Set<string>();
  for (const id of U.keys()) {
    const u = G(id);
    if ((u.label || '').toLowerCase().includes(q) || (u.desc || '').toLowerCase().includes(q)) {
      let x: Unit | undefined = U.get(id);
      while (x) { hits.add(x.id); x = x.parent ? U.get(x.parent) : undefined; }
    }
  }
  $('tree').querySelectorAll<HTMLElement>('.trow').forEach((r) => {
    const id = r.dataset.id as string;
    const kb = r.parentElement?.querySelector(':scope > .tchildren') as HTMLElement | null;
    if (kb) { const show = hits.has(id); kb.classList.toggle('open', show); r.classList.toggle('open', show); }
    r.style.display = hits.size ? (hits.has(id) ? '' : 'none') : '';
  });
}

/* ===================== INSPECTOR (empty until something is selected) ===================== */
function renderInspector(): void {
  const el = $('insp');
  if (!SEL) { el.innerHTML = ''; return; }
  const u = U.get(SEL);
  if (!u) { el.innerHTML = ''; return; }
  const p = pathOf(u.id);
  const isSym = SYM_KINDS.has(u.kind);
  const canUnfold = isContainer(u);
  const tier = (t: string, adv?: boolean): string => `<span class="tier${adv ? ' adv' : ''}">${t}</span>`;
  let html = `<div class="ihead">
    <span class="ikind"${layers.color ? ` style="--kc:var(${KIND_COL[u.kind] ?? '--k-function'})"` : ''}>${esc(u.kind)}</span>
    <div class="iname${isSym ? ' mono' : ''}">${esc(u.label)}</div>
    ${u.src ? `<div class="ipath">${esc(u.src)}</div>` : ''}
    <div class="ipath">${esc([p.region === 'app' ? 'src/' : p.region === 'tooling' ? 'tools/' : '', ...p.parts].filter(Boolean).join('  ›  '))}</div>
    ${u.desc ? `<div class="idesc">${esc(u.desc)}</div>` : ''}
    ${(canUnfold || isSym) ? `<div class="iact">
      ${canUnfold ? `<button class="ibtn pri" id="iUnfold">${expanded.has(u.id) ? 'fold' : 'unfold'}</button>` : ''}
      ${isRendered(u.id) ? `<button class="ibtn" id="iHide">remove from view</button>` : `<button class="ibtn" id="iShow">add to view</button>`}
    </div>` : ''}
  </div>`;

  // interface (for symbols) — signatures are gate-verified claims (flowmap:trust)
  const ifaceBlock = (l: string, a: string[]): string =>
    a && a.length
      ? `<div style="padding:12px 18px;border-top:1px solid var(--line)"><div class="ilab">${l}${tier('verified')}</div>${a.map((x) => `<div class="iline">${ifaceLine(x)}</div>`).join('')}</div>`
      : '';
  html += ifaceBlock('accepts', u.accepts) + ifaceBlock('returns', u.returns) + ifaceBlock('state', u.state);

  // blast radius (when the layer is on): transitive dependents over the real edge set
  if (layers.blast) {
    html += `<div style="padding:12px 18px;border-top:1px solid var(--line)"><div class="ilab">blast radius</div>
      <div class="iline">${BLAST_N} transitive dependent${BLAST_N === 1 ? '' : 's'}</div></div>`;
  }

  // connections — code-backed unless listed in the A5 advisory allowlist
  const outs = dedupeConns(OUT[u.id] ?? [], 'to'), ins = dedupeConns(IN[u.id] ?? [], 'from');
  if (outs.length) html += connBlock('uses →', outs, u.id, true);
  if (ins.length) html += connBlock('← used by', ins, u.id, false);

  // body (app symbols): the real source, verbatim from public/bodies.json
  if (isSym && u.body) {
    html += `<div style="padding:12px 18px;border-top:1px solid var(--line)"><div class="ilab">source${tier('verbatim')}</div><div class="body-src"><pre>${esc(u.body)}</pre></div></div>`;
  }

  el.innerHTML = html;
  const un = document.getElementById('iUnfold');
  if (un) un.onclick = () => toggleExpand(u.id);
  const hd = document.getElementById('iHide');
  if (hd) hd.onclick = () => { hidden.add(u.id); SEL = null; render(true); };
  const sh = document.getElementById('iShow');
  if (sh) sh.onclick = () => { revealNode(u.id); render(true); };
  el.querySelectorAll<HTMLElement>('[data-goto]').forEach((r) => {
    r.onclick = () => { const id = r.dataset.goto as string; revealNode(id); SEL = id; render(true); };
  });
}
interface Conn { id: string; labels: Set<string> }
function dedupeConns(arr: UEdge[], key: 'from' | 'to'): Conn[] {
  const m = new Map<string, Conn>();
  for (const e of arr) {
    const id = e[key];
    if (!m.has(id)) m.set(id, { id, labels: new Set() });
    if (e.label) e.label.split(',').forEach((s) => { s = s.trim(); if (s) (m.get(id) as Conn).labels.add(s); });
  }
  return [...m.values()];
}
function connBlock(title: string, arr: Conn[], selfId: string, outgoing: boolean): string {
  const anyAdv = arr.some((c) => ALLOW.has(outgoing ? `${selfId}->${c.id}` : `${c.id}->${selfId}`));
  const tierChip = layers.trust || !anyAdv ? `<span class="tier">code-backed</span>` : '';
  return `<div style="padding:12px 18px;border-top:1px solid var(--line)"><div class="ilab">${title} (${arr.length})${tierChip}</div>`
    + arr.map((c) => {
      const u = U.get(c.id);
      const adv = ALLOW.has(outgoing ? `${selfId}->${c.id}` : `${c.id}->${selfId}`);
      const ll = [...c.labels].slice(0, 2).join(', ');
      return `<div class="conn${adv ? ' adv' : ''}" data-goto="${esc(c.id)}"><span class="arw">${outgoing ? '→' : '←'}</span><span class="cn">${esc(u ? u.label : c.id)}</span><span class="cl">${adv ? 'advisory' : esc(ll)}</span></div>`;
    }).join('') + `</div>`;
}

/* ===================== LAYERS PANEL — the vocabulary of opt-in reveals ===================== */
const LAYER_DEFS: Array<{ k: string; t: string; d: string }> = [
  { k: 'calls',   t: 'calls',         d: 'solid call wires' },
  { k: 'deps',    t: 'dependencies',  d: 'dotted dependency wires' },
  { k: 'desc',    t: 'descriptions',  d: 'one-line role under each name' },
  { k: 'iface',   t: 'interfaces',    d: 'accepts / returns on symbols' },
  { k: 'metrics', t: 'metrics',       d: 'symbol counts · fan-in · hubs' },
  { k: 'color',   t: 'colour',        d: 'tint by region and kind' },
  { k: 'trust',   t: 'trust',         d: 'mark advisory claims and edges' },
  { k: 'blast',   t: 'blast radius',  d: 'ripple what depends on the selection' },
];
function renderLayers(): void {
  const boxEl = $('layers');
  boxEl.innerHTML = '';
  for (const L of LAYER_DEFS) {
    const row = h('div', 'layer' + (layers[L.k] ? ' on' : ''));
    row.innerHTML = `<span class="sw"></span><span class="lx"><div class="lt">${L.t}</div><div class="ld">${L.d}</div></span>`;
    row.onclick = () => { layers[L.k] = !layers[L.k]; applyLayerClasses(); renderLayers(); render(false); };
    keyable(row);
    boxEl.appendChild(row);
  }
}
function applyLayerClasses(): void {
  document.body.classList.toggle('desc', layers.desc);
  document.body.classList.toggle('iface', layers.iface);
  document.body.classList.toggle('metrics', layers.metrics);
  document.body.classList.toggle('color', layers.color);
  document.body.classList.toggle('trust', layers.trust);
}

/* ===================== HINT (a count, never narration) ===================== */
function updateHint(): void {
  const shown = [...U.keys()].filter((id) => isRendered(id) && G(id).kind !== 'region').length;
  const total = [...U.keys()].filter((id) => G(id).kind !== 'region').length;
  const pct = Math.round((1 - shown / total) * 100);
  $('hint').innerHTML = shown === 0 ? '' : `<b>${pct}%</b> still folded · ${shown} of ${total} shown`;
}

/* ===================== DOCK ===================== */
$('foldAll').onclick = foldAll;
function applyTheme(dark: boolean): void {
  document.body.classList.toggle('dark', dark);
  $('themeIcon').innerHTML = dark
    ? '<circle cx="8" cy="8" r="3.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4"/>'
    : '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5Z"/>';
  localStorage.setItem('unfold.theme', dark ? 'dark' : 'light');
  drawWires();
}
$('theme').onclick = () => applyTheme(!document.body.classList.contains('dark'));
($('search') as HTMLInputElement).oninput = (e) => {
  QUERY = (e.target as HTMLInputElement).value.trim().toLowerCase();
  renderTree();
};
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (SEL) { SEL = null; render(false); }
    else if (QUERY) { QUERY = ''; ($('search') as HTMLInputElement).value = ''; renderTree(); }
  }
});

/* ===================== BOOT ===================== */
async function loadText(cands: string[]): Promise<string> {
  let last = '';
  for (const u of cands) {
    try {
      const r = await fetch(u);
      if (r.ok) return await r.text();
      last = 'HTTP ' + r.status + ' ' + u;
    } catch (err) { last = (err as Error).message + ' ' + u; }
  }
  throw new Error(last);
}
async function loadJSON<T>(cands: string[]): Promise<T> { return JSON.parse(await loadText(cands)) as T; }
(async function boot(): Promise<void> {
  try {
    applyTheme(localStorage.getItem('unfold.theme') === 'dark');
    const [rootT, bundleT, rtoolsT, toolingT, hier, bodies, allowT] = await Promise.all([
      loadText(['/docs/flowmap/root.mmd', '../../docs/flowmap/root.mmd']),
      loadText(['/docs/flowmap/_bundle.mmd', '../../docs/flowmap/_bundle.mmd']),
      loadText(['/docs/flowmap/root-tools.mmd', '../../docs/flowmap/root-tools.mmd']),
      loadText(['/docs/flowmap/_tooling.mmd', '../../docs/flowmap/_tooling.mmd']),
      loadJSON<Hier>(['./hierarchy.json', 'hierarchy.json']),
      loadJSON<Record<string, { body?: string }>>(['/public/bodies.json', '/bodies.json', '../../public/bodies.json']).catch(() => ({})),
      loadText(['/docs/flowmap/edge-advisory-allowlist.txt', '../../docs/flowmap/edge-advisory-allowlist.txt']).catch(() => ''),
    ]);
    buildModel(rootT, bundleT, rtoolsT, toolingT, hier, bodies, allowT);
    applyLayerClasses();
    renderLayers();
    render(true);
    console.log('[unfold]', { units: U.size, edges: EDGES.length, advisory: ALLOW.size, roots: ROOTS });
  } catch (err) {
    content.innerHTML = '<div class="booting">Could not load the live maps: ' + esc((err as Error).message)
      + '<br>Serve on the dev server (…/sandbox/unfold/), not file://.</div>';
    console.error(err);
  }
})();
