/* =====================================================================
   contracts.ts — K4 Contracts tab: the keystone certificate view
   ---------------------------------------------------------------------
   Responsibility: initContracts(ctx) fills the K-seam stub. Read-only —
   renders the repo's REAL plan/packet/verdict artifacts, never invokes
   tooling, never mutates state (docs/ide-vision/SPEC_CONTRACTS.md §0/§8).

   Index-first discovery (spec §1): fetch /plan.json + /contracts/
   index.json once, then fetch ONLY the packet/verdict files the index
   lists — the page never fetches a URL that can 404 (zero-console-error
   bar). Fetch paths are relative (no leading slash), matching main.ts's
   own `fetch('bodies.json')` convention so a sub-path deploy still works
   (vite.config base:'./').

   Sub-route (spec §2 fallback): the merged seam's shell.ts routes by
   EXACT hash membership in TAB_ORDER, so `#contracts/<id>` falls back to
   the codebase tab rather than reaching this page — fallback (b) applies.
   The document swap is in-page state only: render() always starts at the
   list (pure function of the hash alone); a card's "Review ->" mutates
   the SAME mounted container directly. Leaving and returning to the tab
   re-renders from scratch, back at the list — no residual state, no
   localStorage (KEY_DECISIONS §4.1).
   ===================================================================== */

import type { AppContext } from '../core/context/context';
import '../../css/contracts.css';
import { renderDocument } from './contracts-doc';

export interface ContractsApi {
  render(): HTMLElement;
}

/* ---------- artifact shapes (every field here is a real JSON path —
   see SPEC_CONTRACTS.md §3/§4 for the mapping) ---------- */

export interface PlanChangeTarget { kind: string; ref: string }
export interface PlanChangeIntent {
  problem?: string; approach?: string; rationale?: string; alternative?: string; tradeoff?: string;
}
export interface PlanChangeAcceptanceCase { name: string }
export interface PlanChange {
  id: string;
  status?: string;
  phase?: number;
  risk?: string;
  target?: PlanChangeTarget;
  intent?: PlanChangeIntent;
  acceptance?: { cases: PlanChangeAcceptanceCase[] };
}
export interface Plan { base: string; changes: PlanChange[] }

export interface PacketSignatureIface { name: string; accepts: string[]; returns: string[] }
export interface PacketSignature { name: string; description: string; interfaces: PacketSignatureIface[] }
export interface PacketSource { path: string; symbol: string }
export interface SubMapNode { id: string; kind: string; parent?: string }
export interface SubMapEdge { from: string; to: string; label?: string }
export interface ContractPacket {
  intent?: PlanChangeIntent | null;
  signature?: PacketSignature | null;
  source?: PacketSource | null;
  contractVersion: number;
  contractHash: string;
  deps: string[];
  coherent: boolean;
  coherenceProblems: string[];
  blastRadius: { affected: string[]; entryPoints: string[]; maxDepth: number } | null;
  subMap: { nodes: Record<string, SubMapNode>; edges: SubMapEdge[] } | null;
}
export interface VerdictCase { name: string; pass: boolean }
export interface Verdict {
  structural: { status: string };
  behavioural: { hasContract: boolean; total: number; passed: number; proven: boolean; cases: VerdictCase[] };
  verdict: 'PASS' | 'PASS_UNPROVEN' | 'FAIL';
  verdictHash: string;
}
export interface BuildRow { change: PlanChange; packet: ContractPacket | null; verdict: Verdict | null }

interface ArtifactIndex { v: number; files: string[] }

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** index-first: only fetch a packet/verdict when its filename is listed
    in contracts/index.json — an unlisted artifact is absent, cost-free,
    404-free (spec §1). Eager, not lazy: grouping needs every verdict up
    front for the first paint. */
async function loadRows(): Promise<{ rows: BuildRow[]; planBase: string }> {
  const plan = await fetchJson<Plan>('plan.json');
  const index = await fetchJson<ArtifactIndex>('contracts/index.json');
  const files = new Set(index?.files ?? []);
  const changes = plan?.changes ?? [];
  const rows = await Promise.all(changes.map(async (change): Promise<BuildRow> => {
    const packet = files.has(`${change.id}.packet.json`)
      ? await fetchJson<ContractPacket>(`contracts/${change.id}.packet.json`)
      : null;
    const verdict = files.has(`${change.id}.verdict.json`)
      ? await fetchJson<Verdict>(`contracts/${change.id}.verdict.json`)
      : null;
    return { change, packet, verdict };
  }));
  return { rows, planBase: plan?.base ?? '' };
}

function isDone(row: BuildRow): boolean {
  return row.verdict !== null && row.verdict.verdict === 'PASS';
}

/* ---------- list page ---------- */

