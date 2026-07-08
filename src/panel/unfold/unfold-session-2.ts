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

import type { NodeKind } from '../../core/types/types';
import { esc, KINDS } from '../../core/config/config';
import { initInspectorFrontmatter } from '../inspector/inspector-frontmatter';
import { ufEscAction } from './unfold-esc';
import { ufVerbAllowed } from './unfold-verbs';
import type { UEnv } from './unfold';

export function initUnfoldSession2(E: UEnv): void {
  /* ================= WRITE-THROUGH (never a private write path) ================= */
  const fmEditor = initInspectorFrontmatter(E.ctx);

  /** inline rename on the selected card (Enter / double-click on selected), writing
      through the existing model path — mutate ctx.state, then hooks render + sync +
      pushHistory + persist. Never a private write path. */
  function renameInPlace(id: string): void {
    const node = E.ctx.state.nodes[id];
    const scope: HTMLElement = E.spec.stage ? E.stageLayer : E.contentEl;
    const name = scope.querySelector<HTMLElement>(`.uf-card[data-id="${window.CSS.escape(id)}"] .uf-cname`);
    if (!node || !name || name.isContentEditable) return;
    const uEntry = E.gu(id);
    const prev = uEntry.label;
    name.setAttribute('contenteditable', 'true');
    name.focus();
    const range = document.createRange();
    range.selectNodeContents(name);
    const sl = window.getSelection();
    sl?.removeAllRanges();
    sl?.addRange(range);
    let settled = false;
    const finish = (commitEdit: boolean): void => {
      if (settled) return;
      settled = true;
      name.removeAttribute('contenteditable');
      const value = (name.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!commitEdit || !value || value === prev) { name.textContent = prev; return; }
      if (node.fm?.name) node.fm.name = value; else node.label = value;
      uEntry.label = value;
      E.ctx.hooks.render(); E.ctx.hooks.sync(); E.ctx.hooks.pushHistory(); E.ctx.hooks.persist();
      if (E.spec.stage) { E.renderStageGroup(undefined); E.focusDim(); E.renderTree(); E.renderInspector(); }
      else E.render(false);
    };
    name.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    };
    name.onblur = () => finish(true);
  }

  /** mount the app's frontmatter editor (panel/inspector-frontmatter) for the selected
      node inside the reading inspector — the same hooks write path as renameInPlace;
      committed edits re-derive the folded view from ctx.state. */
  function mountFrontmatter(host: HTMLElement, id: string): void {
    const node = E.ctx.state.nodes[id];
    if (!node) return;
    fmEditor.renderFrontmatterSection(host, node);
    host.addEventListener('change', () => {
      E.build();
      E.computeBlast();
      E.renderCanvas();
      E.focusDim();
      E.renderTree();
      setTimeout(E.spec.stage ? E.drawStageWires : E.drawWires, 0);
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
  const verbState = (): { sel: string | null; wire: boolean; clipboard: boolean; modelEmpty: boolean } => ({
    sel: E.spec.sel || null,
    wire: !!E.spec.selWire,
    clipboard: E.ctx.clipboard.nodes.length > 0,
    modelEmpty: Object.keys(E.ctx.state.nodes).length === 0,
  });
  /** after a module verb mutates ctx.state: rebuild the derived units + full
      repaint, then re-seed unfold's selection from ctx.state.sel (empty for
      delete/clearAll, the pasted/duplicated/added set otherwise). */
  function rebuildAfterVerb(): void {
    E.refreshFromModel();
    E.selectSync('open');
    E.render(true);
  }
  /** the real DiagramEdge behind the rendered wire pair. A direct pair
      between two real nodes resolves (state.edges forbids a duplicate
      same-direction pair, so at most one match exists); a lifted pair
      spanning a container boundary has no single real edge and correctly
      resolves to null — the caller's gate then has nothing to act on. */
  function resolveSelWireEdgeId(): string | null {
    if (!E.spec.selWire) return null;
    const { a: nodeA, b: nodeB } = E.spec.selWire;
    const foundEdge = E.ctx.state.edges.find((x) => (x.from === nodeA && x.to === nodeB) || (x.from === nodeB && x.to === nodeA));
    return foundEdge ? foundEdge.id : null;
  }

  /* ---- connect mode: the one two-step verb ---- */
  function armConnect(): void {
    if (!E.spec.sel) return;
    E.connectFrom = E.spec.sel;
    E.overlay.classList.add('uf-connecting');
    const scope: HTMLElement = E.spec.stage ? E.stageLayer : E.contentEl;
    scope.querySelector(`[data-id="${window.CSS.escape(E.spec.sel)}"]`)?.classList.add('uf-armed');
  }
  function cancelConnect(): void {
    if (E.connectFrom) {
      E.overlay.querySelectorAll(`[data-id="${window.CSS.escape(E.connectFrom)}"]`).forEach((el) => el.classList.remove('uf-armed'));
    }
    E.connectFrom = null;
    E.overlay.classList.remove('uf-connecting');
  }
  function completeConnect(targetId: string): void {
    const src = E.connectFrom;
    cancelConnect();
    if (!src || src === targetId) return;
    E.deps.selection.selectOnly(src);
    E.deps.nodes.makeEdge(src, targetId);
    rebuildAfterVerb();
  }

  /** a %% group hierarchy container (unfold's synthetic reading-only region) is a
      valid selection SHAPE for the gate but not a real model node — the node
      verbs (duplicate/copy/wrap/connect) need an actual ctx.state.nodes entry
      to bridge into, so they additionally require this before acting. */
  const selIsRealNode = (): boolean => !!(E.spec.sel && E.ctx.state.nodes[E.spec.sel]);

  /** shared shape of edgeReverse/edgeDelete: resolve the real edge behind the
      selected wire, sync the shared selection onto it, then apply the verb */
  function invokeEdgeVerb(action: (id: string) => void): void {
    const id = resolveSelWireEdgeId();
    if (!id) return;
    E.deps.selection.selectEdge(id);
    action(id);
    rebuildAfterVerb();
  }
  /** delete: a selected wire deletes its real edge, a selected node deletes the
      node — the reducer's mutual exclusion means exactly one of the two holds */
  function verbDelete(): void {
    if (E.spec.selWire) {
      const id = resolveSelWireEdgeId();
      if (!id) return;
      E.deps.selection.selectEdge(id);
      E.deps.nodes.deleteEdge(id);
    } else if (E.spec.sel) {
      E.deps.selection.selectOnly(E.spec.sel);
      E.deps.nodes.deleteSelection();
    } else return;
    rebuildAfterVerb();
  }
  /** create a bare node and land on it — reveal + select, in one step */
  function verbAddNode(): void {
    const id = E.deps.nodes.addNode('rect', null, null, {});
    E.build();
    E.goTo(id); // reveal + select the new node in unfold
  }
  /** single dispatch point for every hidden model verb — shortcuts and the
      '⋯' menu both funnel through here so the gate is checked exactly once
      per invocation regardless of the surface that triggered it. */
  function invokeVerb(verb: string): void {
    const verbCtx = verbState();
    if (!ufVerbAllowed(verb, verbCtx)) return;
    switch (verb) {
      case 'addNode':
        verbAddNode();
        return;
      case 'connect':
        if (!selIsRealNode()) return;
        armConnect();
        return;
      case 'duplicate':
        if (!selIsRealNode()) return;
        E.deps.selection.selectOnly(E.spec.sel);
        E.deps.clipboard.duplicateSel();
        rebuildAfterVerb();
        return;
      case 'copy':
        if (!selIsRealNode()) return;
        E.deps.selection.selectOnly(E.spec.sel);
        E.deps.clipboard.copySel(); // clipboard-only change — nothing to rebuild
        return;
      case 'paste':
        // assumption (2): unfold has no pointer-world yet — paste at the model default
        E.deps.clipboard.pasteClip(null);
        rebuildAfterVerb();
        return;
      case 'wrap':
        if (!selIsRealNode()) return;
        E.deps.selection.selectOnly(E.spec.sel);
        E.deps.nodes.wrapInGroup(); // single-selection wrap is legal (assumption 3)
        rebuildAfterVerb();
        return;
      case 'editMeta':
      case 'edgeLabel':
        return; // inline menu rows commit directly — not a single-shot action
      case 'edgeReverse':
        invokeEdgeVerb((id) => E.deps.nodes.reverseEdge(id));
        return;
      case 'edgeDelete':
        invokeEdgeVerb((id) => E.deps.nodes.deleteEdge(id));
        return;
      case 'delete':
        verbDelete();
        return;
      case 'clearAll':
        if (!confirm('Clear the whole canvas?')) return; // assumption (6): confirm stays at the caller
        E.deps.nodes.clearAll();
        rebuildAfterVerb();
        return;
      case 'undo':
        E.deps.history.undo();
        rebuildAfterVerb();
        return;
      case 'redo':
        E.deps.history.redo();
        rebuildAfterVerb();
        return;
    }
  }

  /* ---- the selection-only '⋯' actions menu ---- */
  function closeActionsMenu(): void {
    if (!E.actionsMenuOpen) return;
    E.actionsMenuOpen = false;
    E.renderInspector();
  }
  const VERB_LABELS: Record<string, string> = {
    addNode: 'add node', connect: 'connect', duplicate: 'duplicate', copy: 'copy', paste: 'paste',
    wrap: 'wrap in group', edgeReverse: 'edge reverse', edgeDelete: 'edge delete', delete: 'delete',
    clearAll: 'clear all', undo: 'undo', redo: 'redo',
  };
  function buildActionsMenu(): HTMLElement {
    const verbCtx = verbState();
    const wrap = E.h('div', 'uf-menu');
    const NEEDS_REAL_NODE = new Set(['connect', 'duplicate', 'copy', 'wrap']);
    const item = (verb: string, danger?: boolean): void => {
      if (!ufVerbAllowed(verb, verbCtx)) return;
      if (NEEDS_REAL_NODE.has(verb) && !selIsRealNode()) return; // a %% hier group has no model node to bridge into
      const btn = E.h('button', 'uf-mitem' + (danger ? ' danger' : ''), esc(VERB_LABELS[verb]));
      btn.onclick = (ev) => { ev.stopPropagation(); closeActionsMenu(); invokeVerb(verb); };
      wrap.appendChild(btn);
    };
    item('addNode');
    item('connect');
    item('duplicate');
    item('copy');
    item('paste');
    item('wrap');
    if (ufVerbAllowed('editMeta', verbCtx) && E.spec.sel && E.ctx.state.nodes[E.spec.sel]) {
      wrap.appendChild(buildEditMetaRow(E.spec.sel));
    }
    const wireEdgeId = ufVerbAllowed('edgeLabel', verbCtx) ? resolveSelWireEdgeId() : null;
    if (wireEdgeId) wrap.appendChild(buildEdgeLabelRow(wireEdgeId));
    item('edgeReverse');
    item('edgeDelete', true);
    item('delete', true);
    item('clearAll', true);
    item('undo');
    item('redo');
    return wrap;
  }
  /** inline kind + description editor, committing on change/Enter (never a prompt/alert) */
  function buildEditMetaRow(id: string): HTMLElement {
    const node = E.ctx.state.nodes[id];
    const row = E.h('div', 'uf-mrow');
    const kindSel = document.createElement('select');
    kindSel.className = 'uf-minput';
    kindSel.innerHTML = '<option value="">(none)</option>'
      + KINDS.map((k) => `<option value="${k}">${esc(k)}</option>`).join('');
    kindSel.value = node.kind ?? '';
    kindSel.onchange = () => {
      const kindValue = kindSel.value;
      closeActionsMenu();
      E.deps.selection.selectOnly(id);
      E.deps.nodes.setNodeMeta(id, { kind: kindValue ? (kindValue as NodeKind) : null });
      rebuildAfterVerb();
    };
    const descInp = document.createElement('input');
    descInp.className = 'uf-minput';
    descInp.placeholder = 'description';
    descInp.value = node.fm?.description ?? '';
    const commitDesc = (): void => {
      const descValue = descInp.value;
      closeActionsMenu();
      E.deps.selection.selectOnly(id);
      E.deps.nodes.setNodeMeta(id, { desc: descValue });
      rebuildAfterVerb();
    };
    descInp.onkeydown = (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); commitDesc(); } };
    descInp.onchange = commitDesc;
    row.appendChild(kindSel);
    row.appendChild(descInp);
    return row;
  }
  /** inline edge-label editor, committing on change/Enter */
  function buildEdgeLabelRow(edgeId: string): HTMLElement {
    const edge = E.ctx.state.edges.find((x) => x.id === edgeId);
    const row = E.h('div', 'uf-mrow');
    const labelInp = document.createElement('input');
    labelInp.className = 'uf-minput';
    labelInp.placeholder = 'edge label';
    labelInp.value = edge?.label ?? '';
    const commitLabel = (): void => {
      const value = labelInp.value;
      closeActionsMenu();
      E.deps.selection.selectEdge(edgeId);
      E.deps.nodes.setEdgeLabel(edgeId, value);
      rebuildAfterVerb();
    };
    labelInp.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); commitLabel(); } };
    labelInp.onchange = commitLabel;
    row.appendChild(labelInp);
    return row;
  }

  /* ================= CHROME-LESS CONTROLS: search + keyboard ================= */
  (E.q('ufSearch') as HTMLInputElement).oninput = (e) => {
    E.commit({ type: 'setQuery', q: (e.target as HTMLInputElement).value.trim().toLowerCase() });
  };
  /** Enter renames the selected card in place — but never while typing in a field */
  function handleEnterKey(ev: KeyboardEvent, inAnyField: boolean): void {
    if (!inAnyField && E.spec.sel && !E.spec.focusType) { ev.stopPropagation(); renameInPlace(E.spec.sel); }
  }
  /** overlay-scoped model-verb shortcuts (M5 A-verbs) — suppressed while typing in a
      field (criterion 8); stopPropagation so the legacy document-level keyboard.ts
      handler never ALSO fires the same verb a second time */
  function handleVerbShortcut(ev: KeyboardEvent): void {
    const mod = ev.metaKey || ev.ctrlKey;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('delete'); return; }
    if (mod && ev.shiftKey && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('redo'); return; }
    if (mod && ev.key.toLowerCase() === 'z') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('undo'); return; }
    if (mod && ev.key.toLowerCase() === 'c') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('copy'); return; }
    if (mod && ev.key.toLowerCase() === 'v') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('paste'); return; }
    if (mod && ev.key.toLowerCase() === 'd') { ev.preventDefault(); ev.stopPropagation(); invokeVerb('duplicate'); return; }
  }
  /** Escape dispatch: the pure ufEscAction decides which layer of state to peel back */
  function handleEscapeKey(ev: KeyboardEvent, target: HTMLElement, inAnyField: boolean): void {
    // a rename in flight or a frontmatter field owns its own Escape; the search box keeps the old chain
    if (target.isContentEditable || (inAnyField && target.id !== 'ufSearch')) return;
    ev.stopPropagation();
    const act = ufEscAction({
      connect: !!E.connectFrom,
      focusType: !!E.spec.focusType, selWire: !!E.spec.selWire, stage: !!E.spec.stage,
      sel: !!E.spec.sel, query: !!E.spec.query,
    });
    if (act === 'cancelConnect') { cancelConnect(); }
    else if (act === 'clearTypeFocus') { E.typeFocus(null); }
    else if (act === 'deselectWire') { E.commit({ type: 'selectWire', a: E.spec.selWire!.a, b: E.spec.selWire!.b }); }
    else if (act === 'exitStage') { E.setSel(null); E.stageMode(null); E.renderInspector(); setTimeout(E.drawWires, 0); }
    else if (act === 'selectGroup') { E.selectGroup(E.spec.sel!); }
    else if (act === 'clearQuery') { (E.q('ufSearch') as HTMLInputElement).value = ''; E.commit({ type: 'setQuery', q: '' }); }
    // 'none': nothing to clear — Escape never exits unfold
  }
  document.addEventListener('keydown', (e) => {
    if (!E.overlay.classList.contains('show')) return;
    // the planner overlay (panel/planner.ts) stacks above unfold and owns its own
    // Escape/verb shortcuts; unfold must stay silent underneath it (W1)
    if (E.ctx.runtime.plannerVisible) return;
    const targetEl = e.target as HTMLElement;
    const inAnyField = targetEl.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(targetEl.tagName);
    if (e.key === 'Enter') { handleEnterKey(e, inAnyField); return; }
    if (!inAnyField) handleVerbShortcut(e);
    if (e.key !== 'Escape') return;
    handleEscapeKey(e, targetEl, inAnyField);
  }, true);

  E.renameInPlace = renameInPlace;
  E.mountFrontmatter = mountFrontmatter;
  E.completeConnect = completeConnect;
  E.invokeVerb = invokeVerb;
  E.buildActionsMenu = buildActionsMenu;
  E.closeActionsMenu = closeActionsMenu;
}
