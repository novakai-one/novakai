# SPEC_DESIGN — the Design tab (K5 design spec)

> Design spec for **K5 — Design tab**: port of the prototype's Prototypes flow — outcome input →
> the ONE question → a live draft card whose shape flips with the toggles (decide by seeing,
> never by reading — KEY_DECISIONS §1.3) → confirm seals a **witnessed outcome** → hand-off
> navigates to Contracts (KEY_DECISIONS §1.2, ide-roadmap.json K5 intent). What Design produces is
> a versioned artifact record (§3) — the declared boundary shape a later phase bridges into the
> contract plane, never prose describing an outcome.
>
> **What is BINDING here and what is a design choice.** BINDING: the one-question copy
> (KEY_DECISIONS §1.3, quoted verbatim), decide-by-seeing (§1.3), the two-actor colour law (§5),
> literal non-marketing titles (§1.9). Everything else below — the assumption dimensions, the
> draft-card blocks, file split, storage key, wiring — is a **design choice this spec makes**,
> traced against the real app, not a manifest quote. `/novakai` fundamentals are king; the
> prototype's "Prototypes" tab (`novakai_vision_prototype.html`, anchor
> `el('h1', 'page-title', 'Prototypes')`) is DIRECTION only.

---

## 0. What K5 is and is not

- **IS**: a real page mounted at `#design` — one text input for a stated outcome, a static ONE-
  question fork, a small structured **draft card** whose blocks visibly appear, disappear and
  restructure as assumption toggles flip (§1 step 3), a confirm step that freezes the draft into a
  **witnessed-outcome record** (§3 — a versioned JSON shape, the declared boundary contract), and
  a hand-off that navigates to `#contracts`. New `src/ide/design*.ts` modules + `main.ts` wiring +
  one CSS block. No framework, no new dependency, no new hook.
