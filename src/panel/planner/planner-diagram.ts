/* =====================================================================
   planner-diagram.ts — the review CANVAS: level layout, camera (pan/zoom
   fit), edge drawing (real + ghost + dependency), node drawing, breadcrumb
   and the coherence banner — split out of planner.ts in place. Every symbol
   here used to be a closure over initPlanner's locals; those locals now live
   on the shared `E: PEnv` object planner.ts constructs and passes to every
   sibling factory, and this factory attaches its own functions back onto `E`
   so the other siblings (and planner.ts itself) can call them.

   The render pipeline below is plain module-scope helpers threaded an
   explicit `env: PEnv` (rather than closures) so each step stays small and
   independently readable; only the four functions PEnv itself depends on
   (applyT/fit/render/toTop) stay as inner delegates assigned back onto `env`.
   ===================================================================== */

import type { DiagramEdge, DiagramNode } from '../../core/types/types';
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
const STATUS_COL: Record<string, string> = {
  existing: '#566089', add: '#5bd6a0', modify: '#e0a44a', remove: '#e06a6a',
};
// SVG attribute names repeated across edge-drawing branches (sonarjs/no-duplicate-string).
const ATTR_DASHARRAY = 'stroke-dasharray';
const ATTR_STROKE_WIDTH = 'stroke-width';
// node box width never varies by level (only height does) — one shared constant.
const BOX_WIDTH = 180;

type Center = (id: string) => { x: number; y: number };

// per-edge draw-time context (env + visible id set + centre lookup), bundled to
// keep the edge-drawing helpers under the max-params limit.
type EdgeRenderCtx = { env: PEnv; idset: Set<string>; center: Center; boxHeight: number };

// per-node draw-time context (env + layout + focus/coherence sets), bundled to
// keep drawNode and its helpers under the max-params limit.
type NodeRenderCtx = {
  env: PEnv;
  pos: Record<string, { x: number; y: number }>;
  boxHeight: number;
  lit: Set<string> | null;
  warns: Set<string>;
};

/* =================== layout =================== */
/**
 * D1 — layout fidelity: the review canvas mirrors the human's REAL ctx.state
 * positions (the live canvas), never a re-simulated force layout. Real nodes
 * use their verbatim (x, y); only synth add-nodes get a computed slot. The
 * placement rule is the pure levelPositions() in core/plan, so it is testable.
 */
function layoutLevel(env: PEnv): Record<string, { x: number; y: number }> {
  const key = env.level ?? '__top__';
  if (env.posCache[key]) return env.posCache[key];
  const ids = env.levelNodes();
  const lnodes: PlanLayoutNode[] = ids.map((id) => {
    const real = env.ctx.state.nodes[id];
    if (real) return { id, x: real.x, y: real.y, synth: false };
    const synNode = env.synth[id];
    return { id, x: 0, y: 0, parent: synNode?.parent ?? null, synth: true };
  });
  const pos = levelPositions(lnodes);
  env.posCache[key] = pos;
  return pos;
}

/* =================== camera =================== */
function drawCamera(env: PEnv): void {
  env.$('plWorld').setAttribute('transform', `translate(${env.tx},${env.ty}) scale(${env.k})`);
}

/** world-space bounding box of a set of layout points, padded for the fit. */
function boundsOf(pts: { x: number; y: number }[]): { xMin: number; xMax: number; yMin: number; yMax: number } {
  const pad = 80;
  const xMin = Math.min(...pts.map((point) => point.x)) - pad;
  const xMax = Math.max(...pts.map((point) => point.x)) + 180 + pad;
  const yMin = Math.min(...pts.map((point) => point.y)) - pad;
  const yMax = Math.max(...pts.map((point) => point.y)) + 60 + pad;
  return { xMin, xMax, yMin, yMax };
}

function fitCamera(env: PEnv): void {
  const wrap = env.$('plCanvas');
  const { clientWidth: wrapW, clientHeight: wrapH } = wrap;
  const pos = layoutLevel(env);
  const pts = Object.values(pos);
  if (!pts.length) {
    drawCamera(env);
    return;
  }
  const { xMin, xMax, yMin, yMax } = boundsOf(pts);
  env.k = Math.min(wrapW / (xMax - xMin), wrapH / (yMax - yMin), 1.4);
  env['tx'] = (wrapW - (xMax - xMin) * env.k) / 2 - xMin * env.k;
  env['ty'] = (wrapH - (yMax - yMin) * env.k) / 2 - yMin * env.k;
  drawCamera(env);
}

