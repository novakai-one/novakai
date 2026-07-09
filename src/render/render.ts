/* =====================================================================
   render.ts — model -> canvas DOM
   ---------------------------------------------------------------------
   Responsibility: the main render() that rebuilds node elements (and
   their ports / resize handles / inline-edit state) from the model, plus
   shapeMarkup() for crisp SVG shapes and updateStatus() for the counter.
   Delegates edge drawing to the wires module via a passed-in drawWires.

   Reads: ctx.state, ctx.runtime (editingId/linkSrc).
   Writes: only the DOM under #world. Does not mutate the model.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { DiagramNode, Frontmatter } from '../core/types/types';
import { esc, KIND_BADGE, nodeFill } from '../core/config/config';
import { childIdsOf, type StateStore } from '../core/state/state';
import { isFrontmatterEmpty, parseTypeRef, nodeUsesType } from '../core/frontmatter/frontmatter';

export interface RenderApi {
  render: () => void;
  updateStatus: () => void;
}

function svgWrap(width: number, height: number, inner: string): string {
  return `<svg class="shape-svg" width="${width}" height="${height}" `
    + `viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${inner}</svg>`;
}

function diamondShape(width: number, height: number, fill: string): string {
  const pts = `${width / 2},0 ${width},${height / 2} ${width / 2},${height} 0,${height / 2}`;
  return svgWrap(width, height, `<polygon class="shp" points="${pts}"${fill}/>`);
}

function hexShape(width: number, height: number, fill: string): string {
  const inset = Math.min(width * 0.22, height * 0.5);
  const pts = `${inset},0 ${width - inset},0 ${width},${height / 2} `
    + `${width - inset},${height} ${inset},${height} 0,${height / 2}`;
  return svgWrap(width, height, `<polygon class="shp" points="${pts}"${fill}/>`);
}

function cylinderShape(width: number, height: number, fill: string): string {
  const radiusX = width / 2, radiusY = Math.max(6, Math.min(height * 0.16, 22));
  const body = `M 0 ${radiusY} L 0 ${height - radiusY} A ${radiusX} ${radiusY} 0 0 0 ${width} `
    + `${height - radiusY} L ${width} ${radiusY} Z`;
  return svgWrap(width, height,
    `<path class="shp" d="${body}"${fill}/>`
    + `<ellipse class="shp" cx="${radiusX}" cy="${radiusY}" rx="${radiusX}" ry="${radiusY}"${fill}/>`);
}

/** Crisp SVG geometry for diamond / hex / cylinder shapes. */
export function shapeMarkup(node: DiagramNode): string {
  const fillColor = nodeFill(node);
  const fill = fillColor ? ` style="fill:${fillColor}"` : '';
  if (node.shape === 'diamond') return diamondShape(node.w, node.h, fill);
  if (node.shape === 'hex') return hexShape(node.w, node.h, fill);
  if (node.shape === 'cylinder') return cylinderShape(node.w, node.h, fill);
  return '';
}

/** esc() handles &<> ; also neutralise quotes for use inside an attribute. */
function attr(value: string): string {
  return esc(value).replace(/"/g, '&quot;');
}

/**
 * One traceable type token: an optional dim var name plus a clickable type
 * chip carrying `data-type`. Marked `.is-traced` when it matches the type
 * currently being traced, so every instance lights up together.
 */
function fmTokenHtml(raw: string, tracedType: string | null): string {
  const ref = parseTypeRef(raw);
  if (!ref.type) return '';
  const hit = tracedType !== null && ref.type === tracedType ? ' is-traced' : '';
  const varLabel = ref.varName ? `<span class="fmvar">${esc(ref.varName)}:</span> ` : '';
  const typeChip = `<span class="fmtype${hit}" data-type="${attr(ref.type)}">${esc(ref.type)}</span>`;
  return `<span class="fmtoken">${varLabel}${typeChip}</span>`;
}

/** The node-level name rendered as its own traceable token (no var part). */
function nameTokenHtml(name: string, tracedType: string | null): string {
  const trimmed = name.trim();
  const hit = tracedType !== null && trimmed === tracedType ? ' is-traced' : '';
  const typeChip = `<span class="fmtype${hit}" data-type="${attr(trimmed)}">${esc(name)}</span>`;
  return `<span class="fmtoken">${typeChip}</span>`;
}

function fmNameRow(name: string, tracedType: string | null): string {
  const trimmed = name.trim();
  if (!trimmed) return '';
  const value = nameTokenHtml(name, tracedType);
  return `<div class="fmrow"><span class="fmkey">name</span><span class="fmval">${value}</span></div>`;
}

function fmDescRow(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) return '';
  const value = esc(description);
  return `<div class="fmrow"><span class="fmkey">desc</span><span class="fmval">${value}</span></div>`;
}

