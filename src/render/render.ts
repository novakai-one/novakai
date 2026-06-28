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
import { childIdsOf } from '../core/state/state';
import { isFrontmatterEmpty, parseTypeRef, nodeUsesType } from '../core/frontmatter/frontmatter';

export interface RenderApi {
  render: () => void;
  updateStatus: () => void;
}

/** Crisp SVG geometry for diamond / hex / cylinder shapes. */
export function shapeMarkup(n: DiagramNode): string {
  const w = n.w, h = n.h;
  const color = nodeFill(n);
  const fill = color ? ` style="fill:${color}"` : '';
  const svg = (inner: string): string =>
    `<svg class="shape-svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">${inner}</svg>`;
  if (n.shape === 'diamond') {
    const pts = `${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`;
    return svg(`<polygon class="shp" points="${pts}"${fill}/>`);
  }
  if (n.shape === 'hex') {
    const i = Math.min(w * 0.22, h * 0.5);
    const pts = `${i},0 ${w - i},0 ${w},${h / 2} ${w - i},${h} ${i},${h} 0,${h / 2}`;
    return svg(`<polygon class="shp" points="${pts}"${fill}/>`);
  }
  if (n.shape === 'cylinder') {
    const rx = w / 2, ry = Math.max(6, Math.min(h * 0.16, 22));
    const body = `M 0 ${ry} L 0 ${h - ry} A ${rx} ${ry} 0 0 0 ${w} ${h - ry} L ${w} ${ry} Z`;
    return svg(
      `<path class="shp" d="${body}"${fill}/>` +
      `<ellipse class="shp" cx="${rx}" cy="${ry}" rx="${rx}" ry="${ry}"${fill}/>`,
    );
  }
  return '';
}

/**
 * @param drawWires edge-drawing function from the wires module (injected
 *        to keep render free of a direct import cycle with wires).
 */
/**
 * Build the read-only frontmatter card shown under a node on the canvas.
 * It's an absolutely-positioned overlay (see CSS .fmcard) so it never
 * affects the node's own dimensions. Editing happens in the inspector or
 * via the inline card editor; this is the display form.
 */
export function buildFmCard(fm: Frontmatter, tracedType: string | null): HTMLElement {
  const card = document.createElement('div');
  card.className = 'fmcard';
  const tokens = (items: string[]): string =>
    items.map((s) => fmTokenHtml(s, tracedType)).filter(Boolean).join('');
  const row = (key: string, items: string[]): string => {
    const body = tokens(items);
    return body
      ? `<div class="fmrow"><span class="fmkey">${key}</span><span class="fmval">${body}</span></div>`
      : '';
  };
  let html = '';
  if (fm.name.trim()) html += `<div class="fmrow"><span class="fmkey">name</span><span class="fmval">${nameTokenHtml(fm.name, tracedType)}</span></div>`;
  if (fm.description.trim()) html += `<div class="fmrow"><span class="fmkey">desc</span><span class="fmval">${esc(fm.description)}</span></div>`;
  html += row('state', fm.state);
  // one labelled block per interface; blocks with no accepts/returns are skipped
  for (const iface of fm.interfaces ?? []) {
    const body = row('accepts', iface.accepts) + row('returns', iface.returns);
    if (!body) continue;
    const title = iface.name.trim() ? esc(iface.name) : 'interface';
    html += `<div class="fmiface"><div class="fmiface-name">${title}</div>${body}</div>`;
  }
  card.innerHTML = html;
  return card;
}

