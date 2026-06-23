/* =====================================================================
   context-menu.ts — right-click menu
   ---------------------------------------------------------------------
   Responsibility: build and position the right-click context menu (#ctx)
   with node-specific or canvas-specific actions, and hide it on outside
   click. Delegates each action to the relevant module API.
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { CameraApi } from '../core/camera';
import type { SelectionApi } from './selection';
import type { NodesApi } from './nodes';
import type { ClipboardApi } from './clipboard';
import type { InlineEditApi } from './inline-edit';
import type { ViewApi } from './view';

interface CtxItem {
  label: string;
  fn: () => void;
  sc?: string;
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

export function initContextMenu(ctx: AppContext, deps: ContextMenuDeps): ContextMenuApi {
  const { stage } = ctx.dom;
  const { state } = ctx;
  const { camera, selection, nodes, clipboard, inlineEdit, view } = deps;
  const menu = document.getElementById('ctx') as HTMLElement;

  function showCtx(clientX: number, clientY: number, items: CtxEntry[]): void {
    menu.innerHTML = '';
    items.forEach((it) => {
      if (it === '-') { menu.appendChild(document.createElement('hr')); return; }
      const b = document.createElement('button');
      if (it.danger) b.className = 'danger-item';
      b.innerHTML = `<span>${it.label}</span>${it.sc ? `<span class="sc">${it.sc}</span>` : ''}`;
      b.onclick = () => { hideCtx(); it.fn(); };
      menu.appendChild(b);
    });
    menu.classList.add('show');
    const r = menu.getBoundingClientRect();
    let x = clientX, y = clientY;
    if (x + r.width > innerWidth) x = innerWidth - r.width - 6;
    if (y + r.height > innerHeight) y = innerHeight - r.height - 6;
    menu.style.left = x + 'px'; menu.style.top = y + 'px';
  }

  function hideCtx(): void { menu.classList.remove('show'); }

  stage.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const node = (e.target as HTMLElement).closest('.node') as HTMLElement | null;
    const w = camera.toWorld(e.clientX, e.clientY);
    if (node) {
      const id = node.dataset.id as string;
      if (!state.sel.has(id)) selection.selectOnly(id);
      const n = state.nodes[id];
      const canEnter = !!n && n.shape !== 'group' && n.shape !== 'note';
      showCtx(e.clientX, e.clientY, [
        { label: 'Duplicate', sc: '⌘D', fn: clipboard.duplicateSel },
        { label: 'Copy', sc: '⌘C', fn: clipboard.copySel },
        { label: 'Bring to front', fn: () => nodes.bringToFront(id) },
        '-',
        ...(canEnter ? [{ label: 'Open internals', fn: () => view.enter(id) } as CtxEntry] : []),
        { label: 'Edit label', sc: '⏎', fn: () => inlineEdit.beginEdit(id) },
        '-',
        { label: 'Delete', sc: '⌫', danger: true, fn: nodes.deleteSelection },
      ]);
    } else {
      showCtx(e.clientX, e.clientY, [
        { label: 'Add box here', fn: () => nodes.addNode('rect', w.x - 60, w.y - 26) },
        { label: 'Paste', sc: '⌘V', fn: () => clipboard.pasteClip(w) },
        '-',
        ...(ctx.view.container ? [{ label: 'Go up a level', fn: view.goUp } as CtxEntry, '-' as CtxEntry] : []),
        { label: 'Select all', sc: '⌘A', fn: selection.selectAll },
        { label: 'Zoom to fit', sc: 'F', fn: camera.zoomToFit },
      ]);
    }
  });

  document.addEventListener('pointerdown', (e) => { if (!menu.contains(e.target as Node)) hideCtx(); }, true);

  return { hideCtx };
}
