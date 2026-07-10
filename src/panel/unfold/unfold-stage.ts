/* =====================================================================
   unfold-stage.ts — reading mode: the bounded camera (explore canvas),
   the stage projection (a focused group center-stage, the rest blurred
   behind), entrance stagger + focus illumination, and the zoom/fold/dark
   chrome-less controls, split out of unfold.ts in place. Every symbol
   here used to be a closure over initUnfold's locals; those locals now
   live on the shared `env: UEnv` object unfold.ts constructs and passes
   to every sibling factory, and this factory attaches its own functions
   back onto `env` so the other siblings (and unfold.ts itself) can call
   them. (drawStageWires/drawStageProxyWires — the stage's own wire
   painters — live in unfold-wires.ts alongside the explore-canvas wire
   painters, per the "wire-drawing units" bucket.)

   Readability note: every non-mapped closure that used to live nested
   inside initUnfoldStage now lives as a module-scope helper taking `env`
   (and, where the stage/proxy machinery needs to call back into the
   mapped inner functions below, a small `StageCtx` bundle) explicitly —
   nested function bodies count against the enclosing function's line/
   statement budget, so pulling them out is what keeps initUnfoldStage
   itself small. The mapped symbols stay declared *inside*
   initUnfoldStage as thin delegates that call the module-scope impl.
   ===================================================================== */

import { esc } from '../../core/config/config';
import { ufFitXform } from './unfold-camera';
import type { UEnv, UNode, UEdge } from './unfold';

/* ================= STAGE + FOCUS (approved v3 "stage" design) =================
   Canvas coordinates stay the single spatial truth; stage mode is a SECOND
   PROJECTION of the same graph. Proxy directions derive from group centroids
   in ctx.state positions — the human's manual layout is the source of angles. */

/** the stage layer's own svg host + the type-focus click delegate — grouped so
    initUnfoldStage's own statement count stays under the readability budget. */
function initStageDom(env: UEnv, typeFocus: (t: string | null) => void): void {
  attachWheelZoom(env);
  attachStagePan(env);
  env.stageLayer.innerHTML = '<svg class="uf-swires" xmlns="http://www.w3.org/2000/svg"></svg>';
  attachTypeFocusClick(env, typeFocus);
}

/** attach every non-mode-boundary member onto `env`; the 5 mapped members
    (reframeToFit/enterStagger/focusDim/typeFocus/stageMode) stay declared inside
    initUnfoldStage as thin delegates and are passed in already-bound to it. */
type MappedStageMembers = Pick<UEnv, 'reframeToFit' | 'enterStagger' | 'focusDim' | 'typeFocus' | 'stageMode'>;
function wireStageEnv(env: UEnv, stageCtx: StageCtx, mapped: MappedStageMembers): void {
  Object.assign(env, {
    contentSize: () => getContentSize(env),
    fitView: (anim?: boolean) => fitViewTo(env, anim),
    clampPan: () => clampPanView(env),
    setT: (anim?: boolean) => applyTransform(env, anim),
    renderStageGroup: (dirFrom?: number) => renderStageGroupImpl(stageCtx, dirFrom),
    refreshStage: () => refreshStageImpl(stageCtx),
    stageRepOf: (id: string) => stageRepOfIn(env, id),
    stageFrameIds: () => stageFrameIdsOf(env),
    proxyTargetOf: (outside: string, frame: Set<string>) => proxyTargetOfIn(env, outside, frame),
    carriesType: (id: string, type: string) => carriesTypeIn(env, id, type),
    ...mapped,
  });
}

