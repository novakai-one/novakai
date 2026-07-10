/* =====================================================================
   unfold-session-2.ts — reading mode: write-through (renameInPlace /
   mountFrontmatter — never a private write path), the hidden model verbs
   (M5 A-verbs: connect mode + the selection-only '⋯' actions menu), and
   the overlay-scoped keyboard dispatch, split out of unfold.ts in place
   (overflow of unfold-session.ts, which alone exceeded 400 lines together
   with this content). Every symbol here used to be a closure over
   initUnfold's locals; those locals now live on the shared `E: UEnv`
   object unfold.ts constructs and passes to every sibling factory.
   ===================================================================== */

import type { DiagramNode, NodeKind } from '../../core/types/types';
import { esc, KINDS } from '../../core/config/config';
import { initInspectorFrontmatter } from '../inspector/inspector-frontmatter';
import { ufEscAction } from './unfold-esc';
import { ufVerbAllowed } from './unfold-verbs';
import type { UEnv, UNode } from './unfold';

type FrontmatterEditor = ReturnType<typeof initInspectorFrontmatter>;
/** the selection-shape context ufVerbAllowed gates on */
type VerbCtx = { sel: string | null; wire: boolean; clipboard: boolean; modelEmpty: boolean };

/* ================= WRITE-THROUGH (never a private write path) ================= */

/** put the card label into edit mode: contenteditable + full-text selection */
function beginRenameEdit(name: HTMLElement): void {
  name.setAttribute('contenteditable', 'true');
  name.focus();
  const range = document.createRange();
  range.selectNodeContents(name);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
}
/** the card-label edit in flight: the DOM node plus what it started from */
interface RenameCtx { node: DiagramNode; uEntry: UNode; name: HTMLElement; prev: string }
/** write the new label through the shared model path (never a private write
    path), then repaint — reading mode's stage layer or the folded canvas. */
function writeRenameValue(env: UEnv, ctx: RenameCtx, value: string): void {
  if (ctx.node.fm?.name) ctx.node.fm.name = value;
  else ctx.node.label = value;
  ctx.uEntry.label = value;
  env.ctx.hooks.render();
  env.ctx.hooks.sync();
  env.ctx.hooks.pushHistory();
  env.ctx.hooks.persist();
  if (env.spec.stage) {
    env.renderStageGroup(undefined);
    env.focusDim();
    env.renderTree();
    env.renderInspector();
  } else env.render(false);
}
/** commit or revert the edit in flight */
function applyRenameEdit(env: UEnv, ctx: RenameCtx, commitEdit: boolean): void {
  ctx.name.removeAttribute('contenteditable');
  const value = (ctx.name.textContent ?? '').replace(/\s+/g, ' ').trim();
  if (!commitEdit || !value || value === ctx.prev) {
    ctx.name.textContent = ctx.prev;
    return;
  }
  writeRenameValue(env, ctx, value);
}
/** Enter commits, Escape reverts, blur commits — same finish either way */
function wireRenameKeys(name: HTMLElement, finish: (commitEdit: boolean) => void): void {
  name.onkeydown = (evt) => {
    evt.stopPropagation();
    if (evt.key === 'Enter') {
      evt.preventDefault();
      finish(true);
    }
    if (evt.key === 'Escape') {
      evt.preventDefault();
      finish(false);
    }
  };
  name.onblur = () => finish(true);
}
/** inline rename on the selected card (Enter / double-click on selected), writing
    through the existing model path — mutate ctx.state, then hooks render + sync +
    pushHistory + persist. Never a private write path. */
function renameInPlaceImpl(env: UEnv, id: string): void {
  const node = env.ctx.state.nodes[id];
  const scope: HTMLElement = env.spec.stage ? env.stageLayer : env.contentEl;
  const name = scope.querySelector<HTMLElement>(`.uf-card[data-id="${window.CSS.escape(id)}"] .uf-cname`);
  if (!node || !name || name.isContentEditable) return;
  const uEntry = env.gu(id);
  const ctx: RenameCtx = { node, uEntry, name, prev: uEntry.label };
  beginRenameEdit(name);
  let settled = false;
  const finish = (commitEdit: boolean): void => {
    if (settled) return;
    settled = true;
    applyRenameEdit(env, ctx, commitEdit);
  };
  wireRenameKeys(name, finish);
}

