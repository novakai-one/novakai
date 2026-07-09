/* =====================================================================
   planner-diagram.ts — the review CANVAS: level layout, camera (pan/zoom
   fit), edge drawing (real + ghost + dependency), node drawing, breadcrumb
   and the coherence banner — split out of planner.ts in place. Every symbol
   here used to be a closure over initPlanner's locals; those locals now live
   on the shared `E: PEnv` object planner.ts constructs and passes to every
   sibling factory, and this factory attaches its own functions back onto `E`
   so the other siblings (and planner.ts itself) can call them.
   ===================================================================== */

import type { DiagramNode } from '../../core/types/types';
import { childIdsOf } from '../../core/state/state';
import {
  coherenceWarnings, levelPositions,
  type PlanChange, type PlanLayoutNode,
} from '../../core/plan/plan';
import type { PEnv } from './planner';

const KIND_FILL: Record<string, string> = {
  module: '#39456b', function: '#2d3a59', type: '#473a5d', store: '#3a4d48',
  service: '#3a4d48', hook: '#2d3a59', class: '#39456b', component: '#39456b', event: '#3a4d48',
};
const STATUS_COL: Record<string, string> = { existing: '#566089', add: '#5bd6a0', modify: '#e0a44a', remove: '#e06a6a' };
// SVG attribute names repeated across edge-drawing branches (sonarjs/no-duplicate-string).
const ATTR_DASHARRAY = 'stroke-dasharray';
const ATTR_STROKE_WIDTH = 'stroke-width';

type Center = (id: string) => { x: number; y: number };

// per-node draw-time context (box size + layout + focus/coherence sets), bundled to
// keep drawNode and its helpers under the max-params limit.
type NodeRenderCtx = {
  pos: Record<string, { x: number; y: number }>;
  boxWidth: number;
  boxHeight: number;
  lit: Set<string> | null;
  warns: Set<string>;
};

