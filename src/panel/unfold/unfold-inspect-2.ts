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

/* ================= TREE ================= */
function treeRowClass(env: UEnv, node: UNode, canOpen: boolean): string {
  const shown = env.isRendered(node.id) && !env.spec.hidden.includes(node.id);
  const isOpen = env.spec.expanded.includes(node.id);
  return 'uf-trow '
    + (canOpen ? '' : 'leaf ')
    + (shown ? 'on ' : '')
    + (isOpen ? 'open ' : '')
    + (env.spec.sel === node.id ? 'sel ' : '')
    + (env.spec.sel2 === node.id ? 'sel2' : '');
}
function treeRowHtml(node: UNode, canOpen: boolean): string {
  const twist = canOpen ? '<svg viewBox="0 0 10 10"><path d="M3 1l4 4-4 4"/></svg>' : '';
  return `<span class="uf-ttw">${twist}</span>
      <span class="uf-tlabel">${esc(node.label)}</span>
      <span class="uf-tgo" title="Go to on canvas"><svg viewBox="0 0 16 16"><path d="M6 3l5 5-5 5"/></svg></span>
      <span class="uf-tchk" title="Show / hide on canvas"></span>`;
}
function wireTreeTwist(env: UEnv, row: HTMLElement, node: UNode, canOpen: boolean): void {
  (row.querySelector('.uf-ttw') as HTMLElement).onclick = (evt) => {
    evt.stopPropagation();
    if (!canOpen) return;
    env.apply({ type: 'reveal', id: node.id });
    env.commit({ type: 'toggleExpand', id: node.id });
  };
}
function wireTreeCheck(env: UEnv, row: HTMLElement, node: UNode): void {
  (row.querySelector('.uf-tchk') as HTMLElement).onclick = (evt) => {
    evt.stopPropagation();
    const shown = env.isRendered(node.id) && !env.spec.hidden.includes(node.id);
    env.commit({ type: shown ? 'hide' : 'reveal', id: node.id });
  };
}
function wireTreeLabelAndGo(env: UEnv, row: HTMLElement, node: UNode): void {
  (row.querySelector('.uf-tlabel') as HTMLElement).onclick = (evt) => {
    evt.stopPropagation();
    env.commit({ type: 'selectPeek', id: node.id });   // C6: single-click = secondary highlight, no camera
  };
  (row.querySelector('.uf-tgo') as HTMLElement).onclick = (evt) => {
    evt.stopPropagation();
    env.goTo(node.id);   // C6: the go-arrow travels — reveal + primary-select + reframe
  };
}
function wireTreeRow(env: UEnv, row: HTMLElement, node: UNode, canOpen: boolean): void {
  wireTreeTwist(env, row, node, canOpen);
  wireTreeCheck(env, row, node);
  wireTreeLabelAndGo(env, row, node);
}
function appendTreeKids(env: UEnv, wrap: HTMLElement, node: UNode, isOpen: boolean): void {
  const kids = env.h('div', 'uf-tkids' + (isOpen ? ' open' : ''));
  for (const childId of node.children) kids.appendChild(treeRow(env, childId));
  wrap.appendChild(kids);
}
function treeRow(env: UEnv, id: string): HTMLElement {
  const node = env.gu(id);
  const canOpen = env.isContainer(node);
  const isOpen = env.spec.expanded.includes(id);
  const wrap = env.h('div');
  const row = env.h('div', treeRowClass(env, node, canOpen));
  row.dataset.id = id;
  row.innerHTML = treeRowHtml(node, canOpen);
  wireTreeRow(env, row, node, canOpen);
  wrap.appendChild(row);
  if (canOpen) appendTreeKids(env, wrap, node, isOpen);
  return wrap;
}
function collectQueryHits(env: UEnv, query: string): Set<string> {
  const hits = new Set<string>();
  for (const node of env.U.values()) {
    if (!node.label.toLowerCase().includes(query) && !node.desc.toLowerCase().includes(query)) continue;
    let cur: UNode | undefined = node;
    const seen = new Set<string>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      hits.add(cur.id);
      cur = cur.parent ? env.U.get(cur.parent) : undefined;
    }
  }
  return hits;
}
function applyTreeFilterRow(row: HTMLElement, hits: Set<string>): void {
  const id = row.dataset.id as string;
  const kidsEl = row.parentElement?.querySelector(':scope > .uf-tkids') as HTMLElement | null;
  if (kidsEl) {
    const show = hits.has(id);
    kidsEl.classList.toggle('open', show);
    row.classList.toggle('open', show);
  }
  row.style.display = hits.size ? (hits.has(id) ? '' : 'none') : '';
}
function filterTree(env: UEnv): void {
  const hits = collectQueryHits(env, env.spec.query);
  env.q('ufTree').querySelectorAll<HTMLElement>('.uf-trow').forEach((row) => applyTreeFilterRow(row, hits));
}
function renderTreeImpl(env: UEnv): void {
  const treeEl = env.q('ufTree');
  treeEl.innerHTML = '';
  for (const rootId of env.ROOTS) treeEl.appendChild(treeRow(env, rootId));
  if (env.spec.query) filterTree(env);
}

