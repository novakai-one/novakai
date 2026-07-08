/* =====================================================================
   unfold-inspect.ts — reading mode: group selection, blast radius, the
   inspector (empty until selection), the trust layer, plus the layers
   toggle strip and the browse tree (both live in the same P-panel as
   the inspector), split out of unfold.ts in place. Every symbol here
   used to be a closure over initUnfold's locals; those locals now live
   on the shared `E: UEnv` object unfold.ts constructs and passes to
   every sibling factory, and this factory attaches its own functions
   back onto `E` so the other siblings (and unfold.ts itself) can call
   them.
   ===================================================================== */

import { esc } from '../../core/config/config';
import { SYM_KINDS } from './unfold-view';
import type { UEnv, UNode, UEdge } from './unfold';

const LAYER_DEFS: Array<{ k: string; label: string; desc: string }> = [
  { k: 'calls',   label: 'calls',         desc: 'solid call wires' },
  { k: 'deps',    label: 'dependencies',  desc: 'dotted dependency wires' },
  { k: 'desc',    label: 'descriptions',  desc: 'one-line role under each name' },
  { k: 'iface',   label: 'interfaces',    desc: 'accepts / returns on cards' },
  { k: 'metrics', label: 'metrics',       desc: 'child counts · fan-in' },
  { k: 'color',   label: 'colour',        desc: 'tint by kind' },
  { k: 'trust',   label: 'trust',         desc: 'mark advisory claims and edges' },
  { k: 'blast',   label: 'blast radius',  desc: 'ripple what depends on the selection' },
];

