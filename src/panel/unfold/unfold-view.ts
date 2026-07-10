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

import type { DiagramEdge, DiagramNode, Hier } from '../../core/types/types';
import { esc } from '../../core/config/config';
import { normalizeViewSpec } from '../../core/viewspec/viewspec';
import type { UEdge, UEnv, UNode } from './unfold';

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

function prefixParent(env: UEnv, id: string): string | null {
  const sep = id.indexOf('__');
  return sep > 0 && env.ctx.state.nodes[id.slice(0, sep)] ? id.slice(0, sep) : null;
}

function parentOf(env: UEnv, node: DiagramNode): string | null {
  if (node.parent && env.ctx.state.nodes[node.parent]) return node.parent;
  return prefixParent(env, node.id);
}

/** pull accepts/returns out of a raw node's frontmatter interfaces */
function interfaceFields(rawNode: DiagramNode): { accepts: string[]; returns: string[] } {
  const accepts: string[] = [];
  const returns: string[] = [];
  for (const iface of rawNode.fm?.interfaces ?? []) {
    accepts.push(...iface.accepts);
    returns.push(...iface.returns.filter((ret) => ret && ret !== 'void'));
  }
  return { accepts, returns };
}

function rawNodeToUNode(id: string, rawNode: DiagramNode): UNode {
  const { accepts, returns } = interfaceFields(rawNode);
  return {
    id,
    label: rawNode.fm?.name || rawNode.label || id,
    kind: rawNode.kind ?? (rawNode.shape === 'group' ? 'group' : 'node'),
    desc: rawNode.fm?.description ?? '',
    accepts, returns, state: rawNode.fm?.state ?? [],
    children: [], parent: null, fanIn: 0,
  };
}

/** live-parent/prefix containment for one id, once its plain UNode already exists */
function linkParent(env: UEnv, id: string): void {
  const parentId = parentOf(env, env.ctx.state.nodes[id]);
  const entry = env.U.get(id) as UNode;
  if (!parentId || parentId === id || !env.U.has(parentId)) return;
  entry.parent = parentId;
  (env.U.get(parentId) as UNode).children.push(id);
}

/** populate U with each node's plain fields, then link live-parent/prefix containment */
function populateNodesAndParents(env: UEnv): void {
  for (const id in env.ctx.state.nodes) {
    env.U.set(id, rawNodeToUNode(id, env.ctx.state.nodes[id]));
  }
  for (const id in env.ctx.state.nodes) {
    linkParent(env, id);
  }
}

function addHierGroupNodes(env: UEnv, hier: Hier): void {
  for (const gid of Object.keys(hier.groups)) {
    if (env.U.has(gid)) continue;
    const groupDef = hier.groups[gid];
    env.U.set(gid, {
      id: gid, label: groupDef.label, kind: 'group', desc: '',
      accepts: [], returns: [], state: [], children: [], parent: null, fanIn: 0,
    });
  }
}

function linkHierGroupParents(env: UEnv, hier: Hier): void {
  for (const gid of Object.keys(hier.groups)) {
    const parentId = hier.groups[gid].parent;
    const entry = env.U.get(gid);
    if (!entry || !parentId || entry.parent || parentId === gid || !env.U.has(parentId)) continue;
    entry.parent = parentId;
    (env.U.get(parentId) as UNode).children.push(gid);
  }
}

function linkHierMemberships(env: UEnv, hier: Hier): void {
  for (const nid of Object.keys(hier.memberOf)) {
    const entry = env.U.get(nid);
    const gid = hier.memberOf[nid];
    if (!entry || entry.parent || !env.U.has(gid)) continue;
    entry.parent = gid;
    (env.U.get(gid) as UNode).children.push(nid);
  }
}

/** %% group hierarchy: declared groups become container levels ABOVE the
    containment roots — the reading surface's regions. No geometry, no canvas
    presence; a collision with a real node id lets the node win. */
function applyHierGroups(env: UEnv): void {
  const hier = env.ctx.state.hier;
  if (!hier || !Object.keys(hier.groups).length) return;
  addHierGroupNodes(env, hier);
  linkHierGroupParents(env, hier);
  linkHierMemberships(env, hier);
}

