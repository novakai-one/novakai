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

// this app builds exactly one UEnv (main.ts → initUnfold, a singleton composition
// root) so module-scope state here has the same lifetime as the old per-call locals
let blastN = 0;

/* ---- blast radius: transitive dependents of the selection ---- */
function addBlastDescendants(env: UEnv, parentId: string, seeds: Set<string>): void {
  for (const childId of env.U.get(parentId)?.children ?? []) {
    if (seeds.has(childId)) continue;
    seeds.add(childId);
    addBlastDescendants(env, childId, seeds);
  }
}
// U6: a selected container blasts from its whole subtree — hier groups are not
// edge endpoints, so seeding only the group id would find nothing and dim everything
function collectBlastSeeds(env: UEnv, sel: string): Set<string> {
  const seeds = new Set<string>([sel]);
  if (env.isContainer(env.U.get(sel))) addBlastDescendants(env, sel, seeds);
  return seeds;
}
function bfsBlastHops(env: UEnv, seeds: Set<string>): Map<string, number> {
  const hop = new Map<string, number>([...seeds].map((seed) => [seed, 0]));
  const queue: string[] = [...seeds];
  while (queue.length) {
    const cur = queue.shift() as string;
    for (const inEdge of env.IN[cur] ?? []) {
      if (hop.has(inEdge.from)) continue;
      hop.set(inEdge.from, (hop.get(cur) ?? 0) + 1);
      queue.push(inEdge.from);
    }
  }
  for (const seed of seeds) hop.delete(seed);
  return hop;
}
function applyBlastHops(env: UEnv, hop: Map<string, number>): void {
  const selRep = env.visibleRep(env.spec.sel as string);
  for (const [candidateId, hops] of hop) {
    const rep = env.visibleRep(candidateId);
    if (!rep || rep === selRep) continue;
    const cur = env.REP_HOPS.get(rep);
    if (cur == null || hops < cur) env.REP_HOPS.set(rep, hops);
  }
}
function computeBlastImpl(env: UEnv): void {
  env.REP_HOPS.clear();
  blastN = 0;
  if (!env.spec.layers.blast || !env.spec.sel) return;
  const seeds = collectBlastSeeds(env, env.spec.sel);
  const hop = bfsBlastHops(env, seeds);
  blastN = hop.size;
  applyBlastHops(env, hop);
}

/* ---- trust: A5 advisory edges from an OPTIONAL source ---- */
function parseAllowList(env: UEnv, text: string): void {
  env.ALLOW.clear();
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('->')) continue;
    env.ALLOW.add(trimmed);
  }
}
function handleTrustFileChange(env: UEnv, fileInput: HTMLInputElement): void {
  const file = fileInput.files?.[0];
  if (!file) return;
  void file.text().then((text) => {
    parseAllowList(env, text);
    env.TRUST_SRC = true;
    env.renderLayers();
    env.render(false);
  });
}
function makeTrustFileInput(env: UEnv): HTMLInputElement {
  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = '.txt,text/plain';
  fileInput.onchange = () => handleTrustFileChange(env, fileInput);
  return fileInput;
}
function fetchTrustAllowlist(env: UEnv): void {
  fetch('docs/novakai/edge-advisory-allowlist.txt')
    .then((res) => (res.ok && (res.headers.get('content-type') ?? '').includes('text/plain') ? res.text() : null))
    .then((text) => {
      if (text == null || !text.includes('->')) return;
      parseAllowList(env, text);
      env.TRUST_SRC = true;
      env.renderLayers();
    })
    .catch(() => { /* no same-origin source — the Load button remains the door */ });
}
/** trust layer with an OPTIONAL advisory source: the same-origin allowlist when present
    (this repo, dev server), a Load button otherwise (any repo). Absent source = the
    layer stays disabled — it never marks anything it cannot back. */
function trustLayerImpl(env: UEnv): void {
  env.trustFileEl = makeTrustFileInput(env);
  fetchTrustAllowlist(env);
}

/** C2: stage target for a card's explicit Stage button — the exact projection
    rule formerly auto-run inside select(): a non-group card stages its container
    parent, a top-level container stages itself, anything else has no stage. */