- **IS NOT**: any real AI answering the question (KEY_DECISIONS §1.11 rules real AI in the app out
  of scope — the question is a static UI fork, not a chat impersonation; PROTO_MANIFEST §4 bans
  "any implied AI/terminal integration"); any rendering of the witnessed outcome as a certificate
  document (K4's job); **any bridge into the contract/plan plane** — `contract.mjs`, `plan.json`
  and the C2 cert chain are Node tooling reading disk and cannot read browser `localStorage`;
  connecting the §3 record to that plane is an explicit, not-yet-built K4/K7 job (§3); any code/UI
  generation of the actual outcome — no live-preview engine exists in `/novakai`; the draft card
  is a structured statement of the outcome, not simulated running code.

---

## 1. The flow, step by step

**Rest view** (`design.render()` with no thread open — mirrors `renderRestView()` in the
prototype): one input, "what outcome are you going for?", literal and plain (KEY_DECISIONS §1.9 —
no tagline). Beneath it, past `DesignOutcome` rows from the store (§3), newest first: outcome text
+ a status word (`draft` / `confirmed` / `handed off`) + a small `discard` control on `draft` rows.
**Clicking a row reopens its thread view** at the step its status implies — a `draft` resumes at
the question fork or the draft card (whichever it reached; the record's `question` field says
which); a `confirmed` row resumes at the create-contract offer; a `handed-off` row renders
read-only (frozen card + record id). No status colour implies proof (§5: nothing in Design is
machine-proven, so no teal/green ever appears here). `discard` deletes the record from the store
after a native `confirm()` dialog — drafts only; confirmed/handed-off records are frozen history
(ponytail: hard delete, no undo — add soft-delete when a real user loses work).

1. **Submit outcome** → creates a `DesignOutcome` (`status: 'draft'`), saved immediately (§3), and
   opens the thread view for it.
2. **The ONE question**, shown instantly, no delay, no typing animation: *"Any specifics in mind,
   or should I put together a draft to refine?"* — quoted verbatim from the prototype's
   `PT_QUESTION` constant (`novakai_vision_prototype.html:4683`); KEY_DECISIONS §1.3 has only the
   shorthand ("specifics, or a draft to refine?"), not the exact string. Two real buttons:
   - **Just draft it** → straight to step 3.
   - **Add specifics** → reveals one text field with a **Draft it** submit button; submitting
     stores the field verbatim as `specifics` and advances to step 3 (Enter in the field submits
     too — one control, one transition, no second question). Empty submit is a no-op.
   This is a static UI fork, not a simulated AI turn — the prototype's scripted "AI thinks, then
   types" choreography (`D.THINK_QUESTION`, `PT_ACK_SPECIFICS`, `PT_ACK_ADJUST` timers) is the FAKE
   part (PROTO_MANIFEST §4, "deterministic simulation / agent activity") and is **not ported**:
   the mechanism (one question, at most) is the law; the fake narration around it is not.
3. **The draft card — decide by seeing, never by reading (§1.3).** A bordered card (house 9px
   radius) titled with the outcome text verbatim, built from **structural blocks that the toggles
   visibly add, remove and restructure** — the user watches the shape of the draft change, never
   re-reads a recomputed sentence. Beside the card, one two-word mono flip control per assumption
   dimension (active side lit periwinkle `--accent`, inactive dim), each wired to a structural
   consequence in the card:
   - **scope** — `this change only` ⇄ `+ related call sites`: side B **adds a scope-rows block**
     (the named change + a `related call sites` row); side A removes it, leaving one target row.
   - **risk** — `safe to auto-approve` ⇄ `needs human review`: side B **inserts a review-gate
     step** (`human approves before any agent executes`) into the card's step list; side A removes
     it and the step list visibly shortens.
   - **tests** — `existing tests cover it` ⇄ `needs new acceptance tests`: side B **adds a
     test-plan block** (`acceptance cases to be authored — Keystone 2`); side A removes it.
   Block enter/leave animates with the existing `grid-template-rows: 0fr→1fr` house technique
   (KEY_DECISIONS §4.2), 240ms, keyboard-instant. Flips mutate state and re-render the card —
   pure render of state, no timers.

   **OPEN — default pending Chris ruling**: the three dimensions (`scope` / `risk` / `tests`) are
   this spec's proposed outcome-agnostic default, nothing more. The prototype's own assumption
   rows (`PT_ASSUMPTIONS_RESIZE`, `PT_ASSUMPTIONS_GENERIC`) are demo-domain content (a
   resizable-blocks feature) that does not port, so no BINDING content exists for novakai's draft
   dimensions. The *mechanism* (toggles restructure the card) is settled by §1.3; the *dimension
   set* is not — it ships as the default and goes to Chris for a ruling.
4. **Confirm**: freezes the assumptions and the card's block structure into the record
   (`status: 'confirmed'`, `confirmedAt`, `blocks` — §3). Directly under confirm (decision-first
   placement, KEY_DECISIONS §8.6 grammar) an offer appears: **Create contract**.
5. **Hand-off**: clicking **Create contract** sets `status: 'handed-off'`, `handedOffAt`, saves
   (§3), calls `ctx.hooks.toast(...)`, and navigates via `location.hash = 'contracts'`. It lands on
   the Contracts tab's existing honest empty state (K4 not built yet, SPEC_SHELL §7's `contracts`
   row) — never a simulated contract document. What survives the hand-off is the confirmed
   `DesignOutcome` record (§3): the witnessed outcome, as a versioned shape a future consumer
   builds against.

---

## 2. Module breakdown

Three files under `src/ide/**` (BLOCK-tier, K11) plus a CSS block and a `main.ts` wiring change.