/** mount the app's frontmatter editor (panel/inspector-frontmatter) for the selected
    node inside the reading inspector — the same hooks write path as renameInPlace;
    committed edits re-derive the folded view from ctx.state. */
function mountFrontmatterImpl(env: UEnv, fmEditor: FrontmatterEditor, host: HTMLElement, id: string): void {
  const node = env.ctx.state.nodes[id];
  if (!node) return;
  fmEditor.renderFrontmatterSection(host, node);
  host.addEventListener('change', () => {
    env.build();
    env.computeBlast();
    env.renderCanvas();
    env.focusDim();
    env.renderTree();
    setTimeout(env.spec.stage ? env.drawStageWires : env.drawWires, 0);
  });
}

/* ================= HIDDEN MODEL VERBS (M5 A-verbs) =================
   Unfold is a read-only surface for every model verb except rename and
   frontmatter until this section: overlay-scoped keyboard shortcuts + a
   selection-only '⋯' actions menu, both gated by the pure ufVerbAllowed
   so an impossible verb (paste with an empty clipboard, edge ops with no
   wire) can never be offered. Every verb bridges unfold's own selection
   to the shared model selection first (deps.selection.selectOnly /
   selectEdge), invokes the single-owner module verb (nodes / clipboard /
   history — never an inline mutation here), then rebuilds the universe
   via the refreshFromModel path (the io/mermaid apply precedent) and
   re-seeds unfold's selection from whatever the verb left selected in
   the shared model (selectSync('open') — the same reverse-bridge used
   entering unfold). */
function verbState(env: UEnv): VerbCtx {
  return {
    sel: env.spec.sel || null,
    wire: !!env.spec.selWire,
    clipboard: env.ctx.clipboard.nodes.length > 0,
    modelEmpty: Object.keys(env.ctx.state.nodes).length === 0,
  };
}
/** after a module verb mutates ctx.state: rebuild the derived units + full
    repaint, then re-seed unfold's selection from ctx.state.sel (empty for
    delete/clearAll, the pasted/duplicated/added set otherwise). */
function rebuildAfterVerb(env: UEnv): void {
  env.refreshFromModel();
  env.selectSync('open');
  env.render(true);
}
/** the real DiagramEdge behind the rendered wire pair. A direct pair
    between two real nodes resolves (state.edges forbids a duplicate
    same-direction pair, so at most one match exists); a lifted pair
    spanning a container boundary has no single real edge and correctly
    resolves to null — the caller's gate then has nothing to act on. */
function resolveSelWireEdgeId(env: UEnv): string | null {
  if (!env.spec.selWire) return null;
  const { 'a': nodeA, 'b': nodeB } = env.spec.selWire;
  const foundEdge = env.ctx.state.edges.find(
    (x) => (x.from === nodeA && x.to === nodeB) || (x.from === nodeB && x.to === nodeA),
  );
  return foundEdge ? foundEdge.id : null;
}

/* ---- connect mode: the one two-step verb ---- */
function armConnect(env: UEnv): void {
  if (!env.spec.sel) return;
  env.connectFrom = env.spec.sel;
  env.overlay.classList.add('uf-connecting');
  const scope: HTMLElement = env.spec.stage ? env.stageLayer : env.contentEl;
  scope.querySelector(`[data-id="${window.CSS.escape(env.spec.sel)}"]`)?.classList.add('uf-armed');
}
function cancelConnect(env: UEnv): void {
  if (env.connectFrom) {
    const armedSel = `[data-id="${window.CSS.escape(env.connectFrom)}"]`;
    env.overlay.querySelectorAll(armedSel).forEach((el) => el.classList.remove('uf-armed'));
  }
  env.connectFrom = null;
  env.overlay.classList.remove('uf-connecting');
}
function completeConnect(env: UEnv, targetId: string): void {
  const src = env.connectFrom;
  cancelConnect(env);
  if (!src || src === targetId) return;
  env.deps.selection.selectOnly(src);
  env.deps.nodes.makeEdge(src, targetId);
  rebuildAfterVerb(env);
}