/* =================== render =================== */

/** focus set — selecting a node lights its direct neighbours, dims the rest. */
function computeLitSet(env: PEnv, idset: Set<string>): Set<string> | null {
  if (!env.sel || !idset.has(env.sel)) return null;
  const lit = new Set([env.sel]);
  env.ctx.state.edges.forEach((edge) => {
    if (edge.from === env.sel && idset.has(edge.to)) lit.add(edge.to);
    if (edge.to === env.sel && idset.has(edge.from)) lit.add(edge.from);
  });
  return lit;
}

/** shared bezier path data for the three edge kinds below (real / ghost / dependency). */
function edgePathD(from: { x: number; y: number }, dst: { x: number; y: number }): string {
  const midX = (from.x + dst.x) / 2;
  return `M${from.x},${from.y} C ${midX},${from.y} ${midX},${dst.y} ${dst.x},${dst.y}`;
}

function buildRealEdgePath(ectx: EdgeRenderCtx, edge: DiagramEdge, lit: Set<string> | null): SVGElement {
  const path = ectx.env.el('path');
  path.setAttribute('d', edgePathD(ectx.center(edge.from), ectx.center(edge.to)));
  const dim = lit && !(lit.has(edge.from) && lit.has(edge.to));
  path.setAttribute('class', 'pl-edge ' + (dim ? 'pl-faded' : 'pl-full'));
  path.setAttribute('stroke', edge.style === 'dotted' ? '#39426b' : '#54608a');
  if (edge.style === 'dotted') path.setAttribute(ATTR_DASHARRAY, '4 4');
  return path;
}

/** real edges within the current level. */
function drawRealEdges(edgeGrp: HTMLElement, ectx: EdgeRenderCtx, lit: Set<string> | null): void {
  ectx.env.ctx.state.edges.forEach((edge) => {
    if (!ectx.idset.has(edge.from) || !ectx.idset.has(edge.to)) return;
    edgeGrp.appendChild(buildRealEdgePath(ectx, edge, lit));
  });
}

function buildGhostEdgePath(ectx: EdgeRenderCtx, chg: PlanChange, from: string, dst: string): SVGElement {
  const env = ectx.env;
  const path = env.el('path');
  path.setAttribute('d', edgePathD(ectx.center(from), ectx.center(dst)));
  const faded = env.phaseFocus && chg.phase !== env.phaseFocus;
  path.setAttribute('class', 'pl-edge pl-nodeg ' + (faded ? 'pl-faded' : 'pl-full'));
  path.setAttribute('stroke', STATUS_COL[chg.status]);
  path.setAttribute(ATTR_STROKE_WIDTH, env.sel === chg.target.ref ? '3.4' : '2.4');
  path.setAttribute(ATTR_DASHARRAY, '7 4');
  return path;
}

function appendGhostEdge(edgeGrp: HTMLElement, ectx: EdgeRenderCtx, chg: PlanChange): void {
  const { from, to: dst } = chg.newEdge!;
  if (!ectx.idset.has(from) || !ectx.idset.has(dst)) return;
  const path = buildGhostEdgePath(ectx, chg, from, dst);
  path.addEventListener('click', (evt) => {
    evt.stopPropagation();
    ectx.env.select(chg.target.ref);
  });
  edgeGrp.appendChild(path);
}

/** plan EDGE changes within the current level (ghost edges, selectable). */
function drawPlanGhostEdges(edgeGrp: HTMLElement, ectx: EdgeRenderCtx): void {
  ectx.env.plan.changes
    .filter((chg) => chg.target.kind === 'edge' && chg.newEdge)
    .forEach((chg) => appendGhostEdge(edgeGrp, ectx, chg));
}

function appendDependencyArrow(edgeGrp: HTMLElement, ectx: EdgeRenderCtx, chg: PlanChange, depId: string): void {
  const dep = ectx.env.byId[depId];
  if (!dep || dep.target.kind !== 'node' || !ectx.idset.has(dep.target.ref)) return;
  const path = ectx.env.el('path');
  path.setAttribute('d', edgePathD(ectx.center(dep.target.ref), ectx.center(chg.target.ref)));
  path.setAttribute('class', 'pl-edge pl-full');
  path.setAttribute('stroke', '#7a6a3a');
  path.setAttribute(ATTR_DASHARRAY, '2 5');
  path.setAttribute(ATTR_STROKE_WIDTH, '1.6');
  edgeGrp.appendChild(path);
}