// one labelled row per fm block (state, accepts, returns); empty when no
// item resolves to a traceable token.
function fmTokenRow(key: string, items: string[], tracedType: string | null): string {
  const body = items.map((item) => fmTokenHtml(item, tracedType)).filter(Boolean).join('');
  if (!body) return '';
  return `<div class="fmrow"><span class="fmkey">${key}</span><span class="fmval">${body}</span></div>`;
}

// one labelled block per interface; blocks with no accepts/returns are skipped
function fmInterfaceBlocks(frontmatter: Frontmatter, tracedType: string | null): string {
  let html = '';
  for (const iface of frontmatter.interfaces ?? []) {
    const body = fmTokenRow('accepts', iface.accepts, tracedType) + fmTokenRow('returns', iface.returns, tracedType);
    if (!body) continue;
    const title = iface.name.trim() ? esc(iface.name) : 'interface';
    html += `<div class="fmiface"><div class="fmiface-name">${title}</div>${body}</div>`;
  }
  return html;
}

/**
 * Build the read-only frontmatter card shown under a node on the canvas.
 * It's an absolutely-positioned overlay (see CSS .fmcard) so it never
 * affects the node's own dimensions. Editing happens in the inspector or
 * via the inline card editor; this is the display form.
 */
export function buildFmCard(frontmatter: Frontmatter, tracedType: string | null): HTMLElement {
  const card = document.createElement('div');
  card.className = 'fmcard';
  card.innerHTML = fmNameRow(frontmatter.name, tracedType)
    + fmDescRow(frontmatter.description)
    + fmTokenRow('state', frontmatter.state, tracedType)
    + fmInterfaceBlocks(frontmatter, tracedType);
  return card;
}

function isSvgShape(node: DiagramNode): boolean {
  return node.shape === 'diamond' || node.shape === 'hex' || node.shape === 'cylinder';
}

// One node's per-render view: the model node plus the flags that shape its
// class/signature/inner DOM. Bundled so the helpers below stay under the
// file's max-params budget instead of threading 4-5 loose arguments.
interface NodeView { id: string; node: DiagramNode; isContainer: boolean; traced: string | null; }

function traceClassFor(node: DiagramNode, traced: string | null): string {
  if (!traced) return '';
  return nodeUsesType(node.fm, traced) ? ' trace-hit' : ' trace-dim';
}

function focusClassFor(ctx: AppContext, id: string): string {
  const spine = ctx.runtime.focusSpine;
  if (!spine) return '';
  return spine.has(id) ? ' focus-hit' : ' focus-dim';
}

// className is derived from model + selection/trace/link/edit state and is
// patched on every render (cheap, never a structural change).
function classFor(ctx: AppContext, view: NodeView): string {
  const { state, runtime } = ctx;
  const { node, id, isContainer, traced } = view;
  return 'node shape-' + node.shape + (isSvgShape(node) ? ' svgshape' : '')
    + (state.sel.has(id) ? ' selected' : '') + (runtime.linkSrc === id ? ' linksrc' : '')
    + (isContainer ? ' is-container' : '') + (runtime.editingId === id ? ' editing' : '')
    + traceClassFor(node, traced)
    + (state.roots.includes(id) ? ' is-root' : '') + focusClassFor(ctx, id);
}

function fmSigPart(ctx: AppContext, node: DiagramNode): string {
  if (!ctx.prefs.showFrontmatter || !node.fm || isFrontmatterEmpty(node.fm)) return '';
  return JSON.stringify(node.fm);
}

function dimsSigPart(node: DiagramNode): string {
  return isSvgShape(node) ? `${node.w}x${node.h}` : '';   // svg shape markup depends on size
}