export function initUnfoldStage(env: UEnv): void {
  /** staggered fade-up entrance for newly-revealed cards; wires draw in after cards land */
  function enterStagger(): void {
    enterStaggerImpl(env); }
  /** focus illumination: selection glows, 1-hop neighbours lit, its wires flow, rest dims — no rebuild */
  function focusDim(): void {
    focusDimImpl(env); }
  /** animated reframe: consults the pure ufFitXform for the camera decision — a fit
      only for the first paint and the visible-set verbs (reveal / hide / foldAll);
      a toggleExpand repaint (repaintAction, set by render()) resolves to the prior
      transform, so folding/unfolding a group moves neither zoom nor focus. */
  function reframeToFit(): void {
    reframeToFitImpl(env); }
  /** type focus: every carrier module lights across the surface; inspector lists carriers */
  function typeFocus(typ: string | null): void {
    env.commit({ type: 'focusType', 't': typ }); }
  /** stage projection: focused group center-stage; explore world blurred behind. Exit restores explore exactly.
      (a projection change invalidates a wire selection — the reducer owns that rule) */
  function stageMode(gid: string | null): void {
    env.commit({ type: 'setStage', id: gid }); }
  /** directional proxy pills: external edges aggregate per target container; angle = true angle between centroids. */
  function stageProxies(): void {
    stageProxiesImpl(stageCtx); }
  /** peek → travel: proxy expands in place; explicit travel swaps the target group onto stage from its direction */
  function stageTravel(target: string, fromAngle: number): void {
    stageTravelImpl(stageCtx, target, fromAngle); }

  const stageCtx: StageCtx = { env, hooks: { travel: stageTravel, refreshProxies: stageProxies } };
  initStageDom(env, typeFocus);
  wireStageEnv(env, stageCtx, { reframeToFit, enterStagger, focusDim, typeFocus, stageMode });
}

/* ================= CAMERA (bounded) ================= */

function applyTransform(env: UEnv, anim?: boolean): void {
  env.worldEl.classList.toggle('anim', !!anim);
  env.worldEl.style.transform = `translate(${env.viewXform.x}px,${env.viewXform.y}px) scale(${env.viewXform.k})`;
}

function getContentSize(env: UEnv): { width: number; height: number } {
  return { width: env.contentEl.scrollWidth || 1, height: env.contentEl.scrollHeight || 1 };
}

function clampPanView(env: UEnv): void {
  const { width, height } = getContentSize(env);
  const stageW = env.stageEl.clientWidth;
  const stageH = env.stageEl.clientHeight;
  const margin = 120;
  env.viewXform.x = Math.min(stageW - margin, Math.max(margin - width * env.viewXform.k, env.viewXform.x));
  env.viewXform.y = Math.min(stageH - margin, Math.max(margin - height * env.viewXform.k, env.viewXform.y));
}

function fitViewTo(env: UEnv, anim?: boolean): void {
  const { width, height } = getContentSize(env);
  const stageW = env.stageEl.clientWidth;
  const stageH = env.stageEl.clientHeight;
  const pad = 64;
  env.viewXform.k = Math.max(.15, Math.min(1.15, Math.min((stageW - pad * 2) / width, (stageH - pad * 2) / height)));
  env.viewXform.x = (stageW - width * env.viewXform.k) / 2;
  env.viewXform.y = Math.max(pad, (stageH - height * env.viewXform.k) / 2);
  applyTransform(env, anim);
}

function handleWheelZoom(env: UEnv, evt: WheelEvent): void {
  evt.preventDefault();
  const rect = env.stageEl.getBoundingClientRect();
  const pointX = evt.clientX - rect.left;
  const pointY = evt.clientY - rect.top;
  const nextK = Math.max(.15, Math.min(2.5, env.viewXform.k * (evt.deltaY < 0 ? 1.1 : 0.9)));
  env.viewXform.x = pointX - (pointX - env.viewXform.x) * (nextK / env.viewXform.k);
  env.viewXform.y = pointY - (pointY - env.viewXform.y) * (nextK / env.viewXform.k);
  env.viewXform.k = nextK;
  clampPanView(env);
  applyTransform(env, false);
}

function attachWheelZoom(env: UEnv): void {
  env.stageEl.addEventListener('wheel', (evt) => handleWheelZoom(env, evt), { passive: false });
}

interface PanDragState { startX: number; startY: number; baseX: number; baseY: number; moved: boolean }
interface PanDragBox { drag: PanDragState | null }