/** a %% group hierarchy container (unfold's synthetic reading-only region) is a
    valid selection SHAPE for the gate but not a real model node — the node
    verbs (duplicate/copy/wrap/connect) need an actual ctx.state.nodes entry
    to bridge into, so they additionally require this before acting. */
function selIsRealNode(env: UEnv): boolean {
  return !!(env.spec.sel && env.ctx.state.nodes[env.spec.sel]);
}

/** shared shape of edgeReverse/edgeDelete: resolve the real edge behind the
    selected wire, sync the shared selection onto it, then apply the verb */
function invokeEdgeVerb(env: UEnv, action: (id: string) => void): void {
  const id = resolveSelWireEdgeId(env);
  if (!id) return;
  env.deps.selection.selectEdge(id);
  action(id);
  rebuildAfterVerb(env);
}
/** delete: a selected wire deletes its real edge, a selected node deletes the
    node — the reducer's mutual exclusion means exactly one of the two holds */
function verbDelete(env: UEnv): void {
  if (env.spec.selWire) {
    const id = resolveSelWireEdgeId(env);
    if (!id) return;
    env.deps.selection.selectEdge(id);
    env.deps.nodes.deleteEdge(id);
  } else if (env.spec.sel) {
    env.deps.selection.selectOnly(env.spec.sel);
    env.deps.nodes.deleteSelection();
  } else return;
  rebuildAfterVerb(env);
}
/** create a bare node and land on it — reveal + select, in one step */
function verbAddNode(env: UEnv): void {
  const id = env.deps.nodes.addNode('rect', null, null, {});
  env.build();
  env.goTo(id); // reveal + select the new node in unfold
}

/** one entry per hidden verb — keyed dispatch keeps invokeVerb itself a flat
    lookup instead of a long branch chain. */
const VERB_ACTIONS: Record<string, (env: UEnv) => void> = {
  addNode: (env) => verbAddNode(env),
  connect: (env) => { if (selIsRealNode(env)) armConnect(env); },
  duplicate: (env) => {
    if (!selIsRealNode(env)) return;
    env.deps.selection.selectOnly(env.spec.sel);
    env.deps.clipboard.duplicateSel();
    rebuildAfterVerb(env);
  },
  copy: (env) => {
    if (!selIsRealNode(env)) return;
    env.deps.selection.selectOnly(env.spec.sel);
    env.deps.clipboard.copySel(); // clipboard-only change — nothing to rebuild
  },
  paste: (env) => {
    // assumption (2): unfold has no pointer-world yet — paste at the model default
    env.deps.clipboard.pasteClip(null);
    rebuildAfterVerb(env);
  },
  wrap: (env) => {
    if (!selIsRealNode(env)) return;
    env.deps.selection.selectOnly(env.spec.sel);
    env.deps.nodes.wrapInGroup(); // single-selection wrap is legal (assumption 3)
    rebuildAfterVerb(env);
  },
  // inline menu rows commit directly — editMeta/edgeLabel are not single-shot actions
  editMeta: () => { /* no-op */ },
  edgeLabel: () => { /* no-op */ },
  edgeReverse: (env) => invokeEdgeVerb(env, (id) => env.deps.nodes.reverseEdge(id)),
  edgeDelete: (env) => invokeEdgeVerb(env, (id) => env.deps.nodes.deleteEdge(id)),
  delete: (env) => verbDelete(env),
  clearAll: (env) => {
    if (!confirm('Clear the whole canvas?')) return; // assumption (6): confirm stays at the caller
    env.deps.nodes.clearAll();
    rebuildAfterVerb(env);
  },
  undo: (env) => {
    env.deps.history.undo();
    rebuildAfterVerb(env);
  },
  redo: (env) => {
    env.deps.history.redo();
    rebuildAfterVerb(env);
  },
};
/** single dispatch point for every hidden model verb — shortcuts and the
    '⋯' menu both funnel through here so the gate is checked exactly once
    per invocation regardless of the surface that triggered it. */
function invokeVerb(env: UEnv, verb: string): void {
  const verbCtx = verbState(env);
  if (!ufVerbAllowed(verb, verbCtx)) return;
  VERB_ACTIONS[verb]?.(env);
}