function stageTargetOfImpl(env: UEnv, node: UNode): string | null {
  if (node.kind === 'group') return null;
  if (node.parent && env.isContainer(env.U.get(node.parent))) return node.parent;
  if (!node.parent && env.isContainer(node)) return node.id;
  return null;
}

/* ================= INSPECTOR (empty until selection) ================= */
function addSubtreeIds(env: UEnv, id: string, sub: Set<string>): void {
  if (sub.has(id)) return;
  sub.add(id);
  for (const childId of env.U.get(id)?.children ?? []) addSubtreeIds(env, childId, sub);
}
function collectAncestorFrame(env: UEnv, id: string, sub: Set<string>): Set<string> {
  const frame = new Set(sub);
  let cur = env.U.get(id);
  const seen = new Set<string>();
  while (cur && cur.parent && !seen.has(cur.id)) {
    seen.add(cur.id);
    frame.add(cur.parent);
    cur = env.U.get(cur.parent);
  }
  return frame;
}
function sortConnsByWeight(map: Map<string, number>): [string, number][] {
  return [...map.entries()].sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1));
}
function tallyGroupConns(
  env: UEnv,
  sub: Set<string>,
  frame: Set<string>,
): { uses: Map<string, number>; usedBy: Map<string, number> } {
  const uses = new Map<string, number>(), usedBy = new Map<string, number>();
  for (const edge of env.EDGES) {
    const fromInside = sub.has(edge.from), toInside = sub.has(edge.to);
    if (fromInside === toInside) continue;
    const bucket = fromInside ? uses : usedBy;
    const other = env.proxyTargetOf(fromInside ? edge.to : edge.from, frame);
    bucket.set(other, (bucket.get(other) ?? 0) + edge.w);
  }
  return { uses, usedBy };
}
/** U6: external connections of a container — every edge with exactly one endpoint
    inside the subtree, aggregated to the coarsest foreign container and weight-summed
    (the same grammar as stage pills: frame = subtree + ancestors, so a sibling stays
    itself and a foreign subtree compresses into its top group) */
function groupConnsImpl(env: UEnv, id: string): { uses: [string, number][]; usedBy: [string, number][] } {
  const sub = new Set<string>();
  addSubtreeIds(env, id, sub);
  const frame = collectAncestorFrame(env, id, sub);
  const tally = tallyGroupConns(env, sub, frame);
  return { uses: sortConnsByWeight(tally.uses), usedBy: sortConnsByWeight(tally.usedBy) };
}

/** every [data-goto] anchor inside a just-painted inspector block routes through goTo */
function wireGotoLinks(env: UEnv, el: HTMLElement): void {
  el.querySelectorAll<HTMLElement>('[data-goto]').forEach((row) => {
    row.onclick = () => env.goTo(row.dataset.goto as string);
  });
}
/** the '⋯' actions-menu toggle + its mounted panel — shared by the wire and node inspectors */
function wireActionsMenu(env: UEnv, el: HTMLElement): void {
  const menuBtn = el.querySelector('#ufIMenu') as HTMLElement | null;
  if (menuBtn) {
    menuBtn.onclick = (evt) => {
      evt.stopPropagation();
      env.actionsMenuOpen = !env.actionsMenuOpen;
      renderInspectorImpl(env);
    };
  }
  const menuHost = el.querySelector('#ufActionsMenu') as HTMLElement | null;
  if (menuHost) menuHost.appendChild(env.buildActionsMenu());
}
/** U1: focused-type inspector — every carrier of the clicked type name */
function renderTypeFocusInspector(env: UEnv, el: HTMLElement, typeName: string): void {
  const carriers = [...env.U.keys()].filter((id) => env.carriesType(id, typeName));
  const rows = carriers
    .map((id) => `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">·</span>`
      + `<span class="uf-cn">${esc(env.U.get(id)?.label ?? id)}</span></div>`)
    .join('');
  el.innerHTML = `<div class="uf-ihead"><span class="uf-ikind">type</span>`
    + `<div class="uf-iname uf-mono">${esc(typeName)}</div></div>`
    + `<div class="uf-blk"><div class="uf-ilab2">carried by (${carriers.length})</div>${rows}</div>`;
  wireGotoLinks(env, el);
}
/** the rendered rep pair's underlying model edges: in explore this is the same pure lift
    the painter draws (neutral pass, unordered anchor match); staged keeps its own rep
    aggregation (untouched by P-wires) */