| file | responsibility | rough size |
|---|---|---|
| `src/ide/design-model.ts` | the §3 types + `DESIGN_RECORD_V` + `DEFAULT_ASSUMPTIONS`, the pure state-machine (`startOutcome`, `answerSpecifics`, `answerDraft`, `flipAssumption`, `blocksFor`, `confirmOutcome`, `handOffOutcome`, `discardOutcome`), and the tiny `localStorage` load/save pair (own key, §3) — no DOM. | ~140 lines |
| `src/ide/design-render.ts` | pure DOM builders: `renderRest(outcomes, actions)`, `renderThread(outcome, actions)`, `renderQuestionFork(...)`, `renderDraftCard(outcome)`, `renderToggle(...)` — no business logic, mirrors `pages.ts`'s data/factory split. | ~170 lines |
| `src/ide/design.ts` | the factory: `initDesign(ctx) => DesignApi`. Composes model + render, owns the open-thread id in closure state, returns `{ render }`. | ~50 lines |

Each function stays under the 60-line BLOCK limit; each file well under 500. No new dependency
(DOM + `localStorage` only, same as `persistence.ts`).

### Public API

```ts
// design.ts
export interface DesignApi {
  /** Render the current Design-tab view fresh. Instant-swap, no lifecycle —
      called by the shell's page host exactly like emptyPage() is today
      (SPEC_SHELL §5): rebuilt on every route entry. Does nothing at
      construction time, so boot order is a non-issue. */
  render(): HTMLElement;
}
export function initDesign(ctx: AppContext): DesignApi;
```

`initDesign` takes no module deps — it needs nothing from any other module's return value. It
reads/writes its own `localStorage` key (§3) and calls only `ctx.hooks.toast` (already wired) on
confirm/hand-off/discard, always at interaction time, never at boot.

---

## 3. The witnessed-outcome record — THE declared boundary contract

**The boundary is the SHAPE, not the storage.** K5 persists records in browser `localStorage`
(key `novakai.design.v1`) because that is the only store the client-side app has today. The
contract/plan plane — `tools/novakai/contract/contract.mjs`, `public/plan.json`, the C2 cert
chain — is Node tooling reading disk; **it cannot read browser `localStorage`, and K5 builds no
bridge**. Bridging is an explicit, not-yet-built later job: K4 decides how a confirmed record
becomes contract input (KEY_DECISIONS §1.2's "witnessed outcome becomes part of the contract" is
*fulfilled there, declared here*); K7 (File System Access) provides the disk-write path that gets
the record out of the browser. Until then, what the two sides build against is this versioned
JSON shape — a future consumer (K4's import, K7's export-to-disk) targets the schema below, never
the storage medium.

```ts
// design-model.ts — DESIGN RECORD v1. Any field change bumps DESIGN_RECORD_V
// and this spec section in the same PR (the shape IS the K4/K7 boundary).
// `assumptions` persist on EVERY toggle flip, not only at confirm (journey B
// requires reopening a draft row with toggle state intact) — "frozen at
// confirm" below means made-immutable at confirm, not first-written there.
export const DESIGN_RECORD_V = 1;

export type AssumptionKey = 'scope' | 'risk' | 'tests';   // OPEN default — §1 step 3 note

export interface Assumption {
  key: AssumptionKey;
  label: string;        // two-word mono label, e.g. "scope"
  optionA: string;      // e.g. "this change only"
  optionB: string;      // e.g. "+ related call sites"
  value: 'a' | 'b';     // which side the human flipped on
}

/** One structural block of the draft card (§1 step 3) — what the human
    actually witnessed. `kind` is a closed set; `lines` is the block's
    literal rendered text. */
export interface DraftBlock {
  kind: 'target' | 'scope-rows' | 'review-gate' | 'test-plan';
  lines: string[];
}

export type DesignStatus = 'draft' | 'confirmed' | 'handed-off';

export interface DesignOutcome {
  v: typeof DESIGN_RECORD_V;      // schema version — consumers gate on this
  id: string;                     // 'design-' + monotonic counter — not a fake sha (PROTO_MANIFEST §4)
  outcome: string;                // the user's stated outcome, verbatim (§1.9 — never rewritten as copy)
  question: 'specifics' | 'draft' | null;  // which fork answered the ONE question (null = not yet answered)
  specifics: string | null;       // verbatim, only when question === 'specifics'
  assumptions: Assumption[];      // frozen at confirm
  blocks: DraftBlock[];           // the card structure as witnessed at confirm — frozen
  status: DesignStatus;
  createdAt: string;              // ISO 8601
  confirmedAt: string | null;
  handedOffAt: string | null;
}

/** localStorage['novakai.design.v1'] holds: DesignOutcome[] (newest first). */
```

