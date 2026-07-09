/* =====================================================================
   unfold-view.ts — reading mode: model derivation (build) + folded-canvas
   rendering (cards/groups), split out of unfold.ts in place. Every symbol
   here used to be a closure over initUnfold's locals; those locals now
   live on the shared `E: UEnv` object unfold.ts constructs and passes to
   every sibling factory, and this factory attaches its own functions
   back onto `E` so the other siblings (and unfold.ts itself) can call
   them. (The P-panel dock chrome that used to live in this section of
   unfold.ts now lives in unfold-session.ts — view.ts alone was >400 lines.)
   ===================================================================== */

import type { DiagramNode } from '../../core/types/types';
import { esc } from '../../core/config/config';
import { normalizeViewSpec } from '../../core/viewspec/viewspec';
import type { UEnv, UNode } from './unfold';

// CSS custom-property names + shared kind→var lookup used by cardEl's colour dot
const K_FUNCTION_VAR = '--uf-k-function';
const K_STORE_VAR = '--uf-k-store';
const K_MODULE_VAR = '--uf-k-module';
const K_CLASS_VAR = '--uf-k-class';
const KIND_VAR: Record<string, string> = {
  type: '--uf-k-type', function: K_FUNCTION_VAR, module: K_MODULE_VAR, group: K_MODULE_VAR,
  store: K_STORE_VAR, class: K_CLASS_VAR, hook: K_FUNCTION_VAR, service: K_STORE_VAR,
  event: K_STORE_VAR, component: K_CLASS_VAR,
};

export const SYM_KINDS = new Set(['type', 'function', 'class', 'store', 'hook', 'service', 'event', 'component']);