function computeWireUnderlying(env: UEnv, aId: string, bId: string): UEdge[] {
  if (env.spec.stage) {
    return env.EDGES.filter((e) =>
      ((e.call && env.spec.layers.calls) || (e.dep && env.spec.layers.deps))
      && env.stageRepOf(e.from) === aId && env.stageRepOf(e.to) === bId);
  }
  const lifted = env.computeLifted(true)
    .find((wire) => (wire.a === aId && wire.b === bId) || (wire.a === bId && wire.b === aId));
  return (lifted?.underlying ?? [])
    .map((underEdge) => env.EDGES.find((e) => e.from === underEdge.from && e.to === underEdge.to))
    .filter((e): e is UEdge => !!e);
}
function endpointHtml(env: UEnv, id: string, arrow: string, tag: string): string {
  return `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">${arrow}</span>`
    + `<span class="uf-cn">${esc(env.U.get(id)?.label ?? id)}</span><span class="uf-cl">${tag}</span></div>`;
}
function wireKindsSummary(unders: UEdge[]): string {
  const parts = [
    unders.some((edge) => edge.call) ? 'call' : '',
    unders.some((edge) => edge.dep) ? 'dependency' : '',
  ].filter(Boolean);
  return parts.join(' + ') || 'wire';
}
function edgeKindClass(edge: UEdge): string {
  if (edge.call && edge.dep) return 'calldep';
  return edge.call ? 'call' : 'dep';
}
function edgeKindLabel(edge: UEdge): string {
  if (edge.call && edge.dep) return 'call · dep';
  return edge.call ? 'call' : 'dep';
}
function wireCarryRowHtml(env: UEnv, edge: UEdge): string {
  const advisory = env.spec.layers.trust && env.ALLOW.has(edge.from + '->' + edge.to);
  const chips = (edge.label ? `<span class="uf-cl">${esc(edge.label.split(',')[0])}</span>` : '')
    + (advisory ? '<span class="uf-cl adv">advisory</span>' : '')
    + `<span class="uf-cl ${edgeKindClass(edge)}">${edgeKindLabel(edge)}</span>`;
  const arrow = edge.dep && !edge.call ? '⇢' : '→';
  const fromLabel = esc(env.U.get(edge.from)?.label ?? edge.from), toLabel = esc(env.U.get(edge.to)?.label ?? edge.to);
  return `<div class="uf-conn" data-goto="${esc(edge.to)}"><span class="uf-arw">${arrow}</span>`
    + `<span class="uf-cn">${fromLabel} → ${toLabel}</span>${chips}</div>`;
}
function underlyingCarriesHtml(env: UEnv, unders: UEdge[]): string {
  if (!unders.length) return '';
  const rows = unders.map((edge) => wireCarryRowHtml(env, edge)).join('');
  return `<div class="uf-blk"><div class="uf-ilab2">carries (${unders.length})</div>${rows}</div>`;
}
interface WireInspectorData {
  nodeA: UNode; nodeB: UNode; kinds: string; weight: number; endpoints: string; unders: UEdge[];
}
function wireInspectorHtml(env: UEnv, data: WireInspectorData): string {
  return `<div class="uf-ihead">
    <span class="uf-ikind">wire</span>
    <div class="uf-iname">${esc(data.nodeA.label)} → ${esc(data.nodeB.label)}</div>
    <div class="uf-idesc">${esc(data.kinds)} · weight ${data.weight}</div>
    <div class="uf-iact"><button class="uf-ibtn" id="ufIMenu" title="Actions">⋯</button></div>
  </div>
  ${env.actionsMenuOpen ? '<div class="uf-blk" id="ufActionsMenu"></div>' : ''}
  <div class="uf-blk"><div class="uf-ilab2">endpoints</div>${data.endpoints}</div>
  ${underlyingCarriesHtml(env, data.unders)}`;
}
interface WirePair { aId: string; bId: string }
/** the aggregate no longer exists in this projection — drop the selection through the
    reducer instead of rendering it */
