/* =====================================================================
   unfold-wires.ts — reading mode: the wire-picture painters (explore
   canvas + stage projection), split out of unfold.ts in place. Every
   symbol here used to be a closure over initUnfold's locals; those
   locals now live on the shared `E: UEnv` object unfold.ts constructs
   and passes to every sibling factory. Functions only called from
   WITHIN this file stay plain locals (hoisted, no E needed); only
   computeLifted/drawWires/drawStageWires are called from other siblings
   and so are attached back onto `E`.
   ===================================================================== */

import type { DiagramNode, Point } from '../../core/types/types';
import { portPos, bestSides } from '../../core/state/state';
import { orthoPath as elbowPath, polyPath } from '../../render/wires';
import { routeGraph } from '../../render/avoidRouter';
import type { AdhocRect, AdhocEdge } from '../../render/avoidRouter';
import { ufLiftWires } from './unfold-lift';
import type { LiftedWire } from './unfold-lift';
import type { UEnv, Box, UEdge } from './unfold';

const NS = 'http://www.w3.org/2000/svg';
const STROKE_ROUND = 'round';
const ATTR_STROKE_WIDTH = 'stroke-width';
const ATTR_STROKE_LINECAP = 'stroke-linecap';
const K_STORE_VAR = '--uf-k-store';