/** esc() handles &<> ; also neutralise quotes for use inside an attribute. */
function attr(s: string): string {
  return esc(s).replace(/"/g, '&quot;');
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
  const v = ref.varName ? `<span class="fmvar">${esc(ref.varName)}:</span> ` : '';
  return `<span class="fmtoken">${v}<span class="fmtype${hit}" data-type="${attr(ref.type)}">${esc(ref.type)}</span></span>`;
}

/** The node-level name rendered as its own traceable token (no var part). */
function nameTokenHtml(name: string, tracedType: string | null): string {
  const t = name.trim();
  const hit = tracedType !== null && t === tracedType ? ' is-traced' : '';
  return `<span class="fmtoken"><span class="fmtype${hit}" data-type="${attr(t)}">${esc(name)}</span></span>`;
}

export function initRender(ctx: AppContext, drawWires: () => void): RenderApi {
  const { world } = ctx.dom;
  const statusEl = document.getElementById('status') as HTMLElement;

  // Persistent node-element cache: model id -> rendered element. This is the
  // core of the keyed diff. render() no longer destroys and rebuilds every
  // node each call; it keeps element identity stable, removes only ids that
  // left the level, creates only new ids, and patches the rest in place. A
  // node's inner DOM is rebuilt only when its structural signature changes —
  // otherwise just its className + geometry are touched (cheap). Stable
  // identity is why a position written by the drag fast-path, or an
  // in-progress inline edit, survives a render instead of being blown away.
  const nodeEls = new Map<string, HTMLElement>();

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
  let measureScheduled = false;
  function scheduleMeasure(): void {
    if (measureScheduled) return;
    measureScheduled = true;
    requestAnimationFrame(() => { measureScheduled = false; measureCards(); });
  }
  function measureCards(): void {
    const { state } = ctx;
    let changed = false;
    for (const [id, el] of nodeEls) {
      const card = el.querySelector<HTMLElement>(':scope > .fmcard');
      if (card) {
        const cardW = card.offsetWidth, cardH = card.offsetHeight;
        const prev = state.measured.get(id);
        if (!prev || prev.cardW !== cardW || prev.cardH !== cardH) {
          state.measured.set(id, { cardW, cardH });
          changed = true;
        }
      } else if (state.measured.has(id)) {
        // visible node with no card (frontmatter off / empty): drop any stale size
        state.measured.delete(id);
        changed = true;
      }
    }
    if (changed) drawWires();
  }

  function updateStatus(): void {
    const nc = Object.keys(ctx.state.nodes).length, ec = ctx.state.edges.length;
    let s = `${nc} node${nc !== 1 ? 's' : ''} · ${ec} edge${ec !== 1 ? 's' : ''}`;
    if (ctx.state.sel.size) s += ` · ${ctx.state.sel.size} selected`;
    statusEl.textContent = s;
  }

  const isSvgShape = (n: DiagramNode): boolean =>
    n.shape === 'diamond' || n.shape === 'hex' || n.shape === 'cylinder';

  // className is derived from model + selection/trace/link/edit state and is
  // patched on every render (cheap, never a structural change).
  function classFor(n: DiagramNode, id: string, isContainer: boolean, traced: string | null): string {
    const { state, runtime } = ctx;
    const traceCls = traced ? (nodeUsesType(n.fm, traced) ? ' trace-hit' : ' trace-dim') : '';
    const focusCls = runtime.focusSpine
      ? (runtime.focusSpine.has(id) ? ' focus-hit' : ' focus-dim')
      : '';
    return 'node shape-' + n.shape + (isSvgShape(n) ? ' svgshape' : '')
      + (state.sel.has(id) ? ' selected' : '') + (runtime.linkSrc === id ? ' linksrc' : '')
      + (isContainer ? ' is-container' : '') + (runtime.editingId === id ? ' editing' : '') + traceCls
      + (state.roots.includes(id) ? ' is-root' : '') + focusCls;
  }

  // Everything buildInner() depends on. When unchanged across renders the inner
  // DOM is left alone and only className + geometry are patched.
  function nodeSig(n: DiagramNode, id: string, isContainer: boolean, traced: string | null): string {
    const single = ctx.state.sel.has(id) && ctx.state.sel.size === 1;   // drives resize handles
    const kids = childIdsOf(ctx.state, id).length;                      // drives the enter-btn count
    const fmPart = ctx.prefs.showFrontmatter && n.fm && !isFrontmatterEmpty(n.fm) ? JSON.stringify(n.fm) : '';
    const dims = isSvgShape(n) ? `${n.w}x${n.h}` : '';                  // svg shape markup depends on size
    return [n.shape, n.label, n.kind ?? '', single ? 's' : '', isContainer ? 'c' : '', kids, dims, traced ?? '', nodeFill(n) ?? '', fmPart].join('\u0001');
  }

  // (re)build the inner DOM of a node element from the model
  function buildInner(el: HTMLElement, n: DiagramNode, id: string, isContainer: boolean, traced: string | null): void {
    const { state } = ctx;
    el.textContent = '';   // clear previous inner (children + text)

    if (isSvgShape(n)) el.insertAdjacentHTML('beforeend', shapeMarkup(n));

    const lab = document.createElement('span');
    lab.className = 'label';
    lab.textContent = n.label;
    el.appendChild(lab);   // contenteditable is toggled in render(), not here

    // semantic kind badge (corner chip)
    if (n.kind) {
      const kb = document.createElement('span');
      kb.className = 'kindbadge';
      kb.textContent = KIND_BADGE[n.kind];
      el.appendChild(kb);
    }

    // drill-in affordance: open this node's internal level. Skipped for groups,
    // notes, and the container itself (you're already inside it).
    if (n.shape !== 'group' && n.shape !== 'note' && !isContainer) {
      const kids = childIdsOf(state, id).length;
      const enter = document.createElement('button');
      enter.className = 'enter-btn' + (kids ? ' has-kids' : '');
      enter.title = kids ? `Open internals (${kids})` : 'Open internals';
      enter.textContent = kids ? String(kids) : '\u21f2';
      enter.onpointerdown = (ev) => ev.stopPropagation();
      enter.onclick = (ev) => { ev.stopPropagation(); ctx.hooks.enterContainer(id); };
      el.appendChild(enter);
    }

    // ports
    (['pt', 'pb', 'pl', 'pr'] as const).forEach((p) => {
      const port = document.createElement('div');
      port.className = 'port ' + p;
      port.dataset.port = id; port.dataset.side = p;
      el.appendChild(port);
    });

    // resize handles only when single-selected
    if (state.sel.has(id) && state.sel.size === 1) {
      (['nw', 'ne', 'sw', 'se'] as const).forEach((c) => {
        const h = document.createElement('div');
        h.className = 'rsz ' + c; h.dataset.rsz = c; h.dataset.id = id;
        el.appendChild(h);
      });
    }

    // frontmatter card: an overlay BELOW the node, outside its box model, so
    // showing/hiding it never changes node size or spacing
    if (ctx.prefs.showFrontmatter && n.fm && !isFrontmatterEmpty(n.fm)) {
      el.appendChild(buildFmCard(n.fm, traced));
    }
  }

  function render(): void {
    const { state, runtime } = ctx;
    // if the focused container was removed (e.g. via undo), fall back to root
    if (ctx.view.container && !state.nodes[ctx.view.container]) ctx.view.container = null;
    const container = ctx.view.container;
    const traced = runtime.tracedType;

    // nodes at the current drill level; groups first (z-order). The drilled
    // container itself is appended last so it renders as a real, interactive
    // node (the level anchor) above its children.
    const ids = childIdsOf(state, container).sort((a, b) =>
      (state.nodes[a].shape === 'group' ? 0 : 1) - (state.nodes[b].shape === 'group' ? 0 : 1));
    if (container && state.nodes[container]) ids.push(container);
    const desired = new Set(ids);

    // remove cached elements whose id is no longer shown at this level
    for (const [id, el] of nodeEls) {
      if (!desired.has(id)) { el.remove(); nodeEls.delete(id); }
    }

    // create new / patch existing, then re-append in order (moves, not rebuilds)
    for (const id of ids) {
      const n = state.nodes[id];
      const isContainer = id === container;
      const sig = nodeSig(n, id, isContainer, traced);

      let el = nodeEls.get(id);
      if (!el) {
        el = document.createElement('div');
        el.dataset.id = id;
        nodeEls.set(id, el);
        buildInner(el, n, id, isContainer, traced);
        el.dataset.sig = sig;
      } else if (el.dataset.sig !== sig && runtime.editingId !== id) {
        // structural change (and not mid-edit): rebuild this node's inner DOM
        buildInner(el, n, id, isContainer, traced);
        el.dataset.sig = sig;
      }

      // always-cheap patches: className + geometry + fill
      el.className = classFor(n, id, isContainer, traced);
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      el.style.width = n.w + 'px';
      el.style.height = n.h + 'px';
      const fill = nodeFill(n);
      el.style.background = (fill && !isSvgShape(n) && n.shape !== 'group' && n.shape !== 'note') ? fill : '';

      // toggle inline-edit contenteditable on the persistent label (independent
      // of inner rebuild, so starting/ending an edit always lands correctly)
      const lab = el.querySelector<HTMLElement>(':scope > .label');
      if (lab) {
        if (runtime.editingId === id) lab.setAttribute('contenteditable', 'true');
        else lab.removeAttribute('contenteditable');
      }

      world.appendChild(el);   // reorder existing into place; append new
    }

    // empty-state hint when a drilled container has no internals yet
    const emptyEl = document.getElementById('levelEmpty');
    if (emptyEl) {
      const showEmpty = !!container && childIdsOf(state, container).length === 0;
      emptyEl.style.display = showEmpty ? 'block' : 'none';
      if (showEmpty && ctx.view.container) {
        const cname = esc(state.nodes[ctx.view.container]?.label || 'this node');
        emptyEl.innerHTML = `<b>${cname}</b> has no internals yet.<br>`
          + `Drop a shape \u2014 it lands inside <b>${cname}</b>.<br>`
          + `Or select a node and set its <b>Parent</b> to <b>${cname}</b> in the inspector.`;
      }
    }

    drawWires();
    updateStatus();
    ctx.hooks.drawMinimap();

    // after this paint, measure each card once and reconcile the model; a
    // changed size redraws wires and re-routes (see scheduleMeasure)
    scheduleMeasure();
  }

  return { render, updateStatus };
}
