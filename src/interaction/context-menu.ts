/* =====================================================================
   context-menu.ts — right-click menu
   ---------------------------------------------------------------------
   Responsibility: build and position the right-click context menu (#ctx)
   with node-specific or canvas-specific actions, and hide it on outside
   click. Delegates each action to the relevant module API.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { SelectionApi } from './selection';
import type { NodesApi } from './nodes';
import type { ClipboardApi } from './clipboard';
import type { InlineEditApi } from './inline-edit';
import type { ViewApi } from './view';

interface CtxItem {
  label: string;
  run: () => void;
  shortcut?: string;
  danger?: boolean;
}
type CtxEntry = CtxItem | '-';

export interface ContextMenuApi {
  hideCtx: () => void;
}

export interface ContextMenuDeps {
  camera: CameraApi;
  selection: SelectionApi;
  nodes: NodesApi;
  clipboard: ClipboardApi;
  inlineEdit: InlineEditApi;
  view: ViewApi;
}

function renderCtxItem(menu: HTMLElement, item: CtxItem, hideCtx: () => void): void {
  const btn = document.createElement('button');
  if (item.danger) btn.className = 'danger-item';
  btn.innerHTML = `<span>${item.label}</span>${item.shortcut ? `<span class="sc">${item.shortcut}</span>` : ''}`;
  btn.onclick = () => {
    hideCtx();
    item.run();
  };
  menu.appendChild(btn);
}

function renderCtxEntry(menu: HTMLElement, entry: CtxEntry, hideCtx: () => void): void {
  if (entry === '-') {
    menu.appendChild(document.createElement('hr'));
    return;
  }
  renderCtxItem(menu, entry, hideCtx);
}

function positionCtxMenu(menu: HTMLElement, clientX: number, clientY: number): void {
  const rect = menu.getBoundingClientRect();
  let x = clientX;
  let y = clientY;
  if (x + rect.width > innerWidth) x = innerWidth - rect.width - 6;
  if (y + rect.height > innerHeight) y = innerHeight - rect.height - 6;
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

function buildNodeCtxItems(id: string, ctx: AppContext, deps: ContextMenuDeps): CtxEntry[] {
  const node = ctx.state.nodes[id];
  const canEnter = !!node && node.shape !== 'group' && node.shape !== 'note';
  return [
    { label: 'Duplicate', shortcut: '⌘D', run: deps.clipboard.duplicateSel },
    { label: 'Copy', shortcut: '⌘C', run: deps.clipboard.copySel },
    { label: 'Bring to front', run: () => deps.nodes.bringToFront(id) },
    '-',
    ...(canEnter ? [{ label: 'Open internals', run: () => deps.view.enter(id) } as CtxEntry] : []),
    { label: 'Edit label', shortcut: '⏎', run: () => deps.inlineEdit.beginEdit(id) },
    '-',
    { label: 'Delete', shortcut: '⌫', danger: true, run: deps.nodes.deleteSelection },
  ];
}

function buildCanvasCtxItems(point: { x: number; y: number }, ctx: AppContext, deps: ContextMenuDeps): CtxEntry[] {
  return [
    { label: 'Add box here', run: () => deps.nodes.addNode('rect', point.x - 60, point.y - 26) },
    { label: 'Paste', shortcut: '⌘V', run: () => deps.clipboard.pasteClip(point) },
    '-',
    ...(ctx.view.container ? [{ label: 'Go up a level', run: deps.view.goUp } as CtxEntry, '-' as CtxEntry] : []),
    { label: 'Select all', shortcut: '⌘A', run: deps.selection.selectAll },
    { label: 'Zoom to fit', shortcut: 'F', run: deps.camera.zoomToFit },
  ];
}

function handleStageContextMenu(
  e: MouseEvent,
  ctx: AppContext,
  deps: ContextMenuDeps,
  showCtx: (clientX: number, clientY: number, items: CtxEntry[]) => void,
): void {
  e.preventDefault();
  const node = (e.target as HTMLElement).closest('.node') as HTMLElement | null;
  const point = deps.camera.toWorld(e.clientX, e.clientY);
  if (node) {
    const id = node.dataset.id as string;
    if (!ctx.state.sel.has(id)) deps.selection.selectOnly(id);
    showCtx(e.clientX, e.clientY, buildNodeCtxItems(id, ctx, deps));
    return;
  }
  showCtx(e.clientX, e.clientY, buildCanvasCtxItems(point, ctx, deps));
}

function handleOutsideClick(e: PointerEvent, menu: HTMLElement, hideCtx: () => void): void {
  if (!menu.contains(e.target as Node)) hideCtx();
}

export function initContextMenu(ctx: AppContext, deps: ContextMenuDeps): ContextMenuApi {
  const { stage } = ctx.dom;
  const menu = document.getElementById('ctx') as HTMLElement;

  function showCtx(clientX: number, clientY: number, items: CtxEntry[]): void {
    menu.innerHTML = '';
    items.forEach((item) => renderCtxEntry(menu, item, hideCtx));
    menu.classList.add('show');
    positionCtxMenu(menu, clientX, clientY);
  }

  function hideCtx(): void {
    menu.classList.remove('show');
  }

  stage.addEventListener('contextmenu', (e) => handleStageContextMenu(e, ctx, deps, showCtx));
  document.addEventListener('pointerdown', (e) => handleOutsideClick(e, menu, hideCtx), true);

  return { hideCtx };
}