function tryDropStaleWireSelection(env: UEnv, el: HTMLElement, wire: WirePair, unders: UEdge[]): boolean {
  if (unders.length) return false;
  env.apply({ type: 'selectWire', 'a': wire.aId, 'b': wire.bId });
  el.innerHTML = '';
  return true;
}
/** U2: the selected wire is an information object — endpoints, kind, direction,
    weight, and every underlying model relation it aggregates (legacy-editor parity) */
function renderWireInspector(env: UEnv, el: HTMLElement, aId: string, bId: string): void {
  const unders = computeWireUnderlying(env, aId, bId);
  if (tryDropStaleWireSelection(env, el, { aId, bId }, unders)) return;
  const nodeA = env.gu(aId), nodeB = env.gu(bId);
  const weight = unders.reduce((sum, edge) => sum + edge.w, 0);
  const kinds = wireKindsSummary(unders);
  const endpoints = endpointHtml(env, aId, '→', 'from') + endpointHtml(env, bId, '←', 'to');
  el.innerHTML = wireInspectorHtml(env, { nodeA, nodeB, kinds, weight, endpoints, unders });
  wireGotoLinks(env, el);
  wireActionsMenu(env, el);
}
/** U6: a container's role is derived — member-kind breakdown + total descendants
    (hier groups carry only a label; the breakdown is the honest substitute for a desc) */
function countDescendants(env: UEnv, id: string): number {
  let total = 0;
  for (const childId of env.U.get(id)?.children ?? []) total += 1 + countDescendants(env, childId);
  return total;
}
function buildContainerRoleHtml(env: UEnv, node: UNode): string {
  const byKind = new Map<string, number>();
  for (const childId of node.children) {
    const kind = env.gu(childId).kind;
    byKind.set(kind, (byKind.get(kind) ?? 0) + 1);
  }
  const total = countDescendants(env, node.id);
  const parts = [...byKind.entries()]
    .sort((x, y) => y[1] - x[1])
    .map(([kind, count]) => `${count} ${kind}${count === 1 ? '' : 's'}`);
  const totalNote = total > node.children.length ? esc(` · ${total} total inside`) : '';
  return `<div class="uf-idesc">${esc(parts.join(' · '))}${totalNote}</div>`;
}
function memberRowHtml(env: UEnv, childId: string): string {
  const child = env.gu(childId);
  const tag = env.isContainer(child) ? `${child.children.length} inside` : child.kind;
  return `<div class="uf-conn" data-goto="${esc(childId)}"><span class="uf-arw">·</span>`
    + `<span class="uf-cn">${esc(child.label)}</span><span class="uf-cl">${esc(tag)}</span></div>`;
}
function aggConnRowHtml(id: string, label: string, arrow: string, weight: number): string {
  return `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">${arrow}</span>`
    + `<span class="uf-cn">${esc(label)}</span><span class="uf-cl count">×${weight}</span></div>`;
}
function aggConnBlockHtml(env: UEnv, title: string, arrow: string, arr: [string, number][]): string {
  if (!arr.length) return '';
  const rows = arr.map(([id, weight]) => aggConnRowHtml(id, env.U.get(id)?.label ?? id, arrow, weight)).join('');
  return `<div class="uf-blk"><div class="uf-ilab2">${title} (${arr.length})</div>${rows}</div>`;
}
/** U6: group-level information — direct members, then subtree-aggregated external connections */
function containerConnectionsHtml(env: UEnv, node: UNode): string {
  const members = node.children
    .map((childId) => memberRowHtml(env, childId))
    .join('');
  const membersBlock = `<div class="uf-blk"><div class="uf-ilab2">contains (${node.children.length})</div>`
    + `${members}</div>`;
  const conns = groupConnsImpl(env, node.id);
  return membersBlock
    + aggConnBlockHtml(env, 'uses →', '→', conns.uses)
    + aggConnBlockHtml(env, '← used by', '←', conns.usedBy);
}
interface LeafConnSpec { edges: UEdge[]; key: 'from' | 'to'; title: string; arrow: string }
function leafConnsHtml(env: UEnv, nodeId: string, spec: LeafConnSpec): string {
  const seen = new Map<string, string>();
  for (const edge of spec.edges) if (!seen.has(edge[spec.key])) seen.set(edge[spec.key], edge.label);
  if (!seen.size) return '';
  const rows = [...seen.entries()].map(([id, lbl]) => {
    const advisory = env.spec.layers.trust
      && env.ALLOW.has(spec.key === 'to' ? `${nodeId}->${id}` : `${id}->${nodeId}`);
    const chip = advisory ? '<span class="uf-cl adv">advisory</span>'
      : lbl ? `<span class="uf-cl">${esc(lbl.split(',')[0])}</span>` : '';
    return `<div class="uf-conn" data-goto="${esc(id)}"><span class="uf-arw">${spec.arrow}</span>`
      + `<span class="uf-cn">${esc(env.U.get(id)?.label ?? id)}</span>${chip}</div>`;
  }).join('');
  return `<div class="uf-blk"><div class="uf-ilab2">${spec.title} (${seen.size})</div>${rows}</div>`;
}
/** a leaf's direct model connections — the other of the two connection shapes the inspector shows */
function leafConnectionsHtml(env: UEnv, node: UNode): string {
  const outHtml = leafConnsHtml(
    env, node.id, { edges: env.OUT[node.id] ?? [], key: 'to', title: 'uses →', arrow: '→' },
  );
  const inHtml = leafConnsHtml(
    env, node.id, { edges: env.IN[node.id] ?? [], key: 'from', title: '← used by', arrow: '←' },
  );
  return outHtml + inHtml;
}
/** U6: a container's members + subtree-aggregated external connections, or (for a
    leaf) its direct model connections — the two connection shapes the inspector shows */
