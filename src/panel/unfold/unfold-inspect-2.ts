/* =====================================================================
   unfold-inspect-2.ts — reading mode: the browse tree + the P-panel dock
   chrome (tabs/resize/collapse/io/mermaid/slice/style) that hosts the
   tree and the inspector — overflow split out of unfold-inspect.ts
   (alone exceeded 400 lines) and out of unfold-view.ts (same reason).
   Every symbol here used to be a closure over initUnfold's locals; those
   locals now live on the shared `E: UEnv` object unfold.ts constructs
   and passes to every sibling factory.
   ===================================================================== */

import { esc, FONT_ORDER, FONTS } from '../../core/config/config';
import { ufDockReduce, UF_DOCK_WIDTH } from './unfold-dock';
import type { DockState, DockAction } from './unfold-dock';
import { ufSliceTargets } from './unfold-slice';
import type { UEnv, UNode } from './unfold';

export function initUnfoldInspect2(E: UEnv): void {
  /* ================= TREE ================= */
  function renderTree(): void {
    const treeEl = E.q('ufTree');
    treeEl.innerHTML = '';
    for (const rid of E.ROOTS) treeEl.appendChild(treeRow(rid));
    if (E.spec.query) filterTree();
  }
  function treeRow(id: string): HTMLElement {
    const u = E.gu(id), wrap = E.h('div');
    const canOpen = E.isContainer(u), on = E.isRendered(id) && !E.spec.hidden.includes(id), isOpen = E.spec.expanded.includes(id);
    const row = E.h('div', 'uf-trow ' + (canOpen ? '' : 'leaf ') + (on ? 'on ' : '') + (isOpen ? 'open ' : '') + (E.spec.sel === id ? 'sel ' : '') + (E.spec.sel2 === id ? 'sel2' : ''));
    row.dataset.id = id;
    row.innerHTML = `<span class="uf-ttw">${canOpen ? '<svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg>' : ''}</span>
      <span class="uf-tlabel">${esc(u.label)}</span>
      <span class="uf-tgo" title="Go to on canvas"><svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg></span>
      <span class="uf-tchk" title="Show / hide on canvas"></span>`;
    (row.querySelector('.uf-ttw') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      if (!canOpen) return;
      E.apply({ type: 'reveal', id });
      E.commit({ type: 'toggleExpand', id });
    };
    (row.querySelector('.uf-tchk') as HTMLElement).onclick = (e) => {
      e.stopPropagation();
      E.commit({ type: E.isRendered(id) && !E.spec.hidden.includes(id) ? 'hide' : 'reveal', id });
    };
    (row.querySelector('.uf-tlabel') as HTMLElement).onclick = (e) => {
      e.stopPropagation(); E.commit({ type: 'selectPeek', id });   // C6: single-click = secondary highlight, no camera
    };
    (row.querySelector('.uf-tgo') as HTMLElement).onclick = (e) => {
      e.stopPropagation(); E.goTo(id);   // C6: the go-arrow travels — reveal + primary-select + reframe
    };
    wrap.appendChild(row);
    if (canOpen) {
      const kids = E.h('div', 'uf-tkids' + (isOpen ? ' open' : ''));
      for (const c of u.children) kids.appendChild(treeRow(c));
      wrap.appendChild(kids);
    }
    return wrap;
  }
  function filterTree(): void {
    const hits = new Set<string>();
    for (const node of E.U.values()) {
      if (node.label.toLowerCase().includes(E.spec.query) || node.desc.toLowerCase().includes(E.spec.query)) {
        let x: UNode | undefined = node;
        const seen = new Set<string>();
        while (x && !seen.has(x.id)) { seen.add(x.id); hits.add(x.id); x = x.parent ? E.U.get(x.parent) : undefined; }
      }
    }
    E.q('ufTree').querySelectorAll<HTMLElement>('.uf-trow').forEach((r) => {
      const id = r.dataset.id as string;
      const kb = r.parentElement?.querySelector(':scope > .uf-tkids') as HTMLElement | null;
      if (kb) { const show = hits.has(id); kb.classList.toggle('open', show); r.classList.toggle('open', show); }
      r.style.display = hits.size ? (hits.has(id) ? '' : 'none') : '';
    });
  }

  E.renderTree = renderTree;

  initUnfoldDock(E);
}

