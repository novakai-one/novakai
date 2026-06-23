/* =====================================================================
   camera.ts — pan + zoom
   ---------------------------------------------------------------------
   Responsibility: own everything about the viewport transform. Convert
   screen coords to world coords, apply the CSS transform + grid, and
   implement zoomAt / zoomCenter / zoomToFit. Reads ctx.cam and the
   stage/world DOM; calls ctx.hooks.drawMinimap after moves.

   Exports an init() that returns the camera API the rest of the app uses,
   plus a debounced persist trigger.
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { Point } from '../core/types';
import { Z_MIN, Z_MAX } from '../core/config';
import { levelFitBounds } from '../core/state';

export interface CameraApi {
  applyCam: () => void;
  toWorld: (sx: number, sy: number) => Point;
  zoomAt: (sx: number, sy: number, nz: number) => void;
  zoomCenter: (nz: number) => void;
  zoomToFit: () => void;
  persistSoon: () => void;
}

export function initCamera(ctx: AppContext): CameraApi {
  const { stage, world } = ctx.dom;
  const cam = ctx.cam;

  const zLevel = document.getElementById('zLevel') as HTMLElement;

  function applyCam(): void {
    world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
    zLevel.textContent = Math.round(cam.z * 100) + '%';
    // infinite grid that pans + scales with the camera
    const g = 16 * cam.z;
    stage.style.backgroundSize = g + 'px ' + g + 'px';
    stage.style.backgroundPosition = cam.x + 'px ' + cam.y + 'px';
    ctx.hooks.drawMinimap();
  }

  /** Screen point -> world coords. */
  function toWorld(sx: number, sy: number): Point {
    const r = stage.getBoundingClientRect();
    return { x: (sx - r.left - cam.x) / cam.z, y: (sy - r.top - cam.y) / cam.z };
  }

  function zoomAt(sx: number, sy: number, nz: number): void {
    nz = Math.min(Z_MAX, Math.max(Z_MIN, nz));
    const r = stage.getBoundingClientRect();
    const wx = (sx - r.left - cam.x) / cam.z;
    const wy = (sy - r.top - cam.y) / cam.z;
    cam.z = nz;
    cam.x = sx - r.left - wx * nz;
    cam.y = sy - r.top - wy * nz;
    applyCam(); ctx.hooks.persist();
  }

  function zoomCenter(nz: number): void {
    const r = stage.getBoundingClientRect();
    zoomAt(r.left + stage.clientWidth / 2, r.top + stage.clientHeight / 2, nz);
  }

  function zoomToFit(): void {
    const b = levelFitBounds(ctx.state, ctx.view.container);
    if (!b) { cam.x = 0; cam.y = 0; cam.z = 1; applyCam(); return; }
    const pad = 80;
    const cw = stage.clientWidth, ch = stage.clientHeight;
    const bw = (b.maxX - b.minX) + pad * 2, bh = (b.maxY - b.minY) + pad * 2;
    // fit only zooms OUT; never magnify a small level past 100%
    const z = Math.min(Z_MAX, 1, Math.min(cw / bw, ch / bh));
    cam.z = z;
    cam.x = (cw - (b.maxX - b.minX) * z) / 2 - b.minX * z;
    cam.y = (ch - (b.maxY - b.minY) * z) / 2 - b.minY * z;
    applyCam(); ctx.hooks.persist();
  }

  let persistT: number | null = null;
  function persistSoon(): void {
    if (persistT !== null) clearTimeout(persistT);
    persistT = window.setTimeout(() => ctx.hooks.persist(), 250);
  }

  return { applyCam, toWorld, zoomAt, zoomCenter, zoomToFit, persistSoon };
}
