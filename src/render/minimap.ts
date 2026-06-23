/* =====================================================================
   minimap.ts — overview canvas
   ---------------------------------------------------------------------
   Responsibility: paint the small overview canvas (nodes + current
   viewport rectangle) and translate clicks/drags on it into camera moves
   (minimapTo). Owns the click->world mapping it computes while drawing.

   Reads: ctx.state, ctx.cam, ctx.mmShow. Calls camera.applyCam +
   persistSoon when navigating.
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { CameraApi } from '../core/camera';
import { levelBounds, childIdsOf } from '../core/state';

export interface MinimapApi {
  drawMinimap: () => void;
}

export function initMinimap(ctx: AppContext, camera: CameraApi): MinimapApi {
  const { stage } = ctx.dom;
  const cam = ctx.cam;
  let mmFit: { s: number; ox: number; oy: number } | null = null;

  function drawMinimap(): void {
    const cv = document.getElementById('mmCanvas') as HTMLCanvasElement | null;
    if (!cv || !ctx.mmShow) return;
    const c2d = cv.getContext('2d');
    if (!c2d) return;
    const W = cv.width, H = cv.height;
    c2d.clearRect(0, 0, W, H);
    const cs = getComputedStyle(document.documentElement);
    const nb = cs.getPropertyValue('--node-stroke').trim() || '#3a4254';
    const accent = cs.getPropertyValue('--accent').trim() || '#7c8cff';

    const container = ctx.view.container;
    const b = levelBounds(ctx.state, container);
    // viewport rect in world coords
    const vw0 = (-cam.x) / cam.z, vh0 = (-cam.y) / cam.z;
    const vw1 = (stage.clientWidth - cam.x) / cam.z, vh1 = (stage.clientHeight - cam.y) / cam.z;
    // overall extent = nodes + current viewport, so the box is always visible
    let minX = vw0, minY = vh0, maxX = vw1, maxY = vh1;
    if (b) { minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY); maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY); }
    const pad = 40;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const ew = maxX - minX, eh = maxY - minY;
    const s = Math.min(W / ew, H / eh);
    const ox = (W - ew * s) / 2 - minX * s;
    const oy = (H - eh * s) / 2 - minY * s;
    mmFit = { s, ox, oy };
    const sx = (wx: number): number => wx * s + ox;
    const sy = (wy: number): number => wy * s + oy;

    for (const id of childIdsOf(ctx.state, container)) {
      const n = ctx.state.nodes[id];
      c2d.fillStyle = n.color || nb;
      c2d.globalAlpha = ctx.state.sel.has(id) ? 1 : 0.82;
      const x = sx(n.x), y = sy(n.y), w = Math.max(2, n.w * s), h = Math.max(2, n.h * s);
      const r = Math.min(3, w / 3, h / 3);
      c2d.beginPath();
      if (c2d.roundRect) c2d.roundRect(x, y, w, h, r); else c2d.rect(x, y, w, h);
      c2d.fill();
    }
    c2d.globalAlpha = 1;
    // viewport rectangle
    c2d.strokeStyle = accent;
    c2d.lineWidth = 2;
    c2d.strokeRect(sx(vw0), sy(vh0), (vw1 - vw0) * s, (vh1 - vh0) * s);
    c2d.fillStyle = accent + '18';
    c2d.fillRect(sx(vw0), sy(vh0), (vw1 - vw0) * s, (vh1 - vh0) * s);
  }

  function minimapTo(clientX: number, clientY: number): void {
    if (!mmFit) return;
    const cv = document.getElementById('mmCanvas') as HTMLCanvasElement;
    const r = cv.getBoundingClientRect();
    const px = (clientX - r.left) * (cv.width / r.width);
    const py = (clientY - r.top) * (cv.height / r.height);
    const wx = (px - mmFit.ox) / mmFit.s;
    const wy = (py - mmFit.oy) / mmFit.s;
    cam.x = stage.clientWidth / 2 - wx * cam.z;
    cam.y = stage.clientHeight / 2 - wy * cam.z;
    camera.applyCam(); camera.persistSoon();
  }

  // wire pointer interaction on the minimap element
  const mm = document.getElementById('minimap');
  if (mm) {
    let dragging = false;
    const endDrag = (e: PointerEvent): void => {
      if (!dragging) return;
      dragging = false;
      try { mm.releasePointerCapture(e.pointerId); } catch { /* already released */ }
      ctx.hooks.persist();
    };
    mm.addEventListener('pointerdown', (e) => {
      dragging = true;
      mm.setPointerCapture(e.pointerId);
      minimapTo(e.clientX, e.clientY);
    });
    mm.addEventListener('pointermove', (e) => { if (dragging) minimapTo(e.clientX, e.clientY); });
    mm.addEventListener('pointerup', endDrag);
    mm.addEventListener('pointercancel', endDrag);
    // safety net: if the button is no longer held when we re-enter, stop dragging
    mm.addEventListener('pointerleave', (e) => { if (dragging && e.buttons === 0) endDrag(e); });
  }

  return { drawMinimap };
}
