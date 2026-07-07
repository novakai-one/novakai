/* =====================================================================
   agents-chat.ts — K6 Agents tab: the chat view for one session
   ---------------------------------------------------------------------
   Exports exactly one symbol: renderChat(ctx, session). Elegant, not a
   terminal — no monospace body text outside code tokens. Pure cores
   (mdTokens/revealStep/eventLabel) come from agents-stream.ts.

   LISTENER LIFECYCLE (load-bearing, docs/novakai/plans/k6-agents.plan.
   json #k6-ui-chat): exactly ONE module-scope import.meta.hot.on
   listener, registered once at module evaluation, dispatching into a
   single module-scope `active` slot that renderChat overwrites on every
   mount. Events for a session that isn't the mounted one are dropped.
   NEVER a per-render subscription — shell's renderHost() wipes innerHTML
   on every route change with no unmount hook, so a per-render listener
   would double-fire and append to dead DOM.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import { mdTokens, revealStep, eventLabel } from './agents-stream';

interface ChatSession { id: string | null; title: string }

interface ContentBlock { type: string; text?: string; name?: string; input?: Record<string, unknown> }
interface HistoryMessage { role?: string; content?: string | ContentBlock[]; ts?: string }
interface StreamLine {
  type: string;
  subtype?: string;
  session_id?: string;
  event?: { type: string; delta?: { type: string; text?: string } };
  message?: { content?: ContentBlock[] };
}

interface ViewState {
  sessionId: string | null;
  threadEl: HTMLElement;
  raw: string;
  revealedLen: number;
  assistantEl: HTMLElement | null;
  activityEl: HTMLElement | null;
  rafId: number | null;
  frameStart: number;
  awaitTimer: number | null;
  bootTimer: number | null;
  bootShown: boolean;
}

const ACK_TIMEOUT_MS = 4000;

// history fetch — contracts.ts fetchJson pattern
async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function loadHistory(id: string): Promise<HistoryMessage[]> {
  return (await fetchJson<HistoryMessage[]>('/novakai/agent/history?id=' + encodeURIComponent(id))) ?? [];
}

function extractText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n');
  }
  return '';
}

// markdown DOM builder — createElement only, mono only inside code tokens
function buildTokenEl(token: ReturnType<typeof mdTokens>[number]): HTMLElement {
  if (token.kind === 'codeblock') {
    const pre = document.createElement('pre');
    pre.className = 'ac-codeblock';
    const code = document.createElement('code');
    code.textContent = token.val;
    pre.appendChild(code);
    return pre;
  }
  const para = document.createElement('p');
  for (const part of token.parts) {
    const node =
      part.kind === 'b' ? document.createElement('strong') : part.kind === 'code' ? document.createElement('code') : null;
    if (node) {
      node.textContent = part.val;
      para.appendChild(node);
    } else {
      para.appendChild(document.createTextNode(part.val));
    }
  }
  return para;
}

function renderMarkdown(el: HTMLElement, text: string): void {
  el.replaceChildren();
  for (const token of mdTokens(text)) el.appendChild(buildTokenEl(token));
}

function appendLine(thread: HTMLElement, className: string, text: string): void {
  const el = document.createElement('div');
  el.className = className;
  el.textContent = text;
  thread.appendChild(el);
}

function renderHistoryMessage(thread: HTMLElement, msg: HistoryMessage): void {
  const text = extractText(msg.content);
  if (!text) return;
  if (msg.role === 'user') {
    appendLine(thread, 'ac-bubble-user', text);
    return;
  }
  const el = document.createElement('div');
  el.className = 'ac-msg-assistant';
  renderMarkdown(el, text);
  thread.appendChild(el);
}

// ---- live turn: calm-paced reveal + faint tool activity ----
function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function ensureAssistantEl(view: ViewState): HTMLElement {
  if (!view.assistantEl) {
    const el = document.createElement('div');
    el.className = 'ac-msg-assistant';
    view.threadEl.appendChild(el);
    view.assistantEl = el;
  }
  return view.assistantEl;
}

function startReveal(view: ViewState): void {
  if (view.rafId !== null) return;
  view.frameStart = performance.now();
  const step = (now: number): void => {
    const elapsed = now - view.frameStart;
    view.frameStart = now;
    const pending = view.raw.length - view.revealedLen;
    const chars = reducedMotion() ? pending : revealStep(pending, elapsed);
    view.revealedLen = Math.min(view.raw.length, view.revealedLen + chars);
    renderMarkdown(ensureAssistantEl(view), view.raw.slice(0, view.revealedLen));
    view.rafId = view.revealedLen < view.raw.length ? requestAnimationFrame(step) : null;
  };
  view.rafId = requestAnimationFrame(step);
}

function finishReveal(view: ViewState): void {
  if (view.rafId !== null) {
    cancelAnimationFrame(view.rafId);
    view.rafId = null;
  }
  if (view.raw.length > 0) renderMarkdown(ensureAssistantEl(view), view.raw);
  view.raw = '';
  view.revealedLen = 0;
  view.assistantEl = null;
}

function showActivity(view: ViewState, label: string): void {
  if (!view.activityEl) {
    const el = document.createElement('div');
    el.className = 'ac-activity';
    view.threadEl.appendChild(el);
    view.activityEl = el;
    requestAnimationFrame(() => el.classList.add('ac-activity--in'));
  }
  view.activityEl.textContent = label;
}

function hideActivity(view: ViewState): void {
  const el = view.activityEl;
  if (!el) return;
  view.activityEl = null;
  el.classList.remove('ac-activity--in');
  window.setTimeout(() => el.remove(), 240);
}

function clearAwaitTimer(view: ViewState): void {
  if (view.awaitTimer !== null) {
    window.clearTimeout(view.awaitTimer);
    view.awaitTimer = null;
  }
}

function armAwaitTimer(view: ViewState): void {
  clearAwaitTimer(view);
  view.awaitTimer = window.setTimeout(() => {
    view.awaitTimer = null;
    appendLine(view.threadEl, 'ac-notice', 'dev server required');
  }, ACK_TIMEOUT_MS);
}

function clearBootNotice(view: ViewState): void {
  if (view.bootTimer !== null) {
    window.clearTimeout(view.bootTimer);
    view.bootTimer = null;
  }
  if (view.bootShown) {
    view.bootShown = false;
    hideActivity(view);
  }
}

function handleStreamEvent(view: ViewState, parsed: StreamLine): void {
  clearBootNotice(view);
  const delta = parsed.event?.delta;
  if (parsed.event?.type === 'content_block_delta' && delta?.type === 'text_delta' && typeof delta.text === 'string') {
    view.raw += delta.text;
    startReveal(view);
  }
}

function handleAssistant(view: ViewState, parsed: StreamLine): void {
  for (const block of parsed.message?.content ?? []) {
    if (block.type === 'tool_use') {
      const label = eventLabel({ name: block.name ?? '', input: block.input });
      if (label !== null) showActivity(view, label);
    }
  }
}

function handleEvt(view: ViewState, rawLine: string): void {
  clearAwaitTimer(view);
  // any event proves the bridge is alive — retract a stale offline notice
  view.threadEl.querySelectorAll('.ac-notice').forEach((node) => node.remove());
  let parsed: StreamLine;
  try {
    parsed = JSON.parse(rawLine) as StreamLine;
  } catch {
    return;
  }
  if (parsed.type === 'system' && parsed.subtype === 'init') {
    // init marks the turn actually starting — onboarding is over
    clearBootNotice(view);
    if (view.sessionId === null && parsed.session_id) view.sessionId = parsed.session_id;
    return;
  }
  if (parsed.type === 'stream_event') return handleStreamEvent(view, parsed);
  if (parsed.type === 'assistant') return handleAssistant(view, parsed);
  if (parsed.type === 'result') {
    clearBootNotice(view);
    finishReveal(view);
    hideActivity(view);
  }
}

function sendMessage(view: ViewState, text: string): void {
  appendLine(view.threadEl, 'ac-bubble-user', text);
  const hot = import.meta.hot;
  if (!hot) {
    appendLine(view.threadEl, 'ac-notice', 'dev server required');
    return;
  }
  armAwaitTimer(view);
  if (view.bootTimer === null && !view.bootShown) {
    view.bootTimer = window.setTimeout(() => {
      view.bootTimer = null;
      view.bootShown = true;
      // factual, quiet: a cold child sits in this repo's SessionStart
      // onboard gate for minutes before the turn starts
      showActivity(view, 'onboarding the repo');
    }, 5000);
  }
  hot.send('novakai:agent:send', { sessionId: view.sessionId, text });
}

// single module-scope slot + single module-scope listener — see header.
let active: ViewState | null = null;

if (import.meta.hot) {
  import.meta.hot.on('novakai:agent:evt', (data: { sessionId: string | null; line: string }) => {
    const view = active;
    if (!view) return;
    if (view.sessionId !== null && data.sessionId !== view.sessionId) return;
    handleEvt(view, data.line);
  });
}

export function renderChat(ctx: AppContext, session: ChatSession): HTMLElement {
  void ctx; // read-only view over the K2 bridge — no ctx.state/hooks needed this slice

  const root = document.createElement('div');
  root.className = 'agents-chat';

  const titleBar = document.createElement('div');
  titleBar.className = 'ac-titlebar';
  const title = document.createElement('span');
  title.className = 'ac-title';
  title.textContent = session.title;
  titleBar.appendChild(title);
  root.appendChild(titleBar);

  const thread = document.createElement('div');
  thread.className = 'ac-thread';
  root.appendChild(thread);

  const composer = document.createElement('div');
  composer.className = 'ac-composer';
  const textarea = document.createElement('textarea');
  textarea.className = 'ac-textarea';
  textarea.rows = 1;
  textarea.placeholder = 'Message';
  composer.appendChild(textarea);
  root.appendChild(composer);

  const view: ViewState = {
    sessionId: session.id,
    threadEl: thread,
    raw: '',
    revealedLen: 0,
    assistantEl: null,
    activityEl: null,
    rafId: null,
    frameStart: 0,
    awaitTimer: null,
    bootTimer: null,
    bootShown: false,
  };
  active = view;

  if (session.id) {
    loadHistory(session.id).then((messages) => {
      if (active !== view) return; // remounted elsewhere before history arrived
      for (const msg of messages) renderHistoryMessage(thread, msg);
    });
  }

  textarea.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && !ev.shiftKey) {
      ev.preventDefault();
      const text = textarea.value.trim();
      if (!text) return;
      textarea.value = '';
      sendMessage(view, text);
    }
  });

  return root;
}
