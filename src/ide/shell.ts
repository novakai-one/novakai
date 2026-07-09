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

   No ShellApi — nothing navigates through the shell itself. Every
   non-codebase page needs its render function at route time; that's a
   plain one-way dependency (house deps-injection:
   `initShell(ctx, { renderDesign, renderContracts, ... })`), not a
   cycle, so no hook was added. Design's own Design->Contracts hand-off
   uses `location.hash = 'contracts'` directly — the exact mechanism
   buildRailItem's onclick below already uses — so the `go(page)` return
   this comment once anticipated stayed unbuilt (SPEC_DESIGN.md §4).

   K-seam: the other 6 tabs (home/contracts/agents/files/analytics/rules)
   are now real pages too — thin stub modules (src/ide/{home,contracts,
   agents,files,analytics,rules}.ts) that, for now, render the exact same
   pages.ts EMPTY row + emptyPage() content the shell used to look up
   directly. Pre-wired so each K4/K6-K10 lane owns its own tab file and
   never touches shell.ts/main.ts/pages.ts again.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import { RAIL_ICONS } from './pages';

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

function railSpan(className: string): HTMLSpanElement {
  const span = document.createElement('span');
  span.className = className;
  return span;
}

function buildRailItem(id: TabId): HTMLButtonElement {
  const item = document.createElement('button');
  item.className = 'rail-item';
  item.type = 'button';
  item.dataset.tab = id;

  const icon = railSpan('rail-icon');
  icon.innerHTML = RAIL_ICONS[id];

  const label = railSpan('rail-label');
  label.textContent = id;

  item.append(icon, label);
  item.onclick = () => {
    location.hash = id;
  };
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

type NonCodebaseTab = Exclude<TabId, 'codebase'>;
type Renderers = Record<NonCodebaseTab, () => HTMLElement>;

/** a non-codebase page is just an HTMLElement rebuilt on every route change
    (SPEC_SHELL §5) — the empty pages are trivially cheap, no lifecycle. Every
    non-codebase tab renders through its own dep-injected function, threaded
    in explicitly since this function sits outside `initShell`'s closure and
    has no other way to reach them (no new hook — a one-way shell->page call
    is a plain dependency, not a cycle). */
function renderHost(host: HTMLElement, tab: TabId, renderers: Renderers): void {
  host.innerHTML = '';
  if (tab === 'codebase') return;
  host.appendChild(renderers[tab]());
}

export interface ShellDeps {
  renderHome: () => HTMLElement;
  renderDesign: () => HTMLElement;
  renderContracts: () => HTMLElement;
  renderAgents: () => HTMLElement;
  renderFiles: () => HTMLElement;
  renderAnalytics: () => HTMLElement;
  renderRules: () => HTMLElement;
}

function buildRenderers(deps: ShellDeps): Renderers {
  return {
    home: deps.renderHome,
    design: deps.renderDesign,
    contracts: deps.renderContracts,
    agents: deps.renderAgents,
    files: deps.renderFiles,
    analytics: deps.renderAnalytics,
    rules: deps.renderRules,
  };
}

export function initShell(ctx: AppContext, deps: ShellDeps): void {
  void ctx; // the router only reads location.hash and paints chrome at K3; later
            // phases (K6+) will read ctx.state — kept for the house initX(ctx) shape
  const railEl = document.getElementById('rail');
  const hostEl = document.getElementById('host');
  if (!railEl || !hostEl) return;
  const rail: HTMLElement = railEl;
  const host: HTMLElement = hostEl;
  const items = buildRail(rail);
  const renderers = buildRenderers(deps);

  function route(): void {
    const tab = currentTab();
    setActive(items, tab);
    const showEditor = tab === 'codebase';
    host.style.display = showEditor ? 'none' : 'block';
    if (!showEditor) renderHost(host, tab, renderers);
  }

  window.addEventListener('hashchange', route);
  route();
}
