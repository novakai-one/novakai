/* =====================================================================
   export.ts — SVG + PNG export
   ---------------------------------------------------------------------
   Responsibility: build a clean standalone SVG from the model (not from
   DOM scraping) honoring the live theme, render each node to SVG
   (nodeSVG, including crude label wrapping), and export as a downloaded
   .svg or rasterized .png. Reuses bestSides/portPos + orthoPath/midOf.

   Pure builder + a couple of blob downloads. Does not mutate the model.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { DiagramNode, DiagramEdge } from '../core/types/types';
import type { StateStore } from '../core/state/state';
import { portPos, bestSides } from '../core/state/state';
import { esc, nodeFill } from '../core/config/config';
import { orthoPath, midOf } from '../render/wires';

interface ThemeColors {
  background: string; node: string; stroke: string; ink: string;
  noteBg: string; noteStroke: string; noteInk: string;
  accent: string; edge: string; labelBg: string;
  line: string; inkDim: string; font: string;
}

export interface ExportApi {
  exportSVG: () => void;
  exportPNG: () => void;
}

interface LabelSpec { posX: number; posY: number; color: string; size?: number }

/** Render a single <text> label. */
function textSVG(label: string, spec: LabelSpec): string {
  const size = spec.size ?? 13;
  return `<text x="${spec.posX}" y="${spec.posY}" fill="${spec.color}" font-size="${size}" `
    + `text-anchor="middle" dominant-baseline="middle">${esc(label)}</text>`;
}

interface RectSpec {
  x: number; y: number; width: number; height: number; radius: number; fill: string; stroke: string;
}

function rectSVG(spec: RectSpec): string {
  return `<rect x="${spec.x}" y="${spec.y}" width="${spec.width}" height="${spec.height}" rx="${spec.radius}" `
    + `fill="${spec.fill}" stroke="${spec.stroke}" stroke-width="1.5"/>`;
}

interface EllipseSpec {
  centerX: number; centerY: number; radiusX: number; radiusY: number; fill: string; stroke: string;
}

function ellipseSVG(spec: EllipseSpec): string {
  return `<ellipse cx="${spec.centerX}" cy="${spec.centerY}" rx="${spec.radiusX}" ry="${spec.radiusY}" `
    + `fill="${spec.fill}" stroke="${spec.stroke}" stroke-width="1.5"/>`;
}