function buildInspectorConnectionsHtml(env: UEnv, node: UNode, canOpen: boolean): string {
  return canOpen ? containerConnectionsHtml(env, node) : leafConnectionsHtml(env, node);
}
/** DOM wiring for the node inspector: every button/host the just-painted html contains */
function wireNodeInspectorControls(env: UEnv, el: HTMLElement, node: UNode): void {
  const openBtn = el.querySelector('#ufIOpen') as HTMLElement | null;
  if (openBtn) openBtn.onclick = () => env.toggleExpand(node.id);
  const editBtn = el.querySelector('#ufIEdit') as HTMLElement | null;
  if (editBtn) editBtn.onclick = () => env.commit({ type: 'setFmOpen', open: !env.spec.fmOpen });
  const fmHost = el.querySelector('#ufFmHost') as HTMLElement | null;
  if (fmHost) env.mountFrontmatter(fmHost, node.id);
  const hideBtn = el.querySelector('#ufIHide') as HTMLElement | null;
  if (hideBtn) hideBtn.onclick = () => env.commit({ type: 'hide', id: node.id });
  const showBtn = el.querySelector('#ufIShow') as HTMLElement | null;
  if (showBtn) showBtn.onclick = () => env.commit({ type: 'reveal', id: node.id });
  wireActionsMenu(env, el);
  wireGotoLinks(env, el);
}
/** the header's action-button row: unfold/fold, add/remove from view, edit frontmatter, the ⋯ menu */
function buildInspectorActionsHtml(env: UEnv, node: UNode, canOpen: boolean): string {
  const unfoldBtn = canOpen
    ? `<button class="uf-ibtn pri" id="ufIOpen">${env.spec.expanded.includes(node.id) ? 'fold' : 'unfold'}</button>`
    : '';
  const visBtn = env.isRendered(node.id)
    ? `<button class="uf-ibtn" id="ufIHide">remove from view</button>`
    : `<button class="uf-ibtn" id="ufIShow">add to view</button>`;
  const editBtn = env.ctx.state.nodes[node.id]
    ? `<button class="uf-ibtn${env.spec.fmOpen ? ' pri' : ''}" id="ufIEdit">`
      + `${env.spec.fmOpen ? 'done' : 'edit'}</button>`
    : '';
  return `<div class="uf-iact">${unfoldBtn}${visBtn}${editBtn}`
    + `<button class="uf-ibtn" id="ufIMenu" title="Actions">⋯</button></div>`;
}
/** the inspector header block: kind chip, name, breadcrumbs, role/desc, action buttons */
function buildInspectorHeaderHtml(env: UEnv, node: UNode): string {
  const isSym = SYM_KINDS.has(node.kind);
  const canOpen = env.isContainer(node);
  const crumbs = env.ancestorCrumbs(node);
  const role = canOpen ? buildContainerRoleHtml(env, node) : '';
  const crumbsHtml = crumbs.length ? `<div class="uf-ipath">${esc(crumbs.join('  ›  '))}</div>` : '';
  const descHtml = node.desc ? `<div class="uf-idesc">${esc(node.desc)}</div>` : '';
  const fmHtml = env.spec.fmOpen && env.ctx.state.nodes[node.id] ? '<div class="uf-blk" id="ufFmHost"></div>' : '';
  const menuHtml = env.actionsMenuOpen ? '<div class="uf-blk" id="ufActionsMenu"></div>' : '';
  return `<div class="uf-ihead"><span class="uf-ikind">${esc(node.kind)}</span>`
    + `<div class="uf-iname${isSym ? ' uf-mono' : ''}">${esc(node.label)}</div>${crumbsHtml}`
    + `${descHtml}${role}${buildInspectorActionsHtml(env, node, canOpen)}</div>${fmHtml}${menuHtml}`;
}
function factBlockHtml(env: UEnv, label: string, vals: string[]): string {
  if (!vals.length) return '';
  const rows = vals.map((val) => `<div class="uf-iline">${env.ifaceLine(val)}</div>`).join('');
  return `<div class="uf-blk"><div class="uf-ilab2">${label}</div>${rows}</div>`;
}
function blastRadiusHtml(): string {
  const plural = blastN === 1 ? '' : 's';
  return `<div class="uf-blk"><div class="uf-ilab2">blast radius</div>`
    + `<div class="uf-iline">${blastN} transitive dependent${plural}</div></div>`;
}
/** the inspector's fixed-fact blocks: accepts/returns/state, then blast radius if that layer is on */
function buildInspectorFactsHtml(env: UEnv, node: UNode): string {
  const facts = factBlockHtml(env, 'accepts', node.accepts)
    + factBlockHtml(env, 'returns', node.returns)
    + factBlockHtml(env, 'state', node.state);
  return env.spec.layers.blast ? facts + blastRadiusHtml() : facts;
}
/** the inspector's source block: the loaded function body for this node, if any */
function buildInspectorSourceHtml(env: UEnv, node: UNode): string {
  const body = (env.ctx.bodies?.get(node.id) as { body?: string } | undefined)?.body;
  if (!body) return '';
  return `<div class="uf-blk"><div class="uf-ilab2">source</div>`
    + `<div class="uf-body"><pre>${esc(body)}</pre></div></div>`;
}
/** the node inspector: header + role + fixed facts + connections, then wire every control */
function renderNodeInspectorImpl(env: UEnv, el: HTMLElement): void {
  if (!env.spec.sel || !env.U.has(env.spec.sel)) {
    el.innerHTML = '';
    return;
  }
  const node = env.gu(env.spec.sel);
  const canOpen = env.isContainer(node);
  el.innerHTML = buildInspectorHeaderHtml(env, node)
    + buildInspectorFactsHtml(env, node)
    + buildInspectorConnectionsHtml(env, node, canOpen)
    + buildInspectorSourceHtml(env, node);
  wireNodeInspectorControls(env, el, node);
}
// the inspector: empty until a selection exists, else one of three shapes
// (type focus, wire, or node) — each a dedicated render + wire-up pair above
function renderInspectorImpl(env: UEnv): void {
  const el = env.q('ufInsp');
  if (env.spec.focusType) {
    renderTypeFocusInspector(env, el, env.spec.focusType);
    return;
  }
  if (env.spec.selWire && env.U.has(env.spec.selWire.a) && env.U.has(env.spec.selWire.b)) {
    renderWireInspector(env, el, env.spec.selWire.a, env.spec.selWire.b);
    return;
  }
  renderNodeInspectorImpl(env, el);
}

