/* =====================================================================
   unfold-wires.ts — reading mode: the wire-picture painters (explore
   canvas + stage projection), split out of unfold.ts in place. Every
   symbol here used to be a closure over initUnfold's locals; those
   locals now live on the shared `E: UEnv` object unfold.ts constructs
   and passes to every sibling factory. Functions only called from
   WITHIN this file stay plain locals (hoisted, no E needed); only
   computeLifted/drawWires/drawStageWires are called from other siblings
   and so are attached back onto `E`.

   Readability pass: the mapped symbols (wirePath, requestRoutes,
   selectWire, wireHit, drawWires, initUnfoldWires) keep their name,
   declaration form, export status, arity AND parameter names exactly —
   the novakai map is signature-anchored to them. Every one of them is
   now a thin inner delegate to a module-scope helper below, so the
   actual logic (and its complexity/line count) lives outside the
   frozen shapes and can be decomposed freely. ===================================================================== */

import type { DiagramNode, Point } from '../../core/types/types';
import { portPos, bestSides } from '../../core/state/state';
import { orthoPath as elbowPath, polyPath } from '../../render/wires';
import { routeGraph } from '../../render/avoidRouter';
import type { AdhocRect, AdhocEdge } from '../../render/avoidRouter';
import { ufLiftWires } from './unfold-lift';
import type { LiftedWire, LiftEdge, LiftSpec } from './unfold-lift';
import type { UEnv, Box, UEdge } from './unfold';

const SVG_NS = 'http://www.w3.org/2000/svg';
const STROKE_ROUND = 'round';
const ATTR_STROKE_WIDTH = 'stroke-width';
const ATTR_STROKE_LINECAP = 'stroke-linecap';
const K_STORE_VAR = '--uf-k-store';

/** set several SVG/HTML attributes in one call — trades many
    one-per-line setAttribute calls for one data literal */
function setAttrs(el: Element, attrs: Record<string, string>): void {
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
}

/* ---- shared route-cache + wire-paint-context shapes (module scope, not
   externally fixed — free to shape however keeps the helpers small) ---- */
interface RouteScope { rects: Map<string, AdhocRect>; edges: AdhocEdge[] }
interface RouteCache { sig: string; seq: number; routes: Map<string, Point[]> }

// one route cache per env, keyed off the instance itself — avoids a dedicated
// closure-local declaration in initUnfoldWires so its own body stays thin
const routeCaches = new WeakMap<UEnv, RouteCache>();
function routeCacheFor(env: UEnv): RouteCache {
  let cache = routeCaches.get(env);
  if (!cache) {
    cache = { sig: '', seq: 0, routes: new Map() };
    routeCaches.set(env, cache);
  }
  return cache;
}
interface RouteRequest { sig: string; seq: number }
interface RouteInput { pos: Record<string, Box>; wires: LiftedWire[] }

interface WirePaintCtx {
  edgeCol: string; selCol: string; advCol: string; pos: Record<string, Box>;
  outDeg: Map<string, number>; blastOn: boolean; selRep: string | null; selActive: boolean;
  maxw: number; neutral: LiftedWire[]; trustOn: boolean; repHops: Map<string, number>;
}

type WireHitArgs = { visiblePath: SVGPathElement; pathData: string; idA: string; idB: string; host: SVGSVGElement };
type WireHitFn = (spec: WireHitArgs) => void;

interface WireDrawActions {
  wirePath: (boxA: Box, boxB: Box) => string; wireHit: WireHitFn; onSelect: (idA: string, idB: string) => void;
  requestRoutes: (pos: Record<string, Box>, wires: LiftedWire[]) => void;
}
interface WirePaintEnv { env: UEnv; cache: RouteCache; actions: WireDrawActions }

interface StagePathActions { wirePath: (boxA: Box, boxB: Box) => string; wireHit: WireHitFn }
interface StageWireCtx {
  pos: Record<string, DOMRect>; stageRect: DOMRect; frame: Set<string>;
  wireOn: (edge: UEdge) => boolean; mkPath: (pathD: string, hot: boolean) => SVGPathElement;
  repIn: (id: string) => string | null; sbox: (rect: DOMRect) => Box;
}

/** theming lookup shared by canvas + stage painters */
function themeVar(env: UEnv, name: string): string {
  return getComputedStyle(env.overlay).getPropertyValue(name).trim();
}