export function initUnfoldInspect(E: UEnv): void {
  /* ---- blast radius: transitive dependents of the selection ---- */
  let BLAST_N = 0;
  function computeBlast(): void {
    E.REP_HOPS.clear(); BLAST_N = 0;
    if (!E.spec.layers.blast || !E.spec.sel) return;
    // U6: a selected container blasts from its whole subtree — hier groups are not
    // edge endpoints, so seeding only the group id would find nothing and dim everything
    const seeds = new Set<string>([E.spec.sel]);
    if (E.isContainer(E.U.get(E.spec.sel))) {
      (function walk(x: string): void {
        (E.U.get(x)?.children ?? []).forEach((childId) => { if (!seeds.has(childId)) { seeds.add(childId); walk(childId); } });
      })(E.spec.sel);
    }
    const hop = new Map<string, number>([...seeds].map((seed) => [seed, 0] as [string, number]));
    const bq: string[] = [...seeds];
    while (bq.length) {
      const x = bq.shift() as string;
      for (const inEdge of E.IN[x] ?? []) if (!hop.has(inEdge.from)) { hop.set(inEdge.from, (hop.get(x) ?? 0) + 1); bq.push(inEdge.from); }
    }
    for (const seed of seeds) hop.delete(seed);
    BLAST_N = hop.size;
    const selRep = E.visibleRep(E.spec.sel);
    for (const [id, hp] of hop) {
      const rep = E.visibleRep(id);
      if (!rep || rep === selRep) continue;
      const cur = E.REP_HOPS.get(rep);
      if (cur == null || hp < cur) E.REP_HOPS.set(rep, hp);
    }
  }

  /* ---- trust: A5 advisory edges from an OPTIONAL source ---- */
  function parseAllow(text: string): void {
    E.ALLOW.clear();
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('->')) continue;
      E.ALLOW.add(trimmed);
    }
  }
  /** trust layer with an OPTIONAL advisory source: the same-origin allowlist when present
      (this repo, dev server), a Load button otherwise (any repo). Absent source = the
      layer stays disabled — it never marks anything it cannot back. */
  function trustLayer(): void {
    const trustFileEl = document.createElement('input');
    trustFileEl.type = 'file';
    trustFileEl.accept = '.txt,text/plain';
    trustFileEl.onchange = () => {
      const file = trustFileEl.files?.[0];
      if (!file) return;
      void file.text().then((t) => { parseAllow(t); E.TRUST_SRC = true; renderLayers(); E.render(false); });
    };
    E.trustFileEl = trustFileEl;
    fetch('docs/novakai/edge-advisory-allowlist.txt')
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('text/plain') ? r.text() : null))
      .then((t) => {
        if (t == null || !t.includes('->')) return;
        parseAllow(t);
        E.TRUST_SRC = true;
        renderLayers();
      })
      .catch(() => { /* no same-origin source — the Load button remains the door */ });
  }

  /** U6: a group is a first-class selectable (U6): select + inspect, never stage (U8 deferred).
      The sel/selWire/focusType/fmOpen exclusions live in the reducer; the staged /
      blast / plain repaints live in paint('select'). */
  function selectGroup(id: string): void {
    E.commit({ type: 'select', id });
  }
  function select(id: string): void {
    selectGroup(id);
  }
  /** C2: stage target for a card's explicit Stage button — the exact projection
      rule formerly auto-run inside select(): a non-group card stages its container
      parent, a top-level container stages itself, anything else has no stage. */
  function stageTargetOf(u: UNode): string | null {
    if (u.kind === 'group') return null;
    if (u.parent && E.isContainer(E.U.get(u.parent))) return u.parent;
    if (!u.parent && E.isContainer(u)) return u.id;
    return null;
  }

  /* ================= INSPECTOR (empty until selection) ================= */
  /** U6: external connections of a container — every edge with exactly one endpoint
      inside the subtree, aggregated to the coarsest foreign container and weight-summed
      (the same grammar as stage pills: frame = subtree + ancestors, so a sibling stays
      itself and a foreign subtree compresses into its top group) */
  function groupConns(id: string): { uses: [string, number][]; usedBy: [string, number][] } {
    const sub = new Set<string>();
    (function walk(x: string): void {
      if (sub.has(x)) return;
      sub.add(x);
      (E.U.get(x)?.children ?? []).forEach(walk);
    })(id);
    const frame = new Set(sub);
    let cur = E.U.get(id);
    const seen = new Set<string>();
    while (cur && cur.parent && !seen.has(cur.id)) { seen.add(cur.id); frame.add(cur.parent); cur = E.U.get(cur.parent); }
    const uses = new Map<string, number>(), usedBy = new Map<string, number>();
    for (const edge of E.EDGES) {
      const fi = sub.has(edge.from), ti = sub.has(edge.to);
      if (fi === ti) continue;
      const bucket = fi ? uses : usedBy;
      const other = E.proxyTargetOf(fi ? edge.to : edge.from, frame);
      bucket.set(other, (bucket.get(other) ?? 0) + edge.w);
    }
    const byWeight = (m: Map<string, number>): [string, number][] =>
      [...m.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
    return { uses: byWeight(uses), usedBy: byWeight(usedBy) };
  }

  /** every [data-goto] anchor inside a just-painted inspector block routes through goTo */
  function wireGotoLinks(el: HTMLElement): void {
    el.querySelectorAll<HTMLElement>('[data-goto]').forEach((r) => {
      r.onclick = () => E.goTo(r.dataset.goto as string);
    });
  }
  /** the '⋯' actions-menu toggle + its mounted panel — shared by the wire and node inspectors */
  function wireActionsMenu(el: HTMLElement): void {
    const menuBtn = el.querySelector('#ufIMenu') as HTMLElement | null;
    if (menuBtn) menuBtn.onclick = (ev) => { ev.stopPropagation(); E.actionsMenuOpen = !E.actionsMenuOpen; renderInspector(); };
    const menuHost = el.querySelector('#ufActionsMenu') as HTMLElement | null;
    if (menuHost) menuHost.appendChild(E.buildActionsMenu());
  }
  /** U1: focused-type inspector — every carrier of the clicked type name */
  function renderTypeFocusInspector(el: HTMLElement, t: string): void {
    const carriers = [...E.U.keys()].filter((id) => E.carriesType(id, t));
    el.innerHTML = `<div class="uf-ihead">
      <span class="uf-ikind">type</span>
      <div class="uf-iname uf-mono">${esc(t)}</div>
    </div>
    <div class="uf-blk"><div class="uf-ilab2">carried by (${carriers.length})</div>
    ${carriers.map((id) =>
      `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">·</span><span class="uf-cn">${esc(E.U.get(id)?.label ?? id)}</span></div>`).join('')}
    </div>`;
    wireGotoLinks(el);
  }
  /** the rendered rep pair's underlying model edges: in explore this is the same pure lift
      the painter draws (neutral pass, unordered anchor match); staged keeps its own rep
      aggregation (untouched by P-wires) */
  function computeWireUnderlying(a: string, b: string): UEdge[] {
    if (E.spec.stage) {
      return E.EDGES.filter((e) =>
        ((e.call && E.spec.layers.calls) || (e.dep && E.spec.layers.deps)) && E.stageRepOf(e.from) === a && E.stageRepOf(e.to) === b);
    }
    const lifted = E.computeLifted(true).find((w2) => (w2.a === a && w2.b === b) || (w2.a === b && w2.b === a));
    return (lifted?.underlying ?? [])
      .map((u2) => E.EDGES.find((e) => e.from === u2.from && e.to === u2.to))
      .filter((e): e is UEdge => !!e);
  }
  /** U2: the selected wire is an information object — endpoints, kind, direction,
      weight, and every underlying model relation it aggregates (legacy-editor parity) */
  function renderWireInspector(el: HTMLElement, a: string, b: string): void {
    const ua = E.gu(a), ub = E.gu(b);
    const unders = computeWireUnderlying(a, b);
    if (!unders.length) {
      // the aggregate no longer exists in this projection — drop the selection through the reducer
      E.apply({ type: 'selectWire', a, b });
      el.innerHTML = '';
      return;
    }
    const weight = unders.reduce((s, e) => s + e.w, 0);
    const kinds = [unders.some((e) => e.call) ? 'call' : '', unders.some((e) => e.dep) ? 'dependency' : '']
      .filter(Boolean).join(' + ') || 'wire';
    const ep = (id: string, arrow: string, tag: string): string =>
      `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">${arrow}</span><span class="uf-cn">${esc(E.U.get(id)?.label ?? id)}</span><span class="uf-cl">${tag}</span></div>`;
    el.innerHTML = `<div class="uf-ihead">
      <span class="uf-ikind">wire</span>
      <div class="uf-iname">${esc(ua.label)} → ${esc(ub.label)}</div>
      <div class="uf-idesc">${esc(kinds)} · weight ${weight}</div>
      <div class="uf-iact"><button class="uf-ibtn" id="ufIMenu" title="Actions">⋯</button></div>
    </div>
    ${E.actionsMenuOpen ? '<div class="uf-blk" id="ufActionsMenu"></div>' : ''}
    <div class="uf-blk"><div class="uf-ilab2">endpoints</div>${ep(a, '→', 'from')}${ep(b, '←', 'to')}</div>
    ${unders.length ? `<div class="uf-blk"><div class="uf-ilab2">carries (${unders.length})</div>` + unders.map((e) => {
      const adv = E.spec.layers.trust && E.ALLOW.has(e.from + '->' + e.to);
      const kindCls = e.call && e.dep ? 'calldep' : e.call ? 'call' : 'dep';
      const chips = (e.label ? `<span class="uf-cl">${esc(e.label.split(',')[0])}</span>` : '')
        + (adv ? '<span class="uf-cl adv">advisory</span>' : '')
        + `<span class="uf-cl ${kindCls}">${e.call && e.dep ? 'call · dep' : e.call ? 'call' : 'dep'}</span>`;
      return `<div class="uf-conn" data-goto="${esc(e.to)}"><span class="uf-arw">${e.dep && !e.call ? '⇢' : '→'}</span><span class="uf-cn">${esc(E.U.get(e.from)?.label ?? e.from)} → ${esc(E.U.get(e.to)?.label ?? e.to)}</span>${chips}</div>`;
    }).join('') + '</div>' : ''}`;
    wireGotoLinks(el);
    wireActionsMenu(el);
  }
  /** U6: a container's role is derived — member-kind breakdown + total descendants
      (hier groups carry only a label; the breakdown is the honest substitute for a desc) */
  function buildContainerRoleHtml(u: UNode): string {
    const byKind = new Map<string, number>();
    for (const childId of u.children) {
      const k = E.gu(childId).kind;
      byKind.set(k, (byKind.get(k) ?? 0) + 1);
    }
    let total = -1;
    (function count(x: string): void { total++; (E.U.get(x)?.children ?? []).forEach(count); })(u.id);
    const parts = [...byKind.entries()].sort((x, y) => y[1] - x[1])
      .map(([k, n2]) => `${n2} ${k}${n2 === 1 ? '' : 's'}`);
    return `<div class="uf-idesc">${esc(parts.join(' · '))}${total > u.children.length ? esc(` · ${total} total inside`) : ''}</div>`;
  }
  /** U6: a container's members + subtree-aggregated external connections, or (for a
      leaf) its direct model connections — the two connection shapes the inspector shows */
  function buildInspectorConnectionsHtml(u: UNode, canOpen: boolean): string {
    if (canOpen) {
      // U6: group-level information — direct members, then subtree-aggregated external connections
      const members = u.children.map((c) => {
        const uc = E.gu(c);
        const tag = E.isContainer(uc) ? `${uc.children.length} inside` : uc.kind;
        return `<div class="uf-conn" data-goto="${esc(c)}"><span class="uf-arw">·</span><span class="uf-cn">${esc(uc.label)}</span><span class="uf-cl">${esc(tag)}</span></div>`;
      }).join('');
      const gc = groupConns(u.id);
      const aggBlk = (title: string, arrow: string, arr: [string, number][]): string =>
        !arr.length ? '' : `<div class="uf-blk"><div class="uf-ilab2">${title} (${arr.length})</div>`
          + arr.map(([tid, w2]) =>
            `<div class="uf-conn" data-goto="${esc(tid)}"><span class="uf-arw">${arrow}</span><span class="uf-cn">${esc(E.U.get(tid)?.label ?? tid)}</span><span class="uf-cl count">×${w2}</span></div>`).join('')
          + '</div>';
      return `<div class="uf-blk"><div class="uf-ilab2">contains (${u.children.length})</div>${members}</div>`
        + aggBlk('uses →', '→', gc.uses) + aggBlk('← used by', '←', gc.usedBy);
    }
    const conns = (arr: UEdge[], key: 'from' | 'to', title: string, arrow: string): string => {
      const seen = new Map<string, string>();
      for (const edge of arr) if (!seen.has(edge[key])) seen.set(edge[key], edge.label);
      if (!seen.size) return '';
      return `<div class="uf-blk"><div class="uf-ilab2">${title} (${seen.size})</div>`
        + [...seen.entries()].map(([id, lbl]) => {
          const adv = E.spec.layers.trust && E.ALLOW.has(key === 'to' ? u.id + '->' + id : id + '->' + u.id);
          const chip = adv ? '<span class="uf-cl adv">advisory</span>'
            : lbl ? `<span class="uf-cl">${esc(lbl.split(',')[0])}</span>` : '';
          return `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">${arrow}</span><span class="uf-cn">${esc(E.U.get(id)?.label ?? id)}</span>${chip}</div>`;
        }).join('')
        + '</div>';
    };
    return conns(E.OUT[u.id] ?? [], 'to', 'uses →', '→') + conns(E.IN[u.id] ?? [], 'from', '← used by', '←');
  }
  /** DOM wiring for the node inspector: every button/host the just-painted html contains */
  function wireNodeInspectorControls(el: HTMLElement, u: UNode): void {
    const io = el.querySelector('#ufIOpen') as HTMLElement | null;
    if (io) io.onclick = () => E.toggleExpand(u.id);
    const ie = el.querySelector('#ufIEdit') as HTMLElement | null;
    if (ie) ie.onclick = () => E.commit({ type: 'setFmOpen', open: !E.spec.fmOpen });
    const fmHost = el.querySelector('#ufFmHost') as HTMLElement | null;
    if (fmHost) E.mountFrontmatter(fmHost, u.id);
    const ih = el.querySelector('#ufIHide') as HTMLElement | null;
    if (ih) ih.onclick = () => E.commit({ type: 'hide', id: u.id });
    const is2 = el.querySelector('#ufIShow') as HTMLElement | null;
    if (is2) is2.onclick = () => E.commit({ type: 'reveal', id: u.id });
    wireActionsMenu(el);
    wireGotoLinks(el);
  }
  /** the header's action-button row: unfold/fold, add/remove from view, edit frontmatter, the ⋯ menu */
  function buildInspectorActionsHtml(node: UNode, canOpen: boolean): string {
    return `<div class="uf-iact">
        ${canOpen ? `<button class="uf-ibtn pri" id="ufIOpen">${E.spec.expanded.includes(node.id) ? 'fold' : 'unfold'}</button>` : ''}
        ${E.isRendered(node.id)
          ? `<button class="uf-ibtn" id="ufIHide">remove from view</button>`
          : `<button class="uf-ibtn" id="ufIShow">add to view</button>`}
        ${E.ctx.state.nodes[node.id] ? `<button class="uf-ibtn${E.spec.fmOpen ? ' pri' : ''}" id="ufIEdit">${E.spec.fmOpen ? 'done' : 'edit'}</button>` : ''}
        <button class="uf-ibtn" id="ufIMenu" title="Actions">⋯</button>
      </div>`;
  }
  /** the inspector header block: kind chip, name, breadcrumbs, role/desc, action buttons */
  function buildInspectorHeaderHtml(node: UNode): string {
    const isSym = SYM_KINDS.has(node.kind);
    const canOpen = E.isContainer(node);
    const crumbs = E.ancestorCrumbs(node);
    const role = canOpen ? buildContainerRoleHtml(node) : '';
    return `<div class="uf-ihead">
      <span class="uf-ikind">${esc(node.kind)}</span>
      <div class="uf-iname${isSym ? ' uf-mono' : ''}">${esc(node.label)}</div>
      ${crumbs.length ? `<div class="uf-ipath">${esc(crumbs.join('  ›  '))}</div>` : ''}
      ${node.desc ? `<div class="uf-idesc">${esc(node.desc)}</div>` : ''}${role}
      ${buildInspectorActionsHtml(node, canOpen)}
    </div>
    ${E.spec.fmOpen && E.ctx.state.nodes[node.id] ? '<div class="uf-blk" id="ufFmHost"></div>' : ''}
    ${E.actionsMenuOpen ? '<div class="uf-blk" id="ufActionsMenu"></div>' : ''}`;
  }
  /** the inspector's fixed-fact blocks: accepts/returns/state, then blast radius if that layer is on */
  function buildInspectorFactsHtml(node: UNode): string {
    const blk = (label: string, vals: string[]): string =>
      vals.length ? `<div class="uf-blk"><div class="uf-ilab2">${label}</div>${vals.map((v) => `<div class="uf-iline">${E.ifaceLine(v)}</div>`).join('')}</div>` : '';
    let html = blk('accepts', node.accepts) + blk('returns', node.returns) + blk('state', node.state);
    if (E.spec.layers.blast) {
      html += `<div class="uf-blk"><div class="uf-ilab2">blast radius</div><div class="uf-iline">${BLAST_N} transitive dependent${BLAST_N === 1 ? '' : 's'}</div></div>`;
    }
    return html;
  }
  /** the inspector's source block: the loaded function body for this node, if any */
  function buildInspectorSourceHtml(node: UNode): string {
    const body = (E.ctx.bodies?.get(node.id) as { body?: string } | undefined)?.body;
    return body ? `<div class="uf-blk"><div class="uf-ilab2">source</div><div class="uf-body"><pre>${esc(body)}</pre></div></div>` : '';
  }
  /** the node inspector: header + role + fixed facts + connections, then wire every control */
  function renderNodeInspector(el: HTMLElement): void {
    if (!E.spec.sel || !E.U.has(E.spec.sel)) { el.innerHTML = ''; return; }
    const node = E.gu(E.spec.sel);
    const canOpen = E.isContainer(node);
    let html = buildInspectorHeaderHtml(node);
    html += buildInspectorFactsHtml(node);
    html += buildInspectorConnectionsHtml(node, canOpen);
    html += buildInspectorSourceHtml(node);
    el.innerHTML = html;
    wireNodeInspectorControls(el, node);
  }
  // the inspector: empty until a selection exists, else one of three shapes
  // (type focus, wire, or node) — each a dedicated render + wire-up pair above
  function renderInspector(): void {
    const el = E.q('ufInsp');
    if (E.spec.focusType) { renderTypeFocusInspector(el, E.spec.focusType); return; }
    if (E.spec.selWire && E.U.has(E.spec.selWire.a) && E.U.has(E.spec.selWire.b)) {
      renderWireInspector(el, E.spec.selWire.a, E.spec.selWire.b);
      return;
    }
    renderNodeInspector(el);
  }

  /* ================= LAYERS ================= */
  function renderLayers(): void {
    const bx = E.q('ufLayers');
    bx.innerHTML = '';
    for (const layerDef of LAYER_DEFS) {
      const noSrc = layerDef.k === 'trust' && !E.TRUST_SRC;
      const row = E.h('div', 'uf-layer' + (E.spec.layers[layerDef.k] ? ' on' : '') + (noSrc ? ' off' : ''),
        `<span class="uf-sw"></span><span style="flex:1;min-width:0"><div class="uf-lt">${layerDef.label}</div><div class="uf-ld">${layerDef.desc}</div></span>`
        + (noSrc ? '<button class="uf-load" title="Load an edge-advisory-allowlist.txt">load…</button>' : ''));
      if (noSrc) {
        // no advisory source = the layer stays off (it never marks what it cannot back)
        row.onclick = (ev) => {
          if ((ev.target as HTMLElement).closest('.uf-load')) { ev.stopPropagation(); E.trustFileEl?.click(); }
        };
      } else {
        row.onclick = () => E.commit({ type: 'toggleLayer', key: layerDef.k });
      }
      bx.appendChild(row);
    }
  }
  function applyLayerClasses(): void {
    E.overlay.classList.toggle('desc', E.spec.layers.desc);
    E.overlay.classList.toggle('iface', E.spec.layers.iface);
    E.overlay.classList.toggle('metrics', E.spec.layers.metrics);
    E.overlay.classList.toggle('color', E.spec.layers.color);
    E.overlay.classList.toggle('trust', E.spec.layers.trust);
  }

  E.computeBlast = computeBlast;
  E.trustLayer = trustLayer;
  E.selectGroup = selectGroup;
  E.select = select;
  E.stageTargetOf = stageTargetOf;
  E.groupConns = groupConns;
  E.renderInspector = renderInspector;
  E.renderLayers = renderLayers;
  E.applyLayerClasses = applyLayerClasses;
}
