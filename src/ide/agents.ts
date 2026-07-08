/* =====================================================================
   agents.ts — K6 Agents tab: real Claude Code in a real terminal
   ---------------------------------------------------------------------
   Responsibility: initAgents(ctx) self-mounts ONE persistent sibling
   layer (#agentsPage) on document.body — a session strip + one xterm.js
   pane per session — and toggles its own visibility on hashchange
   (docs/ide-vision/SPEC_AGENTS.md §1/§2). Sessions are module-local
   (never ctx.state, §3): panes are never destroyed on tab switch, so
   scrollback survives. render() stays the seam's covered K3 empty state
   so main.ts/shell.ts/pages.ts stay byte-identical (§2/§11).

   Empty-state markup (.empty/.empty-cmd) is built locally rather than by
   importing pages.ts's emptyPage(): same BINDING grammar, byte-identical
   output, but this module then carries no call edge into another tab's
   file — pages.ts stays untouched and out of this change's dependency
   slice, exactly like every other K-seam lane.
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import { createSession } from './agents-session';
import '@xterm/xterm/css/xterm.css';
import './agents.css';

export interface AgentsApi {
  render(): HTMLElement;
}

type SessionHandle = ReturnType<typeof createSession>;
type SessionStatus = 'running' | 'exited' | 'disconnected';
type BridgeStatus = SessionStatus | 'spawn-failed' | 'bridge-broken';

interface AgentSession {
  id: string;
  ordinal: number;
  status: SessionStatus;
  exitCode: number | null;
  handle: SessionHandle;
  chip: HTMLElement;
}

interface AgentsController {
  layer: HTMLElement;
  strip: HTMLElement;
  newBtn: HTMLButtonElement;
  termArea: HTMLElement;
  sessions: AgentSession[];
  activeId: string | null;
  nextOrdinal: number;
}

interface StateCopy {
  line1: string;
  cmd: string;
}

// §8 empty-state copy, verbatim.
const SPEC_REF = '(SPEC_AGENTS §4)';
const NO_SESSIONS: StateCopy = { line1: 'run Claude Code in a real terminal, in the repo', cmd: '+ new session — spawns claude at the repo root' };
const BRIDGE_ABSENT: StateCopy = { line1: 'no PTY bridge in this build', cmd: `npm run dev — the bridge lives in the dev server ${SPEC_REF}` };
const BRIDGE_BROKEN: StateCopy = { line1: 'the PTY bridge did not answer', cmd: `check the dev-server log — node-pty may have failed to load ${SPEC_REF}` };
const SPAWN_FAILED: StateCopy = { line1: 'claude did not start', cmd: `is claude on the PATH of the shell that ran npm run dev? ${SPEC_REF}` };
// pages.ts's own (frozen) EMPTY row content for 'agents' — reproduced
// verbatim for the covered K3 stub render() must keep returning (§2/§11).
const COVERED_STUB: StateCopy = { line1: 'run Claude Code in a real terminal, in the repo', cmd: 'agents — xterm over the dev-server bridge · K6' };

/* ---------------- termArea empty/failure states ---------------- */

// The BINDING empty-state grammar (PROTO_MANIFEST.md:94) — one dim mono
// line + a fainter command beneath it. Mirrors pages.ts's emptyPage()
// exactly (same classes/markup), kept local per the note above.
function buildEmptyState(copy: StateCopy): HTMLElement {
  const page = document.createElement('div');
  page.className = 'empty';
  const line = document.createElement('div');
  line.textContent = copy.line1;
  const cmd = document.createElement('div');
  cmd.className = 'empty-cmd';
  cmd.textContent = copy.cmd;
  page.append(line, cmd);
  return page;
}

function showState(termArea: HTMLElement, copy: StateCopy): void {
  hideState(termArea);
  const el = buildEmptyState(copy);
  el.classList.add('agents-state');
  termArea.appendChild(el);
}

