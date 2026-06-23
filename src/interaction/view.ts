/* =====================================================================
   view.ts — drill-in navigation
   ---------------------------------------------------------------------
   Responsibility: own the current drill level (ctx.view.container) and
   the verbs that change it — enter a node, go up one level, jump to a
   container — plus the breadcrumb DOM that reflects and drives the path.

   Changing level is a VIEW operation, not a model edit: it clears the
   selection, re-renders the level, fits the camera, and refreshes the
   breadcrumb, but never pushes history or mutates nodes/edges.
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { CameraApi } from '../core/camera';
import { containerOf, containerPath } from '../core/state';
import { esc } from '../core/config';

export interface ViewApi {
  enter: (id: string) => void;
  goUp: () => void;
  goTo: (container: string | null) => void;
  renderBreadcrumb: () => void;
}

export function initView(ctx: AppContext, camera: CameraApi): ViewApi {
  const { state } = ctx;
  const bc = document.getElementById('breadcrumb');

  // breadcrumb clicks must not reach the stage (which would start a marquee
  // and swallow the click through pointer capture)
  if (bc) bc.addEventListener('pointerdown', (e) => e.stopPropagation());

  /** Switch to a level: clear selection, re-render, fit, refresh breadcrumb. */
  function apply(container: string | null): void {
    ctx.view.container = container;
    state.sel.clear(); state.selEdge = null;
    renderBreadcrumb();
    ctx.hooks.render();
    ctx.hooks.renderInspector();
    camera.zoomToFit();
  }

  function enter(id: string): void {
    if (!state.nodes[id]) return;
    if (state.nodes[id].shape === 'group') return; // groups are in-level, not a level
    apply(id);
  }

  function goUp(): void {
    const cur = ctx.view.container;
    if (!cur) return;
    apply(containerOf(state, cur));
  }

  function goTo(container: string | null): void {
    if (container && !state.nodes[container]) return;
    apply(container);
  }

  function renderBreadcrumb(): void {
    if (!bc) return;
    const path = containerPath(state, ctx.view.container); // [] at root
    bc.style.display = path.length ? 'flex' : 'none';
    const crumbs: string[] = [
      `<button class="bc-seg" data-bc="">Main</button>`,
    ];
    path.forEach((id, i) => {
      const last = i === path.length - 1;
      const label = state.nodes[id]?.label || id;
      crumbs.push('<span class="bc-sep">\u203a</span>');
      crumbs.push(`<button class="bc-seg${last ? ' current' : ''}" data-bc="${id}">${esc(label)}</button>`);
    });
    bc.innerHTML = crumbs.join('');
    bc.querySelectorAll('.bc-seg').forEach((b) => {
      (b as HTMLElement).onclick = () => {
        const target = (b as HTMLElement).dataset.bc || '';
        goTo(target ? target : null);
      };
    });
  }

  return { enter, goUp, goTo, renderBreadcrumb };
}
