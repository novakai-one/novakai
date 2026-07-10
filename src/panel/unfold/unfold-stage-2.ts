/* =====================================================================
   unfold-stage-2.ts — reading mode: the zoom/fold/dark chrome-less
   controls, split out of unfold.ts in place (overflow of
   unfold-stage.ts, which alone exceeded 400 lines together with this
   content). Every symbol here used to be a closure over initUnfold's
   locals; those locals now live on the shared `env: UEnv` object
   unfold.ts constructs and passes to every sibling factory. Uses
   clampPan/setT/fitView, which unfold-stage.ts (called earlier by
   unfold.ts) has already attached onto env.
   ===================================================================== */

import type { UEnv } from './unfold';

const DARK_ICON = '<circle cx="8" cy="8" r="3.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4' +
  'M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4"/>';
const LIGHT_ICON = '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5Z"/>';

function zoomIn(env: UEnv): void {
  env.viewXform.k = Math.min(2.5, env.viewXform.k * 1.15);
  env.clampPan();
  env.setT(true);
}

function zoomOut(env: UEnv): void {
  env.viewXform.k = Math.max(.15, env.viewXform.k / 1.15);
  env.clampPan();
  env.setT(true);
}

export function initUnfoldStage2(env: UEnv): void {
  env.q('ufZin').onclick = () => zoomIn(env);
  env.q('ufZout').onclick = () => zoomOut(env);
  env.q('ufZfit').onclick = () => env.fitView(true);
  env.q('ufFold').onclick = () => env.foldAll();

  function applyDark(dark: boolean): void {
    env.overlay.classList.toggle('dark', dark);
    env.q('ufThemeIc').innerHTML = dark ? DARK_ICON : LIGHT_ICON;
    localStorage.setItem('unfold.theme', dark ? 'dark' : 'light');
    env.q('ufStyleDark').classList.toggle('on', dark);
    env.drawWires();
  }
  env.q('ufTheme').onclick = () => applyDark(!env.overlay.classList.contains('dark'));

  env.applyDark = applyDark;
}