/* ================= LAYERS ================= */
function wireLayerRowClick(
  env: UEnv,
  row: HTMLElement,
  layerDef: { k: string; label: string; desc: string },
  noSrc: boolean,
): void {
  if (noSrc) {
    // no advisory source = the layer stays off (it never marks what it cannot back)
    row.onclick = (evt) => {
      if ((evt.target as HTMLElement).closest('.uf-load')) {
        evt.stopPropagation();
        env.trustFileEl?.click();
      }
    };
    return;
  }
  row.onclick = () => env.commit({ type: 'toggleLayer', key: layerDef.k });
}
function renderLayerRow(env: UEnv, layerDef: { k: string; label: string; desc: string }): HTMLElement {
  const noSrc = layerDef.k === 'trust' && !env.TRUST_SRC;
  const cls = 'uf-layer' + (env.spec.layers[layerDef.k] ? ' on' : '') + (noSrc ? ' off' : '');
  const loadBtn = noSrc ? '<button class="uf-load" title="Load an edge-advisory-allowlist.txt">load…</button>' : '';
  const row = env.h('div', cls,
    `<span class="uf-sw"></span><span style="flex:1;min-width:0"><div class="uf-lt">${layerDef.label}</div>`
    + `<div class="uf-ld">${layerDef.desc}</div></span>${loadBtn}`);
  wireLayerRowClick(env, row, layerDef, noSrc);
  return row;
}
function renderLayersImpl(env: UEnv): void {
  const box = env.q('ufLayers');
  box.innerHTML = '';
  for (const layerDef of LAYER_DEFS) box.appendChild(renderLayerRow(env, layerDef));
}
function applyLayerClassesImpl(env: UEnv): void {
  env.overlay.classList.toggle('desc', env.spec.layers.desc);
  env.overlay.classList.toggle('iface', env.spec.layers.iface);
  env.overlay.classList.toggle('metrics', env.spec.layers.metrics);
  env.overlay.classList.toggle('color', env.spec.layers.color);
  env.overlay.classList.toggle('trust', env.spec.layers.trust);
}

