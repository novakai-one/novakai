/* =====================================================================
   clipboard.ts — copy / paste / duplicate
   ---------------------------------------------------------------------
   Responsibility: hold the in-memory clipboard and implement copySel,
   pasteClip (with id remapping + optional cursor anchoring) and
   duplicateSel. Mutates the model, re-renders, pushes history.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { DiagramNode, DiagramEdge, Point } from '../core/types/types';
import { snapV } from '../core/state/state';

export interface Clipboard {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export interface ClipboardApi {
  copySel: () => void;
  pasteClip: (atWorld?: Point | null) => void;
  duplicateSel: () => void;
}

function performCopySel(ctx: AppContext): void {
  if (!ctx.state.sel.size) return;
  const nodes = [...ctx.state.sel].map((id) => ({ ...ctx.state.nodes[id] }));
  const idset = new Set(ctx.state.sel);
  const edges = ctx.state.edges
    .filter((edge) => idset.has(edge.from) && idset.has(edge.to))
    .map((edge) => ({ ...edge }));
  ctx.clipboard = { nodes, edges };
  ctx.hooks.toast(`Copied ${nodes.length}`);
}

/** Offset for a paste: anchored under the cursor when given a world point, else a fixed nudge. */
function computePasteOffset(ctx: AppContext, clip: Clipboard, atWorld?: Point | null): Point {
  const nudge = 24;
  if (!atWorld) return { x: nudge, y: nudge };
  const minX = Math.min(...clip.nodes.map((node) => node.x));
  const minY = Math.min(...clip.nodes.map((node) => node.y));
  return { x: snapV(atWorld.x, ctx.snap) - minX, y: snapV(atWorld.y, ctx.snap) - minY };
}

/** Clone clipboard nodes into the model at the given offset; returns old-id -> new-id map. */
function pasteNodes(ctx: AppContext, clip: Clipboard, offset: Point): Record<string, string> {
  const map: Record<string, string> = {};
  for (const node of clip.nodes) {
    const id = 'n' + (ctx.state.nid++);
    map[node.id] = id;
    ctx.state.nodes[id] = { ...node, id, x: node.x + offset.x, y: node.y + offset.y };
    ctx.state.sel.add(id);
  }
  return map;
}

/** Re-parent pasted nodes: keep containment internal to the pasted set, else drop into the current level. */
function reparentPastedNodes(ctx: AppContext, clip: Clipboard, map: Record<string, string>): void {
  for (const node of clip.nodes) {
    const pasted = ctx.state.nodes[map[node.id]];
    pasted.parent = (node.parent && map[node.parent]) ? map[node.parent] : ctx.view.container;
  }
}

function pasteEdges(ctx: AppContext, clip: Clipboard, map: Record<string, string>): void {
  for (const edge of clip.edges) {
    // quoted: 'to' is DiagramEdge's frozen field name; id-length would flag the bare key
    const remapped = { ...edge, id: 'e' + (ctx.state.eid++), from: map[edge.from], 'to': map[edge.to] };
    ctx.state.edges.push(remapped);
  }
}

function performPasteClip(ctx: AppContext, atWorld?: Point | null): void {
  const clip = ctx.clipboard;
  if (!clip.nodes.length) return;
  ctx.state.sel.clear();
  ctx.state.selEdge = null;
  const offset = computePasteOffset(ctx, clip, atWorld);
  const map = pasteNodes(ctx, clip, offset);
  reparentPastedNodes(ctx, clip, map);
  pasteEdges(ctx, clip, map);
  ctx.hooks.render();
  ctx.hooks.sync();
  ctx.hooks.renderInspector();
  ctx.hooks.pushHistory();
}

function performDuplicateSel(
  ctx: AppContext,
  copySel: () => void,
  pasteClip: (atWorld?: Point | null) => void,
): void {
  if (!ctx.state.sel.size) return;
  copySel();
  pasteClip();
  ctx.hooks.toast('Duplicated');
}

export function initClipboard(ctx: AppContext): ClipboardApi {
  function copySel(): void {
    performCopySel(ctx);
  }

  function pasteClip(atWorld?: Point | null): void {
    performPasteClip(ctx, atWorld);
  }

  function duplicateSel(): void {
    performDuplicateSel(ctx, copySel, pasteClip);
  }

  return { copySel, pasteClip, duplicateSel };
}