function handlePanDown(env: UEnv, box: PanDragBox, evt: PointerEvent): void {
  // U1: stagelayer excluded — pointer capture on stageEl retargets click and kills stage buttons (← explore, proxies)
  const targetEl = evt.target as HTMLElement;
  if (targetEl.closest('.uf-card,.uf-ghead,.uf-open,.uf-dock,.uf-stagelayer,.uf-whit')) return;
  box.drag = { startX: evt.clientX, startY: evt.clientY, baseX: env.viewXform.x, baseY: env.viewXform.y, moved: false };
  env.stageEl.classList.add('grab');
  env.stageEl.setPointerCapture(evt.pointerId);
}

function handlePanMove(env: UEnv, box: PanDragBox, evt: PointerEvent): void {
  const drag = box.drag;
  if (!drag) return;
  if (Math.abs(evt.clientX - drag.startX) + Math.abs(evt.clientY - drag.startY) > 3) drag.moved = true;
  if (!drag.moved) return;
  env.viewXform.x = drag.baseX + (evt.clientX - drag.startX);
  env.viewXform.y = drag.baseY + (evt.clientY - drag.startY);
  clampPanView(env);
  applyTransform(env, false);
}

function handlePanUp(env: UEnv, box: PanDragBox): void {
  // U2: click-without-drag on empty canvas deselects a selected wire (drag threshold 3px)
  const drag = box.drag;
  if (drag && !drag.moved && env.spec.selWire) {
    env.commit({ type: 'selectWire', 'a': env.spec.selWire.a, 'b': env.spec.selWire.b });   // re-select = toggle off
  }
  box.drag = null;
  env.stageEl.classList.remove('grab');
}

function attachStagePan(env: UEnv): void {
  const box: PanDragBox = { drag: null };
  env.stageEl.addEventListener('pointerdown', (evt) => handlePanDown(env, box, evt));
  env.stageEl.addEventListener('pointermove', (evt) => handlePanMove(env, box, evt));
  env.stageEl.addEventListener('pointerup', () => handlePanUp(env, box));
}

/* ================= FRAME / TYPE HELPERS ================= */

/** the staged container plus every ancestor above it (the stage's frame set) */
function stageFrameIdsOf(env: UEnv): Set<string> {
  const ids = new Set<string>();
  if (!env.spec.stage) return ids;
  ids.add(env.spec.stage);
  let cur = env.U.get(env.spec.stage);
  const seen = new Set<string>();
  while (cur && cur.parent && !seen.has(cur.id)) {
    seen.add(cur.id);
    ids.add(cur.parent);
    cur = env.U.get(cur.parent);
  }
  return ids;
}

/** aggregation target for a proxy pill: the COARSEST ancestor of `outside`
    that does not contain the staged subtree — a sibling in the same group
    stays itself; a foreign subtree compresses into its top group */
function proxyTargetOfIn(env: UEnv, outside: string, frame: Set<string>): string {
  let cur = env.U.get(outside);
  const seen = new Set<string>();
  const chain: string[] = [];
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.push(cur.id);
    cur = cur.parent ? env.U.get(cur.parent) : undefined;
  }
  for (let i = chain.length - 1; i >= 0; i--) if (!frame.has(chain[i])) return chain[i];
  return outside;
}

/** ancestor-or-self that is a DIRECT child of the staged container; null when outside it */
function stageRepOfIn(env: UEnv, id: string): string | null {
  let cur = env.U.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.id === env.spec.stage) return null;
    if (cur.parent === env.spec.stage) return cur.id;
    cur = cur.parent ? env.U.get(cur.parent) : undefined;
  }
  return null;
}

function accumulateCentroid(env: UEnv, id: string, acc: { sumX: number; sumY: number; count: number }): void {
  const node = env.ctx.state.nodes[id];
  if (node) {
    acc.sumX += node.x + node.w / 2;
    acc.sumY += node.y + node.h / 2;
    acc.count++;
  }
  (env.U.get(id)?.children ?? []).forEach((childId) => accumulateCentroid(env, childId, acc));
}

