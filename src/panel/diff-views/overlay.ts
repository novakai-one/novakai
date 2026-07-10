/* diff-views/overlay.ts — ghost overlay on a mini-canvas (View 4).
   Draws node positions as an SVG, coloured by diff status. Supports
   wheel-zoom + drag-pan. Default frame tightens to the CHANGED nodes
   (added/removed/changed + their edge endpoints) so the view opens close,
   not zoomed out across the whole 5000px-tall diagram. A "Fit all" /
   "Fit changes" toggle reframes. Grid mirrors the real canvas (radial
   dots, --grid var) so it matches the active theme. */
import { type ViewArg, type DiffModel, el, splitEdgeKey } from './types';
import type { DiagramNode } from '../../core/types/types';

const SVG_NS = 'http://www.w3.org/2000/svg';

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
type ViewBox = { x: number; y: number; width: number; height: number };
type ViewState = { box: ViewBox };
type DragState = { active: boolean; lastX: number; lastY: number };
type DiffSets = { added: Set<string>; removed: Set<string>; changed: Set<string> };

interface OverlayView {
  svg: SVGSVGElement;
  gridG: SVGGElement;
  state: ViewState;
}

interface OverlayScene {
  svg: SVGSVGElement;
  gridG: SVGGElement;
  sceneG: SVGGElement;
  allBounds: Bounds;
  focusBounds: Bounds;
}

function isEmptyDiff(diff: ViewArg['diff']): boolean {
  return diff.counts.nAdd + diff.counts.nRem + diff.counts.nChg + diff.counts.eAdd + diff.counts.eRem === 0;
}

function nodeDim(node: DiagramNode): { width: number; height: number } {
  return { width: node.w || 160, height: node.h || 56 };
}

function nodeCenter(node: DiagramNode): { x: number; y: number } {
  const size = nodeDim(node);
  return { x: node.x + size.width / 2, y: node.y + size.height / 2 };
}

function buildDiffSets(diff: ViewArg['diff']): DiffSets {
  return {
    added: new Set(diff.addedNodes),
    removed: new Set(diff.removedNodes),
    changed: new Set(diff.changedNodes.map((chg) => chg.id)),
  };
}

function buildPlaceMap(before: DiffModel, after: DiffModel, removedIds: Set<string>): Record<string, DiagramNode> {
  const place: Record<string, DiagramNode> = {};
  for (const id in after.nodes) place[id] = after.nodes[id];
  for (const id of removedIds) if (before.nodes[id]) place[id] = before.nodes[id];
  return place;
}

function computeBounds(place: Record<string, DiagramNode>, ids: string[]): Bounds | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const id of ids) {
    const node = place[id];
    if (!node) continue;
    const size = nodeDim(node);
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + size.width);
    maxY = Math.max(maxY, node.y + size.height);
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

function computeFocusIds(sets: DiffSets, diff: ViewArg['diff'], place: Record<string, DiagramNode>): Set<string> {
  const focus = new Set<string>([...sets.added, ...sets.removed, ...sets.changed]);
  [...diff.addedEdges, ...diff.removedEdges].forEach((key) => {
    const { from, to: dest } = splitEdgeKey(key);
    if (place[from]) focus.add(from);
    if (place[dest]) focus.add(dest);
  });
  return focus;
}

function framedView(bounds: Bounds): ViewBox {
  const pad = 80;
  return {
    x: bounds.minX - pad,
    y: bounds.minY - pad,
    width: (bounds.maxX - bounds.minX) + pad * 2,
    height: (bounds.maxY - bounds.minY) + pad * 2,
  };
}

function mkSvg(parent: Element, tag: string, attrs: Record<string, string | number>): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
}

