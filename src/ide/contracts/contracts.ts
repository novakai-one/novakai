/* =====================================================================
   contracts.ts — K4 Contracts tab: the keystone certificate view
   ---------------------------------------------------------------------
   Responsibility: initContracts(ctx) fills the K-seam stub. Renders the
   repo's REAL plan/packet/verdict artifacts and — new this slice — reads
   and writes lifecycle ContractRecords over the dev file bridge
   (contract-store.ts): the tab is no longer read-only, it can create a
   contract from a plan change or free-form, and advance its status.
   Packets and verdicts stay read-only either way; tooling is never
   invoked from the browser (docs/ide-vision/SPEC_CONTRACTS.md §0/§8).

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
   the SAME mounted container directly. Backing out of a document always
   re-fetches (not just re-renders the cache) so a lifecycle write made
   while reading the document is reflected in the list.
   ===================================================================== */

import type { AppContext } from '../../core/context/context';
import '../../../css/contracts.css';
import { renderDocument } from './contracts-doc';
import { renderList } from './contracts-list';
import { loadRecords } from './contract-store';
import type { ContractRecord } from './contract-record';

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

/** a row is the union-join of a plan change and a lifecycle record by id.
    `change` is null only for a record-only row (a free-form contract, or
    one whose plan change has since left the plan). */
export interface ContractRow {
  change: PlanChange | null;
  packet: ContractPacket | null;
  verdict: Verdict | null;
  record: ContractRecord | null;
}

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

async function loadChangeRows(
  changes: PlanChange[], files: Set<string>, recordsById: Map<string, ContractRecord>,
): Promise<ContractRow[]> {
  return Promise.all(changes.map(async (change): Promise<ContractRow> => {
    const packet = files.has(`${change.id}.packet.json`)
      ? await fetchJson<ContractPacket>(`contracts/${change.id}.packet.json`)
      : null;
    const verdict = files.has(`${change.id}.verdict.json`)
      ? await fetchJson<Verdict>(`contracts/${change.id}.verdict.json`)
      : null;
    return { change, packet, verdict, record: recordsById.get(change.id) ?? null };
  }));
}

interface LoadedRows { rows: ContractRow[]; planBase: string; bridgeUp: boolean }

/** index-first for packet/verdict (spec §1); lifecycle records come from
    the dev bridge (loadRecords() returns null when it's absent — NEVER
    inferred from an empty list) and are union-joined onto the plan's
    changes by id, so a free-form record still gets its own row. */
async function loadRows(): Promise<LoadedRows> {
  const plan = await fetchJson<Plan>('plan.json');
  const index = await fetchJson<ArtifactIndex>('contracts/index.json');
  const records = await loadRecords();
  const bridgeUp = records !== null;
  const files = new Set(index?.files ?? []);
  const changes = plan?.changes ?? [];
  const recordsById = new Map((records ?? []).map((record) => [record.id, record]));
  const changeRows = await loadChangeRows(changes, files, recordsById);
  const changeIds = new Set(changes.map((change) => change.id));
  const recordOnlyRows: ContractRow[] = (records ?? [])
    .filter((record) => !changeIds.has(record.id))
    .map((record) => ({ change: null, packet: null, verdict: null, record }));
  return { rows: [...changeRows, ...recordOnlyRows], planBase: plan?.base ?? '', bridgeUp };
}

/* ---------- document page (delegates section rendering to contracts-doc.ts) ---------- */

function renderDocumentView(row: ContractRow, planBase: string, bridgeUp: boolean, onBack: () => void): HTMLElement {
  const wrap = document.createElement('div');
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'ctr-back';
  back.textContent = '← builds';
  back.onclick = onBack;
  wrap.append(back, renderDocument(row, planBase, bridgeUp));
  return wrap;
}

interface ContractsPageState {
  body: HTMLElement;
  rows: ContractRow[];
  planBase: string;
  bridgeUp: boolean;
}

function showList(state: ContractsPageState, openDocFn: (id: string) => void, refreshFn: () => void): void {
  state.body.innerHTML = '';
  state.body.appendChild(renderList(state.rows, state.bridgeUp, openDocFn, refreshFn));
}

function openDoc(state: ContractsPageState, id: string, refreshFn: () => void): void {
  const row = state.rows.find((candidate) => (candidate.change?.id ?? candidate.record?.id) === id);
  if (!row) return;
  state.body.innerHTML = '';
  state.body.appendChild(renderDocumentView(row, state.planBase, state.bridgeUp, refreshFn));
}

function refresh(state: ContractsPageState, showListFn: () => void): void {
  loadRows().then((loaded) => {
    state.rows = loaded.rows;
    state.planBase = loaded.planBase;
    state.bridgeUp = loaded.bridgeUp;
    showListFn();
  });
}

export function initContracts(ctx: AppContext): ContractsApi {
  void ctx; // artifact + record fetch/write over the dev bridge — no ctx.state/hooks needed this slice
  function render(): HTMLElement {
    const root = document.createElement('div');
    root.className = 'contracts-page';
    const body = document.createElement('div');
    root.appendChild(body);
    const state: ContractsPageState = {
      body, rows: [], planBase: '', bridgeUp: false,
    };
    const openDocFn = (id: string): void => openDoc(state, id, refreshFn);
    const refreshFn = (): void => refresh(state, () => showList(state, openDocFn, refreshFn));
    refreshFn();
    return root;
  }
  return { render };
}
