/* =====================================================================
   keyboard.ts — keyboard + wheel input
   ---------------------------------------------------------------------
   Responsibility: global key handling (undo/redo, clipboard, delete,
   arrow-nudge, quick-add 1-9, link/fit/zoom/panel/help hotkeys, space-pan
   tracking) and the wheel handler (trackpad pan / pinch-zoom / mouse
   ctrl-zoom). Bridges to the right module API for each action.

   This is pure wiring: it owns no model state of its own beyond a nudge
   debounce timer and the last-mouse tracker.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { SelectionApi } from './selection';
import type { NodesApi } from './nodes';
import type { ClipboardApi } from './clipboard';
import type { PointerApi } from './pointer';
import type { InlineEditApi } from './inline-edit';
import type { HistoryApi } from '../core/history/history';
import type { ViewApi } from './view';
import type { ShapeKind } from '../core/types/types';
import { GRID } from '../core/config/config';

export interface KeyboardDeps {
  camera: CameraApi;
  selection: SelectionApi;
  nodes: NodesApi;
  clipboard: ClipboardApi;
  pointer: PointerApi;
  inlineEdit: InlineEditApi;
  history: HistoryApi;
  view: ViewApi;
  togglePanel: () => void;
  hideCtx: () => void;
}

function editing(): boolean {
  const el = document.activeElement as HTMLElement | null;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}

/** Runs `action` under preventDefault and reports the key as handled. */
function fireAction(e: KeyboardEvent, action: () => void): boolean {
  e.preventDefault();
  action();
  return true;
}

/** Runs `action` (no preventDefault) and reports the key as handled. */
function markHandled(action: () => void): boolean {
  action();
  return true;
}

function handleHistoryKeys(e: KeyboardEvent, deps: KeyboardDeps, mod: boolean): boolean {
  if (!mod) return false;
  const key = e.key.toLowerCase();
  if (key === 'z') return fireAction(e, () => (e.shiftKey ? deps.history.redo() : deps.history.undo()));
  if (key === 'y') return fireAction(e, () => deps.history.redo());
  return false;
}

function handleClipboardKeys(e: KeyboardEvent, ctx: AppContext, deps: KeyboardDeps, mod: boolean): boolean {
  if (!mod) return false;
  const key = e.key.toLowerCase();
  if (key === 'c') return fireAction(e, () => deps.clipboard.copySel());
  if (key === 'v') return fireAction(e, () => deps.clipboard.pasteClip(ctx.lastMouseWorld));
  if (key === 'd') return fireAction(e, () => deps.clipboard.duplicateSel());
  if (key === 'a') return fireAction(e, () => deps.selection.selectAll());
  return false;
}

function handleDeleteKey(e: KeyboardEvent, deps: KeyboardDeps): boolean {
  if (e.key !== 'Delete' && e.key !== 'Backspace') return false;
  return fireAction(e, () => deps.nodes.deleteSelection());
}

function applyNudgeStep(key: string, big: boolean, ctx: AppContext): void {
  const step = big ? GRID : 1;
  let dx = 0;
  let dy = 0;
  if (key === 'ArrowUp') dy = -step;
  if (key === 'ArrowDown') dy = step;
  if (key === 'ArrowLeft') dx = -step;
  if (key === 'ArrowRight') dx = step;
  ctx.state.sel.forEach((id) => {
    ctx.state.nodes[id].x += dx;
    ctx.state.nodes[id].y += dy;
  });
}

function scheduleNudgeCommit(ctx: AppContext, nudge: { timer: number | null }): void {
  ctx.hooks.render();
  ctx.hooks.sync();
  if (nudge.timer !== null) clearTimeout(nudge.timer);
  nudge.timer = window.setTimeout(() => {
    ctx.hooks.pushHistory();
    ctx.hooks.reroute();
  }, 350);
}

function handleArrowNudge(e: KeyboardEvent, ctx: AppContext, nudge: { timer: number | null }): boolean {
  const arrowKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
  if (!arrowKeys.includes(e.key) || !ctx.state.sel.size) return false;
  e.preventDefault();
  applyNudgeStep(e.key, e.shiftKey, ctx);
  scheduleNudgeCommit(ctx, nudge);
  return true;
}

function handleEditEnterKey(e: KeyboardEvent, ctx: AppContext, deps: KeyboardDeps): boolean {
  if (e.key !== 'Enter' || ctx.state.sel.size !== 1) return false;
  return fireAction(e, () => deps.inlineEdit.beginEdit([...ctx.state.sel][0]));
}

function handleEscapeKey(ctx: AppContext, deps: KeyboardDeps, helpOverlay: HTMLElement): void {
  const { state, runtime } = ctx;
  const nothingToClear = !runtime.tracedType && !runtime.focusSpine && !deps.pointer.isLinkMode()
    && !state.sel.size && !state.selEdge && !helpOverlay.classList.contains('show');
  if (nothingToClear && ctx.view.container) {
    deps.view.goUp();
    return;
  }
  runtime.tracedType = null;
  runtime.focusSpine = null;
  deps.pointer.setLinkMode(false);
  deps.selection.clearSel();
  deps.hideCtx();
  helpOverlay.classList.remove('show');
}