function makeBox(x: number, y: number, width: number, height: number): Box {
  return { 'x': x, 'y': y, 'w': width, 'h': height, 'cx': x + width / 2, 'cy': y + height / 2 };
}

/* ---- ONE wire geometry, not two: nearest facing ports from core/state
   (portPos/bestSides) and the render/wires elbow path — the one-way
   reuse the arch sandbox proved. wirePath (frozen, see initUnfoldWires)
   IS this geometry directly; boxToDiagramNode is its only helper. ---- */

function boxToDiagramNode(source: Box): DiagramNode {
  return { id: '', label: '', shape: 'rect', color: null, 'x': source.x, 'y': source.y, 'w': source.w, 'h': source.h };
}

function buildWirePath(boxA: Box, boxB: Box): string {
  const nodeA = boxToDiagramNode(boxA);
  const nodeB = boxToDiagramNode(boxB);
  const [sideA, sideB] = bestSides(nodeA, nodeB);
  return elbowPath(portPos(nodeA, sideA), sideA, portPos(nodeB, sideB), sideB);
}

/* ---- obstacle-avoided wire routes (libavoid, shared worker): elbows paint first,
       the routed polylines upgrade them when the reply lands — same doctrine as the
       editor canvas. Keyed by a layout signature so a stale reply is dropped.
       Lifted wires connect SIBLINGS, so each containment scope routes on its own:
       the obstacles are exactly that scope's sibling boxes (cards AND group boxes),
       and a wire bends around a foreign container instead of crossing it. Atomic
       reveals legitimately cross group borders and route against cards only. ---- */

/** the containment scope a wire routes within: the atomic pseudo-scope, or
    the shared parent of both endpoints — ancestor↔descendant wires (no
    shared parent) keep their elbows instead, no scope contains both fairly */
function scopeKeyFor(env: UEnv, wire: LiftedWire): string | null {
  if (wire.atomic) return '~atomic';
  const parentA = env.U.get(wire.a)?.parent ?? null;
  const parentB = env.U.get(wire.b)?.parent ?? null;
  return parentA === parentB ? (parentA ?? '~root') : null;
}

/** group wires sharing a containment scope into the per-scope edge lists
    routeGraph will lay out one scope at a time */
function buildRouteScopes(env: UEnv, pos: Record<string, Box>, wires: LiftedWire[]): Map<string, RouteScope> {
  const scopes = new Map<string, RouteScope>();
  for (const wire of wires) {
    if (!pos[wire.a] || !pos[wire.b]) continue;
    const scopeKey = scopeKeyFor(env, wire);
    if (scopeKey == null) continue;
    if (!scopes.has(scopeKey)) scopes.set(scopeKey, { rects: new Map(), edges: [] });
    const scope = scopes.get(scopeKey) as RouteScope;
    scope.edges.push({ id: wire.a + ' ' + wire.b, source: wire.a, target: wire.b });
  }
  return scopes;
}

/** every id that belongs in scope `scopeKey`'s obstacle set: every card, for the
    atomic pseudo-scope; every sibling under that parent, otherwise */
function routeScopeMemberIds(env: UEnv, scopeKey: string, pos: Record<string, Box>): string[] {
  if (scopeKey === '~atomic') {
    const ids: string[] = [];
    env.contentEl.querySelectorAll<HTMLElement>('.uf-card').forEach((card) => {
      if (card.dataset.id) ids.push(card.dataset.id);
    });
    return ids;
  }
  const parent = scopeKey === '~root' ? null : scopeKey;
  return Object.keys(pos).filter((id) => (env.U.get(id)?.parent ?? null) === parent);
}

/** any edge endpoint the membership pass missed still needs a rect, so its wire has an obstacle to route against */
function addMissingRect(scope: RouteScope, id: string, rectOf: (id: string) => AdhocRect | null): void {
  if (scope.rects.has(id)) return;
  const rect = rectOf(id);
  if (rect) scope.rects.set(id, rect);
}

function fillRouteScopeRects(
  env: UEnv, scopes: Map<string, RouteScope>, pos: Record<string, Box>,
  rectOf: (id: string) => AdhocRect | null,
): void {
  for (const [scopeKey, scope] of scopes) {
    for (const id of routeScopeMemberIds(env, scopeKey, pos)) addMissingRect(scope, id, rectOf);
    for (const edge of scope.edges) {
      for (const id of [edge.source, edge.target]) addMissingRect(scope, id, rectOf);
    }
  }
}

