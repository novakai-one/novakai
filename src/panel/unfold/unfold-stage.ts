/* =====================================================================
   unfold-stage.ts — reading mode: the bounded camera (explore canvas),
   the stage projection (a focused group center-stage, the rest blurred
   behind), entrance stagger + focus illumination, and the zoom/fold/dark
   chrome-less controls, split out of unfold.ts in place. Every symbol
   here used to be a closure over initUnfold's locals; those locals now
   live on the shared `E: UEnv` object unfold.ts constructs and passes to
   every sibling factory, and this factory attaches its own functions
   back onto `E` so the other siblings (and unfold.ts itself) can call
   them. (drawStageWires/drawStageProxyWires — the stage's own wire
   painters — live in unfold-wires.ts alongside the explore-canvas wire
   painters, per the "wire-drawing units" bucket.)
   ===================================================================== */

import { esc } from '../../core/config/config';
import { ufFitXform } from './unfold-camera';
import type { UEnv } from './unfold';

export function initUnfoldStage(E: UEnv): void {
  /* ================= CAMERA (bounded) ================= */
  function setT(anim?: boolean): void {
    E.worldEl.classList.toggle('anim', !!anim);
    E.worldEl.style.transform = `translate(${E.viewXform.x}px,${E.viewXform.y}px) scale(${E.viewXform.k})`;
  }
  const contentSize = (): { width: number; height: number } =>
    ({ width: E.contentEl.scrollWidth || 1, height: E.contentEl.scrollHeight || 1 });
  function clampPan(): void {
    const { width, height } = contentSize(), sw = E.stageEl.clientWidth, sh = E.stageEl.clientHeight, margin = 120;
    E.viewXform.x = Math.min(sw - margin, Math.max(margin - width * E.viewXform.k, E.viewXform.x));
    E.viewXform.y = Math.min(sh - margin, Math.max(margin - height * E.viewXform.k, E.viewXform.y));
  }
  function fitView(anim?: boolean): void {
    const { width, height } = contentSize(), sw = E.stageEl.clientWidth, sh = E.stageEl.clientHeight, pad = 64;
    E.viewXform.k = Math.max(.15, Math.min(1.15, Math.min((sw - pad * 2) / width, (sh - pad * 2) / height)));
    E.viewXform.x = (sw - width * E.viewXform.k) / 2;
    E.viewXform.y = Math.max(pad, (sh - height * E.viewXform.k) / 2);
    setT(anim);
  }
  E.stageEl.addEventListener('wheel', (wheelEv) => {
    wheelEv.preventDefault();
    const rect = E.stageEl.getBoundingClientRect(), px = wheelEv.clientX - rect.left, py = wheelEv.clientY - rect.top;
    const k2 = Math.max(.15, Math.min(2.5, E.viewXform.k * (wheelEv.deltaY < 0 ? 1.1 : 0.9)));
    E.viewXform.x = px - (px - E.viewXform.x) * (k2 / E.viewXform.k);
    E.viewXform.y = py - (py - E.viewXform.y) * (k2 / E.viewXform.k);
    E.viewXform.k = k2;
    clampPan(); setT(false);
  }, { passive: false });
  let panDrag: { sx: number; sy: number; x: number; y: number; moved: boolean } | null = null;
  E.stageEl.addEventListener('pointerdown', (downEv) => {
    // U1: stagelayer excluded — pointer capture on stageEl retargets click and kills stage buttons (← explore, proxies)
    if ((downEv.target as HTMLElement).closest('.uf-card,.uf-ghead,.uf-open,.uf-dock,.uf-stagelayer,.uf-whit')) return;
    panDrag = { sx: downEv.clientX, sy: downEv.clientY, x: E.viewXform.x, y: E.viewXform.y, moved: false };
    E.stageEl.classList.add('grab');
    E.stageEl.setPointerCapture(downEv.pointerId);
  });
  E.stageEl.addEventListener('pointermove', (moveEv) => {
    if (!panDrag) return;
    if (Math.abs(moveEv.clientX - panDrag.sx) + Math.abs(moveEv.clientY - panDrag.sy) > 3) panDrag.moved = true;
    if (!panDrag.moved) return;
    E.viewXform.x = panDrag.x + (moveEv.clientX - panDrag.sx);
    E.viewXform.y = panDrag.y + (moveEv.clientY - panDrag.sy);
    clampPan(); setT(false);
  });
  E.stageEl.addEventListener('pointerup', () => {
    // U2: click-without-drag on empty canvas deselects a selected wire (drag threshold 3px)
    if (panDrag && !panDrag.moved && E.spec.selWire) {
      E.commit({ type: 'selectWire', a: E.spec.selWire.a, b: E.spec.selWire.b });   // re-select = toggle off
    }
    panDrag = null; E.stageEl.classList.remove('grab');
  });

  /* ================= STAGE + FOCUS (approved v3 "stage" design) =================
     Canvas coordinates stay the single spatial truth; stage mode is a SECOND
     PROJECTION of the same graph. Proxy directions derive from group centroids
     in ctx.state positions — the human's manual layout is the source of angles. */
  // spec.stage / spec.focusType carry the projection; only animation infra lives here
  const stageLayer = E.stageLayer;
  stageLayer.innerHTML = '<svg class="uf-swires" xmlns="http://www.w3.org/2000/svg"></svg>';

  /** the staged container plus every ancestor above it (the stage's frame set) */
  function stageFrameIds(): Set<string> {
    const ids = new Set<string>();
    if (!E.spec.stage) return ids;
    ids.add(E.spec.stage);
    let cur = E.U.get(E.spec.stage);
    const seen = new Set<string>();
    while (cur && cur.parent && !seen.has(cur.id)) { seen.add(cur.id); ids.add(cur.parent); cur = E.U.get(cur.parent); }
    return ids;
  }
  /** aggregation target for a proxy pill: the COARSEST ancestor of `outside`
      that does not contain the staged subtree — a sibling in the same group
      stays itself; a foreign subtree compresses into its top group */
  function proxyTargetOf(outside: string, frame: Set<string>): string {
    let cur = E.U.get(outside);
    const seen = new Set<string>();
    const chain: string[] = [];
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); chain.push(cur.id); cur = cur.parent ? E.U.get(cur.parent) : undefined; }
    for (let i = chain.length - 1; i >= 0; i--) if (!frame.has(chain[i])) return chain[i];
    return outside;
  }
  /** ancestor-or-self that is a DIRECT child of the staged container; null when outside it */
  function stageRepOf(id: string): string | null {
    let cur = E.U.get(id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.id === E.spec.stage) return null;
      if (cur.parent === E.spec.stage) return cur.id;
      cur = cur.parent ? E.U.get(cur.parent) : undefined;
    }
    return null;
  }
  /** mean center of a container subtree in ctx.state world coordinates */
  function centroidOf(rid: string): { x: number; y: number } {
    let sx = 0, sy = 0, count = 0;
    (function walk(id: string): void {
      const nd = E.ctx.state.nodes[id];
      if (nd) { sx += nd.x + nd.w / 2; sy += nd.y + nd.h / 2; count++; }
      (E.U.get(id)?.children ?? []).forEach(walk);
    })(rid);
    return count ? { x: sx / count, y: sy / count } : { x: 0, y: 0 };
  }
  const baseType = (s: string): string => {
    const i = s.indexOf(':');
    return (i >= 0 ? s.slice(i + 1) : s).trim().replace(/\[\]$/, '');
  };
  function carriesType(id: string, t: string): boolean {
    const node = E.U.get(id);
    if (!node) return false;
    return [...node.accepts, ...node.returns, ...node.state].some((x) => baseType(x) === t);
  }

  /** staggered fade-up entrance for newly-revealed cards; wires draw in after cards land */
  function enterStagger(): void {
    const els: HTMLElement[] = [];
    E.contentEl.querySelectorAll<HTMLElement>('.uf-card').forEach((el) => {
      if (!E.prevShown.has(el.dataset.id as string)) els.push(el);
    });
    els.forEach((el) => el.classList.add('uf-born'));
    els.forEach((el, i) => setTimeout(() => el.classList.add('uf-in'), 80 + i * 55));
    const done = 80 + els.length * 55 + 650;
    if (els.length) setTimeout(() => els.forEach((el) => el.classList.remove('uf-born', 'uf-in')), done + 60);
    E.wireEnterAt = els.length ? performance.now() + 80 + els.length * 55 + 250 : E.wireEnterAt;
    E.prevShown.clear();
    for (const el of E.contentEl.querySelectorAll<HTMLElement>('.uf-card')) E.prevShown.add(el.dataset.id as string);
  }

  /** focus illumination: selection glows, 1-hop neighbours lit, its wires flow, rest dims — no rebuild */
  function focusDim(): void {
    const blastOn = E.spec.layers.blast && !!E.spec.sel;
    E.overlay.querySelectorAll<HTMLElement>('.uf-card').forEach((el) => {
      const id = el.dataset.id as string;
      const sel = E.spec.sel === id;
      const lit = !!E.spec.focusType && carriesType(id, E.spec.focusType);
      const wep = !!E.spec.selWire && (E.spec.selWire.a === id || E.spec.selWire.b === id);   // U2: a selected wire lights its endpoints
      el.classList.toggle('sel', sel);
      el.classList.toggle('lit', lit || wep);
      el.classList.toggle('sel2', E.spec.sel2 === id);   // C7: secondary peek highlight
      if (!blastOn) {
        const nbr = !E.spec.focusType && !!E.spec.sel && !sel && E.isNeighbour(E.spec.sel, id);
        // C7: a peeked card is never dimmed, even while a primary sel is active
        const dim = (E.spec.focusType ? !lit : E.spec.selWire ? !wep : (E.spec.sel ? !sel && !nbr : false)) && id !== E.spec.sel2;
        el.classList.toggle('nbr', nbr);
        el.classList.toggle('dim', dim);
      }
    });
    // U6: a selected group frame carries the ring too (member cards handle their own dim)
    E.overlay.querySelectorAll<HTMLElement>('.uf-grp').forEach((el) =>
      el.classList.toggle('sel', E.spec.sel === el.dataset.id));
    E.overlay.querySelectorAll<HTMLElement>('.uf-t').forEach((s) =>
      s.classList.toggle('hit', s.dataset.t === E.spec.focusType));
  }

  /** animated reframe: consults the pure ufFitXform for the camera decision — a fit
      only for the first paint and the visible-set verbs (reveal / hide / foldAll);
      a toggleExpand repaint (repaintAction, set by render()) resolves to the prior
      transform, so folding/unfolding a group moves neither zoom nor focus. */
  function reframeToFit(): void {
    E.worldEl.classList.remove('anim');
    E.worldEl.classList.add('anim2');
    const next = ufFitXform(
      E.repaintAction, E.firstFit, E.viewXform, contentSize(),
      { width: E.stageEl.clientWidth, height: E.stageEl.clientHeight }, 64);
    E.viewXform.x = next.x; E.viewXform.y = next.y; E.viewXform.k = next.k;
    E.worldEl.style.transform = `translate(${E.viewXform.x}px,${E.viewXform.y}px) scale(${E.viewXform.k})`;
    setTimeout(() => E.worldEl.classList.remove('anim2'), 950);
  }

  /** type focus: every carrier module lights across the surface; inspector lists carriers */
  function typeFocus(t: string | null): void {
    E.commit({ type: 'focusType', t });
  }
  E.overlay.addEventListener('click', (e) => {
    const tk = (e.target as HTMLElement).closest('.uf-t') as HTMLElement | null;
    if (!tk) return;
    e.stopPropagation();
    typeFocus(E.spec.focusType === tk.dataset.t ? null : (tk.dataset.t as string));
  }, true);

  /** stage projection: focused group center-stage; explore world blurred behind. Exit restores explore exactly.
      (a projection change invalidates a wire selection — the reducer owns that rule) */
  function stageMode(gid: string | null): void {
    E.commit({ type: 'setStage', id: gid });
  }
  function renderStageGroup(dirFrom?: number): void {
    stageLayer.querySelectorAll('.uf-sgroup,.uf-proxy').forEach((x) => x.remove());
    const sWiresEl = E.sWiresEl;
    sWiresEl.innerHTML = '';
    if (!E.spec.stage) return;
    const stageU = E.gu(E.spec.stage);
    const crumbs = E.ancestorCrumbs(stageU);
    const sgroupEl = E.h('div', 'uf-sgroup',
      `<div class="uf-shead"><span class="uf-slabel">${esc(stageU.label)}</span>
        <span class="uf-strail">${esc(crumbs.join(' / '))}</span>
        <button class="uf-sleave">← explore</button></div>`);
    const wrap = E.h('div', 'uf-sbody');
    for (const kid of stageU.children) if (!E.spec.hidden.includes(kid)) wrap.appendChild(E.cardEl(E.gu(kid)));
    sgroupEl.appendChild(wrap);
    (sgroupEl.querySelector('.uf-sleave') as HTMLElement).onclick = () => {
      E.setSel(null); stageMode(null); E.renderInspector(); setTimeout(E.drawWires, 0);
    };
    if (dirFrom !== undefined) {
      sgroupEl.style.transition = 'none';
      sgroupEl.style.transform =
        `translate(calc(-50% + ${Math.round(Math.cos(dirFrom) * 70)}px),calc(-50% + ${Math.round(Math.sin(dirFrom) * 70)}px)) scale(.94)`;
      setTimeout(() => { sgroupEl.style.transition = ''; sgroupEl.style.transform = ''; }, 30);
    }
    stageLayer.appendChild(sgroupEl);
    stageProxies();
    setTimeout(E.drawStageWires, 60);
  }

  /** U4: silent stage refresh — rebuild the projection from CURRENT view state
      (layers, hidden, blast, selection) without replaying entrance transitions.
      Called by render() so both projections subscribe to the same state. */
  function refreshStage(): void {
    if (!E.spec.stage) return;
    const stageU = E.U.get(E.spec.stage);
    if (!stageU || !stageU.children.some((c) => !E.spec.hidden.includes(c))) {
      // staged container gone or emptied by reveal toggles — exit to explore
      stageMode(null);
      return;
    }
    renderStageGroup(undefined);
    const settle = (el: HTMLElement): void => {
      el.style.transition = 'none';
      el.style.transitionDelay = '0ms';
      el.style.opacity = '1';
      setTimeout(() => { el.style.transition = ''; el.style.transitionDelay = ''; el.style.opacity = ''; }, 40);
    };
    const sgroupEl = stageLayer.querySelector('.uf-sgroup') as HTMLElement | null;
    if (sgroupEl) settle(sgroupEl);
    stageLayer.querySelectorAll<HTMLElement>('.uf-proxy').forEach(settle);
  }

  /** directional proxy pills: external edges aggregate per target container; angle = true angle between centroids.
      Edge-granularity honesty: cross-module edges in this model attach at MODULE level, so an edge incident to the
      staged container itself or its ancestor chain is FRAME-attributed (no child anchor) — without that a staged
      sub-group shows no connections at all. Child-attributed links obey the selection filter; frame links persist. */
  interface PLink { inside: string | null; outside: string }
  interface ProxyEntry { og: string; links: PLink[]; ang: number }
  /** one external link per edge crossing the stage frame, aggregated to its
      coarsest foreign container — the raw material stageProxies lays out */
  function collectProxyLinks(frameIds: Set<string>): Map<string, PLink[]> {
    const byRoot = new Map<string, PLink[]>();
    for (const edge of E.EDGES) {
      const ra = stageRepOf(edge.from), rb = stageRepOf(edge.to);
      let inside: string | null = null, outside: string | null = null;
      if ((ra || frameIds.has(edge.from)) && !rb && !frameIds.has(edge.to)) { inside = ra; outside = edge.to; }
      else if ((rb || frameIds.has(edge.to)) && !ra && !frameIds.has(edge.from)) { inside = rb; outside = edge.from; }
      else continue;
      // U3: pill set is STABLE across selection — selection is expressed in the wires, not by mutating the pills
      if (stageRepOf(outside)) continue; // inside the staged subtree after all
      const og = proxyTargetOf(outside, frameIds);
      if (!byRoot.has(og)) byRoot.set(og, []);
      (byRoot.get(og) as PLink[]).push({ inside, outside });
    }
    return byRoot;
  }
  /** de-overlap pass: a near-1-D editor layout clusters the true angles; spread pills
      apart while preserving the true angular ORDER (the spatial meaning the human laid out) */
  function deoverlapAngles(entries: ProxyEntry[], minSep: number): void {
    for (let pass = 0; pass < 24 && entries.length > 1; pass++) {
      let moved = false;
      for (let j = 0; j < entries.length; j++) {
        const p1 = entries[j], p2 = entries[(j + 1) % entries.length];
        let gap = p2.ang - p1.ang;
        if (j === entries.length - 1) gap += Math.PI * 2;
        if (gap < minSep - 1e-4) { const push = (minSep - gap) / 2; p1.ang -= push; p2.ang += push; moved = true; }
      }
      if (!moved) break;
    }
  }
  /** one directional proxy pill element, placed on the ring around the staged group */
  function buildProxyEl(entry: ProxyEntry, center: { cx: number; cy: number; radius: number }, delayIndex: number): HTMLElement {
    const { og, links, ang } = entry;
    const pillEl = E.h('div', 'uf-proxy');
    pillEl.dataset.gid = og;
    pillEl.dataset.ang = String(ang);
    if (links.some((l) => l.inside === null)) pillEl.dataset.frame = '1';
    const gl = E.gu(og).label;
    const names = [...new Set(links.map((l) => E.U.get(l.outside)?.label ?? l.outside))].filter((n) => n !== gl);
    pillEl.innerHTML = `<span class="uf-pdot"></span>${names.length ? `<span>${esc(names.slice(0, 3).join(', '))}${names.length > 3 ? ' +' + (names.length - 3) : ''}</span>` : ''}
      <span class="uf-pgrp">${esc(gl)}</span>`;
    pillEl.style.left = (center.cx + Math.cos(ang) * center.radius * 1.05) + 'px';
    pillEl.style.top = (center.cy + Math.sin(ang) * center.radius * .9) + 'px';
    pillEl.style.transitionDelay = (120 + delayIndex * 70) + 'ms';
    pillEl.onclick = (e) => { e.stopPropagation(); peekProxy(pillEl, og, links.map((l) => l.outside), ang); };
    return pillEl;
  }
  function stageProxies(): void {
    stageLayer.querySelectorAll('.uf-proxy').forEach((p) => p.remove());
    if (!E.spec.stage) return;
    const frameIds = stageFrameIds();
    const byRoot = collectProxyLinks(frameIds);
    const cx = E.stageEl.clientWidth / 2, cy = E.stageEl.clientHeight / 2;
    let radius = Math.min(E.stageEl.clientWidth, E.stageEl.clientHeight) * .40;
    // C3: floor the ring so the smaller (0.9) vertical placement scale still clears the
    // staged panel. ponytail: circumscribed-circle clearance — uses the panel half-diagonal,
    // generous for very rectangular panels but guarantees zero pill/panel overlap; tighten to
    // per-pill panel-edge distance only if pills look too far.
    const sgroupEl = stageLayer.querySelector('.uf-sgroup') as HTMLElement | null;
    if (sgroupEl) {
      const gr = sgroupEl.getBoundingClientRect();
      const GAP = 40;
      const panelHalfDiag = 0.5 * Math.hypot(gr.width, gr.height);
      radius = Math.max(radius, (panelHalfDiag + GAP) / 0.9);
    }
    const center = centroidOf(E.spec.stage);
    const entries = [...byRoot.entries()].map(([og, links]) => {
      const other = centroidOf(og);
      return { og, links, ang: Math.atan2(other.y - center.y, other.x - center.x) };
    }).sort((x, y) => x.ang - y.ang);
    const minSep = Math.min(.55, (Math.PI * 2) / Math.max(entries.length, 1));
    deoverlapAngles(entries, minSep);
    entries.forEach((entry, i) => stageLayer.appendChild(buildProxyEl(entry, { cx, cy, radius }, i)));
  }

  /** peek → travel: proxy expands in place; explicit travel swaps the target group onto stage from its direction */
  function peekProxy(p: HTMLElement, og: string, outs: string[], ang: number): void {
    if (p.classList.contains('peek')) return;
    stageLayer.querySelectorAll('.uf-proxy.peek').forEach((q2) => { q2.remove(); });
    p.classList.add('peek');
    p.style.transitionDelay = '0ms';
    const uniq = [...new Set(outs)];
    const ogu = E.gu(og);
    const members = uniq.filter((m) => m !== og);
    const body = members.length
      ? members.slice(0, 4).map((m) => {
          const um = E.U.get(m);
          return `<div class="uf-pdesc"><b>${esc(um?.label ?? m)}</b>${um?.desc ? ' — ' + esc(um.desc) : ''}</div>`;
        }).join('')
      : `<div class="uf-pdesc">${ogu.desc ? esc(ogu.desc) : `${ogu.children.length} inside · fan-in ${ogu.fanIn}`}</div>`;
    p.innerHTML = `<span class="uf-ptitle">${esc(ogu.label)}</span>${body}<button class="uf-ptravel">travel →</button>`;
    (p.querySelector('.uf-ptravel') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      E.setSel(uniq[0] && E.gu(og).children.includes(uniq[0]) ? uniq[0] : null);
      stageTravel(og, ang);
    };
    p.onclick = (e) => { e.stopPropagation(); p.remove(); stageProxies(); setTimeout(E.drawStageWires, 0); };
  }
  function stageTravel(target: string, fromAngle: number): void {
    if (!E.U.has(target)) return;
    if (!E.gu(target).children.length) {
      // a childless module has nothing to project — land in explore with it selected
      E.apply({ type: 'setStage', id: null }, { type: 'reveal', id: target });
      E.setSel(target);
      E.overlay.classList.remove('staged');
      E.render(true);
      return;
    }
    E.apply({ type: 'setStage', id: target });
    E.overlay.classList.add('staged');
    renderStageGroup(fromAngle + Math.PI);
    focusDim();
    E.renderTree();
    E.renderInspector();
  }

  E.contentSize = contentSize;
  E.fitView = fitView;
  E.clampPan = clampPan;
  E.setT = setT;
  E.reframeToFit = reframeToFit;
  E.enterStagger = enterStagger;
  E.focusDim = focusDim;
  E.typeFocus = typeFocus;
  E.stageMode = stageMode;
  E.renderStageGroup = renderStageGroup;
  E.refreshStage = refreshStage;
  E.stageRepOf = stageRepOf;
  E.stageFrameIds = stageFrameIds;
  E.proxyTargetOf = proxyTargetOf;
  E.carriesType = carriesType;
}
