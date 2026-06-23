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

import type { AppContext } from '../core/context';
import type { CameraApi } from '../core/camera';
import type { SelectionApi } from './selection';
import type { NodesApi } from './nodes';
import type { ClipboardApi } from './clipboard';
import type { PointerApi } from './pointer';
import type { InlineEditApi } from './inline-edit';
import type { HistoryApi } from '../core/history';
import type { ViewApi } from './view';
import type { ShapeKind } from '../core/types';
import { GRID } from '../core/config';

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
  const a = document.activeElement as HTMLElement | null;
  return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable);
}

export function initKeyboard(ctx: AppContext, deps: KeyboardDeps): void {
  const { stage } = ctx.dom;
  const { state, cam } = ctx;
  const { camera, selection, nodes, clipboard, pointer, inlineEdit, history } = deps;
  const helpOverlay = document.getElementById('helpOverlay') as HTMLElement;
  let nudgeTimer: number | null = null;

  /* ---------------- wheel: pan / zoom ---------------- */
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const factor = Math.exp(-e.deltaY * 0.01);
      camera.zoomAt(e.clientX, e.clientY, cam.z * factor);
    } else {
      let dx = e.deltaX, dy = e.deltaY;
      if (e.shiftKey && dx === 0) { dx = dy; dy = 0; }
      cam.x -= dx; cam.y -= dy;
      camera.applyCam(); camera.persistSoon();
    }
  }, { passive: false });

  /* ---------------- keydown ---------------- */
  window.addEventListener('keydown', (e) => {
    if (e.key === ' ' && !editing()) { pointer.setSpaceDown(true); stage.classList.add('space'); }
    if (editing()) return;
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) history.redo(); else history.undo(); return; }
    if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); history.redo(); return; }

    if (mod && e.key.toLowerCase() === 'c') { e.preventDefault(); clipboard.copySel(); return; }
    if (mod && e.key.toLowerCase() === 'v') { e.preventDefault(); clipboard.pasteClip(ctx.lastMouseWorld); return; }
    if (mod && e.key.toLowerCase() === 'd') { e.preventDefault(); clipboard.duplicateSel(); return; }
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); selection.selectAll(); return; }

    if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); nodes.deleteSelection(); return; }

    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) && state.sel.size) {
      e.preventDefault();
      const step = e.shiftKey ? GRID : 1;
      let dx = 0, dy = 0;
      if (e.key === 'ArrowUp') dy = -step;
      if (e.key === 'ArrowDown') dy = step;
      if (e.key === 'ArrowLeft') dx = -step;
      if (e.key === 'ArrowRight') dx = step;
      state.sel.forEach((id) => { state.nodes[id].x += dx; state.nodes[id].y += dy; });
      ctx.hooks.render(); ctx.hooks.sync();
      if (nudgeTimer !== null) clearTimeout(nudgeTimer);
      nudgeTimer = window.setTimeout(() => { ctx.hooks.pushHistory(); ctx.hooks.reroute(); }, 350);
      return;
    }

    if (e.key === 'Enter' && state.sel.size === 1) { e.preventDefault(); inlineEdit.beginEdit([...state.sel][0]); return; }
    if (e.key.toLowerCase() === 'l') { pointer.setLinkMode(!pointer.isLinkMode()); return; }
    if (e.key.toLowerCase() === 'f') { camera.zoomToFit(); return; }
    if (e.key === 'Escape') {
      const nothingToClear = !ctx.runtime.tracedType && !pointer.isLinkMode()
        && !state.sel.size && !state.selEdge && !helpOverlay.classList.contains('show');
      if (nothingToClear && ctx.view.container) { deps.view.goUp(); return; }
      ctx.runtime.tracedType = null; pointer.setLinkMode(false); selection.clearSel(); deps.hideCtx(); helpOverlay.classList.remove('show');
      return;
    }
    if (e.key === '?') { helpOverlay.classList.toggle('show'); return; }
    if (e.key === 'Tab') { e.preventDefault(); deps.togglePanel(); return; }
    if (e.key === '+' || e.key === '=') { camera.zoomCenter(cam.z * 1.2); return; }
    if (e.key === '-' || e.key === '_') { camera.zoomCenter(cam.z / 1.2); return; }

    const numMap: Record<string, ShapeKind> = {
      '1': 'rect', '2': 'round', '3': 'stadium', '4': 'cylinder', '5': 'diamond',
      '6': 'circle', '7': 'hex', '8': 'note', '9': 'group',
    };
    if (numMap[e.key]) {
      const m = ctx.lastMouseWorld;
      nodes.addNode(numMap[e.key], m ? m.x - 60 : null, m ? m.y - 26 : null);
      return;
    }
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') { pointer.setSpaceDown(false); stage.classList.remove('space'); }
  });
}
