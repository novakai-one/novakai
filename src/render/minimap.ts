/* =====================================================================
   minimap.ts — overview canvas
   ---------------------------------------------------------------------
   Responsibility: paint the small overview canvas (nodes + current
   viewport rectangle) and translate clicks/drags on it into camera moves
   (minimapTo). Owns the click->world mapping it computes while drawing.

   Reads: ctx.state, ctx.cam, ctx.mmShow. Calls camera.applyCam +
   persistSoon when navigating.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { DiagramNode } from '../core/types/types';
import { levelBounds, childIdsOf } from '../core/state/state';

export interface MinimapApi {
  drawMinimap: () => void;
}

// World-space rect the viewport currently shows, in the current camera pan/zoom.
interface ViewportWorldRect { left: number; top: number; right: number; bottom: number; }
// The scale/offset mapping world coords -> minimap canvas pixels for one paint.
interface MinimapFit { scale: number; offsetX: number; offsetY: number; }
interface Extent { minX: number; minY: number; maxX: number; maxY: number; }
type Bounds = Extent | null;
type Cam = { x: number; y: number; z: number };

function viewportWorldRect(cam: Cam, stageW: number, stageH: number): ViewportWorldRect {
  return {
    left: -cam.x / cam.z,
    top: -cam.y / cam.z,
    right: (stageW - cam.x) / cam.z,
    bottom: (stageH - cam.y) / cam.z,
  };
}

// overall extent = nodes + current viewport (+ padding), so the box is always visible
function fitExtent(viewport: ViewportWorldRect, bounds: Bounds): Extent {
  let minX = viewport.left, minY = viewport.top, maxX = viewport.right, maxY = viewport.bottom;
  if (bounds) {
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  const pad = 40;
  return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
}

function computeFit(canvasW: number, canvasH: number, extent: Extent): MinimapFit {
  const spanW = extent.maxX - extent.minX, spanH = extent.maxY - extent.minY;
  const scale = Math.min(canvasW / spanW, canvasH / spanH);
  const offsetX = (canvasW - spanW * scale) / 2 - extent.minX * scale;
  const offsetY = (canvasH - spanH * scale) / 2 - extent.minY * scale;
  return { scale, offsetX, offsetY };
}

interface MinimapColors { nodeStroke: string; accent: string; }

function minimapColors(): MinimapColors {
  const computedStyle = getComputedStyle(document.documentElement);
  const nodeStroke = computedStyle.getPropertyValue('--node-stroke').trim() || '#3a4254';
  const accent = computedStyle.getPropertyValue('--accent').trim() || '#7c8cff';
  return { nodeStroke, accent };
}

// Shared per-paint inputs for painting one node's box (colour source, fit).
interface NodePaintCtx { c2d: CanvasRenderingContext2D; fit: MinimapFit; nodeStroke: string; }

function paintMinimapNode(paintCtx: NodePaintCtx, node: DiagramNode, selected: boolean): void {
  const { c2d, fit, nodeStroke } = paintCtx;
  c2d.fillStyle = node.color || nodeStroke;
  c2d.globalAlpha = selected ? 1 : 0.82;
  const boxX = node.x * fit.scale + fit.offsetX, boxY = node.y * fit.scale + fit.offsetY;
  const boxW = Math.max(2, node.w * fit.scale), boxH = Math.max(2, node.h * fit.scale);
  const radius = Math.min(3, boxW / 3, boxH / 3);
  c2d.beginPath();
  if (c2d.roundRect) c2d.roundRect(boxX, boxY, boxW, boxH, radius);
  else c2d.rect(boxX, boxY, boxW, boxH);
  c2d.fill();
}

function drawMinimapNodes(ctx: AppContext, c2d: CanvasRenderingContext2D, fit: MinimapFit, nodeStroke: string): void {
  const container = ctx.view.container;
  const paintCtx: NodePaintCtx = { c2d, fit, nodeStroke };
  for (const id of childIdsOf(ctx.state, container)) {
    paintMinimapNode(paintCtx, ctx.state.nodes[id], ctx.state.sel.has(id));
  }
}

// viewport rectangle: a stroked outline + soft fill over its screen-space box
function drawViewportRect(
  c2d: CanvasRenderingContext2D,
  viewport: ViewportWorldRect,
  fit: MinimapFit,
  accent: string,
): void {
  c2d.globalAlpha = 1;
  const toScreenX = (worldX: number): number => worldX * fit.scale + fit.offsetX;
  const toScreenY = (worldY: number): number => worldY * fit.scale + fit.offsetY;
  const rectW = (viewport.right - viewport.left) * fit.scale, rectH = (viewport.bottom - viewport.top) * fit.scale;
  c2d.strokeStyle = accent;
  c2d.lineWidth = 2;
  c2d.strokeRect(toScreenX(viewport.left), toScreenY(viewport.top), rectW, rectH);
  c2d.fillStyle = accent + '18';
  c2d.fillRect(toScreenX(viewport.left), toScreenY(viewport.top), rectW, rectH);
}

// Per-instance minimap state, threaded explicitly through the module-level
// functions below (instead of nested closures) so initMinimap's own body
// stays a thin composition wrapper under the file's line budget.
interface MinimapDeps {
  ctx: AppContext;
  camera: CameraApi;
  stage: HTMLElement;
  fitHolder: { fit: MinimapFit | null };
}

function drawMinimapImpl(deps: MinimapDeps): void {
  const canvasEl = document.getElementById('mmCanvas') as HTMLCanvasElement | null;
  if (!canvasEl || !deps.ctx.mmShow) return;
  const c2d = canvasEl.getContext('2d');
  if (!c2d) return;
  c2d.clearRect(0, 0, canvasEl.width, canvasEl.height);

  const colors = minimapColors();
  const container = deps.ctx.view.container, bounds = levelBounds(deps.ctx.state, container);
  const viewport = viewportWorldRect(deps.ctx.cam, deps.stage.clientWidth, deps.stage.clientHeight),
    extent = fitExtent(viewport, bounds);
  const fit = computeFit(canvasEl.width, canvasEl.height, extent);
  deps.fitHolder.fit = fit;

  drawMinimapNodes(deps.ctx, c2d, fit, colors.nodeStroke);
  drawViewportRect(c2d, viewport, fit, colors.accent);
}

function minimapToImpl(deps: MinimapDeps, clientX: number, clientY: number): void {
  const fit = deps.fitHolder.fit;
  if (!fit) return;
  const canvasEl = document.getElementById('mmCanvas') as HTMLCanvasElement;
  const rect = canvasEl.getBoundingClientRect();
  const canvasX = (clientX - rect.left) * (canvasEl.width / rect.width);
  const canvasY = (clientY - rect.top) * (canvasEl.height / rect.height);
  const worldX = (canvasX - fit.offsetX) / fit.scale;
  const worldY = (canvasY - fit.offsetY) / fit.scale;
  deps.ctx.cam.x = deps.stage.clientWidth / 2 - worldX * deps.ctx.cam.z;
  deps.ctx.cam.y = deps.stage.clientHeight / 2 - worldY * deps.ctx.cam.z;
  deps.camera.applyCam();
  deps.camera.persistSoon();
}

interface DragState { dragging: boolean; }

function releaseDragCapture(minimapEl: HTMLElement, event: PointerEvent): void {
  try {
    minimapEl.releasePointerCapture(event.pointerId);
  } catch {
    /* already released */
  }
}

