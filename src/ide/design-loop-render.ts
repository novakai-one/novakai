/* =====================================================================
   design-loop-render.ts — K5.2 Design tab: the review-loop surface
   ---------------------------------------------------------------------
   Responsibility: initDesignLoop() mounts a self-contained loop panel
   after the existing prototypes flow (design.ts wires it in, mount only).
   Owns its own closure state (draft pair, review marks, selection, frame
   mode) — no localStorage, no lifecycle beyond one mount (mirrors design.
   ts's "render() starts fresh every time" precedent). All business logic
   (lint, groups, marks, carry-forward, seal serialization) lives in the
   sibling pure module './design-loop'; this file only builds and updates
   DOM, following contracts-doc.ts's "one small render function per
   concern" + house el()/collapse-head+xwrap/copy-button patterns.

   Frame <-> panel wiring: a single module-scope `window` message listener
   (added once, at import time) routes postMessage selects from whichever
   iframe is currently "active" — avoids adding a new listener on every
   mount (this factory is re-instantiated on every Design tab visit).
   The parent NEVER scrolls or transforms the iframe in response to a
   click — selection only ever moves the review list.
   ===================================================================== */

import '../../css/design-loop.css';
import {
  carryForward, changesPayload, groupOf, lintPointers, resolvePointer, reviewGroups, reviewMark, sealOutcome,
} from './design-loop';
import type { ReviewState } from './design-loop';

export interface DesignLoopApi { render(): HTMLElement }

interface Draft { contract: unknown; html: string }

type FrameMode = 'inspect' | 'demo';

interface LoopState {
  draft: Draft | null;
  groups: string[];
  review: ReviewState;
  selected: string | null;
  mode: FrameMode;
}

interface LoopRefs {
  errorEl: HTMLElement;
  rawEl: HTMLElement;
  changesEl: HTMLElement;
  frameHost: HTMLElement;
  panelListEl: HTMLElement;
  detailEl: HTMLElement;
  sealEl: HTMLElement;
  modeTrack: HTMLElement;
}

/** the one thing outlives a single mount's closures: which iframe (if any)
    the shared listener below should accept messages from right now. */
interface ActiveFrame { iframe: HTMLIFrameElement | null; onSelect: (pointer: string) => void }

interface LoopCtx { state: LoopState; refs: LoopRefs; active: ActiveFrame }

const TAG_DIV = 'div';
const CLS_BTN = 'design-btn';
const CLS_BTN_ACCENT = `${CLS_BTN} design-btn--accent`;

/* ---------- house DOM helpers (el/button/collapse — contracts-doc.ts style) ---------- */

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, cls: string, onClick: (evt: MouseEvent) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.textContent = label;
  btn.onclick = onClick;
  return btn;
}

function makeXwrap(content: HTMLElement): { wrap: HTMLElement; toggle: () => boolean } {
  const wrap = el(TAG_DIV, 'dl-xwrap');
  const inner = el(TAG_DIV, 'dl-xwrap-inner');
  inner.appendChild(content);
  wrap.appendChild(inner);
  const toggle = (): boolean => wrap.classList.toggle('dl-xwrap--open');
  return { wrap, toggle };
}

/** `▸ draft` trigger, default CLOSED — the contracts.ts collapse-head +
    xwrap mechanism, own class names, house vars only. */
function renderCollapsible(label: string, content: HTMLElement): HTMLElement {
  const frag = el(TAG_DIV, 'dl-collapse');
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'dl-collapse-head';
  head.append(el('span', 'dl-caret', '▸'), el('span', 'dl-collapse-label', label));
  const { wrap, toggle } = makeXwrap(content);
  head.onclick = () => head.classList.toggle('open', toggle());
  frag.append(head, wrap);
  return frag;
}

/** contracts-doc.ts's renderCopyCmd, generalized to any text (the intake
    panel copies raw json/html/changes, not just a shell command). */
function copyButton(text: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'dl-copy-btn';
  btn.textContent = '⧉ copy';
  btn.onclick = (evt) => {
    evt.stopPropagation();
    void navigator.clipboard?.writeText(text);
    btn.textContent = 'copied';
    btn.classList.add('copied');
    setTimeout(() => { btn.textContent = '⧉ copy'; btn.classList.remove('copied'); }, 1400);
  };
  return btn;
}

function rawBlock(label: string, text: string): HTMLElement {
  const box = el(TAG_DIV, 'dl-raw-block');
  const head = el(TAG_DIV, 'dl-raw-head');
  head.append(el('span', 'dl-raw-label', label), copyButton(text));
  box.append(head, el('pre', 'dl-raw-pre', text));
  return box;
}

/* ---------- pure-ish helpers (no DOM state) ---------- */

function extractPointers(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  doc.querySelectorAll('[data-contract]').forEach((node) => {
    const pointer = node.getAttribute('data-contract');
    if (pointer) out.push(pointer);
  });
  return out;
}

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

