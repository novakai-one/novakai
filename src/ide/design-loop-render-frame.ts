/* =====================================================================
   design-loop-render-frame.ts — frame/layout rendering for the K5.2
   Design loop. Split out of design-loop-render.ts (which keeps the
   review/intake logic, closure state, the shared frame->parent listener
   and initDesignLoop): the sandboxed preview iframe + its injected
   inspector, and the static work-area/mode-toggle/refs builders. See
   design-loop-render.ts for the full module-header note on the frame <->
   panel wiring.
   ===================================================================== */

import { el, TAG_DIV } from './design-loop-render';
import type { FrameMode, LoopCtx, LoopRefs } from './design-loop-render';

/** ~15-line capture-phase inspector, injected into the srcdoc. Inspect
    mode: intercept the click, resolve the closest stamped ancestor, tell
    the parent which pointer was hit. Demo mode: get out of the way so the
    prototype's own handlers fire untouched. */
function inspectorScript(): string {
  return `<script>(function(){
var mode='inspect';
window.addEventListener('message',function(e){ if(e&&e.data&&e.data.novakai==='mode') mode=e.data.mode; });
document.addEventListener('click',function(e){
  if(mode!=='inspect') return;
  var t=e.target&&e.target.closest&&e.target.closest('[data-contract]');
  if(!t) return;
  e.preventDefault(); e.stopPropagation();
  parent.postMessage({novakai:'select',pointer:t.getAttribute('data-contract')},'*');
},true);
})();</script>`;
}

/** the actual iframe element — split out so renderFrame stays a short
    empty-check + wire-up, not a 13-statement builder. */
function buildPreviewIframe(html: string, mode: FrameMode): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.className = 'dl-frame';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.srcdoc = html + inspectorScript();
  iframe.onload = () => iframe.contentWindow?.postMessage({ novakai: 'mode', mode }, '*');
  return iframe;
}

export function renderFrame(ctx: LoopCtx): void {
  const { state, refs } = ctx;
  refs.frameHost.innerHTML = '';
  ctx.active.iframe = null;
  if (!state.draft) {
    refs.frameHost.appendChild(el(TAG_DIV, 'dl-empty-line', 'load a draft to preview'));
    return;
  }
  const iframe = buildPreviewIframe(state.draft.html, state.mode);
  refs.frameHost.appendChild(iframe);
  ctx.active.iframe = iframe;
}

/* ---------- static builders (built once per mount) ---------- */

/** the frame chrome's one quiet control — a real track+knob switch (house
    .tgl-switch/.tgl-knob, already in css/styles.css, reused not redefined). */
function buildModeToggle(ctx: LoopCtx): HTMLElement {
  const wrap = el(TAG_DIV, 'dl-mode-toggle');
  const setMode = (next: FrameMode): void => {
    ctx.state.mode = next;
    ctx.refs.modeTrack.classList.toggle('flip', next === 'demo');
    ctx.active.iframe?.contentWindow?.postMessage({ novakai: 'mode', mode: next }, '*');
  };
  ctx.refs.modeTrack.onclick = () => setMode(ctx.state.mode === 'inspect' ? 'demo' : 'inspect');
  wrap.append(el('span', 'dl-mode-label', 'inspect'), ctx.refs.modeTrack, el('span', 'dl-mode-label', 'demo'));
  return wrap;
}

export function buildRefs(): LoopRefs {
  const modeTrack = el(TAG_DIV, 'tgl-switch');
  modeTrack.appendChild(el('span', 'tgl-knob'));
  return {
    errorEl: el(TAG_DIV, 'dl-error'),
    rawEl: el(TAG_DIV, 'dl-raw'),
    changesEl: el(TAG_DIV, 'dl-changes'),
    frameHost: el(TAG_DIV, 'dl-frame-host'),
    panelListEl: el(TAG_DIV, 'dl-panel-list'),
    detailEl: el(TAG_DIV, 'dl-detail'),
    sealEl: el(TAG_DIV, 'dl-seal'),
    modeTrack,
  };
}

export function buildWorkArea(ctx: LoopCtx): HTMLElement {
  const frameChrome = el(TAG_DIV, 'dl-frame-chrome');
  frameChrome.appendChild(buildModeToggle(ctx));
  const frameCol = el(TAG_DIV, 'dl-frame-col');
  frameCol.append(frameChrome, ctx.refs.frameHost);
  const panelCol = el(TAG_DIV, 'dl-panel-col');
  panelCol.append(ctx.refs.panelListEl, ctx.refs.detailEl);
  const workArea = el(TAG_DIV, 'dl-workarea');
  workArea.append(frameCol, panelCol);
  return workArea;
}
