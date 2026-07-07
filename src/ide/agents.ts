/* =====================================================================
   agents.ts — K6 Agents tab: heading, new chat, last-3 session list
   ---------------------------------------------------------------------
   Responsibility: initAgents(ctx) fills the K-seam stub (render()'s body
   only — no other file changes to mount it, pages.ts's EMPTY 'agents' row
   simply goes unused). Fetches /novakai/agent/sessions from the dev-only
   K2 bridge (vite-agent-bridge.mjs) via the contracts.ts fetchJson
   pattern; offline/CI the list container renders present but empty.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import { renderChat } from './agents-chat';
import '../../css/agents.css';

export interface AgentsApi {
  render(): HTMLElement;
}

interface BridgeSession { id: string; title: string; ts: string }
interface ChatSession { id: string | null; title: string }

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

async function loadSessions(): Promise<BridgeSession[]> {
  return (await fetchJson<BridgeSession[]>('/novakai/agent/sessions')) ?? [];
}

/** one tiny local helper — '2m ago' style; falls back to '' for an
    unparseable/missing timestamp rather than throwing. */
function relativeTime(ts: string): string {
  const then = Date.parse(ts);
  if (Number.isNaN(then)) return '';
  const deltaSec = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (deltaSec < 60) return 'just now';
  const min = Math.round(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

function sessionTitle(session: BridgeSession, index: number, count: number): string {
  return session.title || `novakai ${count - index}`;
}

function renderRow(session: BridgeSession, index: number, count: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'agents-row';
  const title = document.createElement('span');
  title.className = 'agents-row-title';
  title.textContent = sessionTitle(session, index, count);
  const time = document.createElement('span');
  time.className = 'agents-row-time';
  time.textContent = relativeTime(session.ts);
  row.append(title, time);
  return row;
}

const VISIBLE_ROWS = 3;

function renderList(sessions: BridgeSession[], onOpen: (session: ChatSession) => void): HTMLElement {
  const list = document.createElement('div');
  list.className = 'agents-list';
  sessions.forEach((session, index) => {
    list.appendChild(renderRow(session, index, sessions.length));
  });
  if (sessions.length > VISIBLE_ROWS) {
    list.classList.add('collapsed');
    list.onclick = () => {
      const expanded = list.classList.toggle('expanded');
      list.classList.toggle('collapsed', !expanded);
    };
  }
  list.addEventListener('click', (ev) => {
    const rowEl = (ev.target as HTMLElement).closest('.agents-row');
    if (!rowEl) return;
    const idx = Array.from(list.children).indexOf(rowEl);
    const session = sessions[idx];
    if (session) onOpen({ id: session.id, title: sessionTitle(session, idx, sessions.length) });
  });
  return list;
}

function renderHome(onOpen: (session: ChatSession) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'agents-home';

  const title = document.createElement('h1');
  title.className = 'agents-title';
  title.textContent = 'Agents';
  wrap.appendChild(title);

  let sessionCount = 0;

  const newChat = document.createElement('button');
  newChat.type = 'button';
  newChat.className = 'agents-new-chat';
  newChat.textContent = 'New chat';
  newChat.onclick = () => onOpen({ id: null, title: `novakai ${sessionCount + 1}` });
  wrap.appendChild(newChat);

  const listWrap = document.createElement('div');
  listWrap.className = 'agents-list-wrap';
  wrap.appendChild(listWrap);

  loadSessions().then((sessions) => {
    sessionCount = sessions.length;
    listWrap.appendChild(renderList(sessions, onOpen));
  });

  return wrap;
}

// swaps body's content in place with a 500ms var(--ease) crossfade
function swapBody(body: HTMLElement, next: HTMLElement): void {
  body.classList.add('agents-swap-out');
  requestAnimationFrame(() => {
    body.innerHTML = '';
    body.appendChild(next);
    requestAnimationFrame(() => body.classList.remove('agents-swap-out'));
  });
}

function openChat(ctx: AppContext, session: ChatSession, body: HTMLElement, onBack: () => void): void {
  const host = document.createElement('div');
  host.className = 'agents-chat-host';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'agents-back';
  back.textContent = '← agents';
  back.onclick = onBack;
  host.appendChild(back);
  host.appendChild(renderChat(ctx, session));
  swapBody(body, host);
}

export function initAgents(ctx: AppContext): AgentsApi {
  function render(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'agents-page';
    const body = document.createElement('div');
    body.className = 'agents-page-body';
    root.appendChild(body);

    function showHome(): void {
      swapBody(body, renderHome((session) => openChat(ctx, session, body, showHome)));
    }

    showHome();
    return root;
  }
  return { render };
}