function downloadText(name: string, text: string): void {
  const blob = new Blob([text], { type: 'text/plain' });
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  anchor.download = name;
  anchor.click();
}

/* ---------- the one shared frame->parent listener (added once, ever) ---------- */

let activeFrame: ActiveFrame | null = null;

window.addEventListener('message', (evt: MessageEvent) => {
  if (!activeFrame?.iframe || evt.source !== activeFrame.iframe.contentWindow) return;
  const data = evt.data as { novakai?: string; pointer?: string } | null;
  if (data?.novakai === 'select' && typeof data.pointer === 'string') activeFrame.onSelect(data.pointer);
});

/* ---------- rebuild functions: each owns one concern, small + focused ---------- */

function renderFrame(ctx: LoopCtx): void {
  const { state, refs } = ctx;
  refs.frameHost.innerHTML = '';
  ctx.active.iframe = null;
  if (!state.draft) { refs.frameHost.appendChild(el(TAG_DIV, 'dl-empty-line', 'load a draft to preview')); return; }
  const iframe = document.createElement('iframe');
  iframe.className = 'dl-frame';
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.srcdoc = state.draft.html + inspectorScript();
  iframe.onload = () => iframe.contentWindow?.postMessage({ novakai: 'mode', mode: state.mode }, '*');
  refs.frameHost.appendChild(iframe);
  ctx.active.iframe = iframe;
}

function keptPointers(review: ReviewState): string[] {
  return Object.entries(review).filter(([, entry]) => entry.state === 'kept').map(([pointer]) => pointer);
}

function dotClass(review: ReviewState, pointer: string): string {
  const entry = review[pointer];
  if (entry?.state === 'kept') return 'dl-dot dl-dot--kept';
  if (entry?.state === 'change') return 'dl-dot dl-dot--change';
  return 'dl-dot';
}

function renderGroupRow(ctx: LoopCtx, pointer: string): HTMLElement {
  const cls = `dl-group-row${pointer === ctx.state.selected ? ' dl-group-row--selected' : ''}`;
  const row = button(pointer, cls, () => selectPointer(ctx, pointer, false));
  row.prepend(el('span', dotClass(ctx.state.review, pointer)));
  return row;
}

function renderCommentField(ctx: LoopCtx, pointer: string): HTMLElement {
  const box = el(TAG_DIV, 'dl-comment');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'dl-comment-input';
  input.placeholder = 'what should change';
  const submit = (): void => {
    if (!input.value.trim()) return; // reviewMark itself refuses an empty comment — mirrored here so the UI never even calls it
    ctx.state.review = reviewMark(ctx.state.review, pointer, 'change', input.value);
    rebuildAfterReview(ctx);
  };
  input.onkeydown = (evt) => { if (evt.key === 'Enter') submit(); };
  box.append(input, button('submit', CLS_BTN, submit));
  return box;
}

function renderDetailActions(ctx: LoopCtx, pointer: string): HTMLElement {
  const wrap = el(TAG_DIV, 'dl-detail-actions');
  const keepBtn = button('keep', CLS_BTN, () => {
    ctx.state.review = reviewMark(ctx.state.review, pointer, 'keep', '');
    rebuildAfterReview(ctx);
  });
  const changeBtn = button('change', CLS_BTN, () => changeBtn.replaceWith(renderCommentField(ctx, pointer)));
  wrap.append(keepBtn, changeBtn);
  return wrap;
}

function rebuildDetail(ctx: LoopCtx): void {
  const { state, refs } = ctx;
  refs.detailEl.innerHTML = '';
  if (!state.draft) { refs.detailEl.appendChild(el(TAG_DIV, 'dl-detail-empty', 'load a draft first')); return; }
  if (!state.selected) { refs.detailEl.appendChild(el(TAG_DIV, 'dl-detail-empty', 'select an element')); return; }
  const value = resolvePointer(state.draft.contract, state.selected);
  refs.detailEl.append(
    el(TAG_DIV, 'dl-detail-path', state.selected),
    el('pre', 'dl-detail-value', JSON.stringify(value, null, 2)),
    renderDetailActions(ctx, state.selected),
  );
}

function rebuildPanel(ctx: LoopCtx): void {
  ctx.refs.panelListEl.innerHTML = '';
  for (const pointer of ctx.state.groups) ctx.refs.panelListEl.appendChild(renderGroupRow(ctx, pointer));
  rebuildDetail(ctx);
}

function rebuildRaw(ctx: LoopCtx): void {
  const { state, refs } = ctx;
  refs.rawEl.innerHTML = '';
  if (!state.draft) { refs.rawEl.appendChild(el(TAG_DIV, 'dl-empty-line', 'no draft loaded')); return; }
  refs.rawEl.append(
    rawBlock('contract json', JSON.stringify(state.draft.contract, null, 2)),
    rawBlock('projected html', state.draft.html),
  );
}

