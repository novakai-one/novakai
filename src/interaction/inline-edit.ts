/* =====================================================================
   inline-edit.ts — double-click label editing
   ---------------------------------------------------------------------
   Responsibility: the contenteditable inline label edit flow (beginEdit)
   and the stage dblclick handler that either edits the node under the
   cursor or drops + edits a new box. Manages the editingId runtime flag
   so render keeps the editor alive across re-renders.

   Depends on camera (toWorld), nodes (addNode), and writes
   runtime.editingId. Commits the edited label back into the model and
   pushes history.
   ===================================================================== */

import type { AppContext } from '../core/context';
import type { CameraApi } from '../core/camera';
import type { NodesApi } from './nodes';
import { nodeAtPoint } from '../core/state';

export interface InlineEditApi {
  beginEdit: (id: string) => void;
}

export function initInlineEdit(ctx: AppContext, camera: CameraApi, nodes: NodesApi): InlineEditApi {
  const { stage, world } = ctx.dom;
  const { state, runtime } = ctx;

  function beginEdit(id: string): void {
    if (!state.nodes[id]) return;
    state.sel.clear(); state.sel.add(id); state.selEdge = null;
    runtime.editingId = id;
    ctx.hooks.render(); ctx.hooks.renderInspector();

    const el = world.querySelector(`.node[data-id="${id}"]`) as HTMLElement | null;
    if (!el) { runtime.editingId = null; return; }
    const lab = el.querySelector('.label') as HTMLElement;
    el.classList.add('editing');
    lab.setAttribute('contenteditable', 'true');
    lab.focus();
    const range = document.createRange(); range.selectNodeContents(lab);
    const selo = window.getSelection(); selo?.removeAllRanges(); selo?.addRange(range);

    let done = false;
    const startedAt = performance.now();
    const finish = (): void => {
      if (done) return;
      // ignore a blur that fires in the first 80ms (synthetic dblclick tail)
      if (performance.now() - startedAt < 80) { setTimeout(() => lab.focus(), 0); return; }
      done = true;
      runtime.editingId = null;
      el.classList.remove('editing');
      lab.removeAttribute('contenteditable');
      state.nodes[id].label = (lab.textContent || '').trim();
      ctx.hooks.render(); ctx.hooks.sync(); ctx.hooks.renderInspector(); ctx.hooks.pushHistory();
      lab.removeEventListener('blur', finish);
      lab.removeEventListener('keydown', key);
    };
    const key = (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); finish(); }
      else if (ev.key === 'Escape') {
        lab.textContent = state.nodes[id].label; done = true; runtime.editingId = null;
        el.classList.remove('editing'); lab.removeAttribute('contenteditable'); lab.blur(); ctx.hooks.render();
      }
      ev.stopPropagation();
    };
    lab.addEventListener('blur', finish);
    lab.addEventListener('keydown', key);
  }

  stage.addEventListener('dblclick', (e) => {
    // type chips trace on single click (see pointer.ts); swallow the dbl-click
    // so it neither re-toggles the trace nor opens the inspector editor
    if ((e.target as HTMLElement).closest('.fmtype')) { e.stopPropagation(); return; }
    // double-clicking a wire, its bend handle, or its label must not drop a node
    if ((e.target as HTMLElement).closest('path.hit, .bendhandle, .edgelabel')) { e.stopPropagation(); return; }
    // double-clicking elsewhere on a frontmatter card opens the inspector editor instead
    const card = (e.target as HTMLElement).closest('.fmcard') as HTMLElement | null;
    if (card) {
      const host = card.closest('.node') as HTMLElement | null;
      const id = host?.dataset.id;
      if (id) openFrontmatterEditor(id);
      e.stopPropagation();
      return;
    }
    const w = camera.toWorld(e.clientX, e.clientY);
    const id = nodeAtPoint(state, w.x, w.y, ctx.view.container);
    if (!id) {
      const newId = nodes.addNode('rect', w.x - 60, w.y - 26);
      setTimeout(() => beginEdit(newId), 0);
      return;
    }
    beginEdit(id);
  });

  /** Select a node, surface the inspector, and focus its frontmatter name. */
  function openFrontmatterEditor(id: string): void {
    if (!state.nodes[id]) return;
    state.sel.clear(); state.sel.add(id); state.selEdge = null;
    ctx.hooks.render(); ctx.hooks.renderInspector();
    ctx.hooks.showTab('insp');
    setTimeout(() => {
      const name = document.getElementById('fmName') as HTMLInputElement | null;
      if (name) { name.focus(); name.select(); }
    }, 0);
  }

  return { beginEdit };
}