function appendDependencyArrowsFor(edgeGrp: HTMLElement, ectx: EdgeRenderCtx, chg: PlanChange): void {
  if (!chg.dependsOn?.length || chg.target.kind !== 'node' || !ectx.idset.has(chg.target.ref)) return;
  chg.dependsOn.forEach((depId) => appendDependencyArrow(edgeGrp, ectx, chg, depId));
}

/** dependency arrows between visible change nodes (amber dashed). */
function drawDependencyArrows(edgeGrp: HTMLElement, ectx: EdgeRenderCtx): void {
  ectx.env.plan.changes.forEach((chg) => appendDependencyArrowsFor(edgeGrp, ectx, chg));
}

function drawEdges(edgeGrp: HTMLElement, ectx: EdgeRenderCtx, lit: Set<string> | null): void {
  drawRealEdges(edgeGrp, ectx, lit);
  if (ectx.env.planOn) {
    drawPlanGhostEdges(edgeGrp, ectx);
    drawDependencyArrows(edgeGrp, ectx);
  }
}

/** number of real (non-group) children — used for the top-level "N fns" subtitle and drill-in gating. */
function unitChildCount(env: PEnv, id: string): number {
  return childIdsOf(env.ctx.state, id).filter((cid) => env.ctx.state.nodes[cid].shape !== 'group').length;
}

/** whether a node should render dimmed (out of focus / out of the active phase). */
function isNodeDimmed(renderCtx: NodeRenderCtx, id: string, chg: PlanChange | undefined): boolean {
  const env = renderCtx.env;
  if (renderCtx.lit && !renderCtx.lit.has(id)) return true;
  if (env.planOn && env.phaseFocus && chg && chg.phase !== env.phaseFocus) return true;
  return env.planOn && !!env.phaseFocus && !chg && id !== env.sel;
}

/** node box fill — change-status tint, else the kind's base colour. */
function nodeFillColor(chg: PlanChange | undefined, node: DiagramNode): string {
  if (!chg) return KIND_FILL[node.kind ?? 'module'] || KIND_FILL.module;
  if (chg.status === 'add') return '#16332544';
  if (chg.status === 'remove') return '#33161644';
  return '#33301644';
}

/** node subtitle — change status, else synth "new", else the real kind (+ fn count at top level). */
function nodeSubtitleText(renderCtx: NodeRenderCtx, id: string, chg: PlanChange | undefined): string {
  const env = renderCtx.env;
  if (chg) return chg.status.toUpperCase() + (chg.phase ? ' · P' + chg.phase : '');
  if (env.synth[id]) return 'new · ' + (env.node(id)!.kind ?? 'module');
  const node = env.node(id)!;
  const nfn = unitChildCount(env, id);
  return (node.kind ?? '') + (env.level === null && nfn ? ` · ${nfn} fns` : '');
}

function buildMarkText(renderCtx: NodeRenderCtx, glyph: string, fill: string): SVGElement {
  const mark = renderCtx.env.el('text');
  mark.setAttribute('x', String(BOX_WIDTH - 11));
  mark.setAttribute('y', '17');
  mark.setAttribute('text-anchor', 'end');
  mark.setAttribute('class', 'pl-text');
  mark.setAttribute('font-size', '13');
  mark.setAttribute('fill', fill);
  mark.textContent = glyph;
  return mark;
}

/** top-right mark: a coherence warning wins over a plain accept/reject verdict mark. */
function appendStatusMark(grp: SVGElement, renderCtx: NodeRenderCtx, id: string, chg: PlanChange | undefined): void {
  const ref = renderCtx.env.byRef[id]?.id ?? '';
  if (renderCtx.warns.has(ref)) {
    grp.appendChild(buildMarkText(renderCtx, '⚠', '#e06a6a'));
    return;
  }
  if (chg && renderCtx.env.verdicts[chg.id]) {
    const accepted = renderCtx.env.verdicts[chg.id] === 'accept';
    grp.appendChild(buildMarkText(renderCtx, accepted ? '✓' : '✕', accepted ? '#5bd6a0' : '#e06a6a'));
  }
}