// Everything buildInner() depends on. When unchanged across renders the inner
// DOM is left alone and only className + geometry are patched.
function nodeSig(ctx: AppContext, view: NodeView): string {
  const { node, id, isContainer, traced } = view;
  const { state } = ctx;
  const single = state.sel.has(id) && state.sel.size === 1;   // drives resize handles
  const kids = childIdsOf(state, id).length;                  // drives the enter-btn count
  return [
    node.shape, node.label, node.kind ?? '',
    single ? 's' : '', isContainer ? 'c' : '', kids,
    dimsSigPart(node), traced ?? '', nodeFill(node) ?? '', fmSigPart(ctx, node),
  ].join('');
}

function appendLabel(el: HTMLElement, node: DiagramNode): void {
  const lab = document.createElement('span');
  lab.className = 'label';
  lab.textContent = node.label;
  el.appendChild(lab);   // contenteditable is toggled in render(), not here
}

// semantic kind badge (corner chip)
function appendKindBadge(el: HTMLElement, node: DiagramNode): void {
  if (!node.kind) return;
  const badge = document.createElement('span');
  badge.className = 'kindbadge';
  badge.textContent = KIND_BADGE[node.kind];
  el.appendChild(badge);
}

// drill-in affordance: open this node's internal level. Skipped for groups,
// notes, and the container itself (you're already inside it).
function appendEnterButton(ctx: AppContext, el: HTMLElement, view: NodeView): void {
  const { node, id, isContainer } = view;
  if (node.shape === 'group' || node.shape === 'note' || isContainer) return;
  const kids = childIdsOf(ctx.state, id).length;
  const enter = document.createElement('button');
  enter.className = 'enter-btn' + (kids ? ' has-kids' : '');
  enter.title = kids ? `Open internals (${kids})` : 'Open internals';
  enter.textContent = kids ? String(kids) : '⇲';
  enter.onpointerdown = (downEvent) => downEvent.stopPropagation();
  enter.onclick = (clickEvent) => {
    clickEvent.stopPropagation();
    ctx.hooks.enterContainer(id);
  };
  el.appendChild(enter);
}

function appendPorts(el: HTMLElement, id: string): void {
  (['pt', 'pb', 'pl', 'pr'] as const).forEach((side) => {
    const port = document.createElement('div');
    port.className = 'port ' + side;
    port.dataset.port = id;
    port.dataset.side = side;
    el.appendChild(port);
  });
}

// resize handles only when single-selected
function appendResizeHandles(ctx: AppContext, el: HTMLElement, id: string): void {
  if (!(ctx.state.sel.has(id) && ctx.state.sel.size === 1)) return;
  (['nw', 'ne', 'sw', 'se'] as const).forEach((corner) => {
    const handle = document.createElement('div');
    handle.className = 'rsz ' + corner;
    handle.dataset.rsz = corner;
    handle.dataset.id = id;
    el.appendChild(handle);
  });
}

// frontmatter card: an overlay BELOW the node, outside its box model, so
// showing/hiding it never changes node size or spacing
function appendFmCard(ctx: AppContext, el: HTMLElement, node: DiagramNode, traced: string | null): void {
  if (!ctx.prefs.showFrontmatter || !node.fm || isFrontmatterEmpty(node.fm)) return;
  el.appendChild(buildFmCard(node.fm, traced));
}

// (re)build the inner DOM of a node element from the model
function buildInner(ctx: AppContext, el: HTMLElement, view: NodeView): void {
  const { node, id, traced } = view;
  el.textContent = '';   // clear previous inner (children + text)
  if (isSvgShape(node)) el.insertAdjacentHTML('beforeend', shapeMarkup(node));
  appendLabel(el, node);
  appendKindBadge(el, node);
  appendEnterButton(ctx, el, view);
  appendPorts(el, id);
  appendResizeHandles(ctx, el, id);
  appendFmCard(ctx, el, node, traced);
}

// nodes at the current drill level; groups first (z-order). The drilled
// container itself is appended last so it renders as a real, interactive
// node (the level anchor) above its children.
function levelIds(state: StateStore, container: string | null): string[] {
  const ids = childIdsOf(state, container).sort((nodeIdA, nodeIdB) =>
    (state.nodes[nodeIdA].shape === 'group' ? 0 : 1) - (state.nodes[nodeIdB].shape === 'group' ? 0 : 1));
  if (container && state.nodes[container]) ids.push(container);
  return ids;
}

// remove cached elements whose id is no longer shown at this level
function pruneRemovedNodes(nodeEls: Map<string, HTMLElement>, desired: Set<string>): void {
  for (const [id, el] of nodeEls) {
    if (desired.has(id)) continue;
    el.remove();
    nodeEls.delete(id);
  }
}

