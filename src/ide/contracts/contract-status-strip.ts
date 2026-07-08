/* =====================================================================
   contract-status-strip.ts — K4 Contracts tab: lifecycle status strip
   ---------------------------------------------------------------------
   The per-document status strip: current status chip, an Advance button
   that steps the record forward one status via the dev file bridge, the
   record's history, and its non-null refs. Also the "no contract record"
   + Create-contract fallback for a row that has no record yet — the same
   create flow as the list (contracts-list.ts), just triggered from the
   document view instead. Split out of contracts-doc.ts to keep that file
   under the K11 max-lines BLOCK-tier limit.
   ===================================================================== */

import type { ContractRow } from './contracts';
import {
  advance, createRecord, nextStatus, type ContractRecord, type ContractStatus,
} from './contract-record';
import { saveRecord } from './contract-store';
import { statusChip } from './contracts-list';

export type RecordChangeHandler = (updated: ContractRecord) => void;

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

async function runAdvance(record: ContractRecord, onChange: RecordChangeHandler): Promise<void> {
  const updated = advance(record);
  if (await saveRecord(updated)) onChange(updated);
}

function renderAdvanceButton(record: ContractRecord, next: ContractStatus, onChange: RecordChangeHandler): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ctr-action-btn';
  btn.textContent = `Advance → ${next}`;
  btn.onclick = () => { void runAdvance(record, onChange); };
  return btn;
}

async function runCreate(row: ContractRow, onChange: RecordChangeHandler): Promise<void> {
  const id = row.change?.id ?? row.record?.id;
  if (!id) return;
  const title = row.change?.intent?.approach ?? id;
  const refs = row.change
    ? { plan: id, packet: `contracts/${id}.packet.json`, verdict: `contracts/${id}.verdict.json` }
    : {};
  const record = createRecord(id, title, refs);
  if (await saveRecord(record)) onChange(record);
}

function renderDocCreateButton(row: ContractRow, onChange: RecordChangeHandler): HTMLElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ctr-action-btn';
  btn.textContent = 'Create contract';
  btn.onclick = () => { void runCreate(row, onChange); };
  return btn;
}

function renderHistoryList(history: ContractRecord['history']): HTMLElement {
  const list = el('div', 'ctr-history-list');
  for (const entry of history) {
    const line = el('div', 'ctr-history-row', `${entry.from} → ${entry.to} · ${entry.at}`);
    list.appendChild(line);
  }
  return list;
}

const REF_LABELS: Record<keyof ContractRecord['refs'], string> = {
  plan: 'plan', packet: 'packet', verdict: 'verdict', design: 'design', sessionId: 'session', decision: 'decision',
};

/** only non-null refs render — an absent ref is not "unset", it just isn't
    part of this contract's shape (a free-form record has no plan/packet). */
function renderRefsList(refs: ContractRecord['refs']): HTMLElement {
  const list = el('div', 'ctr-refs-list');
  for (const key of Object.keys(refs) as (keyof ContractRecord['refs'])[]) {
    const value = refs[key];
    if (value === null) continue;
    list.appendChild(el('div', 'ctr-refs-row', `${REF_LABELS[key]}: ${value}`));
  }
  return list;
}

export function renderStatusStrip(row: ContractRow, bridgeUp: boolean, onChange: RecordChangeHandler): HTMLElement {
  const strip = el('div', 'ctr-status-strip');
  const record = row.record;
  if (!record) {
    strip.appendChild(el('span', 'ctr-pending-line', 'no contract record'));
    if (bridgeUp) strip.appendChild(renderDocCreateButton(row, onChange));
    return strip;
  }
  strip.appendChild(statusChip(record.status));
  const next = nextStatus(record.status);
  if (bridgeUp && next) strip.appendChild(renderAdvanceButton(record, next, onChange));
  strip.append(renderHistoryList(record.history), renderRefsList(record.refs));
  return strip;
}
