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
import type { Theme, FontDef } from '../../core/config/config';
import { THEMES, THEME_VARS, FONTS } from '../../core/config/config';
import { savePrefs } from '../../core/persistence/persistence';

export interface ThemingApi {
  applyTheme: (key: string, doRender?: boolean) => void;
  applyFont: (key: string) => void;
  applyCanvasPrefs: () => void;
}

function setThemeVars(theme: Theme): void {
  const root = document.documentElement.style;
  for (const varName of THEME_VARS) {
    if (theme.vars[varName]) root.setProperty(varName, theme.vars[varName]);
  }
}

function markActiveChip(key: string): void {
  document.querySelectorAll('.theme-chip').forEach((chip) =>
    chip.classList.toggle('active', (chip as HTMLElement).dataset.theme === key));
}

function applyThemeImpl(ctx: AppContext, key: string, doRender: boolean): void {
  const theme = THEMES[key];
  if (!theme) return;
  setThemeVars(theme);
  ctx.prefs.theme = key;
  savePrefs(ctx.prefs);
  markActiveChip(key);
  if (doRender) ctx.hooks.render(); // SVG shapes re-read fills
}

function applyFontImpl(ctx: AppContext, key: string): void {
  const font: FontDef | undefined = FONTS[key];
  if (!font) return;
  document.documentElement.style.setProperty('--node-font', font.stack);
  document.documentElement.style.setProperty('--uf-font', font.stack);
  ctx.prefs.font = key;
  savePrefs(ctx.prefs);
  const preview = document.getElementById('fontPreview');
  if (preview) (preview as HTMLElement).style.fontFamily = font.stack;
}

function applyCanvasPrefsImpl(ctx: AppContext): void {
  const { stage } = ctx.dom;
  stage.style.backgroundImage = ctx.prefs.grid
    ? 'radial-gradient(var(--grid) 1.1px, transparent 1.1px)' : 'none';
  document.documentElement.style.setProperty('--fm-width', ctx.prefs.fmWidth + 'px');
  ctx.mmShow = ctx.prefs.map;
  const minimap = document.getElementById('minimap');
  if (minimap) minimap.classList.toggle('hidden', !ctx.prefs.map);
  ctx.snap = ctx.prefs.snap;
  const snapBtn = document.getElementById('snapBtn');
  if (snapBtn) snapBtn.classList.toggle('active', ctx.snap);
  ctx.hooks.applyCam(); // refresh grid size/position + minimap
}

export function initTheming(ctx: AppContext): ThemingApi {
  function applyTheme(key: string, doRender = true): void {
    applyThemeImpl(ctx, key, doRender);
  }

  function applyFont(key: string): void {
    applyFontImpl(ctx, key);
  }

  function applyCanvasPrefs(): void {
    applyCanvasPrefsImpl(ctx);
  }

  return { applyTheme, applyFont, applyCanvasPrefs };
}