function hideState(termArea: HTMLElement): void {
  termArea.querySelector('.agents-state')?.remove();
}

/** Shown whenever no session exists — the honest static split between a
    real dev bridge (no-sessions) and a production build (bridge-absent). */
function renderTermState(ctl: AgentsController): void {
  if (ctl.sessions.length > 0) return;
  showState(ctl.termArea, import.meta.env.DEV ? NO_SESSIONS : BRIDGE_ABSENT);
}

/* ---------------- chip ---------------- */

function chipSuffixText(session: AgentSession): string {
  if (session.status === 'exited') return ` · exited ${session.exitCode ?? 0}`;
  if (session.status === 'disconnected') return ' · disconnected';
  return '';
}

function updateChipSuffix(session: AgentSession): void {
  const suffixEl = session.chip.querySelector<HTMLElement>('.chip-suffix');
  if (suffixEl) suffixEl.textContent = chipSuffixText(session);
  session.chip.classList.toggle('ended', session.status !== 'running');
}

function buildChipDom(ordinal: number): { chip: HTMLElement; closeEl: HTMLElement } {
  const chip = document.createElement('div');
  chip.className = 'agents-chip';
  const label = document.createElement('span');
  label.className = 'chip-label';
  label.textContent = `claude ${ordinal}`;
  const suffix = document.createElement('span');
  suffix.className = 'chip-suffix';
  const closeEl = document.createElement('span');
  closeEl.className = 'chip-x';
  closeEl.textContent = '×';
  chip.append(label, suffix, closeEl);
  return { chip, closeEl };
}

// Running sessions confirm in place: × -> literal "end?" text, a second
// click within it commits; pointerleave or any other click reverts. Ended
// sessions (nothing left to lose) close on one click (§5).
function wireChipClose(ctl: AgentsController, closeEl: HTMLElement, getSession: () => AgentSession): void {
  let armed = false;
  const onDocPointer = (ev: Event): void => { if (ev.target !== closeEl) disarm(); };
  function disarm(): void {
    armed = false;
    closeEl.textContent = '×';
    document.removeEventListener('pointerdown', onDocPointer, true);
  }
  closeEl.addEventListener('pointerleave', () => { if (armed) disarm(); });
  closeEl.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const session = getSession();
    if (session.status !== 'running') { closeSession(ctl, session); return; }
    if (!armed) {
      armed = true;
      closeEl.textContent = 'end?';
      document.addEventListener('pointerdown', onDocPointer, true);
      return;
    }
    disarm();
    closeSession(ctl, session);
  });
}

/* ---------------- session lifecycle ---------------- */

function activateSession(ctl: AgentsController, id: string): void {
  const target = ctl.sessions.find((sess) => sess.id === id);
  if (!target) return;
  for (const sess of ctl.sessions) {
    if (sess.id !== id) sess.handle.pane.style.display = 'none';
    sess.chip.classList.toggle('active', sess.id === id);
  }
  ctl.activeId = id;
  hideState(ctl.termArea);
  target.handle.activate();
}

function disposeSession(ctl: AgentsController, session: AgentSession): void {
  session.handle.dispose();
  session.chip.remove();
  ctl.sessions = ctl.sessions.filter((sess) => sess.id !== session.id);
  if (ctl.activeId === session.id) ctl.activeId = null;
}

function reconcileActive(ctl: AgentsController): void {
  if (ctl.activeId !== null) return;
  const last = ctl.sessions[ctl.sessions.length - 1];
  if (last) activateSession(ctl, last.id);
  else renderTermState(ctl);
}

function closeSession(ctl: AgentsController, session: AgentSession): void {
  disposeSession(ctl, session);
  reconcileActive(ctl);
}

// spawn-failed / bridge-broken (§5/§8): a session that never produced a
// PTY byte is a failed attempt, not a record — dispose it entirely and
// show the honest reason in place of a pane.
function handleFailedAttempt(ctl: AgentsController, session: AgentSession, copy: StateCopy): void {
  disposeSession(ctl, session);
  showState(ctl.termArea, copy);
}