/* ---- the selection-only '⋯' actions menu ---- */
function closeActionsMenu(env: UEnv): void {
  if (!env.actionsMenuOpen) return;
  env.actionsMenuOpen = false;
  env.renderInspector();
}
const VERB_LABELS: Record<string, string> = {
  addNode: 'add node', connect: 'connect', duplicate: 'duplicate', copy: 'copy', paste: 'paste',
  wrap: 'wrap in group', edgeReverse: 'edge reverse', edgeDelete: 'edge delete', delete: 'delete',
  clearAll: 'clear all', undo: 'undo', redo: 'redo',
};
/** connect/duplicate/copy/wrap need an actual ctx.state.nodes entry to bridge into */
const NEEDS_REAL_NODE = new Set(['connect', 'duplicate', 'copy', 'wrap']);
const MENU_ITEMS_BEFORE_EDIT: Array<[string, boolean?]> = [
  ['addNode'], ['connect'], ['duplicate'], ['copy'], ['paste'], ['wrap'],
];
const MENU_ITEMS_AFTER_EDIT: Array<[string, boolean?]> = [
  ['edgeReverse'], ['edgeDelete', true], ['delete', true], ['clearAll', true], ['undo'], ['redo'],
];
/** the menu-under-construction: the DOM wrap plus the selection-shape gate */
interface MenuCtx { wrap: HTMLElement; verbCtx: VerbCtx }
function addMenuItem(env: UEnv, menu: MenuCtx, verb: string, danger?: boolean): void {
  if (!ufVerbAllowed(verb, menu.verbCtx)) return;
  if (NEEDS_REAL_NODE.has(verb) && !selIsRealNode(env)) return; // a %% hier group has no model node to bridge into
  const btn = env.h('button', 'uf-mitem' + (danger ? ' danger' : ''), esc(VERB_LABELS[verb]));
  btn.onclick = (evt) => {
    evt.stopPropagation();
    closeActionsMenu(env);
    invokeVerb(env, verb);
  };
  menu.wrap.appendChild(btn);
}
function addMenuItems(env: UEnv, menu: MenuCtx, items: Array<[string, boolean?]>): void {
  for (const [verb, danger] of items) addMenuItem(env, menu, verb, danger);
}
function addEditMetaRowIfAllowed(env: UEnv, menu: MenuCtx): void {
  if (ufVerbAllowed('editMeta', menu.verbCtx) && env.spec.sel && env.ctx.state.nodes[env.spec.sel]) {
    menu.wrap.appendChild(buildEditMetaRow(env, env.spec.sel));
  }
}
function addEdgeLabelRowIfAllowed(env: UEnv, menu: MenuCtx): void {
  const wireEdgeId = ufVerbAllowed('edgeLabel', menu.verbCtx) ? resolveSelWireEdgeId(env) : null;
  if (wireEdgeId) menu.wrap.appendChild(buildEdgeLabelRow(env, wireEdgeId));
}
function buildActionsMenu(env: UEnv): HTMLElement {
  const menu: MenuCtx = { wrap: env.h('div', 'uf-menu'), verbCtx: verbState(env) };
  addMenuItems(env, menu, MENU_ITEMS_BEFORE_EDIT);
  addEditMetaRowIfAllowed(env, menu);
  addEdgeLabelRowIfAllowed(env, menu);
  addMenuItems(env, menu, MENU_ITEMS_AFTER_EDIT);
  return menu.wrap;
}
/** commit-on-Enter keydown handler shared by every inline single-line editor
    (kind/description/edge-label rows) — stopPropagation always, commit once */