function createNodeEl(ctx: AppContext, id: string, view: NodeView, sig: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.id = id;
  buildInner(ctx, el, view);
  el.dataset.sig = sig;
  return el;
}

// create new / patch existing. A node's inner DOM is rebuilt only when its
// structural signature changes — otherwise it's left alone (cheap).
function ensureNodeEl(ctx: AppContext, nodeEls: Map<string, HTMLElement>, view: NodeView): HTMLElement {
  const { id } = view;
  const sig = nodeSig(ctx, view);
  const cached = nodeEls.get(id);
  if (!cached) {
    const el = createNodeEl(ctx, id, view, sig);
    nodeEls.set(id, el);
    return el;
  }
  if (cached.dataset.sig !== sig && ctx.runtime.editingId !== id) {
    buildInner(ctx, cached, view);
    cached.dataset.sig = sig;
  }
  return cached;
}

// always-cheap patches: className + geometry + fill (never a structural change)
function applyCheapPatches(ctx: AppContext, el: HTMLElement, view: NodeView): void {
  const node = view.node;
  el.className = classFor(ctx, view);
  el.style.left = node.x + 'px';
  el.style.top = node.y + 'px';
  el.style.width = node.w + 'px';
  el.style.height = node.h + 'px';
  const fill = nodeFill(node);
  el.style.background = fill && !isSvgShape(node) && node.shape !== 'group' && node.shape !== 'note' ? fill : '';
}

// toggle inline-edit contenteditable on the persistent label (independent
// of inner rebuild, so starting/ending an edit always lands correctly)
function syncEditableLabel(ctx: AppContext, el: HTMLElement, id: string): void {
  const lab = el.querySelector<HTMLElement>(':scope > .label');
  if (!lab) return;
  if (ctx.runtime.editingId === id) lab.setAttribute('contenteditable', 'true');
  else lab.removeAttribute('contenteditable');
}

// empty-state hint when a drilled container has no internals yet
function updateEmptyHint(ctx: AppContext): void {
  const emptyEl = document.getElementById('levelEmpty');
  if (!emptyEl) return;
  const { state } = ctx;
  const container = ctx.view.container;
  const showEmpty = !!container && childIdsOf(state, container).length === 0;
  emptyEl.style.display = showEmpty ? 'block' : 'none';
  if (!showEmpty || !container) return;
  const cname = esc(state.nodes[container]?.label || 'this node');
  emptyEl.innerHTML = `<b>${cname}</b> has no internals yet.<br>`
    + `Drop a shape — it lands inside <b>${cname}</b>.<br>`
    + `Or select a node and set its <b>Parent</b> to <b>${cname}</b> in the inspector.`;
}

function updateStatus(ctx: AppContext, statusEl: HTMLElement): void {
  const nodeCount = Object.keys(ctx.state.nodes).length;
  const edgeCount = ctx.state.edges.length;
  let statusText = `${nodeCount} node${nodeCount !== 1 ? 's' : ''} · ${edgeCount} edge${edgeCount !== 1 ? 's' : ''}`;
  if (ctx.state.sel.size) statusText += ` · ${ctx.state.sel.size} selected`;
  statusEl.textContent = statusText;
}

// One repaint's per-node measurement outcome: true if that node's stored
// footprint changed (new card, resized card, or a card that disappeared).
function measureOneCard(state: StateStore, id: string, el: HTMLElement): boolean {
  const card = el.querySelector<HTMLElement>(':scope > .fmcard');
  if (!card) {
    if (!state.measured.has(id)) return false;
    // visible node with no card (frontmatter off / empty): drop any stale size
    state.measured.delete(id);
    return true;
  }
  const cardW = card.offsetWidth, cardH = card.offsetHeight;
  const prev = state.measured.get(id);
  if (prev && prev.cardW === cardW && prev.cardH === cardH) return false;
  state.measured.set(id, { cardW, cardH });
  return true;
}

