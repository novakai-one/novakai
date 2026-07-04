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

export function initTabs(ctx: AppContext): TabsApi {
  const { main } = ctx.dom;
  const $ = (id: string): HTMLElement => document.getElementById(id) as HTMLElement;

  function showTab(which: 'insp' | 'style' | 'mmd' | 'source' | 'nav' | 'slice'): void {
    const m = which === 'mmd', s = which === 'style', i = which === 'insp',
      src = which === 'source', nav = which === 'nav', sl = which === 'slice';
    $('tabMmd').classList.toggle('active', m);
    $('tabStyle').classList.toggle('active', s);
    $('tabInsp').classList.toggle('active', i);
    $('tabSource').classList.toggle('active', src);
    $('tabNav').classList.toggle('active', nav);
    $('tabSlice').classList.toggle('active', sl);
    $('paneMmd').style.display = m ? 'block' : 'none';
    $('paneStyle').style.display = s ? 'flex' : 'none';
    $('paneInsp').style.display = i ? 'flex' : 'none';
    $('paneSource').style.display = src ? 'flex' : 'none';
    $('paneNav').style.display = nav ? 'flex' : 'none';
    $('paneSlice').style.display = sl ? 'flex' : 'none';
    $('footMmd').style.display = m ? 'flex' : 'none';
    $('footInsp').style.display = (i || src) ? 'flex' : 'none';
    if (m) ctx.hooks.sync();
    if (src) ctx.hooks.renderInspector();
    if (nav) ctx.hooks.renderNavigator();
    if (sl) ctx.hooks.renderSlice();
  }

  let panelOpen = true;
  function togglePanel(): void {
    panelOpen = !panelOpen;
    main.classList.toggle('collapsed', !panelOpen);
    $('panelBtn').classList.toggle('active', !panelOpen);
  }

  let toastTimer: number | null = null;
  function toast(msg: string): void {
    const t = $('toast');
    t.textContent = msg; t.classList.add('show');
    if (toastTimer !== null) clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => t.classList.remove('show'), 1400);
  }

  // tab buttons
  $('tabMmd').onclick = () => showTab('mmd');
  $('tabStyle').onclick = () => showTab('style');
  $('tabInsp').onclick = () => showTab('insp');
  $('tabSource').onclick = () => showTab('source');
  $('tabNav').onclick = () => showTab('nav');
  $('tabSlice').onclick = () => showTab('slice');
  $('panelBtn').onclick = togglePanel;

  // panel resize: drag the left-edge handle to set --panel-w (clamped).
  // persisted to localStorage so width survives reloads.
  (() => {
    const handle = document.getElementById('panelResize');
    if (!handle) return;
    const MINW = 280, MAXW = 900;
    const saved = Number(localStorage.getItem('flowmap.panelW'));
    if (saved >= MINW && saved <= MAXW) {
      document.documentElement.style.setProperty('--panel-w', saved + 'px');
    }
    let dragging = false;
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      // panel hugs the right edge; width = distance from cursor to viewport right
      const w = Math.min(MAXW, Math.max(MINW, window.innerWidth - e.clientX));
      document.documentElement.style.setProperty('--panel-w', w + 'px');
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      handle.classList.remove('dragging');
      const cur = getComputedStyle(document.documentElement).getPropertyValue('--panel-w').trim();
      const px = parseInt(cur, 10);
      if (px) localStorage.setItem('flowmap.panelW', String(px));
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      ctx.hooks.render(); // re-fit minimap / wires to the new canvas width
    };
    handle.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      dragging = true;
      handle.classList.add('dragging');
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    });
  })();

  return { showTab, togglePanel, toast };
}