function handleViewToggleKeys(e: KeyboardEvent, ctx: AppContext, deps: KeyboardDeps): boolean {
  const key = e.key.toLowerCase();
  if (key === 'l') return markHandled(() => deps.pointer.setLinkMode(!deps.pointer.isLinkMode()));
  if (key === 'f') return markHandled(() => deps.camera.zoomToFit());
  if (e.key === '+' || e.key === '=') return markHandled(() => deps.camera.zoomCenter(ctx.cam.z * 1.2));
  if (e.key === '-' || e.key === '_') return markHandled(() => deps.camera.zoomCenter(ctx.cam.z / 1.2));
  return false;
}

function handleEscapeHelpKeys(
  e: KeyboardEvent,
  ctx: AppContext,
  deps: KeyboardDeps,
  helpOverlay: HTMLElement,
): boolean {
  if (e.key === 'Escape') return markHandled(() => handleEscapeKey(ctx, deps, helpOverlay));
  if (e.key === '?') return markHandled(() => helpOverlay.classList.toggle('show'));
  if (e.key === 'Tab') return fireAction(e, deps.togglePanel);
  return false;
}

function handleQuickAddKey(e: KeyboardEvent, ctx: AppContext, deps: KeyboardDeps): void {
  const numMap: Record<string, ShapeKind> = {
    '1': 'rect', '2': 'round', '3': 'stadium', '4': 'cylinder', '5': 'diamond',
    '6': 'circle', '7': 'hex', '8': 'note', '9': 'group',
  };
  const shape = numMap[e.key];
  if (!shape) return;
  const point = ctx.lastMouseWorld;
  deps.nodes.addNode(shape, point ? point.x - 60 : null, point ? point.y - 26 : null);
}

function handleSpaceAndEditingGuard(e: KeyboardEvent, ctx: AppContext, deps: KeyboardDeps): boolean {
  const { stage } = ctx.dom;
  if (e.key === ' ' && !editing()) {
    deps.pointer.setSpaceDown(true);
    stage.classList.add('space');
  }
  return editing();
}

function dispatchPrimaryKeys(
  e: KeyboardEvent,
  ctx: AppContext,
  deps: KeyboardDeps,
  nudge: { timer: number | null },
): boolean {
  const mod = e.metaKey || e.ctrlKey;
  return handleHistoryKeys(e, deps, mod)
    || handleClipboardKeys(e, ctx, deps, mod)
    || handleDeleteKey(e, deps)
    || handleArrowNudge(e, ctx, nudge)
    || handleEditEnterKey(e, ctx, deps);
}

function handleKeydown(
  e: KeyboardEvent,
  ctx: AppContext,
  deps: KeyboardDeps,
  aux: { helpOverlay: HTMLElement; nudge: { timer: number | null } },
): void {
  if (handleSpaceAndEditingGuard(e, ctx, deps)) return;
  const handled = dispatchPrimaryKeys(e, ctx, deps, aux.nudge)
    || handleViewToggleKeys(e, ctx, deps)
    || handleEscapeHelpKeys(e, ctx, deps, aux.helpOverlay);
  if (handled) return;
  handleQuickAddKey(e, ctx, deps);
}

function computeWheelPan(e: WheelEvent): { dx: number; dy: number } {
  let dx = e.deltaX;
  let dy = e.deltaY;
  if (e.shiftKey && dx === 0) {
    dx = dy;
    dy = 0;
  }
  return { dx, dy };
}

function handleWheel(e: WheelEvent, ctx: AppContext, camera: CameraApi): void {
  const { cam } = ctx;
  e.preventDefault();
  if (e.ctrlKey || e.metaKey) {
    const factor = Math.exp(-e.deltaY * 0.01);
    camera.zoomAt(e.clientX, e.clientY, cam.z * factor);
    return;
  }
  const { dx, dy } = computeWheelPan(e);
  cam.x -= dx;
  cam.y -= dy;
  camera.applyCam();
  camera.persistSoon();
}

function handleKeyup(e: KeyboardEvent, deps: KeyboardDeps, stage: HTMLElement): void {
  if (e.key !== ' ') return;
  deps.pointer.setSpaceDown(false);
  stage.classList.remove('space');
}

export function initKeyboard(ctx: AppContext, deps: KeyboardDeps): void {
  const { stage } = ctx.dom;
  const { camera } = deps;
  const helpOverlay = document.getElementById('helpOverlay') as HTMLElement;
  const nudge: { timer: number | null } = { timer: null };

  stage.addEventListener('wheel', (e) => handleWheel(e, ctx, camera), { passive: false });
  window.addEventListener('keydown', (e) => handleKeydown(e, ctx, deps, { helpOverlay, nudge }));
  window.addEventListener('keyup', (e) => handleKeyup(e, deps, stage));
}
