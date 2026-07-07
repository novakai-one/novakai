/* =====================================================================
   design-render.ts — K5 Design tab: pure DOM builders
   ---------------------------------------------------------------------
   Responsibility: build the rest view, the thread view (question fork /
   draft card + toggles / confirm offer / read-only), and the draft card
   itself — no business logic, mirrors pages.ts's data/factory split.
   Every builder is a pure function of (state, actions): it reads a
   DesignOutcome (or a list of them) and an actions contract, and returns
   a fresh HTMLElement. design.ts owns state + wires the actions.
   ===================================================================== */

import type { Assumption, AssumptionKey, DesignOutcome, DesignStatus, DraftBlock } from './design-model';
import { blocksFor, DESIGN_RECORD_V } from './design-model';

/** What a thread view can ask design.ts to do. Implemented in design.ts;
    built here only against the interface. */
export interface DesignActions {
  submitOutcome(text: string): void;
  selectRow(id: string): void;
  discard(id: string): void;
  answerDraft(): void;
  answerSpecifics(text: string): void;
  flipAssumption(key: AssumptionKey): void;
  confirm(): void;
  handOff(): void;
}

const TAG_DIV = 'div';
const CLS_BTN = 'design-btn';
const CLS_BTN_ACCENT = `${CLS_BTN} design-btn--accent`;
const OUTCOME_PROMPT = 'what outcome are you going for?';
// The ONE question — verbatim from the prototype's PT_QUESTION constant
// (novakai_vision_prototype.html:4683). KEY_DECISIONS §1.3 only has the
// shorthand ("specifics, or a draft to refine?"); the prototype is the
// literal source of this exact string.
const QUESTION_TEXT = 'Any specifics in mind, or should I put together a draft to refine?';
const STATUS_LABEL: Record<DesignStatus, string> = { draft: 'draft', confirmed: 'confirmed', 'handed-off': 'handed off' };

function el(tag: string, cls: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, cls: string, onClick: (evt: MouseEvent) => void): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = cls;
  btn.textContent = label;
  btn.onclick = onClick;
  return btn;
}

/** Short mono date for the row's fixed date column — not a prototype
    format lift (the prototype's pt-date is static demo data, `p.date`),
    just enough to fill the grid's reserved column. */
