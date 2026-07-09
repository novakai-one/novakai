/* =====================================================================
   navigator.ts — searchable node list panel
   ---------------------------------------------------------------------
   Responsibility: render a live, filterable list of every node in the
   current diagram; clicking a row switches drill level if needed, selects
   the node, and centres the camera on it.

   Reads: ctx.state (nodes, edges, sel, view.container).
   Writes: view level, selection, camera position.
   No direct imports of other modules' runtime — deps injected.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';
import type { SelectionApi } from '../../interaction/selection';
import type { ViewApi } from '../../interaction/view';
import type { CameraApi } from '../../core/camera/camera';
import type { DiagramNode, NodeKind } from '../../core/types/types';
import type { StateStore } from '../../core/state/state';
import { containerOf } from '../../core/state/state';
import { esc, KIND_BADGE } from '../../core/config/config';

export interface NavigatorApi {
  render: () => void;
}

interface NavChrome {
  searchInput: HTMLInputElement;
  kindBar: HTMLDivElement;
  list: HTMLDivElement;
}

interface NavCtx {
  ctx: AppContext;
  selection: SelectionApi;
  view: ViewApi;
  camera: CameraApi;
  chrome: NavChrome;
  activeKind: NodeKind | null;
}

function buildChrome(pane: HTMLElement): NavChrome {
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search nodes…';
  searchInput.className = 'nav-search';

  const kindBar = document.createElement('div');
  kindBar.className = 'nav-kinds';

  const list = document.createElement('div');
  list.className = 'nav-list';

  pane.appendChild(searchInput);
  pane.appendChild(kindBar);
  pane.appendChild(list);

  return { searchInput, kindBar, list };
}

function collectKinds(state: StateStore): Set<NodeKind> {
  const kinds = new Set<NodeKind>();
  for (const id of Object.keys(state.nodes)) {
    const kind = state.nodes[id].kind;
    if (kind) kinds.add(kind as NodeKind);
  }
  return kinds;
}

function makeKindButton(
  label: string,
  title: string,
  active: boolean,
  onClick: () => void,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = 'nav-kind-btn' + (active ? ' active' : '');
  btn.textContent = label;
  if (title) btn.title = title;
  btn.onclick = onClick;
  return btn;
}

function nodeMatches(node: DiagramNode, id: string, activeKind: NodeKind | null, query: string): boolean {
  if (activeKind && node.kind !== activeKind) return false;
  if (query && !id.toLowerCase().includes(query) && !node.label.toLowerCase().includes(query)) return false;
  return true;
}

function rowMarkup(state: StateStore, id: string, node: DiagramNode): string {
  const container = containerOf(state, id);
  const containerLabel = container ? (state.nodes[container]?.label || container) : '';
  const badge = node.kind ? (KIND_BADGE[node.kind] ?? node.kind) : '';
  const sel = state.sel.has(id) ? ' nav-row--sel' : '';

  return (
    `<div class="nav-row${sel}" data-id="${esc(id)}">` +
    `<span class="nav-row-label">${esc(node.label || id)}</span>` +
    (badge ? `<span class="nav-row-badge">${esc(badge)}</span>` : '') +
    (containerLabel ? `<span class="nav-row-container">${esc(containerLabel)}</span>` : '') +
    `</div>`
  );
}

function rowHtml(state: StateStore, id: string, activeKind: NodeKind | null, query: string): string | null {
  const node = state.nodes[id];
  if (!nodeMatches(node, id, activeKind, query)) return null;
  return rowMarkup(state, id, node);
}

function wireRowClicks(list: HTMLElement, navigateTo: (id: string) => void): void {
  list.querySelectorAll<HTMLElement>('.nav-row').forEach((row) => {
    row.onclick = () => {
      const id = row.dataset.id;
      if (id) navigateTo(id);
    };
  });
}

function navigateToImpl(nav: NavCtx, id: string): void {
  const { state } = nav.ctx;
  if (!state.nodes[id]) return;
  const level = containerOf(state, id);
  // Switch drill level first (clears sel + fits); then override with select + centre.
  if (nav.ctx.view.container !== level) nav.view.goTo(level);
  nav.selection.selectOnly(id);
  nav.camera.zoomToNode(id);
}

function buildKindBarImpl(nav: NavCtx): void {
  const { kindBar } = nav.chrome;
  kindBar.textContent = '';
  kindBar.appendChild(makeKindButton('All', '', nav.activeKind === null, () => {
    nav.activeKind = null;
    renderImpl(nav);
  }));
  for (const kind of [...collectKinds(nav.ctx.state)].sort()) {
    kindBar.appendChild(makeKindButton(KIND_BADGE[kind] ?? kind, kind, nav.activeKind === kind, () => {
      nav.activeKind = nav.activeKind === kind ? null : kind;
      renderImpl(nav);
    }));
  }
}

function renderImpl(nav: NavCtx): void {
  const { searchInput, list } = nav.chrome;
  const query = searchInput.value.toLowerCase().trim();
  buildKindBarImpl(nav);

  const rows = Object.keys(nav.ctx.state.nodes)
    .map((id) => rowHtml(nav.ctx.state, id, nav.activeKind, query))
    .filter((html): html is string => html !== null);

  list.innerHTML = rows.length
    ? rows.join('')
    : `<div class="nav-empty">${query ? 'No matches for "' + esc(query) + '"' : 'No nodes yet'}</div>`;

  wireRowClicks(list, (id) => navigateToImpl(nav, id));
}

export function initNavigator(
  ctx: AppContext,
  deps: { selection: SelectionApi; view: ViewApi; camera: CameraApi },
): NavigatorApi {
  const pane = document.getElementById('paneNav') as HTMLElement | null;
  if (!pane) return { render: () => {} };

  const chrome = buildChrome(pane);
  const nav: NavCtx = {
    ctx,
    selection: deps.selection,
    view: deps.view,
    camera: deps.camera,
    chrome,
    activeKind: null,
  };
  const render = (): void => renderImpl(nav);
  chrome.searchInput.oninput = render;

  return { render };
}
