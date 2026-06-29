/* diff-views/overlay.ts — ghost overlay on a mini-canvas (View 4).
   Draws node positions as an SVG, coloured by diff status. Supports
   wheel-zoom + drag-pan. Default frame tightens to the CHANGED nodes
   (added/removed/changed + their edge endpoints) so the view opens close,
   not zoomed out across the whole 5000px-tall diagram. A "Fit all" /
   "Fit changes" toggle reframes. Grid mirrors the real canvas (radial
   dots, --grid var) so it matches the active theme. */
import { type ViewArg, el, splitEdgeKey } from './types';
import type { DiagramNode } from '../../core/types/types';

const NS = 'http://www.w3.org/2000/svg';

export function renderOverlay(host: HTMLElement, arg: ViewArg): void {
  const { diff, before, after } = arg;
  host.innerHTML = '';

  const total = diff.counts.nAdd + diff.counts.nRem + diff.counts.nChg + diff.counts.eAdd + diff.counts.eRem;
  if (total === 0) {
    host.appendChild(el('div', 'diff-empty', 'No changes to overlay.'));
    return;
  }

  const addedSet = new Set(diff.addedNodes);
  const removedSet = new Set(diff.removedNodes);
  const changedSet = new Set(diff.changedNodes.map((c) => c.id));
  const addedEdges = new Set(diff.addedEdges);

  // node lookup: after positions, plus removed nodes from before
  const place: Record<string, DiagramNode> = {};
  for (const id in after.nodes) place[id] = after.nodes[id];
  for (const id of removedSet) if (before.nodes[id]) place[id] = before.nodes[id];

  const ids = Object.keys(place);
  if (!ids.length) { host.appendChild(el('div', 'diff-empty', 'No positioned nodes to draw.')); return; }

  const dim = (n: DiagramNode) => ({ w: n.w || 160, h: n.h || 56 });
  const center = (n: DiagramNode) => { const d = dim(n); return { x: n.x + d.w / 2, y: n.y + d.h / 2 }; };

  // bounds helper over a set of ids
  const bounds = (set: string[]) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const id of set) {
      const n = place[id]; if (!n) continue;
      const d = dim(n);
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + d.w); maxY = Math.max(maxY, n.y + d.h);
    }
    if (minX === Infinity) return null;
    return { minX, minY, maxX, maxY };
  };

  // the "interesting" set = changed nodes + endpoints of changed edges
  const focusIds = new Set<string>([...addedSet, ...removedSet, ...changedSet]);
  [...diff.addedEdges, ...diff.removedEdges].forEach((k) => {
    const { from, to } = splitEdgeKey(k);
    if (place[from]) focusIds.add(from);
    if (place[to]) focusIds.add(to);
  });

  const allB = bounds(ids)!;
  const focusB = bounds([...focusIds]) ?? allB;

  /* ---- svg + pan/zoom state ---- */
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'dv-ovl-svg');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  const gridG = document.createElementNS(NS, 'g');  // background dots
  const sceneG = document.createElementNS(NS, 'g'); // nodes + edges
  svg.appendChild(gridG);
  svg.appendChild(sceneG);

  const mk = (parent: Element, tag: string, attrs: Record<string, string | number>): SVGElement => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    parent.appendChild(e);
    return e;
  };

  /* ---- draw scene (in world coords; transform handles zoom/pan) ---- */
  const drawEdge = (from: string, to: string, cls: string): void => {
    const a = place[from], b = place[to];
    if (!a || !b) return;
    const p1 = center(a), p2 = center(b);
    mk(sceneG, 'line', { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, class: `dv-ovl-edge ${cls}` });
  };
  for (const e of after.edges) {
    if (addedEdges.has(`${e.from}->${e.to}:${e.style}`)) continue;
    drawEdge(e.from, e.to, 'eq');
  }
  diff.addedEdges.forEach((k) => { const { from, to } = splitEdgeKey(k); drawEdge(from, to, 'add'); });
  diff.removedEdges.forEach((k) => { const { from, to } = splitEdgeKey(k); drawEdge(from, to, 'rem'); });

  for (const id of ids) {
    const n = place[id], d = dim(n);
    let cls = 'eq';
    if (addedSet.has(id)) cls = 'add';
    else if (removedSet.has(id)) cls = 'rem';
    else if (changedSet.has(id)) cls = 'chg';
    mk(sceneG, 'rect', { x: n.x, y: n.y, width: d.w, height: d.h, rx: 10, class: `dv-ovl-node ${cls}` });
    const c = center(n);
    const label = mk(sceneG, 'text', { x: c.x, y: c.y + 4, 'text-anchor': 'middle', class: `dv-ovl-label ${cls}` });
    label.textContent = id;
  }

  /* ---- pan/zoom: maintain a viewBox we mutate ---- */
  let vb = framed(focusB);
  applyVB();

  function framed(b: { minX: number; minY: number; maxX: number; maxY: number }) {
    const pad = 80;
    return { x: b.minX - pad, y: b.minY - pad, w: (b.maxX - b.minX) + pad * 2, h: (b.maxY - b.minY) + pad * 2 };
  }
  function applyVB(): void {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    // grid: tile dots across the visible viewBox in world space
    gridG.innerHTML = '';
    const step = 16;
    const x0 = Math.floor(vb.x / step) * step, y0 = Math.floor(vb.y / step) * step;
    // cap dot count so extreme zoom-out stays cheap
    const cols = Math.min(400, Math.ceil(vb.w / step) + 1);
    const rows = Math.min(400, Math.ceil(vb.h / step) + 1);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      mk(gridG, 'circle', { cx: x0 + i * step, cy: y0 + j * step, r: 1.1, class: 'dv-ovl-dot' });
    }
  }

  // wheel zoom toward cursor
  svg.addEventListener('wheel', (ev) => {
    ev.preventDefault();
    const r = svg.getBoundingClientRect();
    const fx = (ev.clientX - r.left) / r.width;
    const fy = (ev.clientY - r.top) / r.height;
    const factor = ev.deltaY > 0 ? 1.12 : 1 / 1.12;
    const nw = Math.max(120, Math.min(40000, vb.w * factor));
    const nh = nw * (vb.h / vb.w);
    vb = { x: vb.x + (vb.w - nw) * fx, y: vb.y + (vb.h - nh) * fy, w: nw, h: nh };
    applyVB();
  }, { passive: false });

  // drag pan
  let dragging = false, lastX = 0, lastY = 0;
  svg.addEventListener('pointerdown', (ev) => {
    dragging = true; lastX = ev.clientX; lastY = ev.clientY;
    svg.setPointerCapture(ev.pointerId); svg.classList.add('grabbing');
  });
  svg.addEventListener('pointermove', (ev) => {
    if (!dragging) return;
    const r = svg.getBoundingClientRect();
    const dx = (ev.clientX - lastX) / r.width * vb.w;
    const dy = (ev.clientY - lastY) / r.height * vb.h;
    vb = { ...vb, x: vb.x - dx, y: vb.y - dy };
    lastX = ev.clientX; lastY = ev.clientY;
    applyVB();
  });
  const endDrag = () => { dragging = false; svg.classList.remove('grabbing'); };
  svg.addEventListener('pointerup', endDrag);
  svg.addEventListener('pointercancel', endDrag);

  /* ---- chrome ---- */
  const wrap = el('div', 'dv-ovl');
  const bar = el('div', 'dv-ovl-bar');
  const legend = el('div', 'dv-ovl-legend');
  legend.innerHTML =
    '<span class="dv-leg add">added</span>'
    + '<span class="dv-leg rem">removed</span>'
    + '<span class="dv-leg chg">changed</span>'
    + '<span class="dv-leg eq">unchanged</span>';
  const controls = el('div', 'dv-ovl-controls');
  const fitChanges = el('button', 'filebtn dv-mini', 'Fit changes');
  const fitAll = el('button', 'filebtn dv-mini', 'Fit all');
  const zoomHint = el('span', 'dv-ovl-hint', 'scroll = zoom · drag = pan');
  fitChanges.onclick = () => { vb = framed(focusB); applyVB(); };
  fitAll.onclick = () => { vb = framed(allB); applyVB(); };
  controls.appendChild(fitChanges); controls.appendChild(fitAll); controls.appendChild(zoomHint);
  bar.appendChild(legend); bar.appendChild(controls);

  wrap.appendChild(bar);
  wrap.appendChild(svg);
  host.appendChild(wrap);
}
