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
import type { NodeKind } from '../../core/types/types';
import { containerOf } from '../../core/state/state';
import { esc, KIND_BADGE } from '../../core/config/config';

export interface NavigatorApi {
  render: () => void;
}

export function initNavigator(
  ctx: AppContext,
  deps: { selection: SelectionApi; view: ViewApi; camera: CameraApi },
): NavigatorApi {
  const { state } = ctx;
  const { selection, view, camera } = deps;

  const pane = document.getElementById('paneNav') as HTMLElement | null;
  if (!pane) return { render: () => {} };

  /* ---- build the fixed chrome (search + kind bar + list container) ---- */
  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search nodes…';
  searchInput.className = 'nav-search';
  searchInput.oninput = render;

  const kindBar = document.createElement('div');
  kindBar.className = 'nav-kinds';

  const list = document.createElement('div');
  list.className = 'nav-list';

  pane.appendChild(searchInput);
  pane.appendChild(kindBar);
  pane.appendChild(list);

  let activeKind: NodeKind | null = null;

  /* ---- render ---- */

  function buildKindBar(): void {
    const kinds = new Set<NodeKind>();
    for (const id of Object.keys(state.nodes)) {
      const k = state.nodes[id].kind;
      if (k) kinds.add(k as NodeKind);
    }

    kindBar.textContent = '';

    const allBtn = document.createElement('button');
    allBtn.className = 'nav-kind-btn' + (activeKind === null ? ' active' : '');
    allBtn.textContent = 'All';
    allBtn.onclick = () => { activeKind = null; render(); };
    kindBar.appendChild(allBtn);

    for (const k of [...kinds].sort()) {
      const btn = document.createElement('button');
      btn.className = 'nav-kind-btn' + (activeKind === k ? ' active' : '');
      btn.textContent = KIND_BADGE[k] ?? k;
      btn.title = k;
      btn.onclick = () => { activeKind = activeKind === k ? null : k; render(); };
      kindBar.appendChild(btn);
    }
  }

  function render(): void {
    const query = searchInput.value.toLowerCase().trim();
    buildKindBar();

    const rows: string[] = [];
    const ids = Object.keys(state.nodes);

    for (const id of ids) {
      const n = state.nodes[id];
      if (activeKind && n.kind !== activeKind) continue;
      if (query && !id.toLowerCase().includes(query) && !n.label.toLowerCase().includes(query)) continue;

      const container = containerOf(state, id);
      const containerLabel = container
        ? (state.nodes[container]?.label || container)
        : '';
      const badge = n.kind ? (KIND_BADGE[n.kind] ?? n.kind) : '';
      const sel = state.sel.has(id) ? ' nav-row--sel' : '';

      rows.push(
        `<div class="nav-row${sel}" data-id="${esc(id)}">` +
        `<span class="nav-row-label">${esc(n.label || id)}</span>` +
        (badge ? `<span class="nav-row-badge">${esc(badge)}</span>` : '') +
        (containerLabel ? `<span class="nav-row-container">${esc(containerLabel)}</span>` : '') +
        `</div>`,
      );
    }

    list.innerHTML = rows.length
      ? rows.join('')
      : `<div class="nav-empty">${query ? 'No matches for "' + esc(query) + '"' : 'No nodes yet'}</div>`;

    list.querySelectorAll<HTMLElement>('.nav-row').forEach((row) => {
      row.onclick = () => { const id = row.dataset.id; if (id) navigateTo(id); };
    });
  }

  function navigateTo(id: string): void {
    if (!state.nodes[id]) return;
    const level = containerOf(state, id);
    // Switch drill level first (clears sel + fits); then override with select + centre.
    if (ctx.view.container !== level) view.goTo(level);
    selection.selectOnly(id);
    camera.zoomToNode(id);
  }

  return { render };
}