function commitOnEnter(commitFn: () => void): (evt: KeyboardEvent) => void {
  return (evt) => {
    evt.stopPropagation();
    if (evt.key === 'Enter') {
      evt.preventDefault();
      commitFn();
    }
  };
}
/** the kind <select> half of the inline kind + description editor */
function buildKindSelect(env: UEnv, id: string, node: DiagramNode): HTMLSelectElement {
  const kindSel = document.createElement('select');
  kindSel.className = 'uf-minput';
  kindSel.innerHTML = '<option value="">(none)</option>'
    + KINDS.map((k) => `<option value="${k}">${esc(k)}</option>`).join('');
  kindSel.value = node.kind ?? '';
  kindSel.onchange = () => {
    const kindValue = kindSel.value;
    closeActionsMenu(env);
    env.deps.selection.selectOnly(id);
    env.deps.nodes.setNodeMeta(id, { kind: kindValue ? (kindValue as NodeKind) : null });
    rebuildAfterVerb(env);
  };
  return kindSel;
}
/** the description <input> half of the inline kind + description editor */
function buildDescInput(env: UEnv, id: string, node: DiagramNode): HTMLInputElement {
  const descInp = document.createElement('input');
  descInp.className = 'uf-minput';
  descInp.placeholder = 'description';
  descInp.value = node.fm?.description ?? '';
  const commitDesc = (): void => {
    const descValue = descInp.value;
    closeActionsMenu(env);
    env.deps.selection.selectOnly(id);
    env.deps.nodes.setNodeMeta(id, { desc: descValue });
    rebuildAfterVerb(env);
  };
  descInp.onkeydown = commitOnEnter(commitDesc);
  descInp.onchange = commitDesc;
  return descInp;
}
/** inline kind + description editor, committing on change/Enter (never a prompt/alert) */
function buildEditMetaRow(env: UEnv, id: string): HTMLElement {
  const node = env.ctx.state.nodes[id];
  const row = env.h('div', 'uf-mrow');
  row.appendChild(buildKindSelect(env, id, node));
  row.appendChild(buildDescInput(env, id, node));
  return row;
}
/** inline edge-label editor, committing on change/Enter */
function buildEdgeLabelRow(env: UEnv, edgeId: string): HTMLElement {
  const edge = env.ctx.state.edges.find((x) => x.id === edgeId);
  const row = env.h('div', 'uf-mrow');
  const labelInp = document.createElement('input');
  labelInp.className = 'uf-minput';
  labelInp.placeholder = 'edge label';
  labelInp.value = edge?.label ?? '';
  const commitLabel = (): void => {
    const value = labelInp.value;
    closeActionsMenu(env);
    env.deps.selection.selectEdge(edgeId);
    env.deps.nodes.setEdgeLabel(edgeId, value);
    rebuildAfterVerb(env);
  };
  labelInp.onkeydown = commitOnEnter(commitLabel);
  labelInp.onchange = commitLabel;
  row.appendChild(labelInp);
  return row;
}

/* ================= CHROME-LESS CONTROLS: search + keyboard ================= */
/** Enter renames the selected card in place — but never while typing in a field */
function handleEnterKey(env: UEnv, evt: KeyboardEvent, inAnyField: boolean): void {
  if (inAnyField || !env.spec.sel || env.spec.focusType) return;
  evt.stopPropagation();
  env.renameInPlace(env.spec.sel);
}
interface ShortcutRule { verb: string; matches: (evt: KeyboardEvent, mod: boolean) => boolean }
/** overlay-scoped model-verb shortcuts (M5 A-verbs); first match wins */
const VERB_SHORTCUTS: ShortcutRule[] = [
  { verb: 'delete', matches: (evt) => evt.key === 'Delete' || evt.key === 'Backspace' },
  { verb: 'redo', matches: (evt, mod) => mod && evt.shiftKey && evt.key.toLowerCase() === 'z' },
  { verb: 'undo', matches: (evt, mod) => mod && evt.key.toLowerCase() === 'z' },
  { verb: 'copy', matches: (evt, mod) => mod && evt.key.toLowerCase() === 'c' },
  { verb: 'paste', matches: (evt, mod) => mod && evt.key.toLowerCase() === 'v' },
  { verb: 'duplicate', matches: (evt, mod) => mod && evt.key.toLowerCase() === 'd' },
];
/** overlay-scoped model-verb shortcuts (M5 A-verbs) — suppressed while typing in a
    field (criterion 8); stopPropagation so the legacy document-level keyboard.ts
    handler never ALSO fires the same verb a second time */