/* ================= DOCK (P-panel) =================
   The chrome state (tab · collapsed · width) advances ONLY through the
   pure ufDockReduce; this block is a dumb painter of it. Persisted under
   'unfold.dock' — a GLOBAL chrome preference, deliberately not the
   per-diagram ViewSpec (which owns what you look at, not how the panel
   is arranged). */
function initUnfoldDock(E: UEnv): void {
  const DOCK_TABS = ['reveal', 'io', 'mermaid', 'slice', 'style'];
  const DOCK_KEY = 'unfold.dock';
  const panelEl = E.q('ufPanel'), railEl = E.q('ufRail');
  const dockBodies: Record<string, HTMLElement> = {
    reveal: E.q('ufBodyReveal'), io: E.q('ufBodyIo'), mermaid: E.q('ufBodyMmd'),
    slice: E.q('ufBodySlice'), style: E.q('ufBodyStyle'),
  };
  const readDock = (): unknown => {
    try { return JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null'); } catch { return null; }
  };
  let dock: DockState = ufDockReduce(
    { tab: DOCK_TABS[0], collapsed: false, width: UF_DOCK_WIDTH },
    { type: 'load', raw: readDock() }, DOCK_TABS);

  function applyDock(reframe: boolean): void {
    panelEl.style.width = dock.width + 'px';
    panelEl.hidden = dock.collapsed;
    railEl.hidden = !dock.collapsed;
    E.overlay.querySelectorAll('.uf-tab').forEach((tabBtn) =>
      tabBtn.classList.toggle('on', (tabBtn as HTMLElement).dataset.tab === dock.tab));
    for (const tab of DOCK_TABS) dockBodies[tab].hidden = tab !== dock.tab;
    if (dock.tab === 'mermaid' && !dock.collapsed) {
      (E.q('ufMmdText') as HTMLTextAreaElement).value = E.deps.mermaid.toMermaid();
    }
    if (dock.tab === 'slice' && !dock.collapsed) renderSliceTab();
    E.q('ufBodiesInfo').textContent = E.ctx.bodies ? `${E.ctx.bodies.size} bodies loaded` : 'no bodies loaded';
    // a dock resize/load changes the STAGE, not the visible set — always refit,
    // regardless of whatever view action last drove a render()
    if (reframe && E.overlay.classList.contains('show')) { E.repaintAction = 'reveal'; E.reframeToFit(); setTimeout(E.drawWires, 0); }
  }
  function dockCommit(a: DockAction, reframe = true): void {
    const next = ufDockReduce(dock, a, DOCK_TABS);
    if (next === dock) return;
    dock = next;
    try { localStorage.setItem(DOCK_KEY, JSON.stringify(dock)); } catch { /* storage unavailable */ }
    applyDock(reframe);
  }
  /** whole-model change from the io/mermaid tabs (or the planner closing having
      rewritten ctx.state, W1): rebuild the universe and repaint. No-op while
      hidden — nothing on screen needs refreshing, and open() rebuilds anyway. */
  function refreshFromModel(): void {
    if (!E.overlay.classList.contains('show')) return;
    E.build();
    E.persistView('load');
    E.render(true);
    applyDock(false); // the mermaid textarea re-reads the (re)serialised model
  }
  E.q('ufTabs').addEventListener('click', (ev) => {
    const tabBtn = (ev.target as HTMLElement).closest('.uf-tab') as HTMLElement | null;
    if (tabBtn?.dataset.tab) dockCommit({ type: 'setTab', tab: tabBtn.dataset.tab });
  });
  E.q('ufPcol').onclick = () => dockCommit({ type: 'toggleCollapse' });
  E.q('ufPexp').onclick = () => dockCommit({ type: 'toggleCollapse' });
  // left-border drag: width = distance from the pointer to the overlay's right edge;
  // one reframe at drag end, not per pixel
  E.q('ufRsz').onpointerdown = (downEv) => {
    downEv.preventDefault();
    const rsz = E.q('ufRsz');
    rsz.classList.add('on');
    try { rsz.setPointerCapture(downEv.pointerId); } catch { /* synthetic pointer */ }
    const move = (ev: PointerEvent) =>
      dockCommit({ type: 'resize', width: E.overlay.getBoundingClientRect().right - ev.clientX }, false);
    const up = () => {
      rsz.classList.remove('on');
      rsz.removeEventListener('pointermove', move);
      rsz.removeEventListener('pointerup', up);
      applyDock(true);
    };
    rsz.addEventListener('pointermove', move);
    rsz.addEventListener('pointerup', up);
  };
  // io tab: the files module's verbs — one code path shared with the legacy inputs
  E.q('ufSaveMmd').onclick = () => E.deps.files.saveMmd();
  E.q('ufLoadMmd').onclick = () => (E.q('ufLoadMmdFile') as HTMLInputElement).click();
  (E.q('ufLoadMmdFile') as HTMLInputElement).onchange = (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => { E.deps.files.loadMmdText(rd.result as string); refreshFromModel(); };
    rd.readAsText(file);
    (ev.target as HTMLInputElement).value = '';
  };
  E.q('ufReviewPlan').onclick = () => E.ctx.hooks.plannerOpen();
  E.q('ufLoadBodies').onclick = () => (E.q('ufLoadBodiesFile') as HTMLInputElement).click();
  (E.q('ufLoadBodiesFile') as HTMLInputElement).onchange = (ev) => {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const rd = new FileReader();
    rd.onload = () => {
      try { E.deps.files.loadBodies(JSON.parse(rd.result as string)); }
      catch { E.ctx.hooks.toast('Could not parse bodies.json'); }
      applyDock(false);   // refresh the bodies count line
      E.renderInspector();  // the source pane may now fill
    };
    rd.readAsText(file);
    (ev.target as HTMLInputElement).value = '';
  };
  // mermaid tab: the mermaid module stays the only parse/apply path
  E.q('ufMmdApply').onclick = () => {
    E.ctx.dom.mmd.value = (E.q('ufMmdText') as HTMLTextAreaElement).value;
    E.deps.mermaid.applyText();
    refreshFromModel();
  };
  E.q('ufMmdCopy').onclick = () => {
    navigator.clipboard?.writeText((E.q('ufMmdText') as HTMLTextAreaElement).value)
      .then(() => E.ctx.hooks.toast('Copied'))
      .catch(() => E.ctx.hooks.toast('Copy failed'));
  };
  // slice tab: one serialisation path (SliceApi.sliceFor) fed by the pure
  // ufSliceTargets mapping of unfold's own selection shape — refreshed on
  // selection commit (paint()) and on tab activation (applyDock), never
  // per-keystroke since there is none here.
  function renderSliceTab(): void {
    const wire = E.spec.selWire ? { a: E.spec.selWire.a, b: E.spec.selWire.b } : null;
    const result = E.deps.slice.sliceFor(ufSliceTargets(E.spec.sel, wire));
    (E.q('ufSliceText') as HTMLTextAreaElement).value = result.text;
    E.q('ufSliceInfo').textContent = result.info;
  }
  E.q('ufSliceCopy').onclick = () => {
    navigator.clipboard?.writeText((E.q('ufSliceText') as HTMLTextAreaElement).value)
      .then(() => E.ctx.hooks.toast('Copied'))
      .catch(() => E.ctx.hooks.toast('Copy failed'));
  };
  // style tab: appearance only — light/dark drives the same applyDark path as
  // the ufTheme floating-toolbar button; font drives theming.applyFont (the
  // single FONTS source), initialised from ctx.prefs.font
  E.q('ufStyleDark').addEventListener('click', () => E.applyDark(!E.overlay.classList.contains('dark')));
  const fontSel = E.q('ufFontSel') as HTMLSelectElement;
  fontSel.innerHTML = FONT_ORDER.map((k) => `<option value="${k}">${FONTS[k].name}</option>`).join('');
  fontSel.value = E.ctx.prefs.font;
  fontSel.onchange = () => E.deps.theming.applyFont(fontSel.value);
  applyDock(false);

  E.applyDock = applyDock;
  E.dockCommit = dockCommit;
  E.refreshFromModel = refreshFromModel;
  E.renderSliceTab = renderSliceTab;
}