export function initUnfoldWires(E: UEnv): void {
  /** ONE wire geometry, not two: nearest facing ports from core/state (portPos/bestSides)
      and the render/wires elbow path — the one-way reuse the arch sandbox proved. */
  function box(el: HTMLElement): Box {
    const rect = el.getBoundingClientRect(), cr = E.contentEl.getBoundingClientRect(), k = E.viewXform.k;
    return {
      x: (rect.left - cr.left) / k, y: (rect.top - cr.top) / k, w: rect.width / k, h: rect.height / k,
      cx: (rect.left - cr.left) / k + rect.width / k / 2, cy: (rect.top - cr.top) / k + rect.height / k / 2,
    };
  }
  function wirePath(a: Box, b: Box): string {
    const na: DiagramNode = { id: '', label: '', shape: 'rect', color: null, x: a.x, y: a.y, w: a.w, h: a.h };
    const nb: DiagramNode = { id: '', label: '', shape: 'rect', color: null, x: b.x, y: b.y, w: b.w, h: b.h };
    const [sa, sb] = bestSides(na, nb);
    return elbowPath(portPos(na, sa), sa, portPos(nb, sb), sb);
  }
  const cvar = (n: string): string => getComputedStyle(E.overlay).getPropertyValue(n).trim();

  /* ---- obstacle-avoided wire routes (libavoid, shared worker): elbows paint first,
         the routed polylines upgrade them when the reply lands — same doctrine as the
         editor canvas. Keyed by a layout signature so a stale reply is dropped.
         Lifted wires connect SIBLINGS, so each containment scope routes on its own:
         the obstacles are exactly that scope's sibling boxes (cards AND group boxes),
         and a wire bends around a foreign container instead of crossing it. Atomic
         reveals legitimately cross group borders and route against cards only. ---- */
  let ROUTE_SIG = '';
  let routeSeq = 0;
  const ROUTES = new Map<string, Point[]>();
  type RouteScope = { rects: Map<string, AdhocRect>; edges: AdhocEdge[] };
  /** group wires sharing a containment scope (same parent pair, or the atomic
      pseudo-scope) into the per-scope edge lists routeGraph will lay out one
      scope at a time — pulled out of requestRoutes so that loop reads plainly */
  function buildRouteScopes(pos: Record<string, Box>, wires: LiftedWire[]): Map<string, RouteScope> {
    const scopes = new Map<string, RouteScope>();
    for (const w2 of wires) {
      if (!pos[w2.a] || !pos[w2.b]) continue;
      const pa = E.U.get(w2.a)?.parent ?? null, pb = E.U.get(w2.b)?.parent ?? null;
      // ancestor↔descendant wires keep their elbows: no scope contains both fairly
      const sk = w2.atomic ? '~atomic' : pa === pb ? (pa ?? '~root') : null;
      if (sk == null) continue;
      if (!scopes.has(sk)) scopes.set(sk, { rects: new Map(), edges: [] });
      (scopes.get(sk) as RouteScope).edges.push({ id: w2.a + ' ' + w2.b, source: w2.a, target: w2.b });
    }
    return scopes;
  }
  /** every id that belongs in scope `sk`'s obstacle set: every card, for the
      atomic pseudo-scope; every sibling under that parent, otherwise */
  function scopeMemberIds(sk: string, pos: Record<string, Box>): string[] {
    if (sk === '~atomic') {
      const ids: string[] = [];
      E.contentEl.querySelectorAll<HTMLElement>('.uf-card').forEach((el) => { if (el.dataset.id) ids.push(el.dataset.id); });
      return ids;
    }
    const parent = sk === '~root' ? null : sk;
    return Object.keys(pos).filter((id) => (E.U.get(id)?.parent ?? null) === parent);
  }
  /** any edge endpoint the membership pass missed still needs a rect, so its wire has an obstacle to route against */
  function fillScopeEdgeFallback(sc: RouteScope, rectOf: (id: string) => AdhocRect | null): void {
    for (const e2 of sc.edges) {
      for (const id of [e2.source, e2.target]) {
        if (!sc.rects.has(id)) { const rect = rectOf(id); if (rect) sc.rects.set(id, rect); }
      }
    }
  }
  function fillRouteScopeRects(scopes: Map<string, RouteScope>, pos: Record<string, Box>,
    rectOf: (id: string) => AdhocRect | null): void {
    for (const [sk, sc] of scopes) {
      for (const id of scopeMemberIds(sk, pos)) { const rect = rectOf(id); if (rect) sc.rects.set(id, rect); }
      fillScopeEdgeFallback(sc, rectOf);
    }
  }
  function requestRoutes(pos: Record<string, Box>, wires: LiftedWire[]): void {
    const sig = Object.keys(pos).sort().map((id) => {
      const b2 = pos[id];
      return `${id}:${Math.round(b2.x)},${Math.round(b2.y)},${Math.round(b2.w)},${Math.round(b2.h)}`;
    }).join('|') + '||' + wires.map((w2) => (w2.atomic ? 'A' : 'L') + w2.a + '>' + w2.b).sort().join(';');
    if (sig === ROUTE_SIG) return;
    ROUTE_SIG = sig;
    ROUTES.clear();
    if (!wires.length) return;
    const rectOf = (id: string): AdhocRect | null => {
      const b2 = pos[id];
      return b2 ? { id, x: b2.x, y: b2.y, width: b2.w, height: b2.h } : null;
    };
    const scopes = buildRouteScopes(pos, wires);
    fillRouteScopeRects(scopes, pos, rectOf);
    const mySeq = ++routeSeq;
    for (const sc of scopes.values()) {
      void routeGraph([...sc.rects.values()], sc.edges).then((routes) => {
        if (mySeq !== routeSeq || sig !== ROUTE_SIG) return; // layout moved on — drop
        for (const route of routes) ROUTES.set(route.id, route.poly);
        if (routes.length) drawWires();                      // repaint upgrades elbows in place
      });
    }
  }

  /* ---- U2: wires are selectable, informative objects (legacy-editor parity) ---- */

  /** select an aggregated wire by its rendered rep pair; the reducer clears
      node/type focus (mutual exclusion) and a re-click toggles off. Never
      enters stage mode — a wire is information, not travel. */
  function selectWire(a: string, b: string): void {
    E.commit({ type: 'selectWire', a, b });
  }

  /** append an invisible wide hit path over a drawn wire: click selects, hover pre-lights */
  function wireHit(vis: SVGPathElement, d: string, a: string, b: string, host: SVGSVGElement): void {
    const hp = document.createElementNS(NS, 'path') as SVGPathElement;
    hp.setAttribute('d', d);
    hp.setAttribute('class', 'uf-whit');
    hp.onclick = (e) => { e.stopPropagation(); selectWire(a, b); };
    hp.onpointerenter = () => vis.classList.add('uf-whov');
    hp.onpointerleave = () => vis.classList.remove('uf-whov');
    host.appendChild(hp);
  }

  /** the ONE wire-picture decision (pure, acceptance-tested): EDGES + advisory
      flags projected through ufLiftWires. `neutral` recomputes with no selection
      — the aggregate story a click should target regardless of what is revealed. */
  function computeLifted(neutral?: boolean): LiftedWire[] {
    const idx = E.modelIndex();
    return ufLiftWires(
      E.EDGES.map((e) => ({ from: e.from, to: e.to, call: e.call, dep: e.dep, w: e.w, adv: E.ALLOW.has(e.from + '->' + e.to) })),
      {
        parents: idx.parents,
        expanded: [...E.spec.expanded],
        hidden: [...E.spec.hidden],
        sel: neutral ? null : E.spec.sel,
        selWire: neutral ? null : E.spec.selWire,
        layers: { calls: E.spec.layers.calls, deps: E.spec.layers.deps },
      },
    );
  }

  /** mid-path concealed-count badge: the aggregate admits how many real
      endpoints it hides; click selects (= opens) the wire */
  function wireBadge(p: SVGPathElement, it: LiftedWire, hit: { a: string; b: string }, dim: boolean): void {
    let mid: DOMPoint;
    try {
      const len = p.getTotalLength();
      if (!len) return;
      mid = p.getPointAtLength(len / 2);
    } catch { return; }
    const badgeEl = document.createElementNS(NS, 'g');
    badgeEl.setAttribute('class', 'uf-wb' + (it.hot ? ' hot' : '') + (dim ? ' dim' : ''));
    const label = String(it.concealed);
    const bw = 8 + label.length * 6;
    const rectEl = document.createElementNS(NS, 'rect');
    rectEl.setAttribute('x', String(mid.x - bw / 2)); rectEl.setAttribute('y', String(mid.y - 7));
    rectEl.setAttribute('width', String(bw)); rectEl.setAttribute('height', '14'); rectEl.setAttribute('rx', '7');
    const tx = document.createElementNS(NS, 'text');
    tx.setAttribute('x', String(mid.x)); tx.setAttribute('y', String(mid.y));
    tx.setAttribute('text-anchor', 'middle'); tx.setAttribute('dominant-baseline', 'central');
    tx.textContent = label;
    badgeEl.appendChild(rectEl); badgeEl.appendChild(tx);
    badgeEl.onclick = (e) => { e.stopPropagation(); selectWire(hit.a, hit.b); };
    E.wiresEl.appendChild(badgeEl);
  }

  /** ONE arrowhead marker def: direction is drawn only on atomic reveals (a
      lifted aggregate is a two-way conversation — an arrow on it would be a guess) */
  function buildArrowheadDefs(selCol: string): SVGDefsElement {
    const defs = document.createElementNS(NS, 'defs') as SVGDefsElement;
    const mAh = document.createElementNS(NS, 'marker');
    mAh.setAttribute('id', 'ufAhh'); mAh.setAttribute('viewBox', '0 0 8 8');
    mAh.setAttribute('refX', '6.2'); mAh.setAttribute('refY', '4');
    mAh.setAttribute('markerWidth', '6'); mAh.setAttribute('markerHeight', '6');
    mAh.setAttribute('orient', 'auto-start-reverse');
    const mp = document.createElementNS(NS, 'path');
    mp.setAttribute('d', 'M1.4 1.6 L6 4 L1.4 6.4'); mp.setAttribute('fill', 'none');
    mp.setAttribute('stroke', selCol); mp.setAttribute(ATTR_STROKE_WIDTH, '1.8');
    mp.setAttribute(ATTR_STROKE_LINECAP, STROKE_ROUND); mp.setAttribute('stroke-linejoin', STROKE_ROUND);
    mAh.appendChild(mp);
    defs.appendChild(mAh);
    return defs;
  }
  /** the rendered rep pair a click on this lifted wire should select: an atomic
      reveal targets the NEUTRAL aggregate that carries it (re-click toggles off) */
  function hitPairOf(it: LiftedWire, neutral: LiftedWire[]): { a: string; b: string } {
    if (!it.atomic) return { a: it.a, b: it.b };
    const u0 = it.underlying[0];
    const agg = u0 ? neutral.find((n) => n.underlying.some((u2) => u2.from === u0.from && u2.to === u0.to)) : undefined;
    return agg ? { a: agg.a, b: agg.b } : { a: it.a, b: it.b };
  }
  interface WirePaintCtx {
    edgeCol: string; selCol: string; advCol: string; pos: Record<string, Box>;
    outDeg: Map<string, number>; blastOn: boolean; selRep: string | null;
    selActive: boolean; maxw: number; neutral: LiftedWire[];
  }
  /** stroke colour ramp: hot (selection-lit) wins, then advisory, then the plain edge colour */
  function wireStrokeColor(hot: boolean, adv: boolean, wc: WirePaintCtx): string {
    if (hot) return wc.selCol;
    return adv ? wc.advCol : wc.edgeCol;
  }
  /** opacity ramp: selection focus dims everything but the hot/in-blast set;
      otherwise weight alone carries it — advisory wires get an honesty floor */
  function wireOpacity(hot: boolean, inBlast: boolean, adv: boolean, wc: WirePaintCtx, t: number): number {
    const base = wc.selActive ? (hot ? .95 : inBlast ? .55 : .13) : .18 + .55 * t;
    return adv ? Math.max(base, .5) : base;
  }
  /** first-paint entrance: a wire that has never been drawn before (and isn't
      hot/advisory) draws itself in after its cards land, once only */
  function markWireEntrance(p: SVGPathElement, key: string, hot: boolean, adv: boolean): void {
    if (E.wiresEverDrawn.has(key)) return;
    E.wiresEverDrawn.add(key);
    if (hot || adv) return;
    p.setAttribute('pathLength', '1');
    p.classList.add('uf-enter');
    p.style.animationDelay = Math.max(0, E.wireEnterAt - performance.now()) + 'ms';
  }
  function paintWireItem(it: LiftedWire, wc: WirePaintCtx): void {
    const hot = it.hot;
    const adv = E.spec.layers.trust && it.adv;
    const inBlast = wc.blastOn && (E.REP_HOPS.has(it.a) || it.a === wc.selRep) && (E.REP_HOPS.has(it.b) || it.b === wc.selRep);
    const hub = !hot && (wc.outDeg.get(it.a) ?? 0) > 8;
    // weight ramp: the heavy flows carry the story, the light ones recede instead of stacking into noise
    const ramp = Math.pow(it.w / wc.maxw, .6) * (hub ? .35 : 1);
    const width = 1 + ramp * 2.4;
    const pathEl = document.createElementNS(NS, 'path');
    const routed = ROUTES.get(it.a + ' ' + it.b);
    pathEl.setAttribute('d', routed ? polyPath(routed) : wirePath(wc.pos[it.a], wc.pos[it.b]));
    pathEl.setAttribute('fill', 'none');
    pathEl.setAttribute('stroke', wireStrokeColor(hot, adv, wc));
    pathEl.setAttribute(ATTR_STROKE_WIDTH, String(hot ? Math.max(1.6, width) : width));
    pathEl.setAttribute('stroke-opacity', String(wireOpacity(hot, inBlast, adv, wc, ramp)));
    pathEl.setAttribute(ATTR_STROKE_LINECAP, STROKE_ROUND);
    if (adv) pathEl.setAttribute('stroke-dasharray', '4 3');
    if (it.atomic) pathEl.setAttribute('marker-end', 'url(#ufAhh)');
    if (hot) pathEl.classList.add('uf-hot');   // flow animation: the selection's wires visibly carry traffic
    markWireEntrance(pathEl as SVGPathElement, it.a + ' ' + it.b, hot, adv);
    E.wiresEl.appendChild(pathEl);
    const hit = hitPairOf(it, wc.neutral);
    wireHit(pathEl as SVGPathElement, pathEl.getAttribute('d') as string, hit.a, hit.b, E.wiresEl);
    if (it.concealed > 0 && !it.atomic) wireBadge(pathEl as SVGPathElement, it, hit, wc.selActive && !hot);
  }
  function drawWires(): void {
    E.wiresEl.innerHTML = '';
    if (!E.spec.layers.calls && !E.spec.layers.deps) return;
    const { width, height } = E.contentSize();
    E.wiresEl.setAttribute('width', String(width));
    E.wiresEl.setAttribute('height', String(height));
    const edgeCol = cvar('--uf-dim') || '#948f84', selCol = cvar('--uf-accent') || '#4a6b8a';
    const advCol = cvar(K_STORE_VAR) || '#a8824a';
    E.wiresEl.appendChild(buildArrowheadDefs(selCol));
    const pos: Record<string, Box> = {};
    E.contentEl.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => { pos[el.dataset.id as string] = box(el); });
    const lifted = computeLifted().filter((it) => pos[it.a] && pos[it.b]);
    // clicks always target the NEUTRAL aggregate that carries the wire, so a
    // click on any revealed strand selects the aggregate story (re-click toggles off)
    const neutral = E.spec.sel || E.spec.selWire ? computeLifted(true) : lifted;
    const selActive = !!E.spec.sel || !!E.spec.selWire;
    const selRep = E.spec.sel ? E.visibleRep(E.spec.sel) : null;
    const blastOn = E.spec.layers.blast && !!selRep;
    const maxw = Math.max(1, ...lifted.map((x) => x.w));
    const items = [...lifted].sort((x, y) => (x.hot ? 1 : 0) - (y.hot ? 1 : 0)); // hot paints on top
    requestRoutes(pos, items);
    // a hub's fan-out (the composition root, a config read by everyone) is structure, not story:
    // each of its edges says little, so collectively they recede unless the selection asks for them
    const outDeg = new Map<string, number>();
    for (const it of items) outDeg.set(it.a, (outDeg.get(it.a) ?? 0) + 1);
    const wc: WirePaintCtx = { edgeCol, selCol, advCol, pos, outDeg, blastOn, selRep, selActive, maxw, neutral };
    for (const it of items) paintWireItem(it, wc);
  }

  /* ---- stage wires: intra-stage curves between staged cards + curved wires to proxy pills ---- */
  interface StageWireCtx {
    pos: Record<string, DOMRect>; sr: DOMRect; frame: Set<string>;
    wireOn: (e: UEdge) => boolean; mkPath: (d: string, hot: boolean) => SVGPathElement;
    repIn: (id: string) => string | null; sbox: (r: DOMRect) => Box;
  }
  /** curved wires from each staged card to the directional proxy pills outside the frame
      (plus a frame-attributed fallback for pills with no child anchor) — split out of
      drawStageWires so that function reads as intra-stage wires, then proxy wires */
  function drawStageProxyWires(wc: StageWireCtx): void {
    // small local helper: point where the card→pill line crosses the card's own box edge
    const edgeToward = (b: Box, tx: number, ty: number): { x: number; y: number } => {
      const dx = tx - b.cx, dy = ty - b.cy;
      if (!dx && !dy) return { x: b.cx, y: b.cy };
      const s = Math.min(dx ? (b.w / 2) / Math.abs(dx) : Infinity, dy ? (b.h / 2) / Math.abs(dy) : Infinity);
      return { x: b.cx + dx * s, y: b.cy + dy * s };
    };
    E.stageLayer.querySelectorAll<HTMLElement>('.uf-proxy').forEach((px) => {
      const og = px.dataset.gid as string, pr = px.getBoundingClientRect();
      const bx = pr.left - wc.sr.left + pr.width / 2, by = pr.top - wc.sr.top + pr.height / 2;
      const linked = new Set<string>();
      for (const edge of E.EDGES) {
        if (!wc.wireOn(edge)) continue;
        const ra = wc.repIn(edge.from), rb = wc.repIn(edge.to);
        let source: string | null = null;
        if (ra && !rb && E.proxyTargetOf(edge.to, wc.frame) === og) source = ra;
        else if (rb && !ra && E.proxyTargetOf(edge.from, wc.frame) === og) source = rb;
        if (!source || linked.has(source)) continue;
        linked.add(source);
        const pa = edgeToward(wc.sbox(wc.pos[source]), bx, by);
        const mx = (pa.x + bx) / 2, my = (pa.y + by) / 2;
        // U3: non-selected wires stay visible but recede (mkPath dims when selected) — no more vanish-on-deselect flip
        E.sWiresEl.appendChild(wc.mkPath(`M ${pa.x} ${pa.y} Q ${mx} ${pa.y} ${mx} ${my} T ${bx} ${by}`, !!E.spec.sel && source === E.spec.sel));
      }
      // frame-attributed pill with no child anchor: wire from the stage-group frame edge toward the pill
      if (!linked.size && px.dataset.frame) {
        const gEl = E.stageLayer.querySelector('.uf-sgroup');
        if (gEl) {
          const gr = gEl.getBoundingClientRect();
          const ga = { x: gr.left - wc.sr.left + gr.width / 2, y: gr.top - wc.sr.top + gr.height / 2 };
          const fang = Math.atan2(by - ga.y, bx - ga.x);
          const fx = ga.x + Math.cos(fang) * (gr.width / 2), fy = ga.y + Math.sin(fang) * (gr.height / 2);
          const mx = (fx + bx) / 2, my = (fy + by) / 2;
          E.sWiresEl.appendChild(wc.mkPath(`M ${fx} ${fy} Q ${mx} ${fy} ${mx} ${my} T ${bx} ${by}`, false));
        }
      }
    });
  }
  function drawStageWires(): void {
    E.sWiresEl.innerHTML = '';
    if (!E.spec.stage) return;
    if (!E.spec.layers.calls && !E.spec.layers.deps) return;  // U3/U4: stage wires obey the same wire layers as the canvas
    const wireOn = (e: UEdge): boolean => (e.call && E.spec.layers.calls) || (e.dep && E.spec.layers.deps);
    const sw = E.stageEl.clientWidth, sh = E.stageEl.clientHeight;
    E.sWiresEl.setAttribute('viewBox', `0 0 ${sw} ${sh}`);
    const sr = E.stageEl.getBoundingClientRect();
    const pos: Record<string, DOMRect> = {};
    E.stageLayer.querySelectorAll<HTMLElement>('.uf-sgroup .uf-card').forEach((el) => {
      pos[el.dataset.id as string] = el.getBoundingClientRect();
    });
    const edgeCol = cvar('--uf-dim') || '#948f84', selCol = cvar('--uf-accent') || '#4a6b8a';
    // U3: a selection DIMS the other wires instead of erasing them — same grammar as drawWires
    const mkPath = (d: string, hot: boolean): SVGPathElement => {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', hot ? selCol : edgeCol);
      p.setAttribute(ATTR_STROKE_WIDTH, hot ? '1.8' : '1.2');
      p.setAttribute('stroke-opacity', hot ? '.95' : E.spec.sel || E.spec.selWire ? '.16' : '.5');
      p.setAttribute(ATTR_STROKE_LINECAP, STROKE_ROUND);
      if (hot) p.classList.add('uf-hot');
      return p;
    };
    // stage-space Box builder — feeds the same edge-anchored wirePath the canvas wires use,
    // instead of drawing center-to-center through the cards
    const sbox = (r: DOMRect): Box => ({
      x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height,
      cx: r.left - sr.left + r.width / 2, cy: r.top - sr.top + r.height / 2,
    });
    const repIn = (id: string): string | null => { const r = E.stageRepOf(id); return r && pos[r] ? r : null; };
    const seenK = new Set<string>();
    for (const edge of E.EDGES) {
      if (!wireOn(edge)) continue;
      const repA = repIn(edge.from), repB = repIn(edge.to);
      if (!repA || !repB || repA === repB) continue;
      const k = repA + ' ' + repB;
      if (seenK.has(k)) continue;
      seenK.add(k);
      const wsel = !!E.spec.selWire && repA === E.spec.selWire.a && repB === E.spec.selWire.b;
      const hot = wsel || (!!E.spec.sel && (repA === E.spec.sel || repB === E.spec.sel));
      const pathD = wirePath(sbox(pos[repA]), sbox(pos[repB]));
      const vp = mkPath(pathD, hot);
      E.sWiresEl.appendChild(vp);
      wireHit(vp, pathD, repA, repB, E.sWiresEl);   // U2: stage wires are selectable too
    }
    const frame = E.stageFrameIds();
    drawStageProxyWires({ pos, sr, frame, wireOn, mkPath, repIn, sbox });
  }

  E.computeLifted = computeLifted;
  E.drawWires = drawWires;
  E.drawStageWires = drawStageWires;
}