/** mean center of a container subtree in ctx.state world coordinates */
function centroidOfIn(env: UEnv, rid: string): { x: number; y: number } {
  const acc = { sumX: 0, sumY: 0, count: 0 };
  accumulateCentroid(env, rid, acc);
  return acc.count ? { x: acc.sumX / acc.count, y: acc.sumY / acc.count } : { x: 0, y: 0 };
}

function baseTypeOf(raw: string): string {
  const idx = raw.indexOf(':');
  return (idx >= 0 ? raw.slice(idx + 1) : raw).trim().replace(/\[\]$/, '');
}

function carriesTypeIn(env: UEnv, id: string, type: string): boolean {
  const node = env.U.get(id);
  if (!node) return false;
  return [...node.accepts, ...node.returns, ...node.state].some((x) => baseTypeOf(x) === type);
}

/* ================= ENTRANCE + FOCUS ================= */

function enterStaggerImpl(env: UEnv): void {
  const els: HTMLElement[] = [];
  env.contentEl.querySelectorAll<HTMLElement>('.uf-card').forEach((el) => {
    if (!env.prevShown.has(el.dataset.id as string)) els.push(el);
  });
  els.forEach((el) => el.classList.add('uf-born'));
  els.forEach((el, i) => setTimeout(() => el.classList.add('uf-in'), 80 + i * 55));
  const done = 80 + els.length * 55 + 650;
  if (els.length) setTimeout(() => els.forEach((el) => el.classList.remove('uf-born', 'uf-in')), done + 60);
  env.wireEnterAt = els.length ? performance.now() + 80 + els.length * 55 + 250 : env.wireEnterAt;
  env.prevShown.clear();
  for (const el of env.contentEl.querySelectorAll<HTMLElement>('.uf-card')) env.prevShown.add(el.dataset.id as string);
}

interface CardFocusFlags { sel: boolean; lit: boolean; wep: boolean }

function cardFocusFlags(env: UEnv, id: string): CardFocusFlags {
  const sel = env.spec.sel === id;
  const lit = !!env.spec.focusType && carriesTypeIn(env, id, env.spec.focusType);
  // U2: a selected wire lights its endpoints
  const wep = !!env.spec.selWire && (env.spec.selWire.a === id || env.spec.selWire.b === id);
  return { sel, lit, wep };
}

function cardDimFlags(env: UEnv, id: string, flags: CardFocusFlags): { nbr: boolean; dim: boolean } {
  const nbr = !env.spec.focusType && !!env.spec.sel && !flags.sel && env.isNeighbour(env.spec.sel, id);
  // C7: a peeked card is never dimmed, even while a primary sel is active
  const dimmable = env.spec.focusType
    ? !flags.lit
    : env.spec.selWire ? !flags.wep : (env.spec.sel ? !flags.sel && !nbr : false);
  const dim = dimmable && id !== env.spec.sel2;
  return { nbr, dim };
}

function applyCardFocus(env: UEnv, el: HTMLElement, blastOn: boolean): void {
  const id = el.dataset.id as string;
  const flags = cardFocusFlags(env, id);
  el.classList.toggle('sel', flags.sel);
  el.classList.toggle('lit', flags.lit || flags.wep);
  el.classList.toggle('sel2', env.spec.sel2 === id);   // C7: secondary peek highlight
  if (blastOn) return;
  const { nbr, dim } = cardDimFlags(env, id, flags);
  el.classList.toggle('nbr', nbr);
  el.classList.toggle('dim', dim);
}

function focusDimImpl(env: UEnv): void {
  const blastOn = env.spec.layers.blast && !!env.spec.sel;
  env.overlay.querySelectorAll<HTMLElement>('.uf-card').forEach((el) => applyCardFocus(env, el, blastOn));
  // U6: a selected group frame carries the ring too (member cards handle their own dim)
  env.overlay.querySelectorAll<HTMLElement>('.uf-grp').forEach((el) =>
    el.classList.toggle('sel', env.spec.sel === el.dataset.id));
  env.overlay.querySelectorAll<HTMLElement>('.uf-t').forEach((tagEl) =>
    tagEl.classList.toggle('hit', tagEl.dataset.t === env.spec.focusType));
}