/** a fresh aggregate edge — built via computed member assignment (not object-literal
    `to`/`w` keys) since those field names belong to the UEdge shape shared
    with unfold-wires.ts, not to this file */
function newEdgeAgg(fromId: string, toId: string): UEdge {
  const agg = { from: fromId, label: '', call: false, dep: false } as UEdge;
  agg['to'] = toId;
  agg['w'] = 0;
  return agg;
}

function aggregateEdge(seen: Map<string, UEdge>, edge: DiagramEdge): void {
  const key = edge.from + ' ' + edge.to;
  if (!seen.has(key)) seen.set(key, newEdgeAgg(edge.from, edge.to));
  const agg = seen.get(key) as UEdge;
  agg.w++;
  if (edge.style === 'dotted') agg.dep = true;
  else agg.call = true;
  if (edge.label && agg.label.length < 40) {
    agg.label = [agg.label, edge.label].filter(Boolean).join(', ');
  }
}

/** dedupe ctx.state.edges into UEdge aggregates */
function aggregateEdges(env: UEnv): Map<string, UEdge> {
  const seen = new Map<string, UEdge>();
  for (const edge of env.ctx.state.edges) {
    if (edge.from === edge.to || !env.U.has(edge.from) || !env.U.has(edge.to)) continue;
    aggregateEdge(seen, edge);
  }
  return seen;
}

/** derive OUT/IN adjacency + fan-in from env.EDGES (already deduped) */
function buildAdjacency(env: UEnv): void {
  for (const id of env.U.keys()) {
    env.OUT[id] = [];
    env.IN[id] = [];
  }
  for (const edge of env.EDGES) {
    env.OUT[edge.from].push(edge);
    env.IN[edge.to].push(edge);
  }
  for (const id of env.U.keys()) {
    (env.U.get(id) as UNode).fanIn = new Set(env.IN[id].map((edge) => edge.from)).size;
  }
}

function computeEdgesAndAdjacency(env: UEnv): void {
  const seen = aggregateEdges(env);
  env.EDGES.length = 0;
  env.EDGES.push(...seen.values());
  buildAdjacency(env);
}

// deepFreeze is needed by build() here and by apply()/persistView() in unfold-session.ts —
// a tiny pure helper, exposed to siblings via env.deepFreeze so it isn't duplicated
function deepFreeze<T extends { expanded: unknown[]; hidden: unknown[]; layers: unknown; selWire?: unknown }>(
  viewSpec: T,
): T {
  Object.freeze(viewSpec.expanded);
  Object.freeze(viewSpec.hidden);
  Object.freeze(viewSpec.layers);
  if (viewSpec.selWire) Object.freeze(viewSpec.selWire);
  return Object.freeze(viewSpec);
}

function buildModel(env: UEnv): void {
  env.U.clear();
  env.ROOTS.length = 0;
  for (const key of Object.keys(env.OUT)) delete env.OUT[key];
  for (const key of Object.keys(env.IN)) delete env.IN[key];
  populateNodesAndParents(env);
  applyHierGroups(env);
  for (const [id, entry] of env.U) {
    if (!entry.parent) env.ROOTS.push(id);
  }
  computeEdgesAndAdjacency(env);
  // drop stale view state that no longer resolves — the schema boundary owns this
  env.spec = deepFreeze(normalizeViewSpec(env.spec, [...env.U.keys()]));
  env.overlay.classList.toggle('staged', !!env.spec.stage);
}

function getUNode(env: UEnv, id: string): UNode {
  return env.U.get(id) as UNode;
}

function isContainer(node: UNode | undefined): boolean {
  return !!node && node.children.length > 0;
}

function hasAncestor(env: UEnv, id: string, ancestorId: string): boolean {
  let cur = env.U.get(id);
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.id === ancestorId) return true;
    cur = cur.parent ? env.U.get(cur.parent) : undefined;
  }
  return false;
}