// Post-render measure pass (Phase 2). A frontmatter card wraps its content,
// so its rendered size is the ONE node quantity that can't be derived from
// the model's x/y/w/h. Rather than let wires/layout read it live from the
// DOM (the old desync source), we measure it ONCE per paint here, in a
// batched rAF, and store it in state.measured. Readers (wires obstacles,
// avoid-router, Tidy) then size footprints from the model alone. If a
// measurement changed (first paint, fm edit, frontmatter toggle) the card's
// obstacle footprint changed, so we redraw wires AND re-route — otherwise a
// grown card would block routes computed against its old size. ensureRoutes
// dedupes on the obstacle signature, so this settles instead of looping.
function measureCards(ctx: AppContext, nodeEls: Map<string, HTMLElement>, drawWires: () => void): void {
  const { state } = ctx;
  let changed = false;
  for (const [id, el] of nodeEls) {
    if (measureOneCard(state, id, el)) changed = true;
  }
  if (changed) drawWires();
}

// Whether a measure pass is already queued for this frame — mutated through
// this small holder so scheduleMeasure/measureCards can live at module scope
// instead of as closures nested inside initRender (keeps its own body thin).
interface MeasureFlag { scheduled: boolean; }

function scheduleMeasure(
  ctx: AppContext,
  nodeEls: Map<string, HTMLElement>,
  drawWires: () => void,
  flag: MeasureFlag,
): void {
  if (flag.scheduled) return;
  flag.scheduled = true;
  requestAnimationFrame(() => {
    flag.scheduled = false;
    measureCards(ctx, nodeEls, drawWires);
  });
}

// Per-instance render dependencies, bundled so renderImpl stays under the
// file's max-params budget while every piece of state stays scoped to the
// initRender() call that created it (no module-level shared instance state).
interface RenderDeps {
  world: HTMLElement;
  drawWires: () => void;
  statusEl: HTMLElement;
  nodeEls: Map<string, HTMLElement>;
  measureFlag: MeasureFlag;
}

// One render pass's container/traced snapshot, taken once and reused for
// every node — so a change mid-pass (there isn't one; documents the intent)
// can never make two nodes in the same paint disagree on the current level.
interface RenderFrame { container: string | null; traced: string | null; }

// create-new/patch-existing one node, then re-append it in order (a move,
// not a rebuild). Split out of renderImpl so the per-id loop body doesn't
// count its statements toward renderImpl's own budget.
function renderOneNode(ctx: AppContext, deps: RenderDeps, id: string, frame: RenderFrame): void {
  const view: NodeView = { id, node: ctx.state.nodes[id], isContainer: id === frame.container, traced: frame.traced };
  const el = ensureNodeEl(ctx, deps.nodeEls, view);
  applyCheapPatches(ctx, el, view);
  syncEditableLabel(ctx, el, id);
  deps.world.appendChild(el);   // reorder existing into place; append new
}

// Persistent node-element cache: model id -> rendered element. This is the
// core of the keyed diff. render() no longer destroys and rebuilds every
// node each call; it keeps element identity stable, removes only ids that
// left the level, creates only new ids, and patches the rest in place. Stable
// identity is why a position written by the drag fast-path, or an
// in-progress inline edit, survives a render instead of being blown away.
function renderImpl(ctx: AppContext, deps: RenderDeps): void {
  const { state, runtime } = ctx;
  // if the focused container was removed (e.g. via undo), fall back to root
  if (ctx.view.container && !state.nodes[ctx.view.container]) ctx.view.container = null;
  const frame: RenderFrame = { container: ctx.view.container, traced: runtime.tracedType };

  const ids = levelIds(state, frame.container);
  pruneRemovedNodes(deps.nodeEls, new Set(ids));
  for (const id of ids) renderOneNode(ctx, deps, id, frame);

  updateEmptyHint(ctx);

  deps.drawWires();
  updateStatus(ctx, deps.statusEl);
  ctx.hooks.drawMinimap();

  // after this paint, measure each card once and reconcile the model; a
  // changed size redraws wires and re-routes (see scheduleMeasure)
  scheduleMeasure(ctx, deps.nodeEls, deps.drawWires, deps.measureFlag);
}

/**
 * @param drawWires edge-drawing function from the wires module (injected
 *        to keep render free of a direct import cycle with wires).
 */
export function initRender(ctx: AppContext, drawWires: () => void): RenderApi {
  const deps: RenderDeps = {
    world: ctx.dom.world,
    drawWires,
    statusEl: document.getElementById('status') as HTMLElement,
    nodeEls: new Map<string, HTMLElement>(),
    measureFlag: { scheduled: false },
  };

  function render(): void {
    renderImpl(ctx, deps);
  }
  function updateStatusFn(): void {
    updateStatus(ctx, deps.statusEl);
  }

  return { render, updateStatus: updateStatusFn };
}