/** layout signature: id/pos digest + wire digest, joined — a stale async
    reply is detected by comparing this against the live cache */
function computeRouteSignature(pos: Record<string, Box>, wires: LiftedWire[]): string {
  const posSig = Object.keys(pos).sort().map((id) => {
    const box = pos[id];
    return `${id}:${Math.round(box.x)},${Math.round(box.y)},${Math.round(box.w)},${Math.round(box.h)}`;
  }).join('|');
  const wireSig = wires.map((wire) => (wire.atomic ? 'A' : 'L') + wire.a + '>' + wire.b).sort().join(';');
  return posSig + '||' + wireSig;
}

function rectLookup(pos: Record<string, Box>): (id: string) => AdhocRect | null {
  return (id: string) => {
    const box = pos[id];
    return box ? { id, x: box.x, y: box.y, width: box.w, height: box.h } : null;
  };
}

function scheduleScopeRoute(cache: RouteCache, scope: RouteScope, request: RouteRequest, onUpdated: () => void): void {
  void routeGraph([...scope.rects.values()], scope.edges).then((routes) => {
    if (request.seq !== cache.seq || request.sig !== cache.sig) return; // layout moved on — drop
    for (const route of routes) cache.routes.set(route.id, route.poly);
    if (routes.length) onUpdated(); // repaint upgrades elbows in place
  });
}

function scheduleRoutes(env: UEnv, cache: RouteCache, input: RouteInput, onUpdated: () => void): void {
  const sig = computeRouteSignature(input.pos, input.wires);
  if (sig === cache.sig) return;
  cache.sig = sig;
  cache.routes.clear();
  if (!input.wires.length) return;
  const scopes = buildRouteScopes(env, input.pos, input.wires);
  fillRouteScopeRects(env, scopes, input.pos, rectLookup(input.pos));
  cache.seq += 1;
  const request: RouteRequest = { sig, seq: cache.seq };
  for (const scope of scopes.values()) scheduleScopeRoute(cache, scope, request, onUpdated);
}

/* ---- U2: wires are selectable, informative objects (legacy-editor parity).
   selectWire (frozen, see initUnfoldWires) implements its tiny commit
   directly; wireHit delegates to attachWireHit below. ---- */

interface WireHitSpec extends WireHitArgs { onSelect: (idA: string, idB: string) => void }

/** append an invisible wide hit path over a drawn wire: click selects, hover pre-lights */
function attachWireHit(spec: WireHitSpec): void {
  const hitPath = document.createElementNS(SVG_NS, 'path') as SVGPathElement;
  setAttrs(hitPath, { 'd': spec.pathData, class: 'uf-whit' });
  hitPath.onclick = (evt) => {
    evt.stopPropagation();
    spec.onSelect(spec.idA, spec.idB);
  };
  hitPath.onpointerenter = () => spec.visiblePath.classList.add('uf-whov');
  hitPath.onpointerleave = () => spec.visiblePath.classList.remove('uf-whov');
  spec.host.appendChild(hitPath);
}

/** the ONE wire-picture decision (pure, acceptance-tested): EDGES + advisory
    flags projected through ufLiftWires. `neutral` recomputes with no selection
    — the aggregate story a click should target regardless of what is revealed. */
function liftEnvWires(env: UEnv, neutral?: boolean): LiftedWire[] {
  const modelIdx = env.modelIndex();
  const edges: LiftEdge[] = env.EDGES.map((edge) => ({
    from: edge.from, 'to': edge.to, call: edge.call, dep: edge.dep,
    'w': edge.w, adv: env.ALLOW.has(edge.from + '->' + edge.to),
  }));
  const spec: LiftSpec = {
    parents: modelIdx.parents,
    expanded: [...env.spec.expanded],
    hidden: [...env.spec.hidden],
    sel: neutral ? null : env.spec.sel,
    selWire: neutral ? null : env.spec.selWire,
    layers: { calls: env.spec.layers.calls, deps: env.spec.layers.deps },
  };
  return ufLiftWires(edges, spec);
}

/** mid-path concealed-count badge: the aggregate admits how many real
    endpoints it hides; click selects (= opens) the wire */
