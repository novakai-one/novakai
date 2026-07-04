/* =====================================================================
   theming.ts — apply themes, fonts, canvas prefs at runtime
   ---------------------------------------------------------------------
   Responsibility: translate the Prefs object into live CSS variables and
   canvas state — applyTheme (sets --* vars + re-renders shapes),
   applyFont (sets --node-font), applyCanvasPrefs (grid/snap/minimap).
   Persists prefs on change. The single owner of "prefs -> visuals".

   Reads/writes ctx.prefs, ctx.snap, ctx.mmShow. Calls render + applyCam
   via hooks so shape fills and the grid refresh.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';
import { THEMES, THEME_VARS, FONTS } from '../../core/config/config';
import { savePrefs } from '../../core/persistence/persistence';

export interface ThemingApi {
  applyTheme: (key: string, doRender?: boolean) => void;
  applyFont: (key: string) => void;
  applyCanvasPrefs: () => void;
}

export function initTheming(ctx: AppContext): ThemingApi {
  const { stage } = ctx.dom;

  function applyTheme(key: string, doRender = true): void {
    const t = THEMES[key];
    if (!t) return;
    const root = document.documentElement.style;
    for (const v of THEME_VARS) if (t.vars[v]) root.setProperty(v, t.vars[v]);
    ctx.prefs.theme = key; savePrefs(ctx.prefs);
    document.querySelectorAll('.theme-chip').forEach((c) =>
      c.classList.toggle('active', (c as HTMLElement).dataset.theme === key));
    if (doRender) ctx.hooks.render(); // SVG shapes re-read fills
  }

  function applyFont(key: string): void {
    const f = FONTS[key];
    if (!f) return;
    document.documentElement.style.setProperty('--node-font', f.stack);
    document.documentElement.style.setProperty('--uf-font', f.stack);
    ctx.prefs.font = key; savePrefs(ctx.prefs);
    const fp = document.getElementById('fontPreview');
    if (fp) (fp as HTMLElement).style.fontFamily = f.stack;
  }

  function applyCanvasPrefs(): void {
    stage.style.backgroundImage = ctx.prefs.grid
      ? 'radial-gradient(var(--grid) 1.1px, transparent 1.1px)' : 'none';
    document.documentElement.style.setProperty('--fm-width', ctx.prefs.fmWidth + 'px');
    ctx.mmShow = ctx.prefs.map;
    const mm = document.getElementById('minimap');
    if (mm) mm.classList.toggle('hidden', !ctx.prefs.map);
    ctx.snap = ctx.prefs.snap;
    const sb = document.getElementById('snapBtn');
    if (sb) sb.classList.toggle('active', ctx.snap);
    ctx.hooks.applyCam(); // refresh grid size/position + minimap
  }

  return { applyTheme, applyFont, applyCanvasPrefs };
}