function reframeToFitImpl(env: UEnv): void {
  env.worldEl.classList.remove('anim');
  env.worldEl.classList.add('anim2');
  const next = ufFitXform({
    action: env.repaintAction, firstPaint: env.firstFit, prev: env.viewXform, content: getContentSize(env),
    stage: { width: env.stageEl.clientWidth, height: env.stageEl.clientHeight }, pad: 64,
  });
  env.viewXform.x = next.x;
  env.viewXform.y = next.y;
  env.viewXform.k = next.k;
  env.worldEl.style.transform = `translate(${env.viewXform.x}px,${env.viewXform.y}px) scale(${env.viewXform.k})`;
  setTimeout(() => env.worldEl.classList.remove('anim2'), 950);
}

function attachTypeFocusClick(env: UEnv, onToggle: (t: string | null) => void): void {
  env.overlay.addEventListener('click', (evt) => {
    const tagEl = (evt.target as HTMLElement).closest('.uf-t') as HTMLElement | null;
    if (!tagEl) return;
    evt.stopPropagation();
    onToggle(env.spec.focusType === tagEl.dataset.t ? null : (tagEl.dataset.t as string));
  }, true);
}

/* ================= STAGE GROUP RENDER ================= */

interface PLink { inside: string | null; outside: string }
interface ProxyEntry { grp: string; links: PLink[]; ang: number }
interface ProxyCenter { centerX: number; centerY: number; radius: number }
interface StageHooks { travel: (target: string, fromAngle: number) => void; refreshProxies: () => void }
interface StageCtx { env: UEnv; hooks: StageHooks }

function buildStageBodyEl(env: UEnv, stageU: UNode): HTMLElement {
  const wrap = env.h('div', 'uf-sbody');
  for (const kid of stageU.children) {
    if (!env.spec.hidden.includes(kid)) wrap.appendChild(env.cardEl(env.gu(kid)));
  }
  return wrap;
}

function buildStageGroupEl(env: UEnv, stageU: UNode): HTMLElement {
  const crumbs = env.ancestorCrumbs(stageU);
  const sgroupEl = env.h('div', 'uf-sgroup',
    `<div class="uf-shead"><span class="uf-slabel">${esc(stageU.label)}</span>
      <span class="uf-strail">${esc(crumbs.join(' / '))}</span>
      <button class="uf-sleave">← explore</button></div>`);
  sgroupEl.appendChild(buildStageBodyEl(env, stageU));
  (sgroupEl.querySelector('.uf-sleave') as HTMLElement).onclick = () => {
    env.setSel(null);
    env.commit({ type: 'setStage', id: null });
    env.renderInspector();
    setTimeout(env.drawWires, 0);
  };
  return sgroupEl;
}

function applyStageEnterDirection(sgroupEl: HTMLElement, dirFrom: number): void {
  sgroupEl.style.transition = 'none';
  const dx = Math.round(Math.cos(dirFrom) * 70), dy = Math.round(Math.sin(dirFrom) * 70);
  sgroupEl.style.transform = `translate(calc(-50% + ${dx}px),calc(-50% + ${dy}px)) scale(.94)`;
  setTimeout(() => {
    sgroupEl.style.transition = '';
    sgroupEl.style.transform = '';
  }, 30);
}

function renderStageGroupImpl(ctx: StageCtx, dirFrom?: number): void {
  const env = ctx.env;
  env.stageLayer.querySelectorAll('.uf-sgroup,.uf-proxy').forEach((el) => el.remove());
  env.sWiresEl.innerHTML = '';
  if (!env.spec.stage) return;
  const stageU = env.gu(env.spec.stage);
  const sgroupEl = buildStageGroupEl(env, stageU);
  if (dirFrom !== undefined) applyStageEnterDirection(sgroupEl, dirFrom);
  env.stageLayer.appendChild(sgroupEl);
  stageProxiesImpl(ctx);
  setTimeout(env.drawStageWires, 60);
}