/* ================= DOCK (P-panel) =================
   The chrome state (tab · collapsed · width) advances ONLY through the
   pure ufDockReduce; this block is a dumb painter of it. Persisted under
   'unfold.dock' — a GLOBAL chrome preference, deliberately not the
   per-diagram ViewSpec (which owns what you look at, not how the panel
   is arranged). */
const DOCK_TABS = ['reveal', 'io', 'mermaid', 'slice', 'style'];
const DOCK_KEY = 'unfold.dock';

// this app builds exactly one UEnv (main.ts → initUnfold, a singleton composition
// root), so this module-scope dock state has the same lifetime the old per-call
// closure local did
let dock: DockState = { tab: DOCK_TABS[0], collapsed: false, width: UF_DOCK_WIDTH };
// queried once in initUnfoldDock and reused — same singleton-lifetime reasoning as `dock`
let dockBodies: Record<string, HTMLElement>;

function readDockStorage(): unknown {
  try {
    return JSON.parse(localStorage.getItem(DOCK_KEY) ?? 'null');
  } catch {
    return null;
  }
}
function dockBodyElements(env: UEnv): Record<string, HTMLElement> {
  return {
    reveal: env.q('ufBodyReveal'),
    'io': env.q('ufBodyIo'),
    mermaid: env.q('ufBodyMmd'),
    slice: env.q('ufBodySlice'),
    style: env.q('ufBodyStyle'),
  };
}
function applyDockChrome(env: UEnv): void {
  const panelEl = env.q('ufPanel'), railEl = env.q('ufRail');
  panelEl.style.width = dock.width + 'px';
  panelEl.hidden = dock.collapsed;
  railEl.hidden = !dock.collapsed;
  env.overlay.querySelectorAll('.uf-tab').forEach((tabBtn) =>
    tabBtn.classList.toggle('on', (tabBtn as HTMLElement).dataset.tab === dock.tab));
  for (const tab of DOCK_TABS) dockBodies[tab].hidden = tab !== dock.tab;
}
/** whole-model change from the io/mermaid tabs (or the planner closing having
    rewritten ctx.state, W1): rebuild the universe and repaint. No-op while
    hidden — nothing on screen needs refreshing, and open() rebuilds anyway. */