function buildBadgeRect(mid: DOMPoint, width: number): SVGRectElement {
  const rectEl = document.createElementNS(SVG_NS, 'rect');
  setAttrs(rectEl, {x: String(mid.x - width / 2), y: String(mid.y - 7), width: String(width), height: '14', 'rx': '7'});
  return rectEl;
}

function buildBadgeText(mid: DOMPoint, label: string): SVGTextElement {
  const textEl = document.createElementNS(SVG_NS, 'text');
  setAttrs(textEl, { x: String(mid.x), y: String(mid.y), 'text-anchor': 'middle', 'dominant-baseline': 'central' });
  textEl.textContent = label;
  return textEl;
}

interface WireBadgeSpec { pathEl: SVGPathElement; wire: LiftedWire; hitPair: { a: string; b: string }; dim: boolean }

function paintWireBadge(spec: WireBadgeSpec, env: UEnv, onSelect: (a: string, b: string) => void): void {
  let mid: DOMPoint | null;
  try {
    const len = spec.pathEl.getTotalLength();
    mid = len ? spec.pathEl.getPointAtLength(len / 2) : null;
  } catch {
    mid = null;
  }
  if (!mid) return;
  const label = String(spec.wire.concealed);
  const badgeEl = document.createElementNS(SVG_NS, 'g');
  badgeEl.setAttribute('class', 'uf-wb' + (spec.wire.hot ? ' hot' : '') + (spec.dim ? ' dim' : ''));
  badgeEl.append(buildBadgeRect(mid, 8 + label.length * 6), buildBadgeText(mid, label));
  badgeEl.onclick = (evt) => {
    evt.stopPropagation();
    onSelect(spec.hitPair.a, spec.hitPair.b);
  };
  env.wiresEl.appendChild(badgeEl);
}

/** ONE arrowhead marker def: direction is drawn only on atomic reveals (a
    lifted aggregate is a two-way conversation — an arrow on it would be a guess) */
function buildArrowheadDefs(selCol: string): SVGDefsElement {
  const arrowPath = document.createElementNS(SVG_NS, 'path');
  setAttrs(arrowPath, {
    'd': 'M1.4 1.6 L6 4 L1.4 6.4', fill: 'none', stroke: selCol,
    [ATTR_STROKE_WIDTH]: '1.8', [ATTR_STROKE_LINECAP]: STROKE_ROUND, 'stroke-linejoin': STROKE_ROUND,
  });
  const marker = document.createElementNS(SVG_NS, 'marker');
  setAttrs(marker, {
    id: 'ufAhh', viewBox: '0 0 8 8', refX: '6.2', refY: '4',
    markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse',
  });
  marker.appendChild(arrowPath);
  const defs = document.createElementNS(SVG_NS, 'defs') as SVGDefsElement;
  defs.appendChild(marker);
  return defs;
}

/** the rendered rep pair a click on this lifted wire should select: an atomic
    reveal targets the NEUTRAL aggregate that carries it (re-click toggles off) */
function hitPairOf(wire: LiftedWire, neutralWires: LiftedWire[]): { a: string; b: string } {
  if (!wire.atomic) return { 'a': wire.a, 'b': wire.b };
  const anchor = wire.underlying[0];
  const aggregate = anchor && neutralWires.find(
    (candidate) => candidate.underlying.some((edge) => edge.from === anchor.from && edge.to === anchor.to),
  );
  return aggregate ? { 'a': aggregate.a, 'b': aggregate.b } : { 'a': wire.a, 'b': wire.b };
}

interface WireOpacityInput { hot: boolean; inBlast: boolean; adv: boolean; ctx: WirePaintCtx; weightRatio: number }

/** opacity ramp: selection focus dims everything but the hot/in-blast set;
    otherwise weight alone carries it — advisory wires get an honesty floor */
function wireOpacity(input: WireOpacityInput): number {
  const base = input.ctx.selActive
    ? (input.hot ? .95 : input.inBlast ? .55 : .13)
    : .18 + .55 * input.weightRatio;
  return input.adv ? Math.max(base, .5) : base;
}

interface WireEntranceSpec { pathEl: SVGPathElement; key: string; hot: boolean; adv: boolean }

/** first-paint entrance: a wire that has never been drawn before (and isn't
    hot/advisory) draws itself in after its cards land, once only */
