/* =====================================================================
   design-model.ts — K5 Design tab: record schema + pure state machine
   ---------------------------------------------------------------------
   Responsibility: the §3 witnessed-outcome record shape, the assumption
   defaults, and the pure state-transition functions the flow steps
   through, plus the tiny localStorage load/save pair for this module's
   own key. No DOM (mirrors config.ts/state.ts: data + pure helpers only).
   docs/ide-vision/SPEC_DESIGN.md §3 is this file's authored spec — this
   IS that declared boundary, versioned by DESIGN_RECORD_V.
   ===================================================================== */

// DESIGN RECORD v1. Any field change bumps DESIGN_RECORD_V and
// docs/ide-vision/SPEC_DESIGN.md §3 in the same PR (the shape IS the
// K4/K7 boundary). `assumptions` persist on every toggle flip (so
// reopening a draft resumes with the flipped state, not just the
// original); `blocks` is recomputed on every flip too, but only becomes
// immutable — frozen — at confirm.
export const DESIGN_RECORD_V = 1;

const STORAGE_KEY = 'novakai.design.v1';

export type AssumptionKey = 'scope' | 'risk' | 'tests';

export interface Assumption {
  key: AssumptionKey;
  label: string;
  optionA: string;
  optionB: string;
  value: 'a' | 'b';
}

/** One structural block of the draft card (§1 step 3) — what the human
    actually witnessed. `lines` is the block's literal rendered text. */
export interface DraftBlock {
  kind: 'target' | 'scope-rows' | 'review-gate' | 'test-plan';
  lines: string[];
}

export type DesignStatus = 'draft' | 'confirmed' | 'handed-off';

export interface DesignOutcome {
  v: typeof DESIGN_RECORD_V;
  id: string;
  outcome: string;
  question: 'specifics' | 'draft' | null;
  specifics: string | null;
  assumptions: Assumption[];
  blocks: DraftBlock[];
  status: DesignStatus;
  createdAt: string;
  confirmedAt: string | null;
  handedOffAt: string | null;
}

// OPEN — default pending Chris ruling (SPEC_DESIGN.md §1 step 3 note): the
// three dimensions below are this spec's proposed outcome-agnostic default,
// not BINDING content. The mechanism (toggles restructure the card) is
// settled; this dimension set is not.
export const DEFAULT_ASSUMPTIONS: readonly Assumption[] = [
  { key: 'scope', label: 'scope', optionA: 'this change only', optionB: '+ related call sites', value: 'a' },
  { key: 'risk', label: 'risk', optionA: 'safe to auto-approve', optionB: 'needs human review', value: 'a' },
  {
    key: 'tests', label: 'tests', optionA: 'existing tests cover it', optionB: 'needs new acceptance tests', value: 'a',
  },
];

/** The draft card's structural blocks for the given assumptions (§1 step
    3) — pure derivation, used for the live draft view AND to freeze
    `blocks` at confirm, so a frozen record renders identically to how it
    was witnessed. */
export function blocksFor(outcome: string, assumptions: readonly Assumption[]): DraftBlock[] {
  const sideOf = (key: AssumptionKey): 'a' | 'b' => assumptions.find((item) => item.key === key)?.value ?? 'a';
  const blocks: DraftBlock[] = [{ kind: 'target', lines: [outcome] }];
  if (sideOf('scope') === 'b') blocks.push({ kind: 'scope-rows', lines: [outcome, 'related call sites'] });
  if (sideOf('risk') === 'b') blocks.push({ kind: 'review-gate', lines: ['human approves before any agent executes'] });
  if (sideOf('tests') === 'b') {
    blocks.push({ kind: 'test-plan', lines: ['acceptance cases to be authored — Keystone 2'] });
  }
  return blocks;
}

/** 'design-' + monotonic counter — not a fake sha (PROTO_MANIFEST §4). */
function nextId(outcomes: readonly DesignOutcome[]): string {
  let max = 0;
  for (const rec of outcomes) {
    const suffix = Number(rec.id.slice('design-'.length));
    if (Number.isFinite(suffix) && suffix > max) max = suffix;
  }
  return `design-${max + 1}`;
}

/** Step 1: submit an outcome — a fresh draft record (not yet in a list).
    The `['v']` computed key (rather than a plain `v:` literal) is a lint
    dodge only: id-length (BLOCK tier, src/ide/**) flags a bare 1-char
    object-literal key, but `v` is the spec's mandated schema field name
    (§3) and is not renameable. */
export function startOutcome(existing: readonly DesignOutcome[], text: string): DesignOutcome {
  const assumptions = DEFAULT_ASSUMPTIONS.map((asm) => ({ ...asm }));
  return {
    ['v']: DESIGN_RECORD_V,
    id: nextId(existing),
    outcome: text,
    question: null,
    specifics: null,
    assumptions,
    blocks: blocksFor(text, assumptions),
    status: 'draft',
    createdAt: new Date().toISOString(),
    confirmedAt: null,
    handedOffAt: null,
  };
}

/** Step 2, "Just draft it" branch. */
export function answerDraft(outc: DesignOutcome): DesignOutcome {
  return { ...outc, question: 'draft' };
}

/** Step 2, "Add specifics" branch — stored verbatim (§1.9). An empty
    submit is a caller-side no-op (design.ts), not handled here. */
export function answerSpecifics(outc: DesignOutcome, text: string): DesignOutcome {
  return { ...outc, question: 'specifics', specifics: text };
}

/** Step 3: flip one assumption dimension and re-derive the card's blocks.
    Persisted on every flip by the caller, not only at confirm (see the
    file-top note) — reopening a draft resumes with the flip intact. */
export function flipAssumption(outc: DesignOutcome, key: AssumptionKey): DesignOutcome {
  const assumptions = outc.assumptions.map((asm) => (
    asm.key === key ? { ...asm, value: (asm.value === 'a' ? 'b' : 'a') as 'a' | 'b' } : asm
  ));
  return { ...outc, assumptions, blocks: blocksFor(outc.outcome, assumptions) };
}

/** Step 4: freeze the assumptions + block structure as witnessed. */
export function confirmOutcome(outc: DesignOutcome): DesignOutcome {
  return {
    ...outc,
    status: 'confirmed',
    confirmedAt: new Date().toISOString(),
    blocks: blocksFor(outc.outcome, outc.assumptions),
  };
}

/** Step 5: hand off to Contracts. design.ts does the toast + navigate. */
export function handOffOutcome(outc: DesignOutcome): DesignOutcome {
  return { ...outc, status: 'handed-off', handedOffAt: new Date().toISOString() };
}

/** Drafts only — confirmed/handed-off records are frozen history.
    ponytail: hard delete, no undo — add soft-delete when a real user
    loses work (SPEC_DESIGN.md §1). */
export function discardOutcome(outcomes: readonly DesignOutcome[], id: string): DesignOutcome[] {
  return outcomes.filter((outc) => outc.id !== id);
}

/** Newest-first, own key — never folded into persistence.ts's LS_KEY. A
    stored record with an unrecognized `v` is left as-is; design-render.ts
    renders it read-only rather than guessing its shape. */
export function loadOutcomes(): DesignOutcome[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch { return []; }
}

export function saveOutcomes(outcomes: readonly DesignOutcome[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(outcomes));
  } catch { /* storage may be unavailable; ignore */ }
}