function onSessionStatus(ctl: AgentsController, session: AgentSession, status: BridgeStatus, exitCode: number | null): void {
  if (status === 'spawn-failed') { handleFailedAttempt(ctl, session, SPAWN_FAILED); return; }
  if (status === 'bridge-broken') { handleFailedAttempt(ctl, session, BRIDGE_BROKEN); return; }
  session.status = status;
  session.exitCode = status === 'exited' ? exitCode : null;
  updateChipSuffix(session);
}

function createNewSession(ctl: AgentsController): void {
  const id = crypto.randomUUID();
  const ordinal = ctl.nextOrdinal++;
  let session: AgentSession;
  const handle = createSession({
    host: ctl.termArea,
    sessionId: id,
    contract: null,
    onStatus: (status, exitCode) => onSessionStatus(ctl, session, status, exitCode),
  });
  const { chip, closeEl } = buildChipDom(ordinal);
  wireChipClose(ctl, closeEl, () => session);
  chip.addEventListener('click', () => activateSession(ctl, id));
  session = { id, ordinal, status: 'running', exitCode: null, handle, chip };
  ctl.strip.insertBefore(chip, ctl.newBtn);
  ctl.sessions.push(session);
  activateSession(ctl, id);
}

/* ---------------- layer scaffolding + routing ---------------- */

function buildStrip(): { strip: HTMLElement; newBtn: HTMLButtonElement } {
  const strip = document.createElement('div');
  strip.className = 'agents-strip';
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'agents-new';
  newBtn.textContent = '+ new session';
  strip.appendChild(newBtn);
  return { strip, newBtn };
}

function buildLayer(strip: HTMLElement, termArea: HTMLElement): HTMLElement {
  const layer = document.createElement('div');
  layer.id = 'agentsPage';
  layer.append(strip, termArea);
  document.body.appendChild(layer);
  return layer;
}

// bridge-absent (§8): a production build has no dev server, so the bridge
// cannot exist — the + control is removed rather than offer a dead affordance.
function applyBridgeAbsence(ctl: AgentsController): void {
  if (!import.meta.env.DEV) ctl.newBtn.remove();
}

function isAgentsRoute(): boolean {
  return location.hash.slice(1) === 'agents';
}

// §2: the module owns its own visibility — show/hide via a class, never
// inline styles. On show: fit() + focus the active terminal.
function syncVisibility(ctl: AgentsController): void {
  const show = isAgentsRoute();
  ctl.layer.classList.toggle('show', show);
  if (!show) return;
  ctl.sessions.find((sess) => sess.id === ctl.activeId)?.handle.activate();
}

function refit(ctl: AgentsController): void {
  ctl.sessions.find((sess) => sess.id === ctl.activeId)?.handle.activate();
}

function mountLayer(): void {
  const { strip, newBtn } = buildStrip();
  const termArea = document.createElement('div');
  termArea.className = 'agents-term-area';
  const layer = buildLayer(strip, termArea);
  const ctl: AgentsController = { layer, strip, newBtn, termArea, sessions: [], activeId: null, nextOrdinal: 1 };

  newBtn.onclick = () => createNewSession(ctl);
  new ResizeObserver(() => refit(ctl)).observe(termArea);
  window.addEventListener('hashchange', () => syncVisibility(ctl));

  applyBridgeAbsence(ctl);
  renderTermState(ctl);
  syncVisibility(ctl); // initial check — a direct #agents load fires no hashchange
}

export function initAgents(ctx: AppContext): AgentsApi {
  void ctx; // sessions are module-local, never ctx.state (SPEC_AGENTS §3)
  mountLayer();
  return {
    render(): HTMLElement {
      return buildEmptyState(COVERED_STUB);
    },
  };
}
