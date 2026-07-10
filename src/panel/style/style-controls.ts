/* =====================================================================
   style-controls.ts — build + wire the Style tab
   ---------------------------------------------------------------------
   Responsibility: generate the theme chips, font dropdown, canvas toggle
   checkboxes, and routing select inside the Style pane, and wire their
   change handlers to theming + prefs persistence. Runs once at boot.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';
import type { ThemingApi } from './theming';
import type { Theme } from '../../core/config/config';
import type { Routing } from '../../core/types/types';
import { THEMES, THEME_ORDER, FONTS, FONT_ORDER } from '../../core/config/config';
import { savePrefs } from '../../core/persistence/persistence';

function themeAccentDotHtml(accent: string): string {
  return '<span style="position:absolute;right:3px;bottom:3px;width:9px;height:9px;' +
    `border-radius:50%;background:${accent}"></span>`;
}

function themeChipHtml(key: string, theme: Theme): string {
  const dotStyle = `background:${theme.vars['--node-bg']};border-color:${theme.vars['--line-bright']}`;
  return `<button class="theme-chip" data-theme="${key}">
      <span class="theme-dot" style="${dotStyle}">
        ${themeAccentDotHtml(theme.vars['--accent'])}
      </span>
      <span class="tc-name">${theme.name}</span>
    </button>`;
}

function buildThemeChips(theming: ThemingApi): void {
  const grid = document.getElementById('themeGrid') as HTMLElement;
  grid.innerHTML = THEME_ORDER.map((key) => themeChipHtml(key, THEMES[key])).join('');
  grid.querySelectorAll('.theme-chip').forEach((chip) => {
    (chip as HTMLElement).onclick = () => theming.applyTheme((chip as HTMLElement).dataset.theme as string);
  });
}

function buildFontSelect(ctx: AppContext, theming: ThemingApi): void {
  const fontSel = document.getElementById('fontSel') as HTMLSelectElement;
  fontSel.innerHTML = FONT_ORDER.map((key) => `<option value="${key}">${FONTS[key].name}</option>`).join('');
  fontSel.value = ctx.prefs.font;
  fontSel.onchange = () => theming.applyFont(fontSel.value);
}

function wireCanvasToggle(
  ctx: AppContext,
  theming: ThemingApi,
  checkbox: HTMLInputElement,
  setPref: (checked: boolean) => void,
): void {
  checkbox.onchange = () => {
    setPref(checkbox.checked);
    savePrefs(ctx.prefs);
    theming.applyCanvasPrefs();
  };
}

interface CanvasToggleEls {
  gridChk: HTMLInputElement;
  snapChk: HTMLInputElement;
  mapChk: HTMLInputElement;
  fmChk: HTMLInputElement;
}

function getCanvasToggleEls(ctx: AppContext): CanvasToggleEls {
  const gridChk = document.getElementById('optGrid') as HTMLInputElement;
  const snapChk = document.getElementById('optSnap') as HTMLInputElement;
  const mapChk = document.getElementById('optMap') as HTMLInputElement;
  const fmChk = document.getElementById('optFm') as HTMLInputElement;

  gridChk.checked = ctx.prefs.grid;
  snapChk.checked = ctx.prefs.snap;
  mapChk.checked = ctx.prefs.map;
  fmChk.checked = ctx.prefs.showFrontmatter;

  return { gridChk, snapChk, mapChk, fmChk };
}

function buildCanvasToggles(ctx: AppContext, theming: ThemingApi): void {
  const { gridChk, snapChk, mapChk, fmChk } = getCanvasToggleEls(ctx);

  wireCanvasToggle(ctx, theming, gridChk, (checked) => {
    ctx.prefs.grid = checked;
  });
  wireCanvasToggle(ctx, theming, snapChk, (checked) => {
    ctx.prefs.snap = checked;
  });
  wireCanvasToggle(ctx, theming, mapChk, (checked) => {
    ctx.prefs.map = checked;
  });
  fmChk.onchange = () => {
    ctx.prefs.showFrontmatter = fmChk.checked;
    savePrefs(ctx.prefs);
    ctx.hooks.render();
  };
}

function buildFrontmatterWidthControl(ctx: AppContext): void {
  const widthInput = document.getElementById('optFmWidth') as HTMLInputElement;
  const widthVal = document.getElementById('fmWidthVal') as HTMLElement;
  widthInput.value = String(ctx.prefs.fmWidth);
  widthVal.textContent = String(ctx.prefs.fmWidth);
  widthInput.oninput = () => {
    ctx.prefs.fmWidth = +widthInput.value;
    widthVal.textContent = widthInput.value;
    document.documentElement.style.setProperty('--fm-width', widthInput.value + 'px');
    savePrefs(ctx.prefs);
  };
}

function buildRouteSelect(ctx: AppContext): void {
  const routeSel = document.getElementById('routeSel') as HTMLSelectElement;
  routeSel.value = ctx.prefs.route;
  routeSel.onchange = () => {
    ctx.prefs.route = routeSel.value as Routing;
    savePrefs(ctx.prefs);
  };
}

export function initStyleControls(ctx: AppContext, theming: ThemingApi): void {
  buildThemeChips(theming);
  buildFontSelect(ctx, theming);
  buildCanvasToggles(ctx, theming);
  buildFrontmatterWidthControl(ctx);
  buildRouteSelect(ctx);
}