**Storage**: its own `localStorage` key, `novakai.design.v1`, read/written only by
`design-model.ts` — never folded into `persistence.ts`'s `LS_KEY`/`PREF_KEY`
(`src/core/config/config.ts`): Design's records are not the diagram model, and a new concern gets
its own key (the same pattern as `LS_KEY` vs `PREF_KEY` being two keys, not one). A stored record
whose `v` is unrecognized renders read-only, never migrated silently.

---

## 4. Wiring (`main.ts`, `shell.ts`)

**House deps-injection, no new hook.** There is no import cycle here — `shell.ts` needs Design's
render function at route time, which is exactly the case the repo already solves by passing module
APIs as init deps (precedent: `initNodes(ctx, selection, camera)` and
`initInspector(ctx, nodes, selection)` in `main.ts` section 3). `ctx.hooks` exists to break
*cycles*; a one-way shell→design call is a plain dependency. No `context.ts` change, no
`notWired` entry, no boot-order concern: `design.render` is only ever called at route time.

`main.ts` changes (section 3, module instantiation):

```ts
const design = initDesign(ctx);
// ...
initShell(ctx, { renderDesign: design.render });
```

`shell.ts` changes:
- Signature becomes `initShell(ctx: AppContext, deps: { renderDesign: () => HTMLElement })` —
  house `initX(ctx, deps)` shape. The `go(page)` return its K3 comment anticipated stays unbuilt:
  navigation is `location.hash = 'contracts'`, the exact mechanism `buildRailItem`'s `onclick`
  already uses (`shell.ts:48`); any module can navigate that way with zero shell dependency.
- `route()` (`shell.ts:98–104`) is untouched — it decides only the `#host` show/hide for
  codebase-vs-rest, which does not change.
- **`renderHost` (`shell.ts:82–86`) gains the design branch**: for `tab === 'design'` it appends
  `deps.renderDesign()`; every other non-codebase tab keeps the `emptyPage(def)` path.

`pages.ts` change: the `EMPTY` array drops its `design` row (mirrors how `codebase` already has
none — a real page has no empty-state row). `RAIL_ICONS.design` stays; the glyph serves the real
page.

---

## 5. Two-actor colour law compliance (KEY_DECISIONS §3.2)

| Design element | hue | var | why it's lawful |
|---|---|---|---|
| toggle active side | periwinkle | `--accent` | the human's own choice/judgment — exactly the human actor |
| toggle inactive side, status words, discard | dim / faint | `--ink-dim` / `--ink-faint` | unproven/quiet, shown honestly |
| outcome input, draft-card text | default ink | `--ink` | plain text, no claim attached |

**No teal (`--edge-sel`), no green anywhere in Design.** Teal marks a machine-proven claim and
green marks a verdict (§3.2) — nothing in Design is machine-proven or verdicted; proof and verdicts
belong to Contracts (K4). A `confirmed`/`handed-off` status word is the human's own record of what
they did, not a proof — dim or periwinkle, never teal/green. Any reviewer greps the new CSS block
for `--proven`, `--attested`, `--edge-sel`, or a green hex literal — a nonzero result fails the
colour law.

Motion: draft-card block enter/leave uses `grid-template-rows: 0fr→1fr` at 240ms (KEY_DECISIONS
§4.2), keyboard-instant; toggle flips and the specifics-field reveal use 120/240ms with default
easing — no `--ease` var exists yet in `css/styles.css`, none added (the same choice SPEC_SHELL §2
made for the rail).

---

