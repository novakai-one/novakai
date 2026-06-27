/* =====================================================================
   inspector.ts — the right-hand property editor
   ---------------------------------------------------------------------
   Responsibility: render the Inspector pane for whatever is selected —
   a single node (label/shape/fill/size/pos), multiple nodes (align,
   distribute, bulk fill, group, delete), or an edge (label/style/routing/
   reverse/delete). Wires each control back to the model + render/sync/
   history. Read-render-write against the current selection.

   Depends on nodes (align/group/delete) and selection (clearSel).
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { NodesApi } from '../interaction/nodes';
import type { SelectionApi } from '../interaction/selection';
import type { NodeKind } from '../core/types';
import { SHAPES, KINDS, PALETTE, PALETTE_NAMES, STYLES, DEFAULTS, esc } from '../core/config';
import { isAncestor } from '../core/state';
import { initInspectorFrontmatter } from './inspector-frontmatter';

export interface InspectorApi {
  renderInspector: () => void;
}

export function initInspector(ctx: AppContext, nodes: NodesApi, selection: SelectionApi): InspectorApi {
  const { state } = ctx;
  const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;
  const inspEmpty = $('inspEmpty');
  const inspBody = $('inspBody');
  const fmEditor = initInspectorFrontmatter(ctx);

  function renderInspector(): void {
    const has = state.sel.size || state.selEdge;
    if (!has) {
      inspEmpty.style.display = 'block';
      inspBody.style.display = 'none';
      updateStatus();
      updateSource();
      return;
    }
    inspEmpty.style.display = 'none';
    inspBody.style.display = 'flex';

    if (state.selEdge) { renderEdgeInspector(inspBody); updateStatus(); updateSource(); return; }
    if (state.sel.size > 1) { renderMultiInspector(inspBody); updateStatus(); updateSource(); return; }

    renderSingleInspector(inspBody);
    updateStatus();
    updateSource();
  }

  function updateSource(): void {
    const sourceEmpty = document.getElementById('sourceEmpty');
    const sourceBody = document.getElementById('sourceBody');
    if (!sourceEmpty || !sourceBody) return;

    // show body only for single-node selection with a matching bodies entry
    if (state.sel.size !== 1) {
      sourceEmpty.style.display = 'block';
      sourceBody.style.display = 'none';
      return;
    }
    const id = [...state.sel][0];
    const entry = ctx.bodies?.get(id);
    if (!entry) {
      sourceEmpty.style.display = 'block';
      sourceBody.style.display = 'none';
      sourceEmpty.innerHTML = ctx.bodies
        ? `No source found for <code>${esc(id)}</code>.<br>Ensure the node id matches a <code>@flowmap-node</code> banner.`
        : `Select a node to view its source code.<br><br>Run <code>extract.mjs --bodies</code> against your TS project to generate <code>bodies.json</code>.`;
      return;
    }
    sourceEmpty.style.display = 'none';
    sourceBody.style.display = 'block';
    // signature header (real param types + return) above the body, when present
    let sig = '';
    const acc = entry.accepts ?? [];
    const ret = entry.returns ?? null;
    if (acc.length || ret) {
      const params = acc.map((a) => `  ${esc(a)}`).join(',\n');
      const head = acc.length ? `(\n${params}\n)` : `()`;
      const tail = ret ? ` → ${esc(ret)}` : '';
      sig = `<span class="src-sig">${head}${tail}</span>`;
    }
    sourceBody.innerHTML = `<span class="src-kind">${esc(entry.kind)}</span>${sig}${esc(entry.body)}`;
  }

  function updateStatus(): void {
    const statusEl = document.getElementById('status');
    if (!statusEl) return;
    const nc = Object.keys(state.nodes).length, ec = state.edges.length;
    let s = `${nc} node${nc !== 1 ? 's' : ''} · ${ec} edge${ec !== 1 ? 's' : ''}`;
    if (state.sel.size) s += ` · ${state.sel.size} selected`;
    statusEl.textContent = s;
  }

  function renderSingleInspector(body: HTMLElement): void {
    const n = state.nodes[[...state.sel][0]];
    body.innerHTML = `
      <div class="field"><label>Label</label><input id="iLabel" value="${esc(n.label)}"></div>
      <div class="field"><label>Shape</label><select id="iShape">${
        SHAPES.map((s) => `<option value="${s}" ${s === n.shape ? 'selected' : ''}>${s}</option>`).join('')
      }</select></div>
      <div class="field"><label>Kind</label><select id="iKind"><option value="" ${!n.kind ? 'selected' : ''}>(none)</option>${
        KINDS.map((k) => `<option value="${k}" ${k === n.kind ? 'selected' : ''}>${k}</option>`).join('')
      }</select></div>
      <div class="field"><label>Parent (drill container)</label><select id="iParent"><option value="" ${!n.parent ? 'selected' : ''}>Top level</option>${
        Object.keys(state.nodes)
          .filter((pid) => pid !== n.id && !isAncestor(state, n.id, pid))
          .map((pid) => `<option value="${pid}" ${pid === n.parent ? 'selected' : ''}>${esc(state.nodes[pid].label)}${state.nodes[pid].shape === 'group' ? ' (group)' : ''}</option>`).join('')
      }</select></div>
      <div class="field"><label>Fill</label><div class="swatches" id="iSw">${
        PALETTE.map((c, i) => `<div class="sw ${c === n.color ? 'on' : ''}" data-c="${c}" title="${PALETTE_NAMES[i]}" style="background:${c}"></div>`).join('')
      }</div></div>
      <div class="insp-sec-title">Size & position</div>
      <div class="row2">
        <div class="field"><label>W</label><input id="iW" type="number" value="${Math.round(n.w)}"></div>
        <div class="field"><label>H</label><input id="iH" type="number" value="${Math.round(n.h)}"></div>
      </div>
      <div class="row2">
        <div class="field"><label>X</label><input id="iX" type="number" value="${Math.round(n.x)}"></div>
        <div class="field"><label>Y</label><input id="iY" type="number" value="${Math.round(n.y)}"></div>
      </div>
      <div id="fmHost" class="fm-host"></div>
      <button class="filebtn danger" id="iDel">Delete node</button>`;

    const labelInp = $('iLabel') as HTMLInputElement;
    labelInp.oninput = (e) => { n.label = (e.target as HTMLInputElement).value; ctx.hooks.render(); ctx.hooks.sync(); };
    labelInp.onchange = () => ctx.hooks.pushHistory();

    ($('iShape') as HTMLSelectElement).onchange = (e) => {
      n.shape = (e.target as HTMLSelectElement).value as typeof n.shape;
      void DEFAULTS[n.shape];
      ctx.hooks.render(); ctx.hooks.sync(); renderInspector(); ctx.hooks.pushHistory();
    };

    ($('iKind') as HTMLSelectElement).onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      n.kind = v ? (v as NodeKind) : null;
      ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory();
    };

    ($('iParent') as HTMLSelectElement).onchange = (e) => {
      const v = (e.target as HTMLSelectElement).value;
      n.parent = v || null;
      ctx.hooks.render(); ctx.hooks.sync(); renderInspector(); ctx.hooks.pushHistory();
    };

    $('iSw').querySelectorAll('.sw').forEach((sw) => {
      (sw as HTMLElement).onclick = () => {
        n.color = (sw as HTMLElement).dataset.c === 'null' ? null : (sw as HTMLElement).dataset.c as string;
        ctx.hooks.render(); ctx.hooks.sync(); renderInspector(); ctx.hooks.pushHistory();
      };
    });

    (['W', 'H', 'X', 'Y'] as const).forEach((k) => {
      const inp = $('i' + k) as HTMLInputElement;
      inp.oninput = () => {
        const v = +inp.value || 0;
        if (k === 'W') n.w = Math.max(40, v);
        if (k === 'H') n.h = Math.max(30, v);
        if (k === 'X') n.x = v;
        if (k === 'Y') n.y = v;
        ctx.hooks.render(); ctx.hooks.sync();
      };
      inp.onchange = () => ctx.hooks.pushHistory();
    });

    ($('iDel') as HTMLButtonElement).onclick = () => nodes.deleteSelection();

    // frontmatter editor (its own module; mirrors the label edit pattern)
    fmEditor.renderFrontmatterSection($('fmHost'), n);
  }

  function renderMultiInspector(body: HTMLElement): void {
    body.innerHTML = `
      <div class="multi-note">${state.sel.size} nodes selected</div>
      <div class="insp-sec-title">Align</div>
      <div class="align-grid">
        <button class="filebtn" data-al="left"   title="Align left">⬅</button>
        <button class="filebtn" data-al="cx"     title="Center horizontally">↔</button>
        <button class="filebtn" data-al="right"  title="Align right">➡</button>
        <button class="filebtn" data-al="top"    title="Align top">⬆</button>
        <button class="filebtn" data-al="cy"     title="Center vertically">↕</button>
        <button class="filebtn" data-al="bottom" title="Align bottom">⬇</button>
      </div>
      <div class="insp-sec-title">Distribute</div>
      <div class="row2">
        <button class="filebtn" data-al="dh">Horizontal</button>
        <button class="filebtn" data-al="dv">Vertical</button>
      </div>
      <div class="insp-sec-title">Fill</div>
      <div class="field"><div class="swatches" id="mSw">${
        PALETTE.map((c, i) => `<div class="sw" data-c="${c}" title="${PALETTE_NAMES[i]}" style="background:${c}"></div>`).join('')
      }</div></div>
      <button class="filebtn" id="mGroup">Wrap in group</button>
      <button class="filebtn danger" id="mDel">Delete ${state.sel.size} nodes</button>`;

    body.querySelectorAll('[data-al]').forEach((b) => {
      (b as HTMLElement).onclick = () => { nodes.alignNodes((b as HTMLElement).dataset.al as string); ctx.hooks.pushHistory(); };
    });
    $('mSw').querySelectorAll('.sw').forEach((sw) => {
      (sw as HTMLElement).onclick = () => {
        const c = (sw as HTMLElement).dataset.c === 'null' ? null : (sw as HTMLElement).dataset.c as string;
        state.sel.forEach((id) => {
          if (state.nodes[id].shape !== 'group' && state.nodes[id].shape !== 'note') state.nodes[id].color = c;
        });
        ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory();
      };
    });
    ($('mGroup') as HTMLButtonElement).onclick = () => nodes.wrapInGroup();
    ($('mDel') as HTMLButtonElement).onclick = () => nodes.deleteSelection();
  }

  function renderEdgeInspector(body: HTMLElement): void {
    const e = state.edges.find((x) => x.id === state.selEdge);
    if (!e) { selection.clearSel(); return; }
    const from = state.nodes[e.from], to = state.nodes[e.to];
    body.innerHTML = `
      <div class="multi-note" style="font-size:11.5px; color:var(--ink-dim)">${esc(from?.label || '?')} → ${esc(to?.label || '?')}</div>
      <div class="field"><label>Edge label</label><input id="eLabel" value="${esc(e.label || '')}" placeholder="writes / reads / fires"></div>
      <div class="field"><label>Line style</label><select id="eStyle">${
        Object.keys(STYLES).map((s) => `<option ${s === e.style ? 'selected' : ''}>${s}</option>`).join('')
      }</select></div>
      <div class="field"><label>Routing</label><select id="eRoute">
        <option value="straight" ${e.routing !== 'ortho' ? 'selected' : ''}>straight</option>
        <option value="ortho" ${e.routing === 'ortho' ? 'selected' : ''}>orthogonal</option>
      </select></div>
      <button class="filebtn" id="eReset">Reset route &amp; label</button>
      <button class="filebtn" id="eFlip">Reverse direction</button>
      <button class="filebtn danger" id="eDel">Delete edge</button>`;

    const labelInp = $('eLabel') as HTMLInputElement;
    labelInp.oninput = (ev) => { e.label = (ev.target as HTMLInputElement).value; ctx.hooks.render(); ctx.hooks.sync(); };
    labelInp.onchange = () => ctx.hooks.pushHistory();
    ($('eStyle') as HTMLSelectElement).onchange = (ev) => { e.style = (ev.target as HTMLSelectElement).value as typeof e.style; ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory(); };
    ($('eRoute') as HTMLSelectElement).onchange = (ev) => { e.routing = (ev.target as HTMLSelectElement).value as typeof e.routing; ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory(); };
    ($('eReset') as HTMLButtonElement).onclick = () => { e.bend = null; e.labelPos = null; ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.reroute(); ctx.hooks.pushHistory(); };
    ($('eFlip') as HTMLButtonElement).onclick = () => { const t = e.from; e.from = e.to; e.to = t; ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.pushHistory(); };
    ($('eDel') as HTMLButtonElement).onclick = () => { state.edges = state.edges.filter((x) => x.id !== e.id); selection.clearSel(); ctx.hooks.sync(); ctx.hooks.pushHistory(); };
  }

  return { renderInspector };
}