/** breadcrumb labels from a node up through its live ancestor chain (root-first) */
function ancestorCrumbs(env: UEnv, node: UNode): string[] {
  const crumbs: string[] = [];
  let cur: UNode | undefined = node;
  const seen = new Set<string>();
  while (cur && cur.parent && !seen.has(cur.id)) {
    seen.add(cur.id);
    cur = env.U.get(cur.parent);
    if (cur) crumbs.unshift(cur.label);
  }
  return crumbs;
}

/* ================= CANVAS ================= */

function depthOf(env: UEnv, id: string): number {
  let depth = 0;
  let entry = env.U.get(id);
  const seen = new Set<string>();
  while (entry && entry.parent && !seen.has(entry.id)) {
    seen.add(entry.id);
    depth++;
    entry = env.U.get(entry.parent);
  }
  return depth;
}

function nodeEl(env: UEnv, id: string): HTMLElement {
  return env.spec.expanded.includes(id) && isContainer(env.U.get(id))
    ? groupEl(env, getUNode(env, id))
    : cardEl(env, getUNode(env, id));
}

function groupHeadHtml(node: UNode, kids: string[]): string {
  return `<span class="uf-tw" title="Fold"><svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg></span>
     <span class="uf-gname">${esc(node.label)}</span>
     <span class="uf-gcount">${kids.length}/${node.children.length}</span>`;
}

// U6: the header SELECTS the group (an information act); folding moves to the
// chevron / dblclick — expansion is an explicit affordance, not the click default
function wireGroupHead(env: UEnv, head: HTMLElement, node: UNode): void {
  head.onclick = () => env.selectGroup(node.id);
  (head.querySelector('.uf-tw') as HTMLElement).onclick = (event) => {
    event.stopPropagation();
    env.toggleExpand(node.id);
  };
  head.ondblclick = (event) => {
    if ((event.target as HTMLElement).closest('.uf-tw')) return;
    env.toggleExpand(node.id);
  };
}

function groupClassName(env: UEnv, node: UNode, allLeaf: boolean): string {
  const orientation = allLeaf ? 'leaf' : depthOf(env, node.id) % 2 === 0 ? 'row' : 'col';
  return 'uf-grp open ' + (env.spec.sel === node.id ? 'sel ' : '') + orientation;
}

function groupEl(env: UEnv, node: UNode): HTMLElement {
  const kids = node.children.filter((child) => !env.spec.hidden.includes(child));
  const allLeaf = kids.every((child) => !(env.spec.expanded.includes(child) && isContainer(env.U.get(child))));
  const grpEl = env.h('div', groupClassName(env, node, allLeaf));
  grpEl.dataset.id = node.id;
  const head = env.h('div', 'uf-ghead', groupHeadHtml(node, kids));
  wireGroupHead(env, head, node);
  grpEl.appendChild(head);
  const body = env.h('div', 'uf-gbody');
  for (const kid of kids) body.appendChild(nodeEl(env, kid));
  grpEl.appendChild(body);
  return grpEl;
}

type CardHighlight = { sel: boolean; nbr: boolean; hop: number | undefined; dim: boolean };

function blastHighlight(env: UEnv, node: UNode, sel: boolean): CardHighlight {
  const hop = env.REP_HOPS.get(node.id);
  // a selected container's members ARE the selection — they never dim under blast
  const inSel = sel || (!!env.spec.sel && hasAncestor(env, node.id, env.spec.sel));
  return { sel, nbr: false, hop, dim: !inSel && hop == null };
}

function selectionHighlight(env: UEnv, node: UNode, sel: boolean): CardHighlight {
  const nbr = !!env.spec.sel && !sel && isNeighbour(env, env.spec.sel, node.id);
  return { sel, nbr, hop: undefined, dim: !!env.spec.sel && !sel && !nbr };
}

/** selection/blast/neighbour highlight state for one card — isolated so cardEl
    itself reads as plain assembly, not a nest of blast/selection conditionals */
function cardHighlight(env: UEnv, node: UNode): CardHighlight {
  const sel = env.spec.sel === node.id;
  const blastOn = env.spec.layers.blast && !!env.spec.sel;
  return blastOn ? blastHighlight(env, node, sel) : selectionHighlight(env, node, sel);
}