function formatRowDate(iso: string): string {
  const stamp = new Date(iso);
  return Number.isNaN(stamp.getTime()) ? '' : stamp.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** name / status-chip / date / discard — fixed CSS-grid columns (declared
    delta from the prototype's .pt-row, see the css/styles.css comment on
    .design-row) so every row lines up regardless of status-word width;
    the discard cell is simply absent (not blank-filled) on non-draft
    rows — grid keeps the column reserved either way. */
function renderOutcomeRow(outc: DesignOutcome, actions: DesignActions): HTMLElement {
  const row = el(TAG_DIV, 'design-row');
  row.dataset.status = outc.status;
  row.append(
    el('span', 'design-row-outcome', outc.outcome),
    el('span', 'design-row-status', STATUS_LABEL[outc.status]),
    el('span', 'design-row-date', formatRowDate(outc.createdAt)),
  );
  if (outc.status === 'draft') {
    row.appendChild(button('discard', 'design-row-discard', (evt) => { evt.stopPropagation(); actions.discard(outc.id); }));
  }
  row.onclick = () => actions.selectRow(outc.id);
  return row;
}

function renderOutcomeList(outcomes: readonly DesignOutcome[], actions: DesignActions): HTMLElement {
  const list = el(TAG_DIV, 'design-list');
  if (!outcomes.length) { list.appendChild(el(TAG_DIV, 'design-list-empty', 'no drafts yet')); return list; }
  for (const outc of outcomes) list.appendChild(renderOutcomeRow(outc, actions));
  return list;
}

/** Rest view (§1): the display title, the outcome input, + past rows,
    newest first. The prototype's page header also carries an eyebrow
    ("NOVAKAI · PROTOTYPES") above the title — a DECLARED DROP
    (docs/ide-vision/LIFT_NOT_IMITATE.md): Design's title stands alone. */
export function renderRest(outcomes: readonly DesignOutcome[], actions: DesignActions): HTMLElement {
  const wrap = el(TAG_DIV, 'design-rest');
  wrap.appendChild(el('h1', 'design-page-title', 'Design'));
  wrap.appendChild(el(TAG_DIV, 'design-prompt', OUTCOME_PROMPT));
  const form = document.createElement('form');
  form.className = 'design-outcome-form';
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'design-outcome-input';
  input.placeholder = OUTCOME_PROMPT;
  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'design-outcome-submit';
  submit.textContent = 'Start';
  form.append(input, submit);
  form.onsubmit = (evt) => {
    evt.preventDefault();
    const text = input.value.trim();
    if (text) actions.submitOutcome(text);
  };
  wrap.appendChild(form);
  wrap.appendChild(renderOutcomeList(outcomes, actions));
  return wrap;
}

function renderSpecificsField(actions: DesignActions): HTMLElement {
  const wrap = el(TAG_DIV, 'design-specifics');
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'design-specifics-input';
  input.placeholder = 'the specifics';
  const submitText = (): void => { if (input.value.trim()) actions.answerSpecifics(input.value); };
  input.onkeydown = (evt) => { if (evt.key === 'Enter') submitText(); };
  wrap.append(input, button('Draft it', CLS_BTN, submitText));
  return wrap;
}

/** Step 2: the static ONE-question fork — not a simulated AI turn
    (PROTO_MANIFEST §4's scripted "AI thinks, then types" is not ported). */
function renderQuestionFork(actions: DesignActions): HTMLElement {
  const box = el(TAG_DIV, 'design-question');
  box.appendChild(el('p', 'design-question-text', QUESTION_TEXT));
  const row = el(TAG_DIV, 'design-question-actions');
  const draftBtn = button('Just draft it', CLS_BTN, () => actions.answerDraft());
  const specBtn = button('Add specifics', CLS_BTN, () => specBtn.replaceWith(renderSpecificsField(actions)));
  row.append(draftBtn, specBtn);
  box.appendChild(row);
  return box;
}

/** Step 3: one two-word mono flip control per assumption dimension, a real
    sliding-knob switch lifted verbatim from the prototype's .tgl/.tgl-
    side/.tgl-switch/.tgl-knob (novakai_vision_prototype.html:486-517) —
    not the two flat pill buttons the first pass shipped. The flanking
    words stay real <button>s (own click target each) flanking a clickable
    track+knob; active word var(--ink), inactive var(--ink-faint); the
    knob only turns periwinkle --accent on the flipped (side b) position
    — the human's own departure from the default (§5 colour law). */
function renderToggle(asm: Assumption, actions: DesignActions): HTMLElement {
  const box = el(TAG_DIV, 'design-toggle');
  box.appendChild(el('span', 'design-toggle-label', asm.label));
  const optCls = (side: 'a' | 'b'): string => `design-toggle-opt${asm.value === side ? ' active' : ''}`;
  const flip = (side: 'a' | 'b'): void => { if (asm.value !== side) actions.flipAssumption(asm.key); };
  const track = el(TAG_DIV, `tgl-switch${asm.value === 'b' ? ' flip' : ''}`);
  track.appendChild(el('span', 'tgl-knob'));
  track.onclick = () => flip(asm.value === 'a' ? 'b' : 'a');
  box.append(button(asm.optionA, optCls('a'), () => flip('a')), track, button(asm.optionB, optCls('b'), () => flip('b')));
  return box;
}

function renderAssumptions(outc: DesignOutcome, actions: DesignActions): HTMLElement {
  const wrap = el(TAG_DIV, 'design-assumptions');
  for (const asm of outc.assumptions) wrap.appendChild(renderToggle(asm, actions));
  return wrap;
}

/** One structural block, entering with the house 0fr→1fr grid technique
    (240ms, --ease). ponytail: leave is instant (paint() fully rebuilds
    the card on every action) — only the enter grows in; add exit
    choreography if a later reviewer wants continuity on removal too. */
function renderBlock(block: DraftBlock): HTMLElement {
  const outer = el(TAG_DIV, 'design-block');
  outer.dataset.blockKind = block.kind;
  const inner = el(TAG_DIV, 'design-block-inner');
  for (const line of block.lines) inner.appendChild(el(TAG_DIV, 'design-block-line', line));
  outer.appendChild(inner);
  requestAnimationFrame(() => outer.classList.add('design-block--in'));
  return outer;
}

/** The draft card (§1 step 3) — decide by seeing, never by reading. Draft
    status derives blocks live from the current assumptions; confirmed/
    handed-off render the frozen `blocks` exactly as witnessed. */
export function renderDraftCard(outc: DesignOutcome): HTMLElement {
  const card = el(TAG_DIV, 'design-card');
  card.appendChild(el(TAG_DIV, 'design-card-title', outc.outcome));
  const blocks = outc.status === 'draft' ? blocksFor(outc.outcome, outc.assumptions) : outc.blocks;
  const body = el(TAG_DIV, 'design-card-body');
  for (const block of blocks) body.appendChild(renderBlock(block));
  card.appendChild(body);
  return card;
}

function renderHandoffOffer(actions: DesignActions): HTMLElement {
  const row = el(TAG_DIV, 'design-handoff');
  row.appendChild(button('Create contract', CLS_BTN_ACCENT, () => actions.handOff()));
  return row;
}

function renderConfirmRow(actions: DesignActions): HTMLElement {
  const row = el(TAG_DIV, 'design-confirm-row');
  row.appendChild(button('Confirm', CLS_BTN_ACCENT, () => actions.confirm()));
  return row;
}

/** Reopen a row at the step its status implies (§1): a draft resumes at
    the question fork or the draft card (the record's `question` field
    says which); confirmed resumes at the create-contract offer;
    handed-off (or an unrecognized schema version) renders read-only. */
export function renderThread(outc: DesignOutcome, actions: DesignActions): HTMLElement {
  const wrap = el(TAG_DIV, 'design-thread');
  wrap.appendChild(el('h2', 'design-thread-title', outc.outcome));
  if (outc.v !== DESIGN_RECORD_V) {
    wrap.appendChild(el(TAG_DIV, 'design-readonly', `unrecognized record version (v${String(outc.v)}) — read-only`));
    return wrap;
  }
  if (outc.status === 'handed-off') {
    wrap.append(el(TAG_DIV, 'design-readonly', `handed off · ${outc.id}`), renderDraftCard(outc));
    return wrap;
  }
  if (outc.status === 'confirmed') {
    wrap.append(renderDraftCard(outc), renderHandoffOffer(actions));
    return wrap;
  }
  if (outc.question === null) {
    wrap.appendChild(renderQuestionFork(actions));
    return wrap;
  }
  wrap.append(renderDraftCard(outc), renderAssumptions(outc, actions), renderConfirmRow(actions));
  return wrap;
}