export function initPlannerDiagram(E: PEnv): void {
  /* =================== layout =================== */
  /**
   * D1 — layout fidelity: the review canvas mirrors the human's REAL ctx.state
   * positions (the live canvas), never a re-simulated force layout. Real nodes
   * use their verbatim (x, y); only synth add-nodes get a computed slot. The
   * placement rule is the pure levelPositions() in core/plan, so it is testable.
   */
  function layoutLevel(): Record<string, { x: number; y: number }> {
    const key = E.level ?? '__top__';
    if (E.posCache[key]) return E.posCache[key];
    const ids = E.levelNodes();
    const lnodes: PlanLayoutNode[] = ids.map((id) => {
      const real = E.ctx.state.nodes[id];
      if (real) return { id, x: real.x, y: real.y, synth: false };
      const synNode = E.synth[id];
      return { id, x: 0, y: 0, parent: synNode?.parent ?? null, synth: true };
    });
    const pos = levelPositions(lnodes);
    E.posCache[key] = pos;
    return pos;
  }

  /* =================== camera =================== */
  function applyT(): void { E.$('plWorld').setAttribute('transform', `translate(${E.tx},${E.ty}) scale(${E.k})`); }
  function fit(): void {
    const wrap = E.$('plCanvas'); const wrapW = wrap.clientWidth, wrapH = wrap.clientHeight;
    const pos = layoutLevel(); const pts = Object.values(pos); if (!pts.length) { applyT(); return; }
    const pad = 80;
    const x0 = Math.min(...pts.map((pt) => pt.x)) - pad, x1 = Math.max(...pts.map((pt) => pt.x)) + 180 + pad;
    const y0 = Math.min(...pts.map((pt) => pt.y)) - pad, y1 = Math.max(...pts.map((pt) => pt.y)) + 60 + pad;
    E.k = Math.min(wrapW / (x1 - x0), wrapH / (y1 - y0), 1.4);
    E.tx = (wrapW - (x1 - x0) * E.k) / 2 - x0 * E.k; E.ty = (wrapH - (y1 - y0) * E.k) / 2 - y0 * E.k; applyT();
  }
  /* =================== render =================== */

  /** focus set — selecting a node lights its direct neighbours, dims the rest. */
  function computeLitSet(idset: Set<string>): Set<string> | null {
    if (!E.sel || !idset.has(E.sel)) return null;
    const lit = new Set([E.sel]);
    E.ctx.state.edges.forEach((edge) => { if (edge.from === E.sel && idset.has(edge.to)) lit.add(edge.to); if (edge.to === E.sel && idset.has(edge.from)) lit.add(edge.from); });
    return lit;
  }

  /** real edges within the current level. */
  function drawRealEdges(eg: HTMLElement, idset: Set<string>, center: Center, lit: Set<string> | null): void {
    E.ctx.state.edges.forEach((edge) => {
      if (!idset.has(edge.from) || !idset.has(edge.to)) return;
      const ptFrom = center(edge.from), ptTo = center(edge.to); const mx = (ptFrom.x + ptTo.x) / 2;
      const path = E.el('path'); path.setAttribute('d', `M${ptFrom.x},${ptFrom.y} C ${mx},${ptFrom.y} ${mx},${ptTo.y} ${ptTo.x},${ptTo.y}`);
      const dim = lit && !(lit.has(edge.from) && lit.has(edge.to));
      path.setAttribute('class', 'pl-edge ' + (dim ? 'pl-faded' : 'pl-full'));
      path.setAttribute('stroke', edge.style === 'dotted' ? '#39426b' : '#54608a');
      if (edge.style === 'dotted') path.setAttribute(ATTR_DASHARRAY, '4 4');
      eg.appendChild(path);
    });
  }

  /** plan EDGE changes within the current level (ghost edges, selectable). */
  function drawPlanGhostEdges(eg: HTMLElement, idset: Set<string>, center: Center): void {
    E.plan.changes.filter((chg) => chg.target.kind === 'edge' && chg.newEdge).forEach((chg) => {
      const { from, to } = chg.newEdge!;
      if (!idset.has(from) || !idset.has(to)) return;
      const ptFrom = center(from), ptTo = center(to); const mx = (ptFrom.x + ptTo.x) / 2;
      const path = E.el('path'); path.setAttribute('d', `M${ptFrom.x},${ptFrom.y} C ${mx},${ptFrom.y} ${mx},${ptTo.y} ${ptTo.x},${ptTo.y}`);
      path.setAttribute('class', 'pl-edge pl-nodeg ' + (E.phaseFocus && chg.phase !== E.phaseFocus ? 'pl-faded' : 'pl-full'));
      path.setAttribute('stroke', STATUS_COL[chg.status]); path.setAttribute(ATTR_STROKE_WIDTH, '2.4'); path.setAttribute(ATTR_DASHARRAY, '7 4');
      if (E.sel === chg.target.ref) path.setAttribute(ATTR_STROKE_WIDTH, '3.4');
      path.addEventListener('click', (ev) => { ev.stopPropagation(); E.select(chg.target.ref); });
      eg.appendChild(path);
    });
  }

  /** dependency arrows between visible change nodes (amber dashed). */
  function drawDependencyArrows(eg: HTMLElement, idset: Set<string>, center: Center): void {
    E.plan.changes.forEach((chg) => {
      if (!chg.dependsOn?.length || chg.target.kind !== 'node' || !idset.has(chg.target.ref)) return;
      chg.dependsOn.forEach((depId) => {
        const dep = E.byId[depId]; if (!dep || dep.target.kind !== 'node' || !idset.has(dep.target.ref)) return;
        const ptFrom = center(dep.target.ref), ptTo = center(chg.target.ref); const mx = (ptFrom.x + ptTo.x) / 2;
        const path = E.el('path'); path.setAttribute('d', `M${ptFrom.x},${ptFrom.y} C ${mx},${ptFrom.y} ${mx},${ptTo.y} ${ptTo.x},${ptTo.y}`);
        path.setAttribute('class', 'pl-edge pl-full'); path.setAttribute('stroke', '#7a6a3a'); path.setAttribute(ATTR_DASHARRAY, '2 5'); path.setAttribute(ATTR_STROKE_WIDTH, '1.6');
        eg.appendChild(path);
      });
    });
  }

  /** whether a node should render dimmed (out of focus / out of the active phase). */
  function isNodeDimmed(id: string, ch: PlanChange | undefined, lit: Set<string> | null): boolean {
    return (!!lit && !lit.has(id)) || (E.planOn && !!E.phaseFocus && !!ch && ch.phase !== E.phaseFocus) || (E.planOn && !!E.phaseFocus && !ch && id !== E.sel);
  }

  /** node box fill — change-status tint, else the kind's base colour. */
  function nodeFillColor(ch: PlanChange | undefined, nd: DiagramNode): string {
    if (!ch) return KIND_FILL[nd.kind ?? 'module'] || KIND_FILL.module;
    if (ch.status === 'add') return '#16332544';
    if (ch.status === 'remove') return '#33161644';
    return '#33301644';
  }

  /** node subtitle — change status, else synth "new", else the real kind (+ fn count at top level). */
  function nodeSubtitleText(ch: PlanChange | undefined, nd: DiagramNode, id: string, nfn: number): string {
    if (ch) return ch.status.toUpperCase() + (ch.phase ? ' · P' + ch.phase : '');
    if (E.synth[id]) return 'new · ' + (nd.kind ?? 'module');
    return (nd.kind ?? '') + (E.level === null && nfn ? ` · ${nfn} fns` : '');
  }

  /** top-right mark: a coherence warning wins over a plain accept/reject verdict mark. */
  function appendStatusMark(grp: SVGElement, id: string, ch: PlanChange | undefined, rc: NodeRenderCtx): void {
    if (rc.warns.has(E.byRef[id]?.id ?? '')) {
      const warn = E.el('text'); warn.setAttribute('x', String(rc.boxWidth - 11)); warn.setAttribute('y', '17'); warn.setAttribute('text-anchor', 'end'); warn.setAttribute('class', 'pl-text'); warn.setAttribute('font-size', '13'); warn.setAttribute('fill', '#e06a6a'); warn.textContent = '⚠'; grp.appendChild(warn);
      return;
    }
    if (ch && E.verdicts[ch.id]) {
      const vm = E.el('text'); vm.setAttribute('x', String(rc.boxWidth - 11)); vm.setAttribute('y', '17'); vm.setAttribute('text-anchor', 'end'); vm.setAttribute('class', 'pl-text'); vm.setAttribute('font-size', '13'); vm.setAttribute('fill', E.verdicts[ch.id] === 'accept' ? '#5bd6a0' : '#e06a6a'); vm.textContent = E.verdicts[ch.id] === 'accept' ? '✓' : '✕'; grp.appendChild(vm);
    }
  }

  /** selection outline around the node, only for the currently-selected id. */
  function appendSelectionOutline(grp: SVGElement, id: string, rc: NodeRenderCtx): void {
    if (E.sel !== id) return;
    const sr = E.el('rect'); sr.setAttribute('class', 'pl-seln'); sr.setAttribute('x', '-4'); sr.setAttribute('y', '-4'); sr.setAttribute('width', String(rc.boxWidth + 8)); sr.setAttribute('height', String(rc.boxHeight + 8)); sr.setAttribute('rx', '12'); grp.appendChild(sr);
  }

  /** draw one node group (box + pip + label + status mark + selection outline). */
  function drawNode(ng: HTMLElement, id: string, rc: NodeRenderCtx): void {
    const nd = E.node(id)!; const pt = rc.pos[id] || { x: 0, y: 0 };
    const ch = E.planOn ? E.byRef[id] : undefined;
    const grp = E.el('g');
    grp.setAttribute('class', 'pl-nodeg ' + (isNodeDimmed(id, ch, rc.lit) ? 'pl-faded' : 'pl-full'));
    grp.setAttribute('transform', `translate(${pt.x},${pt.y})`);
    const rect = E.el('rect'); rect.setAttribute('width', String(rc.boxWidth)); rect.setAttribute('height', String(rc.boxHeight)); rect.setAttribute('rx', '9');
    rect.setAttribute('fill', nodeFillColor(ch, nd));
    rect.setAttribute('stroke', ch ? STATUS_COL[ch.status] : '#2a3042'); rect.setAttribute(ATTR_STROKE_WIDTH, ch ? '2' : '1.5');
    grp.appendChild(rect);
    if (ch) { const pip = E.el('rect'); pip.setAttribute('width', '5'); pip.setAttribute('height', String(rc.boxHeight)); pip.setAttribute('rx', '2'); pip.setAttribute('fill', STATUS_COL[ch.status]); grp.appendChild(pip); }
    const titleEl = E.el('text'); titleEl.setAttribute('x', '14'); titleEl.setAttribute('y', E.level === null ? '23' : '20'); titleEl.setAttribute('class', 'pl-text'); titleEl.setAttribute('font-size', '13'); titleEl.setAttribute('font-weight', '600'); titleEl.textContent = nd.label; grp.appendChild(titleEl);
    const sub = E.el('text'); sub.setAttribute('x', '14'); sub.setAttribute('y', E.level === null ? '41' : '36'); sub.setAttribute('class', 'pl-text'); sub.setAttribute('font-size', '9.5'); sub.setAttribute('fill', '#8b93a7');
    const nfn = childIdsOf(E.ctx.state, id).filter((cid) => E.ctx.state.nodes[cid].shape !== 'group').length;
    sub.textContent = nodeSubtitleText(ch, nd, id, nfn);
    grp.appendChild(sub);
    appendStatusMark(grp, id, ch, rc);
    appendSelectionOutline(grp, id, rc);
    grp.addEventListener('click', (ev) => { ev.stopPropagation(); E.select(id); });
    grp.addEventListener('dblclick', (ev) => { ev.stopPropagation(); if (E.level === null && nfn) drill(id); });
    ng.appendChild(grp);
  }

  /** breadcrumb — top level, or drilled-in unit with a link back to top. */
  function renderCrumb(ids: string[]): void {
    if (E.level === null) E.$('plCrumb').innerHTML = `<b>top level</b> · ${ids.length} modules`;
    else E.$('plCrumb').innerHTML = `<span class="pl-crumblink" id="plToTop">top level</span> › <b>${E.node(E.level)!.label}</b> · ${ids.length} units`;
    const tt = document.getElementById('plToTop'); if (tt) tt.onclick = toTop;
  }

  /** banner listing any dependency-incoherent verdicts. */
  function renderCoherenceBanner(): void {
    const cw = coherenceWarnings(E.plan, E.verdicts);
    const banner = E.$('plWarnBanner');
    if (cw.length) { banner.style.display = 'block'; banner.textContent = `⚠ ${cw.length} incoherent verdict${cw.length > 1 ? 's' : ''}: ` + cw.map((warn) => warn.changeId).join(', '); }
    else banner.style.display = 'none';
  }

  function render(): void {
    const ng = E.$('plNodes'), eg = E.$('plEdges'); ng.innerHTML = ''; eg.innerHTML = '';
    const ids = E.levelNodes(); const idset = new Set(ids); const pos = layoutLevel();
    const boxWidth = 180, boxHeight = E.level === null ? 54 : 46;
    const center: Center = (id) => { const pt = pos[id] || { x: 0, y: 0 }; return { x: pt.x + boxWidth / 2, y: pt.y + boxHeight / 2 }; };

    const lit = computeLitSet(idset);
    drawRealEdges(eg, idset, center, lit);
    if (E.planOn) {
      drawPlanGhostEdges(eg, idset, center);
      drawDependencyArrows(eg, idset, center);
    }

    const warns = new Set(coherenceWarnings(E.plan, E.verdicts).map((warn) => warn.changeId));
    const rc: NodeRenderCtx = { pos, boxWidth, boxHeight, lit, warns };
    ids.forEach((id) => drawNode(ng, id, rc));

    renderCrumb(ids);
    renderCoherenceBanner();
  }

  /* =================== drill =================== */
  function drill(id: string): void { E.level = id; E.sel = null; fit(); render(); E.renderInfo(); }
  function toTop(): void { E.level = null; E.sel = null; fit(); render(); E.renderInfo(); }

  E.applyT = applyT;
  E.fit = fit;
  E.render = render;
  E.toTop = toTop;
}