/** card click, once past the connect-mode/group-inspect special cases:
    unfold, or select the group/node itself */
function cardClickTarget(env: UEnv, node: UNode, clickOpens: boolean): void {
  if (clickOpens) {
    env.toggleExpand(node.id);
    return;
  }
  // a group card inspects in place — it must not take the module-card stage path (U8 deferred)
  if (node.kind === 'group') {
    env.selectGroup(node.id);
    return;
  }
  env.select(node.id);
}

/** card click: connect-mode target pick, then group-inspect / expand / select */
function cardClick(env: UEnv, node: UNode, clickOpens: boolean): (event: MouseEvent) => void {
  return (event) => {
    if ((event.target as HTMLElement).isContentEditable) return;
    if ((event.target as HTMLElement).closest('.uf-open')) return;
    // connect mode armed on a source card: this click picks the target and fires the edge
    if (env.connectFrom) {
      event.stopPropagation();
      env.completeConnect(node.id);
      return;
    }
    cardClickTarget(env, node, clickOpens);
  };
}

/** card double-click: expand a container, otherwise rename the selected card in place */
function cardDblClick(env: UEnv, node: UNode, canOpen: boolean): (event: MouseEvent) => void {
  return (event) => {
    if ((event.target as HTMLElement).isContentEditable) return;
    if (canOpen) {
      env.toggleExpand(node.id);
      return;
    }
    if (env.spec.sel === node.id) env.renameInPlace(node.id);
  };
}

/** the card's class-list string — kind/open-affordance/selection/blast classes,
    pulled out of cardEl so the assembly function reads as one straight line */
function cardClassName(node: UNode, canOpen: boolean, clickOpens: boolean, highlight: CardHighlight): string {
  return 'uf-card ' + (SYM_KINDS.has(node.kind) ? 'sym ' : '') + (canOpen && !clickOpens ? 'can-open ' : '')
    + (highlight.sel ? 'sel ' : '') + (highlight.nbr ? 'nbr ' : '')
    + (highlight.hop != null ? 'bh' + Math.min(3, highlight.hop) + ' ' : '') + (highlight.dim ? 'dim' : '');
}

/** the card's inner markup — name/meta/desc/interfaces/blast-hop/unfold-affordance */
function cardBodyHtml(node: UNode, canOpen: boolean, clickOpens: boolean, hop: number | undefined): string {
  const meta = canOpen
    ? `${node.children.length} inside · fan-in ${node.fanIn}`
    : `${node.kind} · fan-in ${node.fanIn}`;
  return `<div class="uf-crow"><span class="uf-dot"></span><span class="uf-cname">${esc(node.label)}</span></div>
    <div class="uf-cmeta">${esc(meta)}</div>
    ${node.desc ? `<div class="uf-cdesc">${esc(node.desc)}</div>` : ''}
    ${ifaceHtml(node)}
    ${hop != null ? `<span class="uf-bhop">${hop}</span>` : ''}
    ${canOpen && !clickOpens
      ? `<span class="uf-open" title="Unfold"><svg viewBox="0 0 16 16">
          <path d="M6 2H2v4M10 2h4v4M6 14H2v-4M10 14h4v-4"/></svg></span>`
      : ''}`;
}

// C2: explicit Stage button — bound now (cards are NOT rebuilt on select), shown
// only under '.uf-card.sel' via CSS. Reuses the target rule removed from select().
function stageButton(env: UEnv, node: UNode, card: HTMLElement): void {
  const stageTgt = env.stageTargetOf(node);
  if (!stageTgt) return;
  const stageBtn = env.h('button', 'uf-cstage', 'stage');
  stageBtn.onclick = (event) => {
    event.stopPropagation();
    env.stageMode(stageTgt);
  };
  card.appendChild(stageBtn);
}

function wireOpenAffordance(env: UEnv, node: UNode, card: HTMLElement, showOpenBtn: boolean): void {
  if (!showOpenBtn) return;
  (card.querySelector('.uf-open') as HTMLElement).onclick = (event) => {
    event.stopPropagation();
    env.toggleExpand(node.id);
  };
}