function settleImmediately(el: HTMLElement): void {
  el.style.transition = 'none';
  el.style.transitionDelay = '0ms';
  el.style.opacity = '1';
  setTimeout(() => {
    el.style.transition = '';
    el.style.transitionDelay = '';
    el.style.opacity = '';
  }, 40);
}

/** U4: silent stage refresh — rebuild the projection from CURRENT view state
    (layers, hidden, blast, selection) without replaying entrance transitions.
    Called by render() so both projections subscribe to the same state. */
function refreshStageImpl(ctx: StageCtx): void {
  const env = ctx.env;
  if (!env.spec.stage) return;
  const stageU = env.U.get(env.spec.stage);
  if (!stageU || !stageU.children.some((childId) => !env.spec.hidden.includes(childId))) {
    // staged container gone or emptied by reveal toggles — exit to explore
    env.commit({ type: 'setStage', id: null });
    return;
  }
  renderStageGroupImpl(ctx, undefined);
  const sgroupEl = env.stageLayer.querySelector('.uf-sgroup') as HTMLElement | null;
  if (sgroupEl) settleImmediately(sgroupEl);
  env.stageLayer.querySelectorAll<HTMLElement>('.uf-proxy').forEach(settleImmediately);
}

/* ================= PROXY COLLECTION + LAYOUT =================
   Edge-granularity honesty: cross-module edges in this model attach at MODULE level, so an edge incident to the
   staged container itself or its ancestor chain is FRAME-attributed (no child anchor) — without that a staged
   sub-group shows no connections at all. Child-attributed links obey the selection filter; frame links persist. */

function classifyEdgeForFrame(env: UEnv, frameIds: Set<string>, edge: UEdge): PLink | null {
  const repFrom = stageRepOfIn(env, edge.from);
  const repTo = stageRepOfIn(env, edge.to);
  if ((repFrom || frameIds.has(edge.from)) && !repTo && !frameIds.has(edge.to)) {
    return { inside: repFrom, outside: edge.to };
  }
  if ((repTo || frameIds.has(edge.to)) && !repFrom && !frameIds.has(edge.from)) {
    return { inside: repTo, outside: edge.from };
  }
  return null;
}

/** one external link per edge crossing the stage frame, aggregated to its
    coarsest foreign container — the raw material stageProxies lays out */
function collectProxyLinks(env: UEnv, frameIds: Set<string>): Map<string, PLink[]> {
  const byRoot = new Map<string, PLink[]>();
  for (const edge of env.EDGES) {
    const link = classifyEdgeForFrame(env, frameIds, edge);
    // U3: pill set is STABLE across selection — selection is expressed in the wires, not by mutating the pills
    if (!link || stageRepOfIn(env, link.outside)) continue; // inside the staged subtree after all
    const grp = proxyTargetOfIn(env, link.outside, frameIds);
    if (!byRoot.has(grp)) byRoot.set(grp, []);
    (byRoot.get(grp) as PLink[]).push(link);
  }
  return byRoot;
}

function buildProxyEntries(env: UEnv, stageId: string, byRoot: Map<string, PLink[]>): ProxyEntry[] {
  const center = centroidOfIn(env, stageId);
  return [...byRoot.entries()]
    .map(([grp, links]) => {
      const other = centroidOfIn(env, grp);
      return { grp, links, ang: Math.atan2(other.y - center.y, other.x - center.x) };
    })
    .sort((entryA, entryB) => entryA.ang - entryB.ang);
}

/** one de-overlap sweep across every adjacent pair; returns whether anything moved,
    so the caller's pass loop knows when to stop early. */
function deoverlapSweep(entries: ProxyEntry[], minSep: number): boolean {
  let moved = false;
  for (let idx = 0; idx < entries.length; idx++) {
    const entryA = entries[idx];
    const entryB = entries[(idx + 1) % entries.length];
    let gap = entryB.ang - entryA.ang;
    if (idx === entries.length - 1) gap += Math.PI * 2;
    if (gap < minSep - 1e-4) {
      const push = (minSep - gap) / 2;
      entryA.ang -= push;
      entryB.ang += push;
      moved = true;
    }
  }
  return moved;
}

