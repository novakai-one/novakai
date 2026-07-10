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

import type { AppContext } from '../context/context';
import type { Point } from '../types/types';
import { Z_MIN, Z_MAX } from '../config/config';
import { levelFitBounds, nodeCenter } from '../state/state';

export interface CameraApi {
  applyCam: () => void;
  toWorld: (screenX: number, screenY: number) => Point;
  zoomAt: (screenX: number, screenY: number, newZoom: number) => void;
  zoomCenter: (newZoom: number) => void;
  zoomToFit: () => void;
  zoomToNode: (id: string) => void;
  persistSoon: () => void;
}

function applyCam(ctx: AppContext): void {
  const { stage, world } = ctx.dom;
  const cam = ctx.cam;
  const zoomLabel = document.getElementById('zLevel') as HTMLElement;
  world.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
  zoomLabel.textContent = Math.round(cam.z * 100) + '%';
  // infinite grid that pans + scales with the camera
  const gridSize = 16 * cam.z;
  stage.style.backgroundSize = gridSize + 'px ' + gridSize + 'px';
  stage.style.backgroundPosition = cam.x + 'px ' + cam.y + 'px';
  ctx.hooks.drawMinimap();
}

/** Screen point -> world coords. */
function toWorld(ctx: AppContext, screenX: number, screenY: number): Point {
  const { stage } = ctx.dom;
  const cam = ctx.cam;
  const rect = stage.getBoundingClientRect();
  return { x: (screenX - rect.left - cam.x) / cam.z, y: (screenY - rect.top - cam.y) / cam.z };
}

function zoomAt(ctx: AppContext, screenX: number, screenY: number, newZoom: number): void {
  const { stage } = ctx.dom;
  const cam = ctx.cam;
  const clampedZoom = Math.min(Z_MAX, Math.max(Z_MIN, newZoom));
  const rect = stage.getBoundingClientRect();
  const worldX = (screenX - rect.left - cam.x) / cam.z;
  const worldY = (screenY - rect.top - cam.y) / cam.z;
  cam['z'] = clampedZoom; // quoted: 'z' is a frozen Cam field; id-length flags bare assignment targets
  cam.x = screenX - rect.left - worldX * clampedZoom;
  cam.y = screenY - rect.top - worldY * clampedZoom;
  applyCam(ctx);
  ctx.hooks.persist();
}

function zoomCenter(ctx: AppContext, newZoom: number): void {
  const { stage } = ctx.dom;
  const rect = stage.getBoundingClientRect();
  zoomAt(ctx, rect.left + stage.clientWidth / 2, rect.top + stage.clientHeight / 2, newZoom);
}

/** Compute the pan/zoom that fits `bounds` (plus padding) into a viewport; never magnifies past 100%. */
function fitTransform(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  viewportWidth: number,
  viewportHeight: number,
): { zoom: number; x: number; y: number } {
  const pad = 80;
  const boundsWidth = (bounds.maxX - bounds.minX) + pad * 2;
  const boundsHeight = (bounds.maxY - bounds.minY) + pad * 2;
  const zoom = Math.min(Z_MAX, 1, Math.min(viewportWidth / boundsWidth, viewportHeight / boundsHeight));
  const x = (viewportWidth - (bounds.maxX - bounds.minX) * zoom) / 2 - bounds.minX * zoom;
  const y = (viewportHeight - (bounds.maxY - bounds.minY) * zoom) / 2 - bounds.minY * zoom;
  return { zoom, x, y };
}

function resetCamera(ctx: AppContext): void {
  const cam = ctx.cam;
  cam.x = 0;
  cam.y = 0;
  cam['z'] = 1; // quoted: see zoomAt
  applyCam(ctx);
}

function zoomToFit(ctx: AppContext): void {
  const { stage } = ctx.dom;
  const cam = ctx.cam;
  const bounds = levelFitBounds(ctx.state, ctx.view.container);
  if (!bounds) {
    resetCamera(ctx);
    return;
  }
  const fit = fitTransform(bounds, stage.clientWidth, stage.clientHeight);
  cam['z'] = fit.zoom; // quoted: see zoomAt
  cam.x = fit.x;
  cam.y = fit.y;
  applyCam(ctx);
  ctx.hooks.persist();
}

/**
 * Pan the camera so `id`'s centre lands at the viewport centre,
 * keeping the current zoom level. No-op when the node does not exist.
 */
function zoomToNode(ctx: AppContext, id: string): void {
  const { stage } = ctx.dom;
  const cam = ctx.cam;
  const node = ctx.state.nodes[id];
  if (!node) return;
  const { cx: centerX, cy: centerY } = nodeCenter(node);
  cam.x = stage.clientWidth / 2 - centerX * cam.z;
  cam.y = stage.clientHeight / 2 - centerY * cam.z;
  applyCam(ctx);
  ctx.hooks.persist();
}

export function initCamera(ctx: AppContext): CameraApi {
  let persistTimer: number | null = null;
  function persistSoon(): void {
    if (persistTimer !== null) clearTimeout(persistTimer);
    persistTimer = window.setTimeout(() => ctx.hooks.persist(), 250);
  }
  return {
    applyCam: () => applyCam(ctx),
    toWorld: (screenX, screenY) => toWorld(ctx, screenX, screenY),
    zoomAt: (screenX, screenY, newZoom) => zoomAt(ctx, screenX, screenY, newZoom),
    zoomCenter: (newZoom) => zoomCenter(ctx, newZoom),
    zoomToFit: () => zoomToFit(ctx),
    zoomToNode: (id) => zoomToNode(ctx, id),
    persistSoon,
  };
}