/** selection outline around the node, only for the currently-selected id. */
function appendSelectionOutline(grp: SVGElement, renderCtx: NodeRenderCtx, id: string): void {
  if (renderCtx.env.sel !== id) return;
  const outline = renderCtx.env.el('rect');
  outline.setAttribute('class', 'pl-seln');
  outline.setAttribute('x', '-4');
  outline.setAttribute('y', '-4');
  outline.setAttribute('width', String(BOX_WIDTH + 8));
  outline.setAttribute('height', String(renderCtx.boxHeight + 8));
  outline.setAttribute('rx', '12');
  grp.appendChild(outline);
}

function buildNodeGroup(
  renderCtx: NodeRenderCtx,
  id: string,
  chg: PlanChange | undefined,
  point: { x: number; y: number },
): SVGElement {
  const grp = renderCtx.env.el('g');
  const dimmed = isNodeDimmed(renderCtx, id, chg);
  grp.setAttribute('class', 'pl-nodeg ' + (dimmed ? 'pl-faded' : 'pl-full'));
  grp.setAttribute('transform', `translate(${point.x},${point.y})`);
  return grp;
}

function buildNodeRect(renderCtx: NodeRenderCtx, id: string, chg: PlanChange | undefined): SVGElement {
  const rect = renderCtx.env.el('rect');
  rect.setAttribute('width', String(BOX_WIDTH));
  rect.setAttribute('height', String(renderCtx.boxHeight));
  rect.setAttribute('rx', '9');
  rect.setAttribute('fill', nodeFillColor(chg, renderCtx.env.node(id)!));
  rect.setAttribute('stroke', chg ? STATUS_COL[chg.status] : '#2a3042');
  rect.setAttribute(ATTR_STROKE_WIDTH, chg ? '2' : '1.5');
  return rect;
}

function buildNodePip(renderCtx: NodeRenderCtx, chg: PlanChange): SVGElement {
  const pip = renderCtx.env.el('rect');
  pip.setAttribute('width', '5');
  pip.setAttribute('height', String(renderCtx.boxHeight));
  pip.setAttribute('rx', '2');
  pip.setAttribute('fill', STATUS_COL[chg.status]);
  return pip;
}

function appendNodeBox(grp: SVGElement, renderCtx: NodeRenderCtx, id: string, chg: PlanChange | undefined): void {
  grp.appendChild(buildNodeRect(renderCtx, id, chg));
  if (chg) grp.appendChild(buildNodePip(renderCtx, chg));
}

function buildNodeTitle(renderCtx: NodeRenderCtx, node: DiagramNode): SVGElement {
  const titleEl = renderCtx.env.el('text');
  titleEl.setAttribute('x', '14');
  titleEl.setAttribute('y', renderCtx.env.level === null ? '23' : '20');
  titleEl.setAttribute('class', 'pl-text');
  titleEl.setAttribute('font-size', '13');
  titleEl.setAttribute('font-weight', '600');
  titleEl.textContent = node.label;
  return titleEl;
}

function buildNodeSubtitle(renderCtx: NodeRenderCtx, id: string, chg: PlanChange | undefined): SVGElement {
  const sub = renderCtx.env.el('text');
  sub.setAttribute('x', '14');
  sub.setAttribute('y', renderCtx.env.level === null ? '41' : '36');
  sub.setAttribute('class', 'pl-text');
  sub.setAttribute('font-size', '9.5');
  sub.setAttribute('fill', '#8b93a7');
  sub.textContent = nodeSubtitleText(renderCtx, id, chg);
  return sub;
}

function appendNodeText(grp: SVGElement, renderCtx: NodeRenderCtx, id: string, chg: PlanChange | undefined): void {
  const node = renderCtx.env.node(id)!;
  grp.appendChild(buildNodeTitle(renderCtx, node));
  grp.appendChild(buildNodeSubtitle(renderCtx, id, chg));
}

function attachNodeHandlers(grp: SVGElement, env: PEnv, id: string): void {
  grp.addEventListener('click', (evt) => {
    evt.stopPropagation();
    env.select(id);
  });
  grp.addEventListener('dblclick', (evt) => {
    evt.stopPropagation();
    if (env.level === null && unitChildCount(env, id)) navigateToUnit(env, id);
  });
}