/** de-overlap pass: a near-1-D editor layout clusters the true angles; spread pills
    apart while preserving the true angular ORDER (the spatial meaning the human laid out) */
function deoverlapAngles(entries: ProxyEntry[], minSep: number): void {
  for (let pass = 0; pass < 24 && entries.length > 1; pass++) {
    if (!deoverlapSweep(entries, minSep)) break;
  }
}

function computeStageRingRadius(env: UEnv): number {
  let radius = Math.min(env.stageEl.clientWidth, env.stageEl.clientHeight) * .40;
  const sgroupEl = env.stageLayer.querySelector('.uf-sgroup') as HTMLElement | null;
  if (!sgroupEl) return radius;
  // C3: floor the ring so the smaller (0.9) vertical placement scale still clears the
  // staged panel. ponytail: circumscribed-circle clearance — uses the panel half-diagonal,
  // generous for very rectangular panels but guarantees zero pill/panel overlap; tighten to
  // per-pill panel-edge distance only if pills look too far.
  const rect = sgroupEl.getBoundingClientRect();
  const gap = 40;
  const panelHalfDiag = 0.5 * Math.hypot(rect.width, rect.height);
  radius = Math.max(radius, (panelHalfDiag + gap) / 0.9);
  return radius;
}

function proxyPillNames(env: UEnv, entry: ProxyEntry, groupLabel: string): string[] {
  const names = [...new Set(entry.links.map((link) => env.U.get(link.outside)?.label ?? link.outside))];
  return names.filter((name) => name !== groupLabel);
}

function proxyPillHtml(env: UEnv, entry: ProxyEntry): string {
  const groupLabel = env.gu(entry.grp).label;
  const names = proxyPillNames(env, entry, groupLabel);
  const namesHtml = names.length
    ? `<span>${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ' +' + (names.length - 3) : ''}</span>`
    : '';
  return `<span class="uf-pdot"></span>${namesHtml}<span class="uf-pgrp">${esc(groupLabel)}</span>`;
}

function positionProxyPill(pillEl: HTMLElement, center: ProxyCenter, ang: number, delayIndex: number): void {
  pillEl.style.left = (center.centerX + Math.cos(ang) * center.radius * 1.05) + 'px';
  pillEl.style.top = (center.centerY + Math.sin(ang) * center.radius * .9) + 'px';
  pillEl.style.transitionDelay = (120 + delayIndex * 70) + 'ms';
}

/** one directional proxy pill element, placed on the ring around the staged group */
function buildProxyEl(ctx: StageCtx, entry: ProxyEntry, center: ProxyCenter, delayIndex: number): HTMLElement {
  const env = ctx.env;
  const pillEl = env.h('div', 'uf-proxy');
  pillEl.dataset.gid = entry.grp;
  pillEl.dataset.ang = String(entry.ang);
  if (entry.links.some((link) => link.inside === null)) pillEl.dataset.frame = '1';
  pillEl.innerHTML = proxyPillHtml(env, entry);
  positionProxyPill(pillEl, center, entry.ang, delayIndex);
  pillEl.onclick = (evt) => {
    evt.stopPropagation();
    peekProxyImpl(ctx, pillEl, entry);
  };
  return pillEl;
}

/** the ring geometry + angle-sorted entries for one stage's proxy layout. */
interface ProxyLayout { entries: ProxyEntry[]; minSep: number; center: ProxyCenter }
function computeProxyLayout(env: UEnv, stageId: string): ProxyLayout {
  const frameIds = stageFrameIdsOf(env);
  const byRoot = collectProxyLinks(env, frameIds);
  const entries = buildProxyEntries(env, stageId, byRoot);
  const minSep = Math.min(.55, (Math.PI * 2) / Math.max(entries.length, 1));
  const center: ProxyCenter = {
    centerX: env.stageEl.clientWidth / 2, centerY: env.stageEl.clientHeight / 2, radius: computeStageRingRadius(env),
  };
  return { entries, minSep, center };
}