function wireInspectApi(env: UEnv, api: {
  computeBlast: () => void;
  trustLayer: () => void;
  selectGroup: (id: string) => void;
  groupConns: (id: string) => { uses: [string, number][]; usedBy: [string, number][] };
  renderInspector: () => void;
}): void {
  env.computeBlast = api.computeBlast;
  env.trustLayer = api.trustLayer;
  env.selectGroup = api.selectGroup;
  env.select = api.selectGroup;
  env.stageTargetOf = (node) => stageTargetOfImpl(env, node);
  env.groupConns = api.groupConns;
  env.renderInspector = api.renderInspector;
  env.renderLayers = () => renderLayersImpl(env);
  env.applyLayerClasses = () => applyLayerClassesImpl(env);
}

export function initUnfoldInspect(env: UEnv): void {
  /** U6: a group is a first-class selectable (U6): select + inspect, never stage (U8 deferred).
      The sel/selWire/focusType/fmOpen exclusions live in the reducer; the staged /
      blast / plain repaints live in paint('select'). */
  function selectGroup(id: string): void {
    env.commit({ type: 'select', id });
  }
  function computeBlast(): void {
    computeBlastImpl(env);
  }
  function trustLayer(): void {
    trustLayerImpl(env);
  }
  function groupConns(id: string): { uses: [string, number][]; usedBy: [string, number][] } {
    return groupConnsImpl(env, id);
  }
  function renderInspector(): void {
    renderInspectorImpl(env);
  }

  wireInspectApi(env, { computeBlast, trustLayer, selectGroup, groupConns, renderInspector });
}