/* ================= MODEL (derived from ctx.state on open) ================= */
export function initUnfoldView(E: UEnv): void {
  const prefixParent = (id: string): string | null => {
    const i = id.indexOf('__');
    return i > 0 && E.ctx.state.nodes[id.slice(0, i)] ? id.slice(0, i) : null;
  };
  function parentOf(node: DiagramNode): string | null {
    if (node.parent && E.ctx.state.nodes[node.parent]) return node.parent;
    return prefixParent(node.id);
  }

  /** populate U with each node's plain fields, then link live-parent/prefix containment */
  function populateNodesAndParents(): void {
    for (const id in E.ctx.state.nodes) {
      const rawNode = E.ctx.state.nodes[id];
      const accepts: string[] = [], returns: string[] = [];
      for (const i of rawNode.fm?.interfaces ?? []) {
        accepts.push(...i.accepts);
        returns.push(...i.returns.filter((ret) => ret && ret !== 'void'));
      }
      E.U.set(id, {
        id,
        label: rawNode.fm?.name || rawNode.label || id,
        kind: rawNode.kind ?? (rawNode.shape === 'group' ? 'group' : 'node'),
        desc: rawNode.fm?.description ?? '',
        accepts, returns, state: rawNode.fm?.state ?? [],
        children: [], parent: null, fanIn: 0,
      });
    }
    for (const id in E.ctx.state.nodes) {
      const parentId = parentOf(E.ctx.state.nodes[id]);
      const entry = E.U.get(id) as UNode;
      if (parentId && parentId !== id && E.U.has(parentId)) {
        entry.parent = parentId;
        (E.U.get(parentId) as UNode).children.push(id);
      }
    }
  }
  /** %% group hierarchy: declared groups become container levels ABOVE the
      containment roots — the reading surface's regions. No geometry, no canvas
      presence; a collision with a real node id lets the node win. */
  function applyHierGroups(): void {
    const hier = E.ctx.state.hier;
    if (!hier || !Object.keys(hier.groups).length) return;
    for (const gid of Object.keys(hier.groups)) {
      if (E.U.has(gid)) continue;
      const groupDef = hier.groups[gid];
      E.U.set(gid, {
        id: gid, label: groupDef.label, kind: 'group', desc: '',
        accepts: [], returns: [], state: [], children: [], parent: null, fanIn: 0,
      });
    }
    for (const gid of Object.keys(hier.groups)) {
      const parentId = hier.groups[gid].parent;
      const entry = E.U.get(gid);
      if (entry && parentId && E.U.has(parentId) && !entry.parent && parentId !== gid) { entry.parent = parentId; (E.U.get(parentId) as UNode).children.push(gid); }
    }
    for (const nid of Object.keys(hier.memberOf)) {
      const entry = E.U.get(nid), gid = hier.memberOf[nid];
      if (entry && !entry.parent && E.U.has(gid)) { entry.parent = gid; (E.U.get(gid) as UNode).children.push(nid); }
    }
  }
  /** dedupe ctx.state.edges into UEdge aggregates, then derive OUT/IN adjacency + fan-in */
  function computeEdgesAndAdjacency(): void {
    const seen = new Map<string, { from: string; to: string; label: string; call: boolean; dep: boolean; w: number }>();
    for (const edge of E.ctx.state.edges) {
      if (edge.from === edge.to || !E.U.has(edge.from) || !E.U.has(edge.to)) continue;
      const key = edge.from + ' ' + edge.to;
      if (!seen.has(key)) seen.set(key, { from: edge.from, to: edge.to, label: '', call: false, dep: false, w: 0 });
      const agg = seen.get(key) as { from: string; to: string; label: string; call: boolean; dep: boolean; w: number };
      agg.w++;
      if (edge.style === 'dotted') agg.dep = true; else agg.call = true;
      if (edge.label && agg.label.length < 40) agg.label = [agg.label, edge.label].filter(Boolean).join(', ');
    }
    E.EDGES.length = 0;
    E.EDGES.push(...seen.values());
    for (const id of E.U.keys()) { E.OUT[id] = []; E.IN[id] = []; }
    for (const edge of E.EDGES) { E.OUT[edge.from].push(edge); E.IN[edge.to].push(edge); }
    for (const id of E.U.keys()) (E.U.get(id) as UNode).fanIn = new Set(E.IN[id].map((edge) => edge.from)).size;
  }
  function build(): void {
    E.U.clear(); E.ROOTS.length = 0;
    for (const k of Object.keys(E.OUT)) delete E.OUT[k];
    for (const k of Object.keys(E.IN)) delete E.IN[k];
    populateNodesAndParents();
    applyHierGroups();
    for (const [id, entry] of E.U) if (!entry.parent) E.ROOTS.push(id);
    computeEdgesAndAdjacency();
    // drop stale view state that no longer resolves — the schema boundary owns this
    E.spec = deepFreeze(normalizeViewSpec(E.spec, [...E.U.keys()]));
    E.overlay.classList.toggle('staged', !!E.spec.stage);
  }
  const gu = (id: string): UNode => E.U.get(id) as UNode;
  const isContainer = (node: UNode | undefined): boolean => !!node && node.children.length > 0;
  const hasAncestor = (id: string, anc: string): boolean => {
    let cur = E.U.get(id);
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) { seen.add(cur.id); if (cur.id === anc) return true; cur = cur.parent ? E.U.get(cur.parent) : undefined; }
    return false;
  };
  /** breadcrumb labels from a node up through its live ancestor chain (root-first) */
  function ancestorCrumbs(node: UNode): string[] {
    const crumbs: string[] = [];
    let x: UNode | undefined = node;
    const seen = new Set<string>();
    while (x && x.parent && !seen.has(x.id)) { seen.add(x.id); x = E.U.get(x.parent); if (x) crumbs.unshift(x.label); }
    return crumbs;
  }
  // deepFreeze is needed by build() here and by apply()/persistView() in unfold-session.ts —
  // a tiny pure helper, exported so it isn't duplicated
  function deepFreeze<T extends { expanded: unknown[]; hidden: unknown[]; layers: unknown; selWire?: unknown }>(viewSpec: T): T {
    Object.freeze(viewSpec.expanded); Object.freeze(viewSpec.hidden); Object.freeze(viewSpec.layers);
    if (viewSpec.selWire) Object.freeze(viewSpec.selWire);
    return Object.freeze(viewSpec);
  }

  /* ================= CANVAS ================= */
  function depthOf(id: string): number {
    let depth = 0, entry = E.U.get(id);
    const seen = new Set<string>();
    while (entry && entry.parent && !seen.has(entry.id)) { seen.add(entry.id); depth++; entry = E.U.get(entry.parent); }
    return depth;
  }
  function renderCanvas(): void {
    E.contentEl.innerHTML = '';
    const wrap = E.h('div');
    wrap.style.cssText = 'display:flex;gap:28px;align-items:flex-start;padding:52px;flex-wrap:wrap;max-width:2200px';
    for (const rid of E.ROOTS) if (E.isRendered(rid)) wrap.appendChild(nodeEl(rid));
    E.contentEl.appendChild(wrap);
  }
  const nodeEl = (id: string): HTMLElement =>
    E.spec.expanded.includes(id) && isContainer(E.U.get(id)) ? groupEl(gu(id)) : cardEl(gu(id));
  function groupEl(u: UNode): HTMLElement {
    const kids = u.children.filter((c) => !E.spec.hidden.includes(c));
    const allLeaf = kids.every((c) => !(E.spec.expanded.includes(c) && isContainer(E.U.get(c))));
    const grpEl = E.h('div', 'uf-grp open ' + (E.spec.sel === u.id ? 'sel ' : '') + (allLeaf ? 'leaf' : depthOf(u.id) % 2 === 0 ? 'row' : 'col'));
    grpEl.dataset.id = u.id;
    const head = E.h('div', 'uf-ghead',
      `<span class="uf-tw" title="Fold"><svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg></span>
       <span class="uf-gname">${esc(u.label)}</span>
       <span class="uf-gcount">${kids.length}/${u.children.length}</span>`);
    // U6: the header SELECTS the group (an information act); folding moves to the
    // chevron / dblclick — expansion is an explicit affordance, not the click default
    head.onclick = () => E.selectGroup(u.id);
    (head.querySelector('.uf-tw') as HTMLElement).onclick = (ev) => { ev.stopPropagation(); E.toggleExpand(u.id); };
    head.ondblclick = (ev) => {
      if ((ev.target as HTMLElement).closest('.uf-tw')) return;
      E.toggleExpand(u.id);
    };
    grpEl.appendChild(head);
    const body = E.h('div', 'uf-gbody');
    for (const kid of kids) body.appendChild(nodeEl(kid));
    grpEl.appendChild(body);
    return grpEl;
  }
  /** selection/blast/neighbour highlight state for one card — isolated so cardEl
      itself reads as plain assembly, not a nest of blast/selection conditionals */
  function cardHighlight(node: UNode): { sel: boolean; nbr: boolean; hop: number | undefined; dim: boolean } {
    const sel = E.spec.sel === node.id;
    const blastOn = E.spec.layers.blast && !!E.spec.sel;
    const hop = blastOn ? E.REP_HOPS.get(node.id) : undefined;
    const nbr = !blastOn && E.spec.sel ? !sel && isNeighbour(E.spec.sel, node.id) : false;
    // a selected container's members ARE the selection — they never dim under blast
    const inSel = sel || (!!E.spec.sel && hasAncestor(node.id, E.spec.sel));
    const dim = blastOn ? !inSel && hop == null : (E.spec.sel ? !sel && !nbr : false);
    return { sel, nbr, hop, dim };
  }
  /** card click: connect-mode target pick, then group-inspect / expand / select */
  function cardClick(node: UNode, clickOpens: boolean): (ev: MouseEvent) => void {
    return (ev) => {
      if ((ev.target as HTMLElement).isContentEditable) return;
      if ((ev.target as HTMLElement).closest('.uf-open')) return;
      // connect mode armed on a source card: this click picks the target and fires the edge
      if (E.connectFrom) { ev.stopPropagation(); E.completeConnect(node.id); return; }
      // a group card inspects in place — it must not take the module-card stage path (U8 deferred)
      if (clickOpens) E.toggleExpand(node.id); else if (node.kind === 'group') E.selectGroup(node.id); else E.select(node.id);
    };
  }
  /** card double-click: expand a container, otherwise rename the selected card in place */
  function cardDblClick(node: UNode, canOpen: boolean): (ev: MouseEvent) => void {
    return (ev) => {
      if ((ev.target as HTMLElement).isContentEditable) return;
      if (canOpen) E.toggleExpand(node.id);
      else if (E.spec.sel === node.id) E.renameInPlace(node.id);
    };
  }
  /** the card's class-list string — kind/open-affordance/selection/blast classes,
      pulled out of cardEl so the assembly function reads as one straight line */
  function cardClassName(node: UNode, canOpen: boolean, clickOpens: boolean,
    highlight: { sel: boolean; nbr: boolean; hop: number | undefined; dim: boolean }): string {
    return 'uf-card ' + (SYM_KINDS.has(node.kind) ? 'sym ' : '') + (canOpen && !clickOpens ? 'can-open ' : '')
      + (highlight.sel ? 'sel ' : '') + (highlight.nbr ? 'nbr ' : '')
      + (highlight.hop != null ? 'bh' + Math.min(3, highlight.hop) + ' ' : '') + (highlight.dim ? 'dim' : '');
  }
  /** the card's inner markup — name/meta/desc/interfaces/blast-hop/unfold-affordance */
  function cardBodyHtml(node: UNode, canOpen: boolean, clickOpens: boolean, hop: number | undefined): string {
    const meta = canOpen ? `${node.children.length} inside · fan-in ${node.fanIn}` : `${node.kind} · fan-in ${node.fanIn}`;
    return `<div class="uf-crow"><span class="uf-dot"></span><span class="uf-cname">${esc(node.label)}</span></div>
      <div class="uf-cmeta">${esc(meta)}</div>
      ${node.desc ? `<div class="uf-cdesc">${esc(node.desc)}</div>` : ''}
      ${ifaceHtml(node)}
      ${hop != null ? `<span class="uf-bhop">${hop}</span>` : ''}
      ${canOpen && !clickOpens ? `<span class="uf-open" title="Unfold"><svg viewBox="0 0 16 16"><path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg></span>` : ''}`;
  }
  function cardEl(u: UNode): HTMLElement {
    const canOpen = isContainer(u);
    // U6: a collapsed GROUP card selects like everything else; only generic 'node'
    // containers keep click-to-expand. Groups expand via the corner icon / dblclick.
    const clickOpens = canOpen && u.kind === 'node';
    const highlight = cardHighlight(u);
    const card = E.h('div', cardClassName(u, canOpen, clickOpens, highlight));
    card.dataset.id = u.id;
    if (E.spec.layers.color) card.style.setProperty('--uf-kc', `var(${KIND_VAR[u.kind] ?? K_FUNCTION_VAR})`);
    card.innerHTML = cardBodyHtml(u, canOpen, clickOpens, highlight.hop);
    card.onclick = cardClick(u, clickOpens);
    if (canOpen && !clickOpens) {
      (card.querySelector('.uf-open') as HTMLElement).onclick = (ev) => { ev.stopPropagation(); E.toggleExpand(u.id); };
    }
    // C2: explicit Stage button — bound now (cards are NOT rebuilt on select), shown
    // only under '.uf-card.sel' via CSS. Reuses the target rule removed from select().
    const stageTgt = E.stageTargetOf(u);
    if (stageTgt) {
      const stageBtn = E.h('button', 'uf-cstage', 'stage');
      stageBtn.onclick = (ev) => { ev.stopPropagation(); E.stageMode(stageTgt); };
      card.appendChild(stageBtn);
    }
    card.ondblclick = cardDblClick(u, canOpen);
    return card;
  }
  function ifaceHtml(u: UNode): string {
    const rows: string[] = [];
    const addRow = (l: string, a: string[]): void => {
      if (a.length) rows.push(`<div class="uf-ilab">${l}</div>` + a.slice(0, 4).map((x) => `<div class="uf-irow">${ifaceLine(x)}</div>`).join(''));
    };
    addRow('accepts', u.accepts); addRow('returns', u.returns); addRow('state', u.state);
    return rows.length ? `<div class="uf-iface">${rows.join('')}</div>` : '';
  }
  function ifaceLine(raw: string): string {
    const i = raw.indexOf(':');
    const name = i >= 0 ? raw.slice(0, i) : '';
    const typ = (i >= 0 ? raw.slice(i + 1) : raw).trim();
    const base = typ.replace(/\[\]$/, '');
    const tok = `<span class="uf-t" data-t="${esc(base)}">${esc(typ)}</span>`;
    return name ? `<span class="uf-vn">${esc(name)}:</span> ${tok}` : tok;
  }
  const isNeighbour = (a: string, b: string): boolean => {
    const ra = E.visibleRep(a);
    return E.EDGES.some((e) =>
      (E.visibleRep(e.from) === ra && E.visibleRep(e.to) === b) || (E.visibleRep(e.to) === ra && E.visibleRep(e.from) === b));
  };

  E.build = build;
  E.deepFreeze = deepFreeze;
  E.renderCanvas = renderCanvas;
  E.cardEl = cardEl;
  E.gu = gu;
  E.isContainer = isContainer;
  E.hasAncestor = hasAncestor;
  E.ancestorCrumbs = ancestorCrumbs;
  E.depthOf = depthOf;
  E.isNeighbour = isNeighbour;
  E.ifaceLine = ifaceLine;
}
