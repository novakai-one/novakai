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

import type { AppContext } from '../core/context';
import type { DiagramNode, Frontmatter } from '../core/types';
import { esc, KIND_BADGE } from '../core/config';
import { childIdsOf } from '../core/state';
import { isFrontmatterEmpty, parseTypeRef, nodeUsesType } from '../core/frontmatter';

export interface RenderApi {
  render: () => void;
  updateStatus: () => void;
}

/** Crisp SVG geometry for diamond / hex / cylinder shapes. */
export function shapeMarkup(n: DiagramNode): string {
  const w = n.w, h = n.h;
  const fill = n.color ? ` style="fill:${n.color}"` : '';
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

  function updateStatus(): void {
    const nc = Object.keys(ctx.state.nodes).length, ec = ctx.state.edges.length;
    let s = `${nc} node${nc !== 1 ? 's' : ''} · ${ec} edge${ec !== 1 ? 's' : ''}`;
    if (ctx.state.sel.size) s += ` · ${ctx.state.sel.size} selected`;
    statusEl.textContent = s;
  }

  function render(): void {
    const { state, runtime } = ctx;
    // if the focused container was removed (e.g. via undo), fall back to root
    if (ctx.view.container && !state.nodes[ctx.view.container]) ctx.view.container = null;
    // remove old nodes + edge labels but keep the <svg> wires element
    [...world.querySelectorAll('.node, .edgelabel, .boundary-stub, .level-root')].forEach((e) => e.remove());

    // nodes at the current drill level; groups first (z-order). The drilled
    // container itself is appended last so it renders as a real, interactive
    // node (the level anchor) above its children.
    const container = ctx.view.container;
    const ids = childIdsOf(state, container).sort((a, b) =>
      (state.nodes[a].shape === 'group' ? 0 : 1) - (state.nodes[b].shape === 'group' ? 0 : 1));
    if (container && state.nodes[container]) ids.push(container);

    const traced = runtime.tracedType;

    for (const id of ids) {
      const n = state.nodes[id];
      const el = document.createElement('div');
      const isSel = state.sel.has(id);
      const isContainer = id === container;
      const svgShape = (n.shape === 'diamond' || n.shape === 'hex' || n.shape === 'cylinder');
      const traceCls = traced
        ? (nodeUsesType(n.fm, traced) ? ' trace-hit' : ' trace-dim')
        : '';
      el.className = 'node shape-' + n.shape + (svgShape ? ' svgshape' : '')
        + (isSel ? ' selected' : '') + (runtime.linkSrc === id ? ' linksrc' : '')
        + (isContainer ? ' is-container' : '') + traceCls;
      el.dataset.id = id;
      el.style.left = n.x + 'px';
      el.style.top = n.y + 'px';
      el.style.width = n.w + 'px';
      el.style.height = n.h + 'px';
      // custom fill: simple shapes paint the div, svg shapes paint the path
      if (n.color && !svgShape && n.shape !== 'group' && n.shape !== 'note') el.style.background = n.color;

      if (svgShape) el.insertAdjacentHTML('beforeend', shapeMarkup(n));

      const lab = document.createElement('span');
      lab.className = 'label';
      lab.textContent = n.label;
      el.appendChild(lab);
      // keep an in-progress inline edit alive across re-renders
      if (runtime.editingId === id) {
        el.classList.add('editing');
        lab.setAttribute('contenteditable', 'true');
      }

      // semantic kind badge (corner chip)
      if (n.kind) {
        const kb = document.createElement('span');
        kb.className = 'kindbadge';
        kb.textContent = KIND_BADGE[n.kind];
        el.appendChild(kb);
      }

      // drill-in affordance: open this node's internal level. Skipped for
      // groups, notes, and the container itself (you're already inside it).
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
      if (isSel && state.sel.size === 1) {
        (['nw', 'ne', 'sw', 'se'] as const).forEach((c) => {
          const h = document.createElement('div');
          h.className = 'rsz ' + c; h.dataset.rsz = c; h.dataset.id = id;
          el.appendChild(h);
        });
      }

      // frontmatter card: an overlay BELOW the node, outside its box model,
      // so showing/hiding it never changes node size or spacing
      if (ctx.prefs.showFrontmatter && n.fm && !isFrontmatterEmpty(n.fm)) {
        el.appendChild(buildFmCard(n.fm, traced));
      }

      world.appendChild(el);
    }

    // (the drilled container is now rendered as a real node in the loop above)

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
  }

  return { render, updateStatus };
}