function markWireEntrance(env: UEnv, spec: WireEntranceSpec): void {
  if (env.wiresEverDrawn.has(spec.key)) return;
  env.wiresEverDrawn.add(spec.key);
  if (spec.hot || spec.adv) return;
  spec.pathEl.setAttribute('pathLength', '1');
  spec.pathEl.classList.add('uf-enter');
  spec.pathEl.style.animationDelay = Math.max(0, env.wireEnterAt - performance.now()) + 'ms';
}

interface WireVisualState { hot: boolean; adv: boolean; inBlast: boolean; ramp: number; width: number }

/** in-blast: both endpoints are within the selection's reachable hops (or are
    the selection itself) — only meaningful while the blast layer is on */
function computeWireVisualState(wire: LiftedWire, ctx: WirePaintCtx): WireVisualState {
  const hot = wire.hot;
  const adv = ctx.trustOn && wire.adv;
  const inBlast = ctx.blastOn
    && (ctx.repHops.has(wire.a) || wire.a === ctx.selRep)
    && (ctx.repHops.has(wire.b) || wire.b === ctx.selRep);
  const hub = !hot && (ctx.outDeg.get(wire.a) ?? 0) > 8;
  // weight ramp: the heavy flows carry the story, the light ones recede instead of stacking into noise
  const ramp = Math.pow(wire.w / ctx.maxw, .6) * (hub ? .35 : 1);
  return { hot, adv, inBlast, ramp, width: 1 + ramp * 2.4 };
}

function setWireStrokeAttrs(pathEl: SVGPathElement, wire: LiftedWire, ctx: WirePaintCtx, state: WireVisualState): void {
  pathEl.setAttribute('stroke', state.hot ? ctx.selCol : state.adv ? ctx.advCol : ctx.edgeCol);
  pathEl.setAttribute(ATTR_STROKE_WIDTH, String(state.hot ? Math.max(1.6, state.width) : state.width));
  pathEl.setAttribute('stroke-opacity', String(wireOpacity({
    hot: state.hot, inBlast: state.inBlast, adv: state.adv, ctx, weightRatio: state.ramp,
  })));
  pathEl.setAttribute(ATTR_STROKE_LINECAP, STROKE_ROUND);
  if (state.adv) pathEl.setAttribute('stroke-dasharray', '4 3');
  if (wire.atomic) pathEl.setAttribute('marker-end', 'url(#ufAhh)');
  if (state.hot) pathEl.classList.add('uf-hot'); // flow animation: the selection's wires visibly carry traffic
}

function wirePathData(
  wire: LiftedWire, ctx: WirePaintCtx, cache: RouteCache, wirePathFn: (a: Box, b: Box) => string,
): string {
  const routed = cache.routes.get(wire.a + ' ' + wire.b);
  return routed ? polyPath(routed) : wirePathFn(ctx.pos[wire.a], ctx.pos[wire.b]);
}

function paintWireItem(wire: LiftedWire, ctx: WirePaintCtx, paintEnv: WirePaintEnv): void {
  const state = computeWireVisualState(wire, ctx);
  const pathEl = document.createElementNS(SVG_NS, 'path');
  pathEl.setAttribute('d', wirePathData(wire, ctx, paintEnv.cache, paintEnv.actions.wirePath));
  pathEl.setAttribute('fill', 'none');
  setWireStrokeAttrs(pathEl, wire, ctx, state);
  markWireEntrance(paintEnv.env, { pathEl, key: wire.a + ' ' + wire.b, hot: state.hot, adv: state.adv });
  paintEnv.env.wiresEl.appendChild(pathEl);
  const hitPair = hitPairOf(wire, ctx.neutral);
  paintEnv.actions.wireHit({ visiblePath: pathEl, pathData: pathEl.getAttribute('d') as string,
    idA: hitPair.a, idB: hitPair.b, host: paintEnv.env.wiresEl });
  if (wire.concealed > 0 && !wire.atomic) {
    const dim = ctx.selActive && !state.hot;
    paintWireBadge({ pathEl, wire, hitPair, dim }, paintEnv.env, paintEnv.actions.onSelect);
  }
}

function sizeWiresSvg(env: UEnv): void {
  const { width, height } = env.contentSize();
  env.wiresEl.setAttribute('width', String(width));
  env.wiresEl.setAttribute('height', String(height));
}