function refreshFromModelImpl(env: UEnv): void {
  if (!env.overlay.classList.contains('show')) return;
  env.build();
  env.persistView('load');
  env.render(true);
  applyDock(env, false); // the mermaid textarea re-reads the (re)serialised model
}
function applyDock(env: UEnv, reframe: boolean): void {
  applyDockChrome(env);
  if (dock.tab === 'mermaid' && !dock.collapsed) {
    (env.q('ufMmdText') as HTMLTextAreaElement).value = env.deps.mermaid.toMermaid();
  }
  if (dock.tab === 'slice' && !dock.collapsed) renderSliceTabImpl(env);
  env.q('ufBodiesInfo').textContent = env.ctx.bodies ? `${env.ctx.bodies.size} bodies loaded` : 'no bodies loaded';
  // a dock resize/load changes the STAGE, not the visible set — always refit,
  // regardless of whatever view action last drove a render()
  if (reframe && env.overlay.classList.contains('show')) {
    env.repaintAction = 'reveal';
    env.reframeToFit();
    setTimeout(env.drawWires, 0);
  }
}
function dockCommitImpl(env: UEnv, action: DockAction, reframe = true): void {
  const next = ufDockReduce(dock, action, DOCK_TABS);
  if (next === dock) return;
  dock = next;
  try {
    localStorage.setItem(DOCK_KEY, JSON.stringify(dock));
  } catch { /* storage unavailable */ }
  applyDock(env, reframe);
}
function wireDockTabs(env: UEnv): void {
  env.q('ufTabs').addEventListener('click', (evt) => {
    const tabBtn = (evt.target as HTMLElement).closest('.uf-tab') as HTMLElement | null;
    if (tabBtn?.dataset.tab) dockCommitImpl(env, { type: 'setTab', tab: tabBtn.dataset.tab });
  });
  env.q('ufPcol').onclick = () => dockCommitImpl(env, { type: 'toggleCollapse' });
  env.q('ufPexp').onclick = () => dockCommitImpl(env, { type: 'toggleCollapse' });
}
// left-border drag: width = distance from the pointer to the overlay's right edge;
// one reframe at drag end, not per pixel
function wireDockResize(env: UEnv): void {
  env.q('ufRsz').onpointerdown = (downEvt) => {
    downEvt.preventDefault();
    const rsz = env.q('ufRsz');
    rsz.classList.add('on');
    try {
      rsz.setPointerCapture(downEvt.pointerId);
    } catch { /* synthetic pointer */ }
    const move = (evt: PointerEvent) =>
      dockCommitImpl(env, { type: 'resize', width: env.overlay.getBoundingClientRect().right - evt.clientX }, false);
    const onUp = () => {
      rsz.classList.remove('on');
      rsz.removeEventListener('pointermove', move);
      rsz.removeEventListener('pointerup', onUp);
      applyDock(env, true);
    };
    rsz.addEventListener('pointermove', move);
    rsz.addEventListener('pointerup', onUp);
  };
}
// io tab: the files module's verbs — one code path shared with the legacy inputs
function wireDockIoTab(env: UEnv): void {
  env.q('ufSaveMmd').onclick = () => env.deps.files.saveMmd();
  env.q('ufLoadMmd').onclick = () => (env.q('ufLoadMmdFile') as HTMLInputElement).click();
  (env.q('ufLoadMmdFile') as HTMLInputElement).onchange = (evt) => {
    const file = (evt.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      env.deps.files.loadMmdText(reader.result as string);
      refreshFromModelImpl(env);
    };
    reader.readAsText(file);
    (evt.target as HTMLInputElement).value = '';
  };
  env.q('ufReviewPlan').onclick = () => env.ctx.hooks.plannerOpen();
  wireDockBodiesLoad(env);
}
function wireDockBodiesLoad(env: UEnv): void {
  env.q('ufLoadBodies').onclick = () => (env.q('ufLoadBodiesFile') as HTMLInputElement).click();
  (env.q('ufLoadBodiesFile') as HTMLInputElement).onchange = (evt) => {
    const file = (evt.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        env.deps.files.loadBodies(JSON.parse(reader.result as string));
      } catch {
        env.ctx.hooks.toast('Could not parse bodies.json');
      }
      applyDock(env, false);   // refresh the bodies count line
      env.renderInspector();  // the source pane may now fill
    };
    reader.readAsText(file);
    (evt.target as HTMLInputElement).value = '';
  };
}
// mermaid tab: the mermaid module stays the only parse/apply path
function wireDockMermaidTab(env: UEnv): void {
  env.q('ufMmdApply').onclick = () => {
    env.ctx.dom.mmd.value = (env.q('ufMmdText') as HTMLTextAreaElement).value;
    env.deps.mermaid.applyText();
    refreshFromModelImpl(env);
  };
  env.q('ufMmdCopy').onclick = () => {
    navigator.clipboard?.writeText((env.q('ufMmdText') as HTMLTextAreaElement).value)
      .then(() => env.ctx.hooks.toast('Copied'))
      .catch(() => env.ctx.hooks.toast('Copy failed'));
  };
}
// slice tab: one serialisation path (SliceApi.sliceFor) fed by the pure
// ufSliceTargets mapping of unfold's own selection shape — refreshed on
// selection commit (paint()) and on tab activation (applyDock), never
// per-keystroke since there is none here.
function sliceBodyParts(env: UEnv, ids: string[]): string[] {
  const bodies = env.ctx.bodies;
  if (!bodies) return [];
  return ids
    .map((id) => ({ id, body: (bodies.get(id) as { body?: string } | undefined)?.body }))
    .filter((entry) => entry.body)
    .map((entry) => `// ${entry.id}\n${entry.body}`);
}
function renderSliceTabImpl(env: UEnv): void {
  const wire = env.spec.selWire ? { 'a': env.spec.selWire.a, 'b': env.spec.selWire.b } : null;
  const roots = ufSliceTargets(env.spec.sel, wire);
  const result = env.deps.slice.sliceFor(roots);
  (env.q('ufSliceText') as HTMLTextAreaElement).value = result.text;
  env.q('ufSliceInfo').textContent = result.info;
  const parts = sliceBodyParts(env, result.ids);
  const bodiesText = parts.length ? parts.join('\n\n') : (env.ctx.bodies ? '' : 'no bodies loaded');
  (env.q('ufSliceBodies') as HTMLTextAreaElement).value = bodiesText;
  env.q('ufSliceBodiesInfo').textContent = `Body slice · ${parts.length} node${parts.length !== 1 ? 's' : ''}`;
}
function wireDockSliceTab(env: UEnv): void {
  env.q('ufSliceCopy').onclick = () => {
    const mmd = (env.q('ufSliceText') as HTMLTextAreaElement).value;
    const src = (env.q('ufSliceBodies') as HTMLTextAreaElement).value;
    navigator.clipboard?.writeText(src ? `${mmd}\n\n${src}` : mmd)   // copy mmd slice + body slice together
      .then(() => env.ctx.hooks.toast('Copied'))
      .catch(() => env.ctx.hooks.toast('Copy failed'));
  };
}
// style tab: appearance only — light/dark drives the same applyDark path as
// the ufTheme floating-toolbar button; font drives theming.applyFont (the
// single FONTS source), initialised from ctx.prefs.font
function wireDockStyleTab(env: UEnv): void {
  env.q('ufStyleDark').addEventListener('click', () => env.applyDark(!env.overlay.classList.contains('dark')));
  const fontSel = env.q('ufFontSel') as HTMLSelectElement;
  fontSel.innerHTML = FONT_ORDER.map((k) => `<option value="${k}">${FONTS[k].name}</option>`).join('');
  fontSel.value = env.ctx.prefs.font;
  fontSel.onchange = () => env.deps.theming.applyFont(fontSel.value);
}
function wireDockApi(env: UEnv): void {
  env.applyDock = (reframe: boolean) => applyDock(env, reframe);
  env.dockCommit = (action: DockAction, reframe?: boolean) => dockCommitImpl(env, action, reframe);
  env.refreshFromModel = () => refreshFromModelImpl(env);
  env.renderSliceTab = () => renderSliceTabImpl(env);
}
function initUnfoldDock(env: UEnv): void {
  dockBodies = dockBodyElements(env);
  dock = ufDockReduce(
    { tab: DOCK_TABS[0], collapsed: false, width: UF_DOCK_WIDTH },
    { type: 'load', raw: readDockStorage() }, DOCK_TABS);
  wireDockTabs(env);
  wireDockResize(env);
  wireDockIoTab(env);
  wireDockMermaidTab(env);
  wireDockSliceTab(env);
  wireDockStyleTab(env);
  applyDock(env, false);
  wireDockApi(env);
}

export function initUnfoldInspect2(env: UEnv): void {
  env.renderTree = () => renderTreeImpl(env);
  initUnfoldDock(env);
}