function rebuildChanges(ctx: LoopCtx): void {
  ctx.refs.changesEl.innerHTML = '';
  const payload = changesPayload(ctx.state.review);
  if (!payload.length) return; // hidden until >=1 change is marked — the return leg to the AI
  ctx.refs.changesEl.appendChild(rawBlock('changes → AI', JSON.stringify(payload, null, 2)));
}

function rebuildSeal(ctx: LoopCtx): void {
  const { state, refs } = ctx;
  refs.sealEl.innerHTML = '';
  const kept = keptPointers(state.review);
  if (!kept.length || !state.draft) return; // seal only ever appears once there is something to attest
  const draft = state.draft;
  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'dl-seal-input';
  nameInput.placeholder = 'name';
  const seal = button('Seal outcome', CLS_BTN_ACCENT, () => {
    const name = nameInput.value.trim();
    if (!name) return;
    downloadText(`${name}.contract.json`, sealOutcome(draft.contract, kept));
    downloadText(`${name}.html`, draft.html);
  });
  refs.sealEl.append(el(TAG_DIV, 'dl-collapse-label', 'seal outcome'), nameInput, seal);
}

function rebuildAfterReview(ctx: LoopCtx): void {
  rebuildPanel(ctx);
  rebuildChanges(ctx);
  rebuildSeal(ctx);
}

function selectPointer(ctx: LoopCtx, pointer: string, scroll: boolean): void {
  ctx.state.selected = pointer;
  rebuildPanel(ctx);
  if (scroll) ctx.refs.panelListEl.querySelector('.dl-group-row--selected')?.scrollIntoView({ block: 'nearest' });
}

/** the frame reports the RAW leaf pointer the click landed on; map it up
    to its second-level reviewable group before the list ever selects. */
function selectFromFrame(ctx: LoopCtx, rawPointer: string): void {
  const group = groupOf(rawPointer, ctx.state.groups);
  if (group) selectPointer(ctx, group, true);
}

/* ---------- intake: parse + lint gate, never renders an unproven frame ---------- */

function showError(refs: LoopRefs, lines: readonly string[]): void {
  refs.errorEl.innerHTML = '';
  for (const line of lines) refs.errorEl.appendChild(el(TAG_DIV, 'dl-error-line', line));
}

function intakeDraft(ctx: LoopCtx, contractText: string, htmlText: string): void {
  let contract: unknown;
  try { contract = JSON.parse(contractText); }
  catch { showError(ctx.refs, ['invalid contract json']); return; }
  const unresolved = lintPointers(extractPointers(htmlText), contract);
  if (unresolved.length) { showError(ctx.refs, unresolved.map((pointer) => `unresolved pointer: ${pointer}`)); return; }
  showError(ctx.refs, []);
  const prev = ctx.state.draft;
  ctx.state.review = prev ? carryForward(ctx.state.review, prev.contract, contract) : {};
  ctx.state.draft = { contract, html: htmlText };
  ctx.state.groups = reviewGroups(contract);
  ctx.state.selected = null;
  renderFrame(ctx);
  rebuildPanel(ctx);
  rebuildRaw(ctx);
  rebuildChanges(ctx);
  rebuildSeal(ctx);
}

/* ---------- static builders (built once per mount) ---------- */

function buildIntakeBody(ctx: LoopCtx): HTMLElement {
  const body = el(TAG_DIV, 'dl-intake-body');
  const contractTa = document.createElement('textarea');
  contractTa.className = 'dl-textarea';
  contractTa.placeholder = 'contract json';
  const htmlTa = document.createElement('textarea');
  htmlTa.className = 'dl-textarea';
  htmlTa.placeholder = 'projected html';
  const loadBtn = button('Load draft', CLS_BTN, () => intakeDraft(ctx, contractTa.value, htmlTa.value));
  body.append(contractTa, htmlTa, loadBtn, ctx.refs.errorEl, ctx.refs.rawEl, ctx.refs.changesEl);
  return body;
}

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

function buildRefs(): LoopRefs {
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

function buildWorkArea(ctx: LoopCtx): HTMLElement {
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

function buildLoop(): HTMLElement {
  const state: LoopState = { draft: null, groups: [], review: {}, selected: null, mode: 'inspect' };
  const refs = buildRefs();
  const active: ActiveFrame = { iframe: null, onSelect: (pointer) => selectFromFrame(ctx, pointer) };
  const ctx: LoopCtx = { state, refs, active };
  activeFrame = active; // this mount is now the one listener target — replaces any prior mount's

  const root = el(TAG_DIV, 'design-loop');
  root.append(renderCollapsible('draft', buildIntakeBody(ctx)), buildWorkArea(ctx), refs.sealEl);
  renderFrame(ctx);
  rebuildPanel(ctx);
  rebuildRaw(ctx);
  return root;
}

export function initDesignLoop(): DesignLoopApi {
  return { render: buildLoop };
}