function polygonSVG(points: string, fill: string, stroke: string): string {
  return `<polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
}

interface ShapeSpec {
  node: DiagramNode; x: number; y: number; centerX: number; centerY: number; fill: string; stroke: string;
}

function diamondSVG(spec: ShapeSpec): string {
  const { node, x, y, centerX, centerY, fill, stroke } = spec;
  const pts = `${centerX},${y} ${x + node.w},${centerY} ${centerX},${y + node.h} ${x},${centerY}`;
  return polygonSVG(pts, fill, stroke);
}

function circleSVG(spec: ShapeSpec): string {
  const { node, centerX, centerY, fill, stroke } = spec;
  return ellipseSVG({ centerX, centerY, radiusX: node.w / 2, radiusY: node.h / 2, fill, stroke });
}

function cylinderSVG(spec: ShapeSpec): string {
  const { node, x, y, centerX, fill, stroke } = spec;
  const rad = Math.max(6, Math.min(node.h * 0.16, 22));
  const top = y + rad, bot = y + node.h - rad;
  const path = `<path d="M ${x} ${top} L ${x} ${bot} A ${node.w / 2} ${rad} 0 0 0 `
    + `${x + node.w} ${bot} L ${x + node.w} ${top} Z" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
  return path + ellipseSVG({ centerX, centerY: top, radiusX: node.w / 2, radiusY: rad, fill, stroke });
}

function hexSVG(spec: ShapeSpec): string {
  const { node, x, y, centerY, fill, stroke } = spec;
  const notch = Math.min(node.w * 0.22, node.h * 0.5);
  const pts = `${x + notch},${y} ${x + node.w - notch},${y} ${x + node.w},${centerY} `
    + `${x + node.w - notch},${y + node.h} ${x + notch},${y + node.h} ${x},${centerY}`;
  return polygonSVG(pts, fill, stroke);
}

/** Render the shape outline (everything but the label) for one node. */
function shapeSVG(node: DiagramNode, x: number, y: number, theme: ThemeColors): string {
  const centerX = x + node.w / 2, centerY = y + node.h / 2;
  const fill = nodeFill(node) || theme.node;
  const stroke = theme.stroke;
  const spec: ShapeSpec = { node, x, y, centerX, centerY, fill, stroke };
  switch (node.shape) {
    case 'diamond': return diamondSVG(spec);
    case 'circle': return circleSVG(spec);
    case 'cylinder': return cylinderSVG(spec);
    case 'hex': return hexSVG(spec);
    case 'stadium': return rectSVG({ x, y, width: node.w, height: node.h, radius: node.h / 2, fill, stroke });
    case 'note':
      return rectSVG({ x, y, width: node.w, height: node.h, radius: 3, fill: theme.noteBg, stroke: theme.noteStroke });
    case 'round': return rectSVG({ x, y, width: node.w, height: node.h, radius: 18, fill, stroke });
    default: return rectSVG({ x, y, width: node.w, height: node.h, radius: 8, fill, stroke });
  }
}

/** Crudely word-wrap a label to fit a node width. */
function wrapLabel(label: string, width: number): string[] {
  const words = (label || '').split(' ');
  const maxChars = Math.max(6, Math.floor(width / 8));
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const next = (line + ' ' + word).trim();
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Render a single node to SVG markup. */
export function nodeSVG(node: DiagramNode, x: number, y: number, theme: ThemeColors): string {
  if (node.shape === 'group') {
    let out = `<rect x="${x}" y="${y}" width="${node.w}" height="${node.h}" rx="8" fill="none" `
      + `stroke="${theme.accent}" stroke-width="1.5" stroke-dasharray="6 4" opacity="0.7"/>`;
    out += `<text x="${x + 12}" y="${y + 18}" fill="${theme.accent}" font-size="11" `
      + `font-family="monospace" letter-spacing="1">${esc(node.label.toUpperCase())}</text>`;
    return out;
  }
  let out = shapeSVG(node, x, y, theme);
  const centerX = x + node.w / 2, centerY = y + node.h / 2;
  const tcolor = node.shape === 'note' ? theme.noteInk : theme.ink;
  const lines = wrapLabel(node.label, node.w);
  const lineHeight = 15, startY = centerY - (lines.length - 1) * lineHeight / 2;
  lines.forEach((labelLine, idx) => {
    out += textSVG(labelLine, { posX: centerX, posY: startY + idx * lineHeight, color: tcolor });
  });
  return out;
}

function themeColors(): ThemeColors {
  const computed = getComputedStyle(document.documentElement);
  const pick = (key: string): string => computed.getPropertyValue(key).trim();
  return {
    background: pick('--bg'), node: pick('--node-bg'), stroke: pick('--node-stroke'), ink: pick('--node-ink'),
    noteBg: pick('--note-bg'), noteStroke: pick('--note-stroke'), noteInk: pick('--note-ink'),
    accent: pick('--accent'), edge: pick('--edge'), labelBg: pick('--label-bg'),
    line: pick('--line'), inkDim: pick('--ink-dim'), font: pick('--node-font') || 'system-ui, sans-serif',
  };
}

function boundsOf(state: StateStore, ids: string[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  ids.forEach((id) => {
    const node = state.nodes[id];
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.w);
    maxY = Math.max(maxY, node.y + node.h);
  });
  return { minX, minY, maxX, maxY };
}

function edgeLabelSVG(label: string, path: string, theme: ThemeColors): string {
  const mid = midOf(path);
  const width = label.length * 6.2 + 10;
  let out = `<rect x="${mid.x - width / 2}" y="${mid.y - 9}" width="${width}" height="18" rx="4" `
    + `fill="${theme.labelBg}" stroke="${theme.line}"/>`;
  out += `<text x="${mid.x}" y="${mid.y + 3.5}" fill="${theme.inkDim}" font-size="10.5" `
    + `font-family="monospace" text-anchor="middle">${esc(label)}</text>`;
  return out;
}

interface RenderCtx { theme: ThemeColors; offsetX: number; offsetY: number }

/** Compute the path `d` string for one edge, offset by ctx.offsetX/offsetY. */
function edgeGeometry(fromNode: DiagramNode, toNode: DiagramNode, edge: DiagramEdge, ctx: RenderCtx): string {
  const [sideA, sideB] = bestSides(fromNode, toNode);
  const start = portPos(fromNode, sideA), end = portPos(toNode, sideB);
  const pointA = { x: start.x + ctx.offsetX, y: start.y + ctx.offsetY };
  const pointB = { x: end.x + ctx.offsetX, y: end.y + ctx.offsetY };
  return edge.routing === 'ortho'
    ? orthoPath(pointA, sideA, pointB, sideB)
    : `M ${pointA.x} ${pointA.y} L ${pointB.x} ${pointB.y}`;
}

/** Render one edge (path + optional label), offset by (offsetX, offsetY). */
function edgeSVG(state: StateStore, edge: DiagramEdge, ctx: RenderCtx): string {
  const fromNode = state.nodes[edge.from], toNode = state.nodes[edge.to];
  if (!fromNode || !toNode) return '';
  const path = edgeGeometry(fromNode, toNode, edge, ctx);
  const dash = edge.style === 'dotted' ? '5 5' : '0';
  const width = edge.style === 'thick' ? 3 : 1.7;
  let out = `<path d="${path}" stroke="${ctx.theme.edge}" stroke-width="${width}" fill="none" `
    + `stroke-dasharray="${dash}" marker-end="url(#ar)" stroke-linejoin="round"/>`;
  if (edge.label) out += edgeLabelSVG(edge.label, path, ctx.theme);
  return out;
}

/** Render every edge in the model, offset by ctx.offsetX/offsetY. */
function edgesSVG(state: StateStore, ctx: RenderCtx): string {
  let out = '';
  for (const edge of state.edges) {
    out += edgeSVG(state, edge, ctx);
  }
  return out;
}

function svgHeader(theme: ThemeColors, width: number, height: number, scale: number): string {
  const svgNs = 'http://www.w3.org/2000/svg';
  let out = `<svg xmlns="${svgNs}" width="${width * scale}" height="${height * scale}" `
    + `viewBox="0 0 ${width} ${height}" font-family="${theme.font.replace(/"/g, "'")}">`;
  out += `<rect width="${width}" height="${height}" fill="${theme.background}"/>`;
  out += `<defs><marker id="ar" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" `
    + `markerUnits="strokeWidth"><path d="M0,0 L7,3 L0,6 Z" fill="${theme.edge}"/></marker></defs>`;
  return out;
}

