/* =====================================================================
   contracts-doc.ts — K4 Contracts tab: the per-build certificate document
   ---------------------------------------------------------------------
   Responsibility: renderDocument(row, planBase, bridgeUp) builds the
   certificate for one plan change and/or lifecycle record — one small
   render function per SPEC_CONTRACTS.md §4 section, dispatched from a
   section table (K11: max-lines-per-function bites at src/ide/**
   function level, so no mega-render). row.change is nullable (a
   record-only row has no plan change); intent/acceptance only render
   when a change is present — packet/verdict sections keep their existing
   absence states either way. contracts.ts owns fetch + state, this
   module builds DOM from already-fetched data plus its own small local
   state for the status-strip's write flows (contract-status-strip.ts).
   The per-section render builders live in contracts-doc-sections.ts;
   this file owns the rail/section-table dispatch + renderDocument.

   Section order follows SPEC_CONTRACTS.md §4's literal table order,
   spliced against the real prototype's actual build order (header ->
   offer -> TRUST -> [prototype, absent] -> acceptance -> contract ->
   activity -> review, novakai_vision_prototype.html ~6080-6470): trust
   renders early (decision-first, KEY_DECISIONS §8.6) with intent/
   technical layer — which the prototype has no equivalent of at all —
   placed right after it, explaining what the seal is vouching for. The
   new status strip renders right after the header, above the offer row.

   Interaction: every secondary section (contract, each trust-seal line)
   uses the prototype's collapse-head + xwrap technique (.bd-collapse-
   head / grid-template-rows 0fr->1fr, 240ms house ease, default CLOSED,
   ~1400-1430/519-529) verbatim in mechanism, house vars only. The
   technical layer is the one exception — an opacity-only crossfade in a
   reserved row (manifest §3), never a height reflow, so revealing it
   never shifts the trust seal below.
   ===================================================================== */

import type {
  ContractPacket, ContractRow, PlanChange, Verdict,
} from './contracts';
import { renderStatusStrip, type RecordChangeHandler } from './contract-status-strip';
import type { ContractRecord } from './contract-record';
import {
  renderAcceptanceSection, renderActivitySection, renderContractSection,
  renderHeader, renderIntentSection, renderTrustSeal,
} from './contracts-doc-sections';

export function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

/* ---------- rail + section-table dispatch ---------- */

function buildRail(label: string, meta: string, isSet: boolean): HTMLElement {
  const rail = el('div', `ctr-rail${isSet ? ' set' : ' draft'}`);
  const inner = el('div', 'ctr-rail-inner');
  const labelWrap = el('div', 'ctr-rail-labelwrap');
  labelWrap.append(el('span', 'ctr-rail-label', label), el('span', 'ctr-rail-meta', meta));
  inner.append(el('span', 'ctr-rail-dot'), labelWrap);
  rail.appendChild(inner);
  return rail;
}

function trustMeta(verdict: Verdict | null): string {
  return verdict ? `${verdict.behavioural.passed} / ${verdict.behavioural.total} proven` : '';
}
function acceptanceMeta(change: PlanChange): string {
  const count = change.acceptance?.cases.length ?? 0;
  return count ? `${count} check${count === 1 ? '' : 's'}` : '';
}
function contractMeta(packet: ContractPacket | null): string {
  const count = Object.keys(packet?.subMap?.nodes ?? {}).length;
  return count ? `${count} nodes` : '';
}

interface SectionSpec { label: string; meta: string; isSet: boolean; content: HTMLElement }

function appendSection(doc: HTMLElement, spec: SectionSpec): void {
  doc.append(buildRail(spec.label, spec.meta, spec.isSet), spec.content);
}

function appendTrustSection(doc: HTMLElement, row: ContractRow): void {
  appendSection(doc, {
    label: 'trust', meta: trustMeta(row.verdict), isSet: !!row.verdict, content: renderTrustSeal(row),
  });
}

function appendAcceptanceSection(doc: HTMLElement, row: ContractRow, change: PlanChange): void {
  appendSection(doc, {
    label: 'acceptance', meta: acceptanceMeta(change), isSet: !!row.verdict?.behavioural.proven,
    content: renderAcceptanceSection(row, change),
  });
}

function appendContractSection(doc: HTMLElement, row: ContractRow): void {
  appendSection(doc, {
    label: 'contract', meta: contractMeta(row.packet), isSet: !!row.packet, content: renderContractSection(row),
  });
}

function appendActivitySection(doc: HTMLElement): void {
  appendSection(doc, { label: 'activity', meta: '', isSet: false, content: renderActivitySection() });
}

/** one small render function per section, dispatched here in
    SPEC_CONTRACTS.md §4's order (see module header comment for the
    order-reconciliation note). Intent/acceptance are change-only — a
    record-only row skips both entirely. */
function buildDoc(
  row: ContractRow, planBase: string, bridgeUp: boolean, onRecordChange: RecordChangeHandler,
): HTMLElement {
  const doc = el('div', 'ctr-doc');
  doc.appendChild(renderHeader(row, planBase));
  doc.appendChild(renderStatusStrip(row, bridgeUp, onRecordChange));
  doc.appendChild(el('div', 'ctr-offer')); // lifecycle action row — empty this slice, collapses (§8)
  appendTrustSection(doc, row);
  // intent has no rail entry — the prototype has no equivalent section
  if (row.change) doc.appendChild(renderIntentSection(row, row.change));
  if (row.change) appendAcceptanceSection(doc, row, row.change);
  appendContractSection(doc, row);
  appendActivitySection(doc);
  return doc;
}

/** the certificate document: self-managing so a lifecycle write from the
    status strip (advance, create-from-strip) can repaint in place —
    contracts.ts only learns of the change when the human backs out to
    the list, which always re-fetches (contracts.ts's `refresh`). */
export function renderDocument(row: ContractRow, planBase: string, bridgeUp: boolean): HTMLElement {
  const container = el('div', 'ctr-doc-shell');
  let current = row;
  function paint(): void {
    container.innerHTML = '';
    container.appendChild(buildDoc(current, planBase, bridgeUp, onRecordChange));
  }
  function onRecordChange(updated: ContractRecord): void {
    current = { ...current, record: updated };
    paint();
  }
  paint();
  return container;
}