function endMinimapDrag(deps: MinimapDeps, minimapEl: HTMLElement, dragState: DragState, event: PointerEvent): void {
  if (!dragState.dragging) return;
  dragState.dragging = false;
  releaseDragCapture(minimapEl, event);
  deps.ctx.hooks.persist();
}

function startMinimapDrag(deps: MinimapDeps, minimapEl: HTMLElement, dragState: DragState, event: PointerEvent): void {
  dragState.dragging = true;
  minimapEl.setPointerCapture(event.pointerId);
  minimapToImpl(deps, event.clientX, event.clientY);
}

// wire pointer interaction on the minimap element
function wireMinimapPointer(deps: MinimapDeps): void {
  const minimapEl = document.getElementById('minimap');
  if (!minimapEl) return;
  const dragState: DragState = { dragging: false };
  const endDrag = (event: PointerEvent): void => endMinimapDrag(deps, minimapEl, dragState, event);
  minimapEl.addEventListener('pointerdown', (event) => startMinimapDrag(deps, minimapEl, dragState, event));
  minimapEl.addEventListener('pointermove', (event) => {
    if (dragState.dragging) minimapToImpl(deps, event.clientX, event.clientY);
  });
  minimapEl.addEventListener('pointerup', endDrag);
  minimapEl.addEventListener('pointercancel', endDrag);
  // safety net: if the button is no longer held when we re-enter, stop dragging
  minimapEl.addEventListener('pointerleave', (event) => {
    if (dragState.dragging && event.buttons === 0) endDrag(event);
  });
}

export function initMinimap(ctx: AppContext, camera: CameraApi): MinimapApi {
  const deps: MinimapDeps = { ctx, camera, stage: ctx.dom.stage, fitHolder: { fit: null } };

  function drawMinimap(): void {
    drawMinimapImpl(deps);
  }

  wireMinimapPointer(deps);

  return { drawMinimap };
}