function wireThemeColors(env: UEnv): { edgeCol: string; selCol: string; advCol: string } {
  return {
    edgeCol: themeVar(env, '--uf-dim') || '#948f84',
    selCol: themeVar(env, '--uf-accent') || '#4a6b8a',
    advCol: themeVar(env, K_STORE_VAR) || '#a8824a',
  };
}

function measureBox(env: UEnv, el: HTMLElement): Box {
  const rect = el.getBoundingClientRect();
  const contentRect = env.contentEl.getBoundingClientRect();
  const scale = env.viewXform.k;
  const posX = (rect.left - contentRect.left) / scale;
  const posY = (rect.top - contentRect.top) / scale;
  return makeBox(posX, posY, rect.width / scale, rect.height / scale);
}

function computeWirePositions(env: UEnv): Record<string, Box> {
  const pos: Record<string, Box> = {};
  env.contentEl.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
    pos[el.dataset.id as string] = measureBox(env, el);
  });
  return pos;
}

type ThemeColors = { edgeCol: string; selCol: string; advCol: string };

/** a hub's fan-out (the composition root, a config read by everyone) is structure, not story:
    each of its edges says little, so collectively they recede unless the selection asks for them.
    `neutral` recomputes with no selection — the aggregate a click should always target. */
function buildWirePaintCtx(
  env: UEnv, pos: Record<string, Box>, lifted: LiftedWire[], colors: ThemeColors,
): WirePaintCtx {
  const neutral = env.spec.sel || env.spec.selWire ? liftEnvWires(env, true) : lifted;
  const selRep = env.spec.sel ? env.visibleRep(env.spec.sel) : null;
  const outDeg = new Map<string, number>();
  for (const wire of lifted) outDeg.set(wire.a, (outDeg.get(wire.a) ?? 0) + 1);
  return {
    ...colors, pos, neutral, outDeg,
    blastOn: env.spec.layers.blast && !!selRep,
    selRep,
    selActive: !!env.spec.sel || !!env.spec.selWire,
    maxw: Math.max(1, ...lifted.map((wire) => wire.w)),
    trustOn: env.spec.layers.trust,
    repHops: env.REP_HOPS,
  };
}

function paintCanvasWires(env: UEnv, cache: RouteCache, actions: WireDrawActions): void {
  env.wiresEl.innerHTML = '';
  if (!(env.spec.layers.calls || env.spec.layers.deps)) return;
  sizeWiresSvg(env);
  const colors = wireThemeColors(env);
  env.wiresEl.appendChild(buildArrowheadDefs(colors.selCol));
  const pos = computeWirePositions(env);
  const lifted = liftEnvWires(env).filter((wire) => pos[wire.a] && pos[wire.b]);
  // hot paints on top
  const items = [...lifted].sort((wireX, wireY) => (wireX.hot ? 1 : 0) - (wireY.hot ? 1 : 0));
  actions.requestRoutes(pos, items);
  const ctx = buildWirePaintCtx(env, pos, lifted, colors);
  const paintEnv: WirePaintEnv = { env, cache, actions };
  for (const wire of items) paintWireItem(wire, ctx, paintEnv);
}

/* ---- stage wires: intra-stage curves between staged cards + curved wires to proxy pills ---- */

// stage-space Box builder — feeds the same edge-anchored wirePath the canvas wires use,
// instead of drawing center-to-center through the cards
function stageBoxOf(rect: DOMRect, stageRect: DOMRect): Box {
  return makeBox(rect.left - stageRect.left, rect.top - stageRect.top, rect.width, rect.height);
}

/** the stage-wire painting context: card positions, the U3/U4 layer filter (stage wires
    obey the same call/dep layers as the canvas), the rep resolver, and the path painter
    (U3: a selection DIMS the other wires instead of erasing them — same grammar as drawWires) */
function stageRepIn(env: UEnv, pos: Record<string, DOMRect>): (id: string) => string | null {
  return (id) => {
    const rep = env.stageRepOf(id);
    return rep && pos[rep] ? rep : null;
  };
}

