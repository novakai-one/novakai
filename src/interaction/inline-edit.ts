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

import type { AppContext } from '../core/context/context';
import type { CameraApi } from '../core/camera/camera';
import type { NodesApi } from './nodes';
import { nodeAtPoint } from '../core/state/state';

export interface InlineEditApi {
  beginEdit: (id: string) => void;
}

/** Selects a node for editing (clears the current selection first). */
function selectForEdit(ctx: AppContext, id: string): void {
  const { state } = ctx;
  state.sel.clear();
  state.sel.add(id);
  state.selEdge = null;
}

function clearEditingId(ctx: AppContext): void {
  ctx.runtime.editingId = null;
}

function selectLabelContents(label: HTMLElement): void {
  const range = document.createRange();
  range.selectNodeContents(label);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}

function activateLabelEditing(el: HTMLElement): HTMLElement {
  const label = el.querySelector('.label') as HTMLElement;
  el.classList.add('editing');
  label.setAttribute('contenteditable', 'true');
  label.focus();
  selectLabelContents(label);
  return label;
}

function commitLabelEdit(ctx: AppContext, id: string, target: { el: HTMLElement; label: HTMLElement }): void {
  const { state, runtime } = ctx;
  const { el, label } = target;
  runtime.editingId = null;
  el.classList.remove('editing');
  label.removeAttribute('contenteditable');
  state.nodes[id].label = (label.textContent || '').trim();
  ctx.hooks.render();
  ctx.hooks.sync();
  ctx.hooks.renderInspector();
  ctx.hooks.pushHistory();
}

function cancelLabelEdit(
  ctx: AppContext,
  id: string,
  target: { el: HTMLElement; label: HTMLElement },
  editState: { done: boolean },
): void {
  const { state, runtime } = ctx;
  const { el, label } = target;
  editState.done = true;
  label.textContent = state.nodes[id].label;
  runtime.editingId = null;
  el.classList.remove('editing');
  label.removeAttribute('contenteditable');
  label.blur();
  ctx.hooks.render();
}

/** True (and refocuses the label) for a blur that fires within the synthetic dblclick tail. */
function isBlurTooEarly(label: HTMLElement, editState: { startedAt: number }): boolean {
  if (performance.now() - editState.startedAt >= 80) return false;
  setTimeout(() => label.focus(), 0);
  return true;
}

function commitOnEnter(e: KeyboardEvent, finish: () => void): void {
  e.preventDefault();
  finish();
}

/** Wires the blur/keydown listeners that commit or cancel an in-flight label edit. */
function wireLabelEditing(ctx: AppContext, id: string, el: HTMLElement, label: HTMLElement): void {
  const target = { el, label };
  const editState = { done: false, startedAt: performance.now() };
  const finish = (): void => {
    if (editState.done || isBlurTooEarly(label, editState)) return;
    editState.done = true;
    commitLabelEdit(ctx, id, target);
    label.removeEventListener('blur', finish);
    label.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.shiftKey) commitOnEnter(e, finish);
    else if (e.key === 'Escape') cancelLabelEdit(ctx, id, target, editState);
    e.stopPropagation();
  };
  label.addEventListener('blur', finish);
  label.addEventListener('keydown', onKey);
}

function isNonEditableDblClickTarget(target: HTMLElement): boolean {
  return !!target.closest('.fmtype') || !!target.closest('path.hit, .bendhandle, .edgelabel');
}

function handleFrontmatterCardClick(
  e: MouseEvent,
  card: HTMLElement,
  openFrontmatterEditor: (id: string) => void,
): void {
  const host = card.closest('.node') as HTMLElement | null;
  const id = host?.dataset.id;
  if (id) openFrontmatterEditor(id);
  e.stopPropagation();
}

function startLabelEdit(ctx: AppContext, world: HTMLElement, id: string): void {
  const el = world.querySelector(`.node[data-id="${id}"]`) as HTMLElement | null;
  if (!el) return clearEditingId(ctx);
  const label = activateLabelEditing(el);
  wireLabelEditing(ctx, id, el, label);
}

function handleCanvasDblClick(
  e: MouseEvent,
  ctx: AppContext,
  deps: { camera: CameraApi; nodes: NodesApi; beginEdit: (id: string) => void },
): void {
  const point = deps.camera.toWorld(e.clientX, e.clientY);
  const id = nodeAtPoint(ctx.state, point.x, point.y, ctx.view.container);
  if (!id) {
    const newId = deps.nodes.addNode('rect', point.x - 60, point.y - 26);
    setTimeout(() => deps.beginEdit(newId), 0);
    return;
  }
  deps.beginEdit(id);
}

type DblClickDeps = {
  camera: CameraApi;
  nodes: NodesApi;
  beginEdit: (id: string) => void;
  openFrontmatterEditor: (id: string) => void;
};

// type chips trace on single click (see pointer.ts); a wire/bendhandle/edgelabel
// double-click must not drop a node; a frontmatter card opens the inspector editor.
function handleStageDblClick(e: MouseEvent, ctx: AppContext, deps: DblClickDeps): void {
  const target = e.target as HTMLElement;
  if (isNonEditableDblClickTarget(target)) {
    e.stopPropagation();
    return;
  }
  const card = target.closest('.fmcard') as HTMLElement | null;
  if (card) {
    handleFrontmatterCardClick(e, card, deps.openFrontmatterEditor);
    return;
  }
  handleCanvasDblClick(e, ctx, deps);
}

function revealInspectorTab(ctx: AppContext): void {
  ctx.hooks.render();
  ctx.hooks.renderInspector();
  ctx.hooks.showTab('insp');
}

function focusFrontmatterName(): void {
  const name = document.getElementById('fmName') as HTMLInputElement | null;
  if (!name) return;
  name.focus();
  name.select();
}

export function initInlineEdit(ctx: AppContext, camera: CameraApi, nodes: NodesApi): InlineEditApi {
  const { dom: { stage, world }, state, runtime } = ctx;

  function beginEdit(id: string): void {
    if (!state.nodes[id]) return;
    selectForEdit(ctx, id);
    runtime.editingId = id;
    ctx.hooks.render();
    ctx.hooks.renderInspector();
    startLabelEdit(ctx, world, id);
  }

  function openFrontmatterEditor(id: string): void {
    if (!state.nodes[id]) return;
    selectForEdit(ctx, id);
    revealInspectorTab(ctx);
    setTimeout(focusFrontmatterName, 0);
  }

  const dblClickDeps = { camera, nodes, beginEdit, openFrontmatterEditor };
  stage.addEventListener('dblclick', (e) => handleStageDblClick(e, ctx, dblClickDeps));

  return { beginEdit };
}
