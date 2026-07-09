/* =====================================================================
   tabs.ts — panel tabs, collapse toggle, and toast
   ---------------------------------------------------------------------
   Responsibility: switch the right panel between inspector/style/mermaid
   panes, collapse/expand the panel, and show transient toast messages.
   Small UI plumbing with no model knowledge.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';

export interface TabsApi {
  showTab: (which: 'insp' | 'style' | 'mmd' | 'source' | 'nav' | 'slice') => void;
  togglePanel: () => void;
  toast: (msg: string) => void;
}

type TabName = 'insp' | 'style' | 'mmd' | 'source' | 'nav' | 'slice';

interface TabDef {
  name: TabName;
  tabId: string;
  paneId: string;
  display: 'block' | 'flex';
}

const TAB_DEFS: TabDef[] = [
  { name: 'mmd', tabId: 'tabMmd', paneId: 'paneMmd', display: 'block' },
  { name: 'style', tabId: 'tabStyle', paneId: 'paneStyle', display: 'flex' },
  { name: 'insp', tabId: 'tabInsp', paneId: 'paneInsp', display: 'flex' },
  { name: 'source', tabId: 'tabSource', paneId: 'paneSource', display: 'flex' },
  { name: 'nav', tabId: 'tabNav', paneId: 'paneNav', display: 'flex' },
  { name: 'slice', tabId: 'tabSlice', paneId: 'paneSlice', display: 'flex' },
];

interface TabsState {
  panelOpen: boolean;
  toastTimer: number | null;
  main: HTMLElement;
  ctx: AppContext;
}

function byId(id: string): HTMLElement {
  return document.getElementById(id) as HTMLElement;
}

function runTabSideEffect(which: TabName, ctx: AppContext): void {
  if (which === 'mmd') ctx.hooks.sync();
  if (which === 'source') ctx.hooks.renderInspector();
  if (which === 'nav') ctx.hooks.renderNavigator();
  if (which === 'slice') ctx.hooks.renderSlice();
}

function showTabImpl(state: TabsState, which: TabName): void {
  for (const def of TAB_DEFS) {
    const active = def.name === which;
    byId(def.tabId).classList.toggle('active', active);
    byId(def.paneId).style.display = active ? def.display : 'none';
  }
  byId('footMmd').style.display = which === 'mmd' ? 'flex' : 'none';
  byId('footInsp').style.display = which === 'insp' || which === 'source' ? 'flex' : 'none';
  runTabSideEffect(which, state.ctx);
}

function togglePanelImpl(state: TabsState): void {
  state.panelOpen = !state.panelOpen;
  state.main.classList.toggle('collapsed', !state.panelOpen);
  byId('panelBtn').classList.toggle('active', !state.panelOpen);
}

function toastImpl(state: TabsState, msg: string): void {
  const el = byId('toast');
  el.textContent = msg;
  el.classList.add('show');
  if (state.toastTimer !== null) clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => el.classList.remove('show'), 1400);
}

const PANEL_MIN_W = 280;
const PANEL_MAX_W = 900;

function restorePanelWidth(): void {
  // ponytail: legacy-key fallback
  const saved = Number(
    localStorage.getItem('novakai.panelW') ?? localStorage.getItem('flowmap.panelW'),
  );
  if (saved >= PANEL_MIN_W && saved <= PANEL_MAX_W) {
    document.documentElement.style.setProperty('--panel-w', saved + 'px');
  }
}

function persistPanelWidth(): void {
  const cur = getComputedStyle(document.documentElement).getPropertyValue('--panel-w').trim();
  const pixels = parseInt(cur, 10);
  if (pixels) localStorage.setItem('novakai.panelW', String(pixels));
}

interface DragState {
  dragging: boolean;
  handle: HTMLElement;
  ctx: AppContext;
}

function onPanelMove(state: DragState, e: PointerEvent): void {
  if (!state.dragging) return;
  // panel hugs the right edge; width = distance from cursor to viewport right
  const width = Math.min(PANEL_MAX_W, Math.max(PANEL_MIN_W, window.innerWidth - e.clientX));
  document.documentElement.style.setProperty('--panel-w', width + 'px');
}

function onPanelUp(state: DragState, move: (e: PointerEvent) => void, release: () => void): void {
  if (!state.dragging) return;
  state.dragging = false;
  state.handle.classList.remove('dragging');
  persistPanelWidth();
  window.removeEventListener('pointermove', move);
  window.removeEventListener('pointerup', release);
  state.ctx.hooks.render(); // re-fit minimap / wires to the new canvas width
}

// panel resize: drag the left-edge handle to set --panel-w (clamped).
// persisted to localStorage so width survives reloads.
function setupPanelResize(ctx: AppContext): void {
  const handle = document.getElementById('panelResize');
  if (!handle) return;
  restorePanelWidth();

  const state: DragState = { dragging: false, handle, ctx };
  const move = (e: PointerEvent): void => onPanelMove(state, e);
  const release = (): void => onPanelUp(state, move, release);
  handle.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    state.dragging = true;
    handle.classList.add('dragging');
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', release);
  });
}

export function initTabs(ctx: AppContext): TabsApi {
  const state: TabsState = { panelOpen: true, toastTimer: null, main: ctx.dom.main, ctx };

  const showTab = (which: TabName): void => showTabImpl(state, which);
  const togglePanel = (): void => togglePanelImpl(state);
  const toast = (msg: string): void => toastImpl(state, msg);

  for (const def of TAB_DEFS) {
    byId(def.tabId).onclick = () => showTab(def.name);
  }
  byId('panelBtn').onclick = togglePanel;

  setupPanelResize(ctx);

  return { showTab, togglePanel, toast };
}
