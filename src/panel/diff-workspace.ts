/* =====================================================================
   diff-workspace.ts — full-screen diff overlay
   ---------------------------------------------------------------------
   Responsibility: open a full-screen workspace that compares the current
   diagram (snapshot at open) against a pasted proposal .mmd. Parses both
   with fromMermaid, diffs with diffModels, renders one of four views over
   the single MmdDiff. Apply = replace live model via the proposal text
   through the existing mermaid apply path.

   Reads:  ctx.state via mermaid.toMermaid() for the "before" snapshot.
   Writes: nothing until Apply (which goes through mermaid.applyText path).
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import type { MermaidApi } from '../io/mermaid';
import { fromMermaid } from '../io/mermaid';
import { diffModels, type MmdDiff } from '../core/diff/diff';
import { renderList } from './diff-views/list';
import { renderSplit } from './diff-views/split';
import { renderImpact } from './diff-views/impact';
import { renderOverlay } from './diff-views/overlay';

type ViewId = 'list' | 'split' | 'impact' | 'overlay';

export interface DiffWorkspaceApi {
  open: () => void;
  close: () => void;
}

export function initDiffWorkspace(ctx: AppContext, deps: { mermaid: MermaidApi }): DiffWorkspaceApi {
  const $ = (id: string) => document.getElementById(id) as HTMLElement;
  const overlay = document.getElementById('diffOverlay');
  if (!overlay) return { open: () => {}, close: () => {} };

  const taBefore = $('diffBefore') as HTMLTextAreaElement;
  const taAfter = $('diffAfter') as HTMLTextAreaElement;
  const beforeMeta = $('diffBeforeMeta');
  const counts = $('diffCounts');
  const body = $('diffBody');

  let view: ViewId = 'list';
  let diff: MmdDiff | null = null;
  let beforeModel: ReturnType<typeof fromMermaid> | null = null;
  let afterModel: ReturnType<typeof fromMermaid> | null = null;

  /* ---- open: snapshot current diagram into "before" ---- */
  function open(): void {
    // Snapshot via re-parse path: serialize current model, that string IS the
    // frozen before. Re-parsing both sides identically = no false diffs.
    const snap = deps.mermaid.toMermaid();
    taBefore.value = snap;
    const n = Object.keys(ctx.state.nodes).length;
    const e = ctx.state.edges.length;
    beforeMeta.textContent = `· ${n} node${n !== 1 ? 's' : ''} · ${e} edge${e !== 1 ? 's' : ''}`;
    diff = null; beforeModel = null; afterModel = null;
    counts.innerHTML = '';
    body.innerHTML = '<div class="diff-hint">Paste a proposal above and click Compare.</div>';
    overlay!.classList.add('show');
    taAfter.focus();
  }

  function close(): void { overlay!.classList.remove('show'); }

  /* ---- compare: parse both, diff, render ---- */
  function compare(): void {
    let before, after;
    try { before = fromMermaid(taBefore.value); }
    catch (err) { return showError('before', err); }
    try { after = fromMermaid(taAfter.value); }
    catch (err) { return showError('after', err); }

    if (!taAfter.value.trim()) {
      body.innerHTML = '<div class="diff-empty">Paste a proposal in the “after” box first.</div>';
      counts.innerHTML = '';
      return;
    }

    beforeModel = before; afterModel = after;
    diff = diffModels(before, after);
    renderCounts(diff);
    renderActiveView();
  }

  function showError(side: string, err: unknown): void {
    const msg = err instanceof Error ? err.message : String(err);
    body.innerHTML = `<div class="diff-err">Parse error in “${side}” .mmd:\n${msg}</div>`;
    counts.innerHTML = '';
    diff = null;
  }

  function renderCounts(d: MmdDiff): void {
    const c = d.counts;
    const total = c.nAdd + c.nRem + c.nChg + c.eAdd + c.eRem;
    if (total === 0) {
      counts.innerHTML = '<span class="diff-badge zero">identical · no changes</span>';
      return;
    }
    const b = (cls: string, txt: string, n: number) => n ? `<span class="diff-badge ${cls}">${txt}</span>` : '';
    counts.innerHTML =
      b('add', `+${c.nAdd} nodes`, c.nAdd) +
      b('rem', `−${c.nRem} nodes`, c.nRem) +
      b('chg', `~${c.nChg} changed`, c.nChg) +
      b('add', `+${c.eAdd} edges`, c.eAdd) +
      b('rem', `−${c.eRem} edges`, c.eRem);
  }

  function renderActiveView(): void {
    if (!diff || !beforeModel || !afterModel) return;
    const arg = { diff, before: beforeModel, after: afterModel,
      beforeText: taBefore.value, afterText: taAfter.value };
    if (view === 'list') renderList(body, arg);
    else if (view === 'split') renderSplit(body, arg);
    else if (view === 'impact') renderImpact(body, arg);
    else if (view === 'overlay') renderOverlay(body, arg);
  }

  /* ---- apply: replace live model with the proposal (explicit confirm) ---- */
  function apply(): void {
    closeMenu();
    if (!taAfter.value.trim()) { ctx.hooks.toast('Nothing to apply'); return; }
    const c = diff?.counts;
    const summary = c
      ? `+${c.nAdd}/−${c.nRem} nodes, ~${c.nChg} changed, +${c.eAdd}/−${c.eRem} edges`
      : 'unreviewed changes';
    if (!confirm(`Overwrite the current diagram with this proposal?\n\n${summary}\n\nThis replaces what's on the canvas. You can undo (Ctrl/⌘+Z) after.`)) return;
    // route through the canonical apply path: write proposal into the mmd
    // textarea, then trigger applyText (the same path the Mermaid tab uses).
    ctx.dom.mmd.value = taAfter.value;
    deps.mermaid.applyText();
    close();
    ctx.hooks.toast('Proposal applied');
  }

  /* ---- actions menu ---- */
  const menu = $('diffMenu');
  function closeMenu(): void { menu.hidden = true; }
  $('diffMenuBtn').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; };
  document.addEventListener('click', () => { if (!menu.hidden) closeMenu(); });

  /* ---- resize handle: drag the input row taller/shorter ---- */
  (() => {
    const handle = $('diffResize');
    const inputs = $('diffInputs');
    if (!handle || !inputs) return;
    let dragging = false, startY = 0, startH = 0;
    const onMove = (ev: PointerEvent) => {
      if (!dragging) return;
      const h = Math.max(70, Math.min(window.innerHeight * 0.7, startH + (ev.clientY - startY)));
      inputs.style.height = h + 'px';
      inputs.style.maxHeight = 'none';
    };
    const onUp = () => {
      dragging = false; handle.classList.remove('dragging');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      dragging = true; startY = ev.clientY; startH = inputs.getBoundingClientRect().height;
      handle.classList.add('dragging');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  })();

  /* ---- wire DOM ---- */
  $('diffClose').onclick = close;
  $('diffCompare').onclick = compare;
  $('diffApply').onclick = apply;
  $('diffPaste').onclick = async () => {
    try { taAfter.value = await navigator.clipboard.readText(); compare(); }
    catch { ctx.hooks.toast('Clipboard read blocked — paste manually'); }
  };
  document.querySelectorAll<HTMLElement>('#diffTabs .diff-tab').forEach((btn) => {
    btn.onclick = () => {
      view = btn.dataset.view as ViewId;
      document.querySelectorAll('#diffTabs .diff-tab').forEach((b) => b.classList.toggle('active', b === btn));
      renderActiveView();
    };
  });
  overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  return { open, close };
}