## 6. What K5 explicitly does NOT do (deferred, not designed away)

- Any real AI/model call behind the ONE question — deferred to whatever wires an agent into the
  app (K8 Home has its own design round; KEY_DECISIONS §1.11).
- **The bridge from the §3 record to the contract/plan plane** — how a confirmed `DesignOutcome`
  becomes a `plan.json` change / `contract.mjs` input is K4's design; getting the record onto disk
  where Node tooling can read it is K7's (File System Access). K5 declares the shape only (§3).
- Rendering the witnessed outcome as a document/certificate — K4's job entirely; Design hands off
  to K4's honest empty state, not a fake render of one.
- Any live code or UI preview of the stated outcome — no such engine exists in `/novakai`; the
  draft card is a structured statement, never simulated running code (PROTO_MANIFEST §4).
- Trust seal, tide-mark rail, seal ceremony, keystone rule — build-document grammar for Contracts
  (K4); nothing in Design is proven, so nothing here earns a seal.
- Per-repo scoping of the store — `localStorage` only at K5 (R4/K7 territory).
- Editing or un-confirming a confirmed record — confirm freezes; changing your mind = discard the
  draft before confirm, or start a new outcome after.

---

## 7. Acceptance criteria

1. `docs/ide-vision/SPEC_DESIGN.md` exists (this file — `ide-roadmap.json` K5 check #1).
2. `grep -F "initDesign" src/main.ts` is non-empty (`ide-roadmap.json` K5 check #2), and
   `grep -F "renderDesign: design.render" src/main.ts` is non-empty (the §4 deps wiring landed).
3. `grep -F "id: 'design'" src/ide/pages.ts` is empty (the `EMPTY` row is removed); `grep -F
   "design:" src/ide/pages.ts` still finds the `RAIL_ICONS.design` glyph.
4. `grep -F "DESIGN_RECORD_V" src/ide/design-model.ts` is non-empty and every persisted record
   carries `v` (the §3 boundary shape is real, versioned code, not spec prose).
5. `npm run lint` exits 0 — the three new `src/ide/design*.ts` files pass BLOCK tier (K11:
   `sonarjs/cognitive-complexity ≤15`, `max-lines-per-function ≤60`, `max-lines ≤500`, no
   duplicate string literals — the repeated `'design'` tab id and toggle labels are named
   constants).
6. Colour law: `grep -E -- "--proven|--attested|--edge-sel|#5fd0a0" css/styles.css` scoped to the
   new Design CSS block returns nothing (§5).
7. Real-Chromium journey A — draft lane (Playwright, house pattern, zero console/page errors):
   type an outcome → submit → the ONE question renders → **Just draft it** → assert the draft card
   contains no `test-plan` block element → flip the `tests` toggle → **assert a `test-plan` block
   element appeared inside the card** (the card's structure changed, not a sentence — §1.3) → flip
   back → assert it is gone → **Confirm** → **Create contract** →
   `expect(page).toHaveURL(/#contracts$/)` → reload → the handed-off row appears in the rest view
   (persistence under `novakai.design.v1`, independent of the diagram's autosave key).
8. Real-Chromium journey B — specifics lane + resume + discard: submit an outcome →
   **Add specifics** → the field reveals → type text, press Enter → the draft card renders and the
   stored record's `specifics` equals the typed text verbatim (assert via a `localStorage` read in
   the test) → navigate to `#codebase` and back to `#design` → click the persisted draft row → the
   thread reopens at the draft card with toggle state intact → **discard** (accept the dialog) →
   the row is gone after reload.
9. `npm run novakai:ship` regenerates the map cleanly with the three new modules present as nodes
   (each new file gets a sibling `.novakai.mmd` fragment, or is scaffolded via
   `tools/buildspec/scaffold.mjs --init`, before the symbol-completeness gate (A1) is satisfied).
10. `npm run novakai:verify:full` green (inherited, `IDE_MASTER_PLAN.md` §3 point 3).