function handleVerbShortcut(env: UEnv, evt: KeyboardEvent): void {
  const mod = evt.metaKey || evt.ctrlKey;
  const rule = VERB_SHORTCUTS.find((candidate) => candidate.matches(evt, mod));
  if (!rule) return;
  evt.preventDefault();
  evt.stopPropagation();
  invokeVerb(env, rule.verb);
}
/** one entry per ufEscAction verdict — keyed dispatch keeps handleEscapeKey a
    flat lookup instead of an if/else-if chain. */
const ESCAPE_HANDLERS: Record<string, (env: UEnv) => void> = {
  cancelConnect: (env) => cancelConnect(env),
  clearTypeFocus: (env) => env.typeFocus(null),
  deselectWire: (env) => env.commit({ type: 'selectWire', 'a': env.spec.selWire!.a, 'b': env.spec.selWire!.b }),
  exitStage: (env) => {
    env.setSel(null);
    env.stageMode(null);
    env.renderInspector();
    setTimeout(env.drawWires, 0);
  },
  selectGroup: (env) => env.selectGroup(env.spec.sel!),
  clearQuery: (env) => {
    (env.q('ufSearch') as HTMLInputElement).value = '';
    env.commit({ type: 'setQuery', 'q': '' });
  },
  // 'none': nothing to clear — Escape never exits unfold
};
/** Escape dispatch: the pure ufEscAction decides which layer of state to peel back */
function handleEscapeKey(env: UEnv, evt: KeyboardEvent, target: HTMLElement, inAnyField: boolean): void {
  // a rename in flight or a frontmatter field owns its own Escape; the search box keeps the old chain
  if (target.isContentEditable || (inAnyField && target.id !== 'ufSearch')) return;
  evt.stopPropagation();
  const act = ufEscAction({
    connect: !!env.connectFrom,
    focusType: !!env.spec.focusType, selWire: !!env.spec.selWire, stage: !!env.spec.stage,
    sel: !!env.spec.sel, query: !!env.spec.query,
  });
  ESCAPE_HANDLERS[act]?.(env);
}
/** overlay-scoped keydown dispatch: Enter (rename), verb shortcuts, Escape */
function registerKeyboardHandlers(env: UEnv): void {
  document.addEventListener('keydown', (evt) => {
    if (!env.overlay.classList.contains('show')) return;
    // the planner overlay (panel/planner.ts) stacks above unfold and owns its own
    // Escape/verb shortcuts; unfold must stay silent underneath it (W1)
    if (env.ctx.runtime.plannerVisible) return;
    const targetEl = evt.target as HTMLElement;
    const inAnyField = targetEl.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(targetEl.tagName);
    if (evt.key === 'Enter') {
      handleEnterKey(env, evt, inAnyField);
      return;
    }
    if (!inAnyField) handleVerbShortcut(env, evt);
    if (evt.key !== 'Escape') return;
    handleEscapeKey(env, evt, targetEl, inAnyField);
  }, true);
}

/** attach every non-mode-boundary member onto `env`; the 2 write-through
    members (renameInPlace/mountFrontmatter) stay declared inside
    initUnfoldSession2 and are passed in already-bound to it. */
type MappedSession2Members = Pick<UEnv, 'renameInPlace' | 'mountFrontmatter'>;
function wireSession2Env(env: UEnv, mapped: MappedSession2Members): void {
  Object.assign(env, {
    completeConnect: (targetId: string) => completeConnect(env, targetId),
    invokeVerb: (verb: string) => invokeVerb(env, verb),
    buildActionsMenu: () => buildActionsMenu(env),
    closeActionsMenu: () => closeActionsMenu(env),
    ...mapped,
  });
}

export function initUnfoldSession2(env: UEnv): void {
  const fmEditor = initInspectorFrontmatter(env.ctx);

  function renameInPlace(id: string): void {
    renameInPlaceImpl(env, id);
  }
  function mountFrontmatter(host: HTMLElement, id: string): void {
    mountFrontmatterImpl(env, fmEditor, host, id);
  }

  (env.q('ufSearch') as HTMLInputElement).oninput = (evt) => {
    env.commit({ type: 'setQuery', 'q': (evt.target as HTMLInputElement).value.trim().toLowerCase() });
  };
  registerKeyboardHandlers(env);
  wireSession2Env(env, { renameInPlace, mountFrontmatter });
}