/** draw one node group (box + pip + label + status mark + selection outline). */
function drawNode(nodeGrp: HTMLElement, renderCtx: NodeRenderCtx, id: string): void {
  const env = renderCtx.env;
  const point = renderCtx.pos[id] || { x: 0, y: 0 };
  const chg = env.planOn ? env.byRef[id] : undefined;
  const grp = buildNodeGroup(renderCtx, id, chg, point);
  appendNodeBox(grp, renderCtx, id, chg);
  appendNodeText(grp, renderCtx, id, chg);
  appendStatusMark(grp, renderCtx, id, chg);
  appendSelectionOutline(grp, renderCtx, id);
  attachNodeHandlers(grp, env, id);
  nodeGrp.appendChild(grp);
}

/** breadcrumb — top level, or drilled-in unit with a link back to top. */
function renderCrumb(env: PEnv, ids: string[]): void {
  if (env.level === null) {
    env.$('plCrumb').innerHTML = `<b>top level</b> · ${ids.length} modules`;
  } else {
    const unitLabel = env.node(env.level)!.label;
    env.$('plCrumb').innerHTML =
      `<span class="pl-crumblink" id="plToTop">top level</span> › <b>${unitLabel}</b> · ${ids.length} units`;
  }
  const crumbLink = document.getElementById('plToTop');
  if (crumbLink) crumbLink.onclick = () => navigateToTop(env);
}

/** banner listing any dependency-incoherent verdicts. */
function renderCoherenceBanner(env: PEnv): void {
  const issues = coherenceWarnings(env.plan, env.verdicts);
  const banner = env.$('plWarnBanner');
  if (issues.length) {
    banner.style.display = 'block';
    banner.textContent = `⚠ ${issues.length} incoherent verdict${issues.length > 1 ? 's' : ''}: ` +
      issues.map((warn) => warn.changeId).join(', ');
  } else {
    banner.style.display = 'none';
  }
}

function centerOf(
  pos: Record<string, { x: number; y: number }>,
  boxHeight: number,
  id: string,
): { x: number; y: number } {
  const point = pos[id] || { x: 0, y: 0 };
  return { x: point.x + BOX_WIDTH / 2, y: point.y + boxHeight / 2 };
}

function buildEdgeRenderCtx(env: PEnv, ids: string[]): EdgeRenderCtx {
  const idset = new Set(ids);
  const pos = layoutLevel(env);
  const boxHeight = env.level === null ? 54 : 46;
  const center: Center = (id) => centerOf(pos, boxHeight, id);
  return { env, idset, center, boxHeight };
}

function buildNodeRenderCtx(env: PEnv, ectx: EdgeRenderCtx, lit: Set<string> | null): NodeRenderCtx {
  const warns = new Set(coherenceWarnings(env.plan, env.verdicts).map((warn) => warn.changeId));
  return { env, pos: layoutLevel(env), boxHeight: ectx.boxHeight, lit, warns };
}

function renderDiagram(env: PEnv): void {
  const nodeGrp = env.$('plNodes');
  const edgeGrp = env.$('plEdges');
  nodeGrp.innerHTML = '';
  edgeGrp.innerHTML = '';
  const ids = env.levelNodes();
  const ectx = buildEdgeRenderCtx(env, ids);
  const lit = computeLitSet(env, ectx.idset);
  const renderCtx = buildNodeRenderCtx(env, ectx, lit);
  drawEdges(edgeGrp, ectx, lit);
  ids.forEach((id) => drawNode(nodeGrp, renderCtx, id));
  renderCrumb(env, ids);
  renderCoherenceBanner(env);
}

/* =================== drill =================== */
function navigateToUnit(env: PEnv, id: string): void {
  env.level = id;
  env.sel = null;
  fitCamera(env);
  renderDiagram(env);
  env.renderInfo();
}

function navigateToTop(env: PEnv): void {
  env.level = null;
  env.sel = null;
  fitCamera(env);
  renderDiagram(env);
  env.renderInfo();
}

export function initPlannerDiagram(env: PEnv): void {
  function applyT(): void {
    drawCamera(env);
  }
  function fit(): void {
    fitCamera(env);
  }
  function render(): void {
    renderDiagram(env);
  }
  function toTop(): void {
    navigateToTop(env);
  }

  env.applyT = applyT;
  env.fit = fit;
  env.render = render;
  env.toTop = toTop;
}
