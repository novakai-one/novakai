/* =====================================================================
   style-controls.ts — build + wire the Style tab
   ---------------------------------------------------------------------
   Responsibility: generate the theme chips, font dropdown, canvas toggle
   checkboxes, and routing select inside the Style pane, and wire their
   change handlers to theming + prefs persistence. Runs once at boot.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';
import type { ThemingApi } from './theming';
import type { Routing } from '../../core/types/types';
import { THEMES, THEME_ORDER, FONTS, FONT_ORDER } from '../../core/config/config';
import { savePrefs } from '../../core/persistence/persistence';

export function initStyleControls(ctx: AppContext, theming: ThemingApi): void {
  // theme chips
  const grid = document.getElementById('themeGrid') as HTMLElement;
  grid.innerHTML = THEME_ORDER.map((k) => {
    const v = THEMES[k].vars;
    return `<button class="theme-chip" data-theme="${k}">
      <span class="theme-dot" style="background:${v['--node-bg']};border-color:${v['--line-bright']}">
        <span style="position:absolute;right:3px;bottom:3px;width:9px;height:9px;border-radius:50%;background:${v['--accent']}"></span>
      </span>
      <span class="tc-name">${THEMES[k].name}</span>
    </button>`;
  }).join('');
  grid.querySelectorAll('.theme-chip').forEach((c) => {
    (c as HTMLElement).onclick = () => theming.applyTheme((c as HTMLElement).dataset.theme as string);
  });

  // font select
  const fs = document.getElementById('fontSel') as HTMLSelectElement;
  fs.innerHTML = FONT_ORDER.map((k) => `<option value="${k}">${FONTS[k].name}</option>`).join('');
  fs.value = ctx.prefs.font;
  fs.onchange = () => theming.applyFont(fs.value);

  // canvas toggles
  const og = document.getElementById('optGrid') as HTMLInputElement;
  const os = document.getElementById('optSnap') as HTMLInputElement;
  const om = document.getElementById('optMap') as HTMLInputElement;
  const of = document.getElementById('optFm') as HTMLInputElement;
  og.checked = ctx.prefs.grid; os.checked = ctx.prefs.snap; om.checked = ctx.prefs.map;
  of.checked = ctx.prefs.showFrontmatter;
  og.onchange = () => { ctx.prefs.grid = og.checked; savePrefs(ctx.prefs); theming.applyCanvasPrefs(); };
  os.onchange = () => { ctx.prefs.snap = os.checked; savePrefs(ctx.prefs); theming.applyCanvasPrefs(); };
  om.onchange = () => { ctx.prefs.map = om.checked; savePrefs(ctx.prefs); theming.applyCanvasPrefs(); };
  of.onchange = () => { ctx.prefs.showFrontmatter = of.checked; savePrefs(ctx.prefs); ctx.hooks.render(); };

  // frontmatter card width
  const ofw = document.getElementById('optFmWidth') as HTMLInputElement;
  const ofwVal = document.getElementById('fmWidthVal') as HTMLElement;
  ofw.value = String(ctx.prefs.fmWidth);
  ofwVal.textContent = String(ctx.prefs.fmWidth);
  ofw.oninput = () => {
    ctx.prefs.fmWidth = +ofw.value;
    ofwVal.textContent = ofw.value;
    document.documentElement.style.setProperty('--fm-width', ofw.value + 'px');
    savePrefs(ctx.prefs);
  };

  // default routing
  const rs = document.getElementById('routeSel') as HTMLSelectElement;
  rs.value = ctx.prefs.route;
  rs.onchange = () => { ctx.prefs.route = rs.value as Routing; savePrefs(ctx.prefs); };
}
