/* =====================================================================
   contracts-list.ts — K4 Contracts tab: the list-page view + create flows
   ---------------------------------------------------------------------
   Split out of contracts.ts to stay under the K11 max-lines-per-function/
   per-file BLOCK-tier limits once the list grew status chips + the two
   contract-creation flows (from a plan change, and free-form). Pure DOM
   builders over already-fetched ContractRow[], plus the two write flows
   (create-from-change, create-freeform) that call the dev file bridge
   directly and hand back through `onChanged` so contracts.ts reloads.
   ===================================================================== */

import type { ContractRow, PlanChange } from './contracts';
import { createRecord, isValidId, type ContractStatus } from './contract-record';
import { saveRecord } from './contract-store';

const STATUS_HUE: Record<ContractStatus, string> = {
  draft: 'dim', active: 'teal', review: 'amber', completed: 'green',
};

/** the lifecycle status chip — shared with contract-status-strip.ts so the
    list and the document strip render the exact same 4-state chip. */
export function statusChip(status: ContractStatus): HTMLElement {
  const chip = document.createElement('span');
  chip.className = `ctr-chip ctr-chip--${STATUS_HUE[status]}`;
  chip.textContent = status;
  return chip;
}

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

function renderCardMeta(row: ContractRow): HTMLElement {
  if (row.change) return renderMetaRow(row.change);
  const meta = document.createElement('div');
  meta.className = 'ctr-meta-row';
  meta.appendChild(metaChip(row.record!.id));
  return meta;
}

async function createFromChange(change: PlanChange, onChanged: () => void): Promise<void> {
  const title = change.intent?.approach ?? change.id;
  const record = createRecord(change.id, title, {
    plan: change.id,
    packet: `contracts/${change.id}.packet.json`,
    verdict: `contracts/${change.id}.verdict.json`,
  });
  if (await saveRecord(record)) onChanged();
}

/** a span (not a button) — it lives inside the card's own <button>, and a
    <button> may not contain interactive content, so the nested action is a
    span with role="button" instead of a real nested button. */
function renderCreateAction(change: PlanChange, onChanged: () => void): HTMLElement {
  const action = document.createElement('span');
  action.className = 'ctr-action-btn ctr-card-action';
  action.textContent = 'Create contract';
  action.setAttribute('role', 'button');
  action.tabIndex = 0;
  const run = (evt: Event): void => { evt.stopPropagation(); void createFromChange(change, onChanged); };
  action.onclick = run;
  action.onkeydown = (evt) => { if (evt.key === 'Enter' || evt.key === ' ') run(evt); };
  return action;
}

function renderCardAction(row: ContractRow, onChanged: () => void, bridgeUp: boolean): HTMLElement {
  if (row.change && !row.record && bridgeUp) return renderCreateAction(row.change, onChanged);
  const action = document.createElement('span');
  action.className = 'ctr-card-action';
  action.textContent = 'Review →';
  return action;
}

function renderNeedsYouCard(
  row: ContractRow, onOpen: (id: string) => void, onChanged: () => void, bridgeUp: boolean,
): HTMLElement {
  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'ctr-card';
  const top = document.createElement('div');
  top.className = 'ctr-card-top';
  const title = document.createElement('span');
  title.className = 'ctr-card-title';
  title.textContent = row.change ? row.change.id : row.record!.title;
  top.appendChild(title);
  if (row.record) top.appendChild(statusChip(row.record.status));
  card.append(top, renderCardMeta(row), renderCardAction(row, onChanged, bridgeUp));
  card.onclick = () => onOpen(row.change?.id ?? row.record!.id);
  return card;
}

function renderDoneRow(row: ContractRow, onOpen: (id: string) => void): HTMLElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'ctr-row';
  const top = document.createElement('div');
  top.className = 'ctr-row-top';
  const title = document.createElement('span');
  title.className = 'ctr-row-title';
  title.textContent = row.change!.id;
  top.appendChild(title);
  if (row.record) top.appendChild(statusChip(row.record.status));
  item.append(top, renderMetaRow(row.change!));
  item.onclick = () => onOpen(row.change!.id);
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

/** done = a real PASS verdict — record-only rows never have one, so they
    always sort into "needs you" until a real verify-change run seals them. */
function isDone(row: ContractRow): boolean {
  return row.verdict !== null && row.verdict.verdict === 'PASS';
}

function renderDoneSection(rows: ContractRow[], onOpen: (id: string) => void): HTMLElement | null {
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

async function createFreeform(idInput: HTMLInputElement, titleInput: HTMLInputElement, onChanged: () => void): Promise<void> {
  const id = idInput.value.trim();
  const title = titleInput.value.trim();
  if (!isValidId(id) || !title) return;
  if (await saveRecord(createRecord(id, title))) {
    idInput.value = '';
    titleInput.value = '';
    onChanged();
  }
}

/** free-form record creation (refs all null) — hidden entirely when the
    bridge is absent, there is no point offering a write the server can't
    accept. */
function renderNewContractRow(onChanged: () => void): HTMLElement {
  const row = document.createElement('div');
  row.className = 'ctr-new-row';
  const idInput = document.createElement('input');
  idInput.className = 'ctr-new-input';
  idInput.placeholder = 'id (slug)';
  const titleInput = document.createElement('input');
  titleInput.className = 'ctr-new-input';
  titleInput.placeholder = 'title';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'ctr-action-btn';
  btn.textContent = 'Create';
  btn.onclick = () => { void createFreeform(idInput, titleInput, onChanged); };
  row.append(idInput, titleInput, btn);
  return row;
}

/** the list grammar: raised needs-you cards, a DONE hairline group, and a
    right-aligned roll-up — all computed pure over the fetched rows
    (SPEC_CONTRACTS.md §3). No page title eyebrow — the rail already
    reads "contracts" (declared delta, mirrors K5's dropped eyebrow). */
export function renderList(
  rows: ContractRow[], bridgeUp: boolean, onOpen: (id: string) => void, onChanged: () => void,
): HTMLElement {
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
  if (bridgeUp) wrap.appendChild(renderNewContractRow(onChanged));
  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'ctr-empty';
    empty.textContent = 'no changes in the plan';
    wrap.appendChild(empty);
    return wrap;
  }
  for (const row of needsYou) wrap.appendChild(renderNeedsYouCard(row, onOpen, onChanged, bridgeUp));
  const done = renderDoneSection(rows.filter(isDone), onOpen);
  if (done) wrap.appendChild(done);
  return wrap;
}