function applyCardColor(env: UEnv, node: UNode, card: HTMLElement): void {
  if (!env.spec.layers.color) return;
  card.style.setProperty('--uf-kc', `var(${KIND_VAR[node.kind] ?? K_FUNCTION_VAR})`);
}

function cardEl(env: UEnv, node: UNode): HTMLElement {
  const canOpen = isContainer(node);
  // U6: a collapsed GROUP card selects like everything else; only generic 'node'
  // containers keep click-to-expand. Groups expand via the corner icon / dblclick.
  const clickOpens = canOpen && node.kind === 'node';
  const highlight = cardHighlight(env, node);
  const card = env.h('div', cardClassName(node, canOpen, clickOpens, highlight));
  card.dataset.id = node.id;
  applyCardColor(env, node, card);
  card.innerHTML = cardBodyHtml(node, canOpen, clickOpens, highlight.hop);
  card.onclick = cardClick(env, node, clickOpens);
  wireOpenAffordance(env, node, card, canOpen && !clickOpens);
  stageButton(env, node, card);
  card.ondblclick = cardDblClick(env, node, canOpen);
  return card;
}

function ifaceRow(label: string, values: string[]): string {
  if (!values.length) return '';
  return `<div class="uf-ilab">${label}</div>`
    + values.slice(0, 4).map((val) => `<div class="uf-irow">${ifaceLine(val)}</div>`).join('');
}

function ifaceHtml(node: UNode): string {
  const rows = [ifaceRow('accepts', node.accepts), ifaceRow('returns', node.returns), ifaceRow('state', node.state)]
    .filter(Boolean);
  return rows.length ? `<div class="uf-iface">${rows.join('')}</div>` : '';
}

function ifaceLine(raw: string): string {
  const sep = raw.indexOf(':');
  const name = sep >= 0 ? raw.slice(0, sep) : '';
  const typ = (sep >= 0 ? raw.slice(sep + 1) : raw).trim();
  const base = typ.replace(/\[\]$/, '');
  const tok = `<span class="uf-t" data-t="${esc(base)}">${esc(typ)}</span>`;
  return name ? `<span class="uf-vn">${esc(name)}:</span> ${tok}` : tok;
}

function isNeighbour(env: UEnv, idA: string, idB: string): boolean {
  const repA = env.visibleRep(idA);
  return env.EDGES.some((edge) =>
    (env.visibleRep(edge.from) === repA && env.visibleRep(edge.to) === idB)
    || (env.visibleRep(edge.to) === repA && env.visibleRep(edge.from) === idB));
}

function renderCanvasImpl(env: UEnv): void {
  env.contentEl.innerHTML = '';
  const wrap = env.h('div');
  wrap.style.cssText = 'display:flex;gap:28px;align-items:flex-start;padding:52px;flex-wrap:wrap;max-width:2200px';
  for (const rid of env.ROOTS) {
    if (env.isRendered(rid)) wrap.appendChild(nodeEl(env, rid));
  }
  env.contentEl.appendChild(wrap);
}

function wireViewApi(env: UEnv, build: () => void, renderCanvas: () => void): void {
  env.build = build;
  env.deepFreeze = deepFreeze;
  env.renderCanvas = renderCanvas;
  env.cardEl = (node) => cardEl(env, node);
  env['gu'] = (id) => getUNode(env, id);
  env.isContainer = isContainer;
  env.hasAncestor = (id, ancestorId) => hasAncestor(env, id, ancestorId);
  env.ancestorCrumbs = (node) => ancestorCrumbs(env, node);
  env.depthOf = (id) => depthOf(env, id);
  env.isNeighbour = (idA, idB) => isNeighbour(env, idA, idB);
  env.ifaceLine = ifaceLine;
}

export function initUnfoldView(env: UEnv): void {
  function build(): void {
    buildModel(env);
  }
  function renderCanvas(): void {
    renderCanvasImpl(env);
  }
  wireViewApi(env, build, renderCanvas);
}