function createOverlaySvg(): { svg: SVGSVGElement; gridG: SVGGElement; sceneG: SVGGElement } {
  const svg = document.createElementNS(SVG_NS, 'svg') as SVGSVGElement;
  svg.setAttribute('class', 'dv-ovl-svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  const gridG = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  const sceneG = document.createElementNS(SVG_NS, 'g') as SVGGElement;
  svg.appendChild(gridG);
  svg.appendChild(sceneG);
  return { svg, gridG, sceneG };
}

type SceneCtx = { sceneG: SVGGElement; place: Record<string, DiagramNode> };

function drawOverlayEdge(ctx: SceneCtx, from: string, toId: string, cls: string): void {
  const src = ctx.place[from], dst = ctx.place[toId];
  if (!src || !dst) return;
  const start = nodeCenter(src), end = nodeCenter(dst);
  mkSvg(ctx.sceneG, 'line', { 'x1': start.x, 'y1': start.y, 'x2': end.x, 'y2': end.y, class: `dv-ovl-edge ${cls}` });
}

function drawAllEdges(ctx: SceneCtx, after: DiffModel, diff: ViewArg['diff']): void {
  const addedKeys = new Set(diff.addedEdges);
  for (const edge of after.edges) {
    if (addedKeys.has(`${edge.from}->${edge.to}:${edge.style}`)) continue;
    drawOverlayEdge(ctx, edge.from, edge.to, 'eq');
  }
  diff.addedEdges.forEach((key) => {
    const { from, to: toId } = splitEdgeKey(key);
    drawOverlayEdge(ctx, from, toId, 'add');
  });
  diff.removedEdges.forEach((key) => {
    const { from, to: toId } = splitEdgeKey(key);
    drawOverlayEdge(ctx, from, toId, 'rem');
  });
}

function nodeStatusClass(id: string, sets: DiffSets): string {
  if (sets.added.has(id)) return 'add';
  if (sets.removed.has(id)) return 'rem';
  if (sets.changed.has(id)) return 'chg';
  return 'eq';
}

function drawAllNodes(sceneG: SVGGElement, place: Record<string, DiagramNode>, ids: string[], sets: DiffSets): void {
  for (const id of ids) {
    const node = place[id];
    const cls = nodeStatusClass(id, sets);
    const size = nodeDim(node);
    mkSvg(sceneG, 'rect', {
      x: node.x, y: node.y, width: size.width, height: size.height, 'rx': 10, class: `dv-ovl-node ${cls}`,
    });
    const mid = nodeCenter(node);
    const label = mkSvg(sceneG, 'text', {
      x: mid.x, y: mid.y + 4, 'text-anchor': 'middle', class: `dv-ovl-label ${cls}`,
    });
    label.textContent = id;
  }
}

function buildOverlayScene(diff: ViewArg['diff'], before: DiffModel, after: DiffModel): OverlayScene | null {
  const sets = buildDiffSets(diff);
  const place = buildPlaceMap(before, after, sets.removed);
  const ids = Object.keys(place);
  if (!ids.length) return null;

  const allBounds = computeBounds(place, ids)!;
  const focusIds = computeFocusIds(sets, diff, place);
  const focusBounds = computeBounds(place, [...focusIds]) ?? allBounds;

  const { svg, gridG, sceneG } = createOverlaySvg();
  drawAllEdges({ sceneG, place }, after, diff);
  drawAllNodes(sceneG, place, ids, sets);

  return { svg, gridG, sceneG, allBounds, focusBounds };
}

/* ---- pan/zoom: maintain a viewBox we mutate ---- */

function applyViewBox(view: OverlayView): void {
  const box = view.state.box;
  view.svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`);
  // grid: tile dots across the visible viewBox in world space
  view.gridG.innerHTML = '';
  const step = 16;
  const startX = Math.floor(box.x / step) * step, startY = Math.floor(box.y / step) * step;
  // cap dot count so extreme zoom-out stays cheap
  const cols = Math.min(400, Math.ceil(box.width / step) + 1);
  const rows = Math.min(400, Math.ceil(box.height / step) + 1);
  for (let col = 0; col < cols; col++) {
    for (let row = 0; row < rows; row++) {
      mkSvg(view.gridG, 'circle', {
        'cx': startX + col * step, 'cy': startY + row * step, 'r': 1.1, class: 'dv-ovl-dot',
      });
    }
  }
}

function zoomAt(state: ViewState, fracX: number, fracY: number, factor: number): void {
  const box = state.box;
  const nextWidth = Math.max(120, Math.min(40000, box.width * factor));
  const nextHeight = nextWidth * (box.height / box.width);
  state.box = {
    x: box.x + (box.width - nextWidth) * fracX,
    y: box.y + (box.height - nextHeight) * fracY,
    width: nextWidth,
    height: nextHeight,
  };
}

function panBy(state: ViewState, dx: number, dy: number): void {
  state.box = { ...state.box, x: state.box.x - dx, y: state.box.y - dy };
}

// wheel zoom toward cursor
function bindWheelZoom(view: OverlayView): void {
  view.svg.addEventListener('wheel', (event) => {
    event.preventDefault();
    const rect = view.svg.getBoundingClientRect();
    const fracX = (event.clientX - rect.left) / rect.width;
    const fracY = (event.clientY - rect.top) / rect.height;
    const factor = event.deltaY > 0 ? 1.12 : 1 / 1.12;
    zoomAt(view.state, fracX, fracY, factor);
    applyViewBox(view);
  }, { passive: false });
}

function startDrag(svg: SVGSVGElement, drag: DragState, event: PointerEvent): void {
  drag.active = true;
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  svg.setPointerCapture(event.pointerId);
  svg.classList.add('grabbing');
}

function moveDrag(view: OverlayView, drag: DragState, event: PointerEvent): void {
  if (!drag.active) return;
  const rect = view.svg.getBoundingClientRect();
  const dx = (event.clientX - drag.lastX) / rect.width * view.state.box.width;
  const dy = (event.clientY - drag.lastY) / rect.height * view.state.box.height;
  panBy(view.state, dx, dy);
  drag.lastX = event.clientX;
  drag.lastY = event.clientY;
  applyViewBox(view);
}

function endDrag(svg: SVGSVGElement, drag: DragState): void {
  drag.active = false;
  svg.classList.remove('grabbing');
}

// drag pan
function bindDragPan(view: OverlayView): void {
  const drag: DragState = { active: false, lastX: 0, lastY: 0 };
  view.svg.addEventListener('pointerdown', (event) => startDrag(view.svg, drag, event));
  view.svg.addEventListener('pointermove', (event) => moveDrag(view, drag, event));
  view.svg.addEventListener('pointerup', () => endDrag(view.svg, drag));
  view.svg.addEventListener('pointercancel', () => endDrag(view.svg, drag));
}

function buildOverlayControls(view: OverlayView, allBounds: Bounds, focusBounds: Bounds): HTMLElement {
  const controls = el('div', 'dv-ovl-controls');
  const fitChanges = el('button', 'filebtn dv-mini', 'Fit changes');
  const fitAll = el('button', 'filebtn dv-mini', 'Fit all');
  const hint = el('span', 'dv-ovl-hint', 'scroll = zoom · drag = pan');
  fitChanges.onclick = () => {
    view.state.box = framedView(focusBounds);
    applyViewBox(view);
  };
  fitAll.onclick = () => {
    view.state.box = framedView(allBounds);
    applyViewBox(view);
  };
  controls.appendChild(fitChanges);
  controls.appendChild(fitAll);
  controls.appendChild(hint);
  return controls;
}

function buildOverlayChrome(view: OverlayView, allBounds: Bounds, focusBounds: Bounds): HTMLElement {
  const bar = el('div', 'dv-ovl-bar');
  const legend = el('div', 'dv-ovl-legend');
  legend.innerHTML = '<span class="dv-leg add">added</span>'
    + '<span class="dv-leg rem">removed</span>'
    + '<span class="dv-leg chg">changed</span>'
    + '<span class="dv-leg eq">unchanged</span>';
  bar.appendChild(legend);
  bar.appendChild(buildOverlayControls(view, allBounds, focusBounds));
  return bar;
}

function buildOverlayWrap(scene: OverlayScene): HTMLElement {
  const view: OverlayView = { svg: scene.svg, gridG: scene.gridG, state: { box: framedView(scene.focusBounds) } };
  applyViewBox(view);
  bindWheelZoom(view);
  bindDragPan(view);

  const wrap = el('div', 'dv-ovl');
  wrap.appendChild(buildOverlayChrome(view, scene.allBounds, scene.focusBounds));
  wrap.appendChild(scene.svg);
  return wrap;
}

export function renderOverlay(host: HTMLElement, arg: ViewArg): void {
  const { diff, before, after } = arg;
  host.innerHTML = '';
  if (isEmptyDiff(diff)) {
    host.appendChild(el('div', 'diff-empty', 'No changes to overlay.'));
    return;
  }
  const scene = buildOverlayScene(diff, before, after);
  if (!scene) {
    host.appendChild(el('div', 'diff-empty', 'No positioned nodes to draw.'));
    return;
  }
  host.appendChild(buildOverlayWrap(scene));
}