function stageProxiesImpl(ctx: StageCtx): void {
  const env = ctx.env;
  env.stageLayer.querySelectorAll('.uf-proxy').forEach((pillEl) => pillEl.remove());
  if (!env.spec.stage) return;
  const layout = computeProxyLayout(env, env.spec.stage);
  deoverlapAngles(layout.entries, layout.minSep);
  layout.entries.forEach((entry, i) => env.stageLayer.appendChild(buildProxyEl(ctx, entry, layout.center, i)));
}

/* ================= PEEK + TRAVEL ================= */

function memberDescHtml(env: UEnv, memberId: string): string {
  const unit = env.U.get(memberId);
  const descHtml = unit?.desc ? ' — ' + esc(unit.desc) : '';
  return `<div class="uf-pdesc"><b>${esc(unit?.label ?? memberId)}</b>${descHtml}</div>`;
}

function peekBodyHtml(env: UEnv, ogu: UNode, members: string[]): string {
  if (!members.length) {
    const fallback = `${ogu.children.length} inside · fan-in ${ogu.fanIn}`;
    return `<div class="uf-pdesc">${ogu.desc ? esc(ogu.desc) : fallback}</div>`;
  }
  return members.slice(0, 4).map((memberId) => memberDescHtml(env, memberId)).join('');
}

function attachProxyTravelClick(ctx: StageCtx, pillEl: HTMLElement, entry: ProxyEntry): void {
  const uniq = [...new Set(entry.links.map((link) => link.outside))];
  const travelBtn = pillEl.querySelector('.uf-ptravel') as HTMLElement;
  travelBtn.onclick = (evt) => {
    evt.stopPropagation();
    ctx.env.setSel(uniq[0] && ctx.env.gu(entry.grp).children.includes(uniq[0]) ? uniq[0] : null);
    ctx.hooks.travel(entry.grp, entry.ang);
  };
}

function attachProxyCloseClick(ctx: StageCtx, pillEl: HTMLElement): void {
  pillEl.onclick = (evt) => {
    evt.stopPropagation();
    pillEl.remove();
    ctx.hooks.refreshProxies();
    setTimeout(ctx.env.drawStageWires, 0);
  };
}

function peekProxyImpl(ctx: StageCtx, pillEl: HTMLElement, entry: ProxyEntry): void {
  if (pillEl.classList.contains('peek')) return;
  ctx.env.stageLayer.querySelectorAll('.uf-proxy.peek').forEach((openPill) => openPill.remove());
  pillEl.classList.add('peek');
  pillEl.style.transitionDelay = '0ms';
  const uniq = [...new Set(entry.links.map((link) => link.outside))];
  const ogu = ctx.env.gu(entry.grp);
  const members = uniq.filter((memberId) => memberId !== entry.grp);
  const bodyHtml = peekBodyHtml(ctx.env, ogu, members);
  pillEl.innerHTML = `<span class="uf-ptitle">${esc(ogu.label)}</span>${bodyHtml}`
    + `<button class="uf-ptravel">travel →</button>`;
  attachProxyTravelClick(ctx, pillEl, entry);
  attachProxyCloseClick(ctx, pillEl);
}

function landInExplore(env: UEnv, target: string): void {
  // a childless module has nothing to project — land in explore with it selected
  env.apply({ type: 'setStage', id: null }, { type: 'reveal', id: target });
  env.setSel(target);
  env.overlay.classList.remove('staged');
  env.render(true);
}

function stageTravelImpl(ctx: StageCtx, target: string, fromAngle: number): void {
  const env = ctx.env;
  if (!env.U.has(target)) return;
  if (!env.gu(target).children.length) {
    landInExplore(env, target);
    return;
  }
  env.apply({ type: 'setStage', id: target });
  env.overlay.classList.add('staged');
  renderStageGroupImpl(ctx, fromAngle + Math.PI);
  focusDimImpl(env);
  env.renderTree();
  env.renderInspector();
}
