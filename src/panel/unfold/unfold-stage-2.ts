/* =====================================================================
   unfold-stage-2.ts — reading mode: the zoom/fold/dark chrome-less
   controls, split out of unfold.ts in place (overflow of
   unfold-stage.ts, which alone exceeded 400 lines together with this
   content). Every symbol here used to be a closure over initUnfold's
   locals; those locals now live on the shared `E: UEnv` object
   unfold.ts constructs and passes to every sibling factory. Uses
   clampPan/setT/fitView, which unfold-stage.ts (called earlier by
   unfold.ts) has already attached onto E.
   ===================================================================== */

import type { UEnv } from './unfold';

export function initUnfoldStage2(E: UEnv): void {
  E.q('ufZin').onclick = () => { E.viewXform.k = Math.min(2.5, E.viewXform.k * 1.15); E.clampPan(); E.setT(true); };
  E.q('ufZout').onclick = () => { E.viewXform.k = Math.max(.15, E.viewXform.k / 1.15); E.clampPan(); E.setT(true); };
  E.q('ufZfit').onclick = () => E.fitView(true);
  E.q('ufFold').onclick = () => E.foldAll();
  function applyDark(dark: boolean): void {
    E.overlay.classList.toggle('dark', dark);
    E.q('ufThemeIc').innerHTML = dark
      ? '<circle cx="8" cy="8" r="3.2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4"/>'
      : '<path d="M13 9.5A5.5 5.5 0 1 1 6.5 3 4.5 4.5 0 0 0 13 9.5Z"/>';
    localStorage.setItem('unfold.theme', dark ? 'dark' : 'light');
    E.q('ufStyleDark').classList.toggle('on', dark);
    E.drawWires();
  }
  E.q('ufTheme').onclick = () => applyDark(!E.overlay.classList.contains('dark'));

  E.applyDark = applyDark;
}