function groupsFirst(state: StateStore): (idA: string, idB: string) => number {
  return (idA, idB) => (state.nodes[idA].shape === 'group' ? 0 : 1) - (state.nodes[idB].shape === 'group' ? 0 : 1);
}

function nodesSVG(state: StateStore, ids: string[], ctx: RenderCtx): string {
  const ord = [...ids].sort(groupsFirst(state));
  let out = '';
  for (const id of ord) {
    const node = state.nodes[id];
    out += nodeSVG(node, node.x + ctx.offsetX, node.y + ctx.offsetY, ctx.theme);
  }
  return out;
}

function buildExportSVG(state: StateStore, scale = 1): { svg: string; width: number; height: number } | null {
  const ids = Object.keys(state.nodes);
  if (!ids.length) return null;
  const { minX, minY, maxX, maxY } = boundsOf(state, ids);
  const pad = 40;
  const width = (maxX - minX) + pad * 2, height = (maxY - minY) + pad * 2;
  const ctx: RenderCtx = { theme: themeColors(), offsetX: pad - minX, offsetY: pad - minY };
  let out = svgHeader(ctx.theme, width, height, scale);
  out += edgesSVG(state, ctx);
  out += nodesSVG(state, ids, ctx);
  out += `</svg>`;
  return { svg: out, width, height };
}

function downloadBlob(blob: Blob, name: string): void {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportSVG(ctx: AppContext): void {
  const built = buildExportSVG(ctx.state, 1);
  if (!built) {
    ctx.hooks.toast('Nothing to export');
    return;
  }
  downloadBlob(new Blob([built.svg], { type: 'image/svg+xml' }), 'novakai.svg');
  ctx.hooks.toast('SVG exported');
}

function renderPNG(
  ctx: AppContext, img: HTMLImageElement, built: { width: number; height: number }, url: string,
): void {
  const canvas = document.createElement('canvas');
  canvas.width = built.width * 2;
  canvas.height = built.height * 2;
  const ctx2d = canvas.getContext('2d');
  if (!ctx2d) {
    ctx.hooks.toast('PNG render failed');
    return;
  }
  ctx2d.drawImage(img, 0, 0);
  canvas.toBlob((pngBlob) => {
    if (!pngBlob) return;
    downloadBlob(pngBlob, 'novakai.png');
    ctx.hooks.toast('PNG exported');
  });
  URL.revokeObjectURL(url);
}

function drawPNG(ctx: AppContext, built: { svg: string; width: number; height: number }): void {
  const img = new Image();
  const blob = new Blob([built.svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  img.onload = () => renderPNG(ctx, img, built, url);
  img.onerror = () => ctx.hooks.toast('PNG render failed');
  img.src = url;
}

function exportPNG(ctx: AppContext): void {
  const built = buildExportSVG(ctx.state, 2); // 2x for retina
  if (!built) {
    ctx.hooks.toast('Nothing to export');
    return;
  }
  drawPNG(ctx, built);
}

export function initExport(ctx: AppContext): ExportApi {
  return { exportSVG: () => exportSVG(ctx), exportPNG: () => exportPNG(ctx) };
}