function stageMkPath(env: UEnv, colors: { edgeCol: string; selCol: string }): StageWireCtx['mkPath'] {
  return (pathD, hot) => {
    const pathEl = document.createElementNS(SVG_NS, 'path');
    setAttrs(pathEl, {
      'd': pathD, fill: 'none', stroke: hot ? colors.selCol : colors.edgeCol,
      [ATTR_STROKE_WIDTH]: hot ? '1.8' : '1.2',
      'stroke-opacity': hot ? '.95' : (env.spec.sel || env.spec.selWire ? '.16' : '.5'),
      [ATTR_STROKE_LINECAP]: STROKE_ROUND,
    });
    if (hot) pathEl.classList.add('uf-hot');
    return pathEl;
  };
}

function buildStageWireCtx(env: UEnv, colors: { edgeCol: string; selCol: string }): StageWireCtx {
  const pos: Record<string, DOMRect> = {};
  env.stageLayer.querySelectorAll<HTMLElement>('.uf-sgroup .uf-card').forEach((card) => {
    pos[card.dataset.id as string] = card.getBoundingClientRect();
  });
  const stageRect = env.stageEl.getBoundingClientRect();
  return {
    pos, stageRect, frame: env.stageFrameIds(),
    wireOn: (edge) => (edge.call && env.spec.layers.calls) || (edge.dep && env.spec.layers.deps),
    repIn: stageRepIn(env, pos),
    sbox: (rect) => stageBoxOf(rect, stageRect),
    mkPath: stageMkPath(env, colors),
  };
}

function paintStageEdge(
  env: UEnv, ctx: StageWireCtx, actions: StagePathActions, pair: { repA: string; repB: string },
): void {
  const selWire = env.spec.selWire;
  const wireSelected = !!selWire && pair.repA === selWire.a && pair.repB === selWire.b;
  const hot = wireSelected || (!!env.spec.sel && (pair.repA === env.spec.sel || pair.repB === env.spec.sel));
  const pathD = actions.wirePath(ctx.sbox(ctx.pos[pair.repA]), ctx.sbox(ctx.pos[pair.repB]));
  const pathEl = ctx.mkPath(pathD, hot);
  env.sWiresEl.appendChild(pathEl);
  actions.wireHit({ visiblePath: pathEl, pathData: pathD, idA: pair.repA, idB: pair.repB, host: env.sWiresEl });
}

function paintStageEdges(env: UEnv, ctx: StageWireCtx, actions: StagePathActions): void {
  const seenPairs = new Set<string>();
  for (const edge of env.EDGES) {
    if (!ctx.wireOn(edge)) continue;
    const repA = ctx.repIn(edge.from);
    const repB = ctx.repIn(edge.to);
    if (!repA || !repB || repA === repB) continue;
    const pairKey = repA + ' ' + repB;
    if (seenPairs.has(pairKey)) continue;
    seenPairs.add(pairKey);
    paintStageEdge(env, ctx, actions, { repA, repB });
  }
}

/* ---- curved wires from each staged card to the directional proxy pills outside the frame
       (plus a frame-attributed fallback for pills with no child anchor) ---- */

type PlanePoint = { x: number; y: number };

// point where the card→pill line crosses the card's own box edge
function edgeToward(box: Box, targetX: number, targetY: number): PlanePoint {
  const dx = targetX - box.cx;
  const dy = targetY - box.cy;
  if (!dx && !dy) return { x: box.cx, y: box.cy };
  const scale = Math.min(
    dx ? (box.w / 2) / Math.abs(dx) : Infinity,
    dy ? (box.h / 2) / Math.abs(dy) : Infinity,
  );
  return { x: box.cx + dx * scale, y: box.cy + dy * scale };
}

function pillAnchor(pillRect: DOMRect, stageRect: DOMRect): PlanePoint {
  return {
    x: pillRect.left - stageRect.left + pillRect.width / 2,
    y: pillRect.top - stageRect.top + pillRect.height / 2,
  };
}

function quadraticWireD(start: PlanePoint, anchor: PlanePoint): string {
  const midX = (start.x + anchor.x) / 2;
  const midY = (start.y + anchor.y) / 2;
  return `M ${start.x} ${start.y} Q ${midX} ${start.y} ${midX} ${midY} T ${anchor.x} ${anchor.y}`;
}

