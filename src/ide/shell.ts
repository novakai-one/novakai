/* =====================================================================
   shell.ts — IDE shell: left icon rail + hash router + page host
   ---------------------------------------------------------------------
   Responsibility: paint the 8-item rail (#rail), and route between the
   Codebase page (the existing editor, untouched — #host stays hidden and
   #main shows through) and the 7 designed empty states rendered into
   #host by pages.ts's emptyPage(). Instant swap, no lifecycle: a non-
   codebase page is just an HTMLElement rebuilt on every route change
   (SPEC_SHELL §4/§5). Default route is codebase, so boot with an empty
   hash lands exactly where the app does today.

   No ShellApi at K3 — nothing navigates programmatically yet (K5 adds a
   `go(page)` return when the Design->Contracts hand-off needs it).
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import { EMPTY, emptyPage, RAIL_ICONS } from './pages';

const TAB_ORDER = ['home', 'design', 'codebase', 'contracts', 'agents', 'files', 'analytics', 'rules'] as const;
type TabId = typeof TAB_ORDER[number];
const DEFAULT_TAB: TabId = 'codebase';

function isTabId(value: string): value is TabId {
  return (TAB_ORDER as readonly string[]).includes(value);
}

/** hash carries the page id only (SPEC_SHELL §4); unknown/empty falls back to codebase */
function currentTab(): TabId {
  const raw = location.hash.slice(1);
  return isTabId(raw) ? raw : DEFAULT_TAB;
}

function buildRailItem(id: TabId): HTMLButtonElement {
  const item = document.createElement('button');
  item.className = 'rail-item';
  item.type = 'button';
  item.dataset.tab = id;

  const icon = document.createElement('span');
  icon.className = 'rail-icon';
  icon.innerHTML = RAIL_ICONS[id];

  const label = document.createElement('span');
  label.className = 'rail-label';
  label.textContent = id;

  item.append(icon, label);
  item.onclick = () => { location.hash = id; };
  return item;
}

/** the always-on trust signal — a non-interactive shield whose hover title
    is the real proving command (SPEC_SHELL §1) */
function buildGateGlyph(): HTMLDivElement {
  const gate = document.createElement('div');
  gate.className = 'rail-gate';
  gate.innerHTML = RAIL_ICONS.gate;
  gate.title = 'npm run novakai:onboard';
  return gate;
}

function buildRail(rail: HTMLElement): Map<TabId, HTMLButtonElement> {
  const items = new Map<TabId, HTMLButtonElement>();
  for (const id of TAB_ORDER) {
    const item = buildRailItem(id);
    rail.appendChild(item);
    items.set(id, item);
  }
  const spacer = document.createElement('div');
  spacer.className = 'rail-spacer';
  rail.appendChild(spacer);
  rail.appendChild(buildGateGlyph());
  return items;
}

function setActive(items: Map<TabId, HTMLButtonElement>, tab: TabId): void {
  for (const [id, item] of items) item.classList.toggle('active', id === tab);
}

/** a non-codebase page is just an HTMLElement rebuilt on every route change
    (SPEC_SHELL §5) — the empty pages are trivially cheap, no lifecycle */
function renderHost(host: HTMLElement, tab: TabId): void {
  host.innerHTML = '';
  const def = EMPTY.find((row) => row.id === tab);
  if (def) host.appendChild(emptyPage(def));
}

export function initShell(ctx: AppContext): void {
  void ctx; // the router only reads location.hash and paints chrome at K3; later
            // phases (K5+) will read ctx.state — kept for the house initX(ctx) shape
  const railEl = document.getElementById('rail');
  const hostEl = document.getElementById('host');
  if (!railEl || !hostEl) return;
  const rail: HTMLElement = railEl;
  const host: HTMLElement = hostEl;
  const items = buildRail(rail);

  function route(): void {
    const tab = currentTab();
    setActive(items, tab);
    const showEditor = tab === 'codebase';
    host.style.display = showEditor ? 'none' : 'block';
    if (!showEditor) renderHost(host, tab);
  }

  window.addEventListener('hashchange', route);
  route();
}
