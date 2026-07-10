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

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import { containerOf, containerPath } from '../core/state/state';
import { esc } from '../core/config/config';

export interface ViewApi {
  enter: (id: string) => void;
  goUp: () => void;
  goTo: (container: string | null) => void;
  renderBreadcrumb: () => void;
}

/** Build the breadcrumb's inner HTML from the current drill path. */
function buildBreadcrumbHtml(ctx: AppContext): string {
  const path = containerPath(ctx.state, ctx.view.container);
  const crumbs: string[] = [`<button class="bc-seg" data-bc="">Main</button>`];
  path.forEach((id, i) => {
    const last = i === path.length - 1;
    const label = ctx.state.nodes[id]?.label || id;
    crumbs.push('<span class="bc-sep">›</span>');
    crumbs.push(`<button class="bc-seg${last ? ' current' : ''}" data-bc="${id}">${esc(label)}</button>`);
  });
  return crumbs.join('');
}

/** Wire click handlers on the breadcrumb's rendered segment buttons. */
function wireBreadcrumbClicks(breadcrumbEl: HTMLElement, goTo: (container: string | null) => void): void {
  breadcrumbEl.querySelectorAll('.bc-seg').forEach((btn) => {
    (btn as HTMLElement).onclick = () => {
      const target = (btn as HTMLElement).dataset.bc || '';
      goTo(target ? target : null);
    };
  });
}

/** Switch to a level: clear selection, re-render, fit, refresh breadcrumb. */
function performApply(
  ctx: AppContext,
  camera: CameraApi,
  renderBreadcrumb: () => void,
  container: string | null,
): void {
  ctx.view.container = container;
  ctx.state.sel.clear();
  ctx.state.selEdge = null;
  renderBreadcrumb();
  ctx.hooks.render();
  ctx.hooks.renderInspector();
  camera.zoomToFit();
}

function performEnter(ctx: AppContext, apply: (container: string | null) => void, id: string): void {
  if (!ctx.state.nodes[id]) return;
  if (ctx.state.nodes[id].shape === 'group') return; // groups are in-level, not a level
  apply(id);
}

function performGoUp(ctx: AppContext, apply: (container: string | null) => void): void {
  const cur = ctx.view.container;
  if (!cur) return;
  apply(containerOf(ctx.state, cur));
}

function performGoTo(
  ctx: AppContext,
  apply: (container: string | null) => void,
  container: string | null,
): void {
  if (container && !ctx.state.nodes[container]) return;
  apply(container);
}

function performRenderBreadcrumb(
  ctx: AppContext,
  breadcrumbEl: HTMLElement | null,
  goTo: (container: string | null) => void,
): void {
  if (!breadcrumbEl) return;
  const path = containerPath(ctx.state, ctx.view.container); // [] at root
  breadcrumbEl.style.display = path.length ? 'flex' : 'none';
  breadcrumbEl.innerHTML = buildBreadcrumbHtml(ctx);
  wireBreadcrumbClicks(breadcrumbEl, goTo);
}

export function initView(ctx: AppContext, camera: CameraApi): ViewApi {
  const breadcrumbEl = document.getElementById('breadcrumb');
  // breadcrumb clicks must not reach the stage (which would start a marquee
  // and swallow the click through pointer capture)
  if (breadcrumbEl) breadcrumbEl.addEventListener('pointerdown', (event) => event.stopPropagation());

  function apply(container: string | null): void {
    performApply(ctx, camera, renderBreadcrumb, container);
  }

  function enter(id: string): void {
    performEnter(ctx, apply, id);
  }

  function goUp(): void {
    performGoUp(ctx, apply);
  }

  function goTo(container: string | null): void {
    performGoTo(ctx, apply, container);
  }

  function renderBreadcrumb(): void {
    performRenderBreadcrumb(ctx, breadcrumbEl, goTo);
  }

  return { enter, goUp, goTo, renderBreadcrumb };
}