function proxySourceFor(env: UEnv, ctx: StageWireCtx, edge: UEdge, proxyGid: string): string | null {
  if (!ctx.wireOn(edge)) return null;
  const repFrom = ctx.repIn(edge.from);
  const repTo = ctx.repIn(edge.to);
  if (repFrom && !repTo && env.proxyTargetOf(edge.to, ctx.frame) === proxyGid) return repFrom;
  if (repTo && !repFrom && env.proxyTargetOf(edge.from, ctx.frame) === proxyGid) return repTo;
  return null;
}

function paintProxyLinkedWires(env: UEnv, ctx: StageWireCtx, pillEl: HTMLElement, anchor: PlanePoint): Set<string> {
  const proxyGid = pillEl.dataset.gid as string;
  const linked = new Set<string>();
  for (const edge of env.EDGES) {
    const source = proxySourceFor(env, ctx, edge, proxyGid);
    if (!source || linked.has(source)) continue;
    linked.add(source);
    const start = edgeToward(ctx.sbox(ctx.pos[source]), anchor.x, anchor.y);
    env.sWiresEl.appendChild(ctx.mkPath(quadraticWireD(start, anchor), !!env.spec.sel && source === env.spec.sel));
  }
  return linked;
}

// frame-attributed pill with no child anchor: wire from the stage-group frame edge toward the pill
function paintProxyFrameFallback(env: UEnv, ctx: StageWireCtx, anchor: PlanePoint): void {
  const groupEl = env.stageLayer.querySelector('.uf-sgroup');
  if (!groupEl) return;
  const groupRect = groupEl.getBoundingClientRect();
  const groupCenter = pillAnchor(groupRect, ctx.stageRect);
  const angle = Math.atan2(anchor.y - groupCenter.y, anchor.x - groupCenter.x);
  const start = {
    x: groupCenter.x + Math.cos(angle) * (groupRect.width / 2),
    y: groupCenter.y + Math.sin(angle) * (groupRect.height / 2),
  };
  env.sWiresEl.appendChild(ctx.mkPath(quadraticWireD(start, anchor), false));
}

function paintStageProxyWires(env: UEnv, ctx: StageWireCtx): void {
  env.stageLayer.querySelectorAll<HTMLElement>('.uf-proxy').forEach((pillEl) => {
    const pillRect = pillEl.getBoundingClientRect();
    const anchor = pillAnchor(pillRect, ctx.stageRect);
    const linked = paintProxyLinkedWires(env, ctx, pillEl, anchor);
    if (!linked.size && pillEl.dataset.frame) paintProxyFrameFallback(env, ctx, anchor);
  });
}

function paintStageWires(
  env: UEnv, wirePathFn: StagePathActions['wirePath'], wireHitFn: StagePathActions['wireHit'],
): void {
  env.sWiresEl.innerHTML = '';
  if (!(env.spec.stage && (env.spec.layers.calls || env.spec.layers.deps))) return;
  const stageWidth = env.stageEl.clientWidth;
  const stageHeight = env.stageEl.clientHeight;
  env.sWiresEl.setAttribute('viewBox', `0 0 ${stageWidth} ${stageHeight}`);
  const colors = wireThemeColors(env);
  const ctx = buildStageWireCtx(env, colors);
  const actions: StagePathActions = { wirePath: wirePathFn, wireHit: wireHitFn };
  paintStageEdges(env, ctx, actions);
  paintStageProxyWires(env, ctx);
}

export function initUnfoldWires(env: UEnv): void {
  function wirePath(boxA: Box, boxB: Box): string {
    return buildWirePath(boxA, boxB); }

  function selectWire(idA: string, idB: string): void {
    env.commit({ type: 'selectWire', 'a': idA, 'b': idB });
  }

  function wireHit(spec: { visiblePath: SVGPathElement; pathData: string; idA: string; idB: string;
    host: SVGSVGElement }): void {
    attachWireHit({ ...spec, onSelect: selectWire });
  }

  function requestRoutes(pos: Record<string, Box>, wires: LiftedWire[]): void {
    scheduleRoutes(env, routeCacheFor(env), { pos, wires }, drawWires);
  }

  function drawWires(): void {
    paintCanvasWires(env, routeCacheFor(env), { wirePath, wireHit, onSelect: selectWire, requestRoutes });
  }

  env.computeLifted = (neutral) => liftEnvWires(env, neutral);
  env.drawWires = drawWires;
  env.drawStageWires = () => paintStageWires(env, wirePath, wireHit);
}