function metaChip(text: string): HTMLElement {
  const chip = document.createElement('span');
  chip.className = 'ctr-chip';
  chip.textContent = text;
  return chip;
}

function renderMetaRow(change: PlanChange): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ctr-meta-row';
  if (change.status) row.appendChild(metaChip(change.status));
  if (change.phase !== undefined) row.appendChild(metaChip(`phase ${change.phase}`));
  if (change.risk) row.appendChild(metaChip(`${change.risk} risk`));
  if (change.target) row.appendChild(metaChip(change.target.ref));
  return row;
}

function renderNeedsYouCard(row: BuildRow, onOpen: (id: string) => void): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'ctr-card';
  const top = document.createElement('div');
  top.className = 'ctr-card-top';
  const title = document.createElement('span');
  title.className = 'ctr-card-title';
  title.textContent = row.change.id;
  top.appendChild(title);
  const action = document.createElement('span');
  action.className = 'ctr-card-action';
  action.textContent = 'Review →';
  card.append(top, renderMetaRow(row.change), action);
  card.onclick = () => onOpen(row.change.id);
  return card;
}

function renderDoneRow(row: BuildRow, onOpen: (id: string) => void): HTMLElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'ctr-row';
  const top = document.createElement('div');
  top.className = 'ctr-row-top';
  const title = document.createElement('span');
  title.className = 'ctr-row-title';
  title.textContent = row.change.id;
  top.appendChild(title);
  item.append(top, renderMetaRow(row.change));
  item.onclick = () => onOpen(row.change.id);
  return item;
}

function renderRollup(total: number, needsYou: number): HTMLElement {
  const rollup = document.createElement('div');
  rollup.className = 'ctr-rollup';
  const you = document.createElement('span');
  you.className = 'ctr-rollup-you';
  you.textContent = `${needsYou} needs you`;
  rollup.append(`${total} builds · `, you);
  return rollup;
}

function renderDoneSection(rows: BuildRow[], onOpen: (id: string) => void): HTMLElement | null {
  if (!rows.length) return null;
  const frag = document.createElement('div');
  const head = document.createElement('div');
  head.className = 'ctr-done-head';
  const label = document.createElement('span');
  label.className = 'ctr-done-label';
  label.textContent = 'DONE';
  const rule = document.createElement('div');
  rule.className = 'ctr-done-rule';
  head.append(label, rule);
  frag.appendChild(head);
  for (const row of rows) frag.appendChild(renderDoneRow(row, onOpen));
  return frag;
}

/** the list grammar: raised needs-you cards, a DONE hairline group, and a
    right-aligned roll-up — all computed pure over the fetched rows
    (SPEC_CONTRACTS.md §3). No page title eyebrow — the rail already
    reads "contracts" (declared delta, mirrors K5's dropped eyebrow). */
function renderList(rows: BuildRow[], onOpen: (id: string) => void): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'ctr-list';
  const head = document.createElement('div');
  head.className = 'ctr-list-head';
  const title = document.createElement('h1');
  title.className = 'ctr-list-title';
  title.textContent = 'Contracts';
  const needsYou = rows.filter((row) => !isDone(row));
  head.append(title, renderRollup(rows.length, needsYou.length));
  wrap.appendChild(head);
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'ctr-empty';
    empty.textContent = 'no changes in the plan';
    wrap.appendChild(empty);
    return wrap;
  }
  for (const row of needsYou) wrap.appendChild(renderNeedsYouCard(row, onOpen));
  const done = renderDoneSection(rows.filter(isDone), onOpen);
  if (done) wrap.appendChild(done);
  return wrap;
}

/* ---------- document page (delegates section rendering to contracts-doc.ts) ---------- */

function renderDocumentView(row: BuildRow, planBase: string, onBack: () => void): HTMLElement {
  const wrap = document.createElement('div');
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'ctr-back';
  back.textContent = '← builds';
  back.onclick = onBack;
  wrap.append(back, renderDocument(row, planBase));
  return wrap;
}

export function initContracts(ctx: AppContext): ContractsApi {
  void ctx; // read-only render over fetched artifacts — no ctx.state/hooks needed this slice
  function render(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'contracts-page';
    const body = document.createElement('div');
    root.appendChild(body);

    let rowsCache: BuildRow[] = [];
    let planBase = '';

    function showList(): void {
      body.innerHTML = '';
      body.appendChild(renderList(rowsCache, openDoc));
    }
    function openDoc(id: string): void {
      const row = rowsCache.find((candidate) => candidate.change.id === id);
      if (!row) return;
      body.innerHTML = '';
      body.appendChild(renderDocumentView(row, planBase, showList));
    }

    loadRows().then(({ rows, planBase: base }) => {
      rowsCache = rows;
      planBase = base;
      showList();
    });
    return root;
  }
  return { render };
}
