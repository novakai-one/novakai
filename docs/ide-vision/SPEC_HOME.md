# SPEC_HOME — the Home tab (K8 design spec)

> Design spec for **K8 — Home**: the entry point ("What would you like to know?"). One ask box
> over the repo's **verified artifacts** — the map (`docs/novakai/_bundle.mmd`) and the source
> bodies (`ctx.bodies`) — where every reply is an **artifact card**, never a chat transcript
> (KEY_DECISIONS §3.9: chat-transcript views are rejected forever; replies are artifacts). Real
> AI wiring is **out of this slice** (§5 says exactly what ships instead and what the seam to
> real AI later is); what ships is real, deterministic, and grounded — zero simulated data
> (PROTO_MANIFEST §4).
>
> **What is BINDING here and what is a design choice.** BINDING: replies-are-artifacts (§3.9),
> the two-actor colour law (§7), literal non-marketing copy (§1.9), no simulated AI/data
> (PROTO_MANIFEST §4, KEY_DECISIONS §1.11), plain-language-first with the technical layer one
> click deep (§1.8). Everything else — the lookup semantics, the answer-card blocks, the history
> shape, file split, storage key — is a **design choice this spec makes**, traced against the
> real app. There is zero prototype coverage for Home (the master plan gives one line); nothing
> here ports from `novakai_vision_prototype.html`.

---

## 0. What K8 is and is not

- **IS**: a real page mounted at `#home` — one text input (placeholder **"What would you like to
  know?"**, verbatim from the vision record — a literal question, not a tagline), answering by
  **deterministic lookup over the live map**: the reply is an artifact card built from the same
  `_bundle.mmd` the gate proves at HEAD, parsed by the app's own parser (`fromMermaid`,
  `src/io/mermaid.ts:212` — never a new parse path; §3). Beneath the input, **session history**:
  the questions asked, newest first, each re-answered live on click (§4). New
  `src/ide/home*.ts` modules + `src/ide/home.css`. No framework, no new dependency, no new hook.
- **IS NOT**: real AI answering free text (KEY_DECISIONS §1.11 rules real AI in the app out of
  scope; PROTO_MANIFEST §4 bans implied AI — no fake "thinking" delays, no simulated agent
  voice, ever); a terminal or anything using the K2 PTY bridge (that is K6's surface and infra —
  §2 is the hard boundary); a natural-language engine that pattern-matches questions into
  canned prose (that IS simulated AI — a query either matches real map units or gets an honest
  no-match state, §1 step 3); a second parser for `.mmd` (A3 two-parser conformance is a
  roadmap invariant; Home imports the app parser, precedent `src/panel/planner/planner.ts:28`);
  any write to the repo, the diagram model, or `ctx.state` — Home is read-only by definition (§2).

---

## 1. The flow, step by step

**Rest view** (`home.render()` on route entry): the ask input, focused, placeholder "What would
you like to know?" — disabled until the map index resolves, enabled when ready (§3,
index-not-ready). Beneath it, past questions from the store (§4), newest first: the question
text verbatim + when it was asked. **Clicking a row re-runs the question live against the
current map** — answers are never replayed from storage (§4: history stores questions only).
Below the rows, one dim `clear history` control (native `confirm()`, then clears the key).
Zero-state (no history yet): the rows are simply absent — the input and the §7-lawful dim
source line (`docs/novakai/_bundle.mmd · proven by npm run novakai:onboard`) are the whole page.
No spinner, no illustration, no greeting copy (§1.9).

1. **Ask** (Enter in the input; empty submit is a no-op): the query is appended to history (§4)
   and answered by `answerFor(query, index)` (§5 — the single answer choke point) against the
   map index (§3). Matching is deterministic and case-insensitive, over real map fields only:
   unit id, unit name (`fm.name`), owning module name, desc text (`fm.description`). Ranked:
   exact name/id match → name substring → module match → desc substring; ties alphabetical.
2. **One match → the answer card** (step 4). **Several matches → the match list**: one row per
   unit — name (mono, verbatim), kind, owning module, first line of desc — capped at 20 rows
   with an honest count line when more exist (`142 units match — showing 20; narrow the
   question`); never a silent cap. Click a row → its answer card.
3. **No match → the honest no-match state**, not a fake answer: one dim mono line
   (`no unit in the map matches that`) and beneath it, fainter, the real pointers — the source
   of every answer (`docs/novakai/_bundle.mmd`), and where non-question intents live:
   `to change the repo: design (draft the outcome) · agents (run Claude Code)`. Home does NOT
   try to detect work-shaped intent and reply to it — that would be simulated judgment
   (PROTO_MANIFEST §4); the pointers are static and identical for every miss. Free-text
   questions that name no unit get the same state; the AI layer that will answer them is the
   §5 seam, and the state says so in one dim line (`free-text answers arrive with the agent
   bridge · K6/K8 seam`).
4. **The answer card — the reply is an artifact (KEY_DECISIONS §3.9).** A bordered card (house
   9px radius) whose title is the **unit name verbatim** (§1.9/§8.1 — literal, never rewritten):
   - **plain layer** (§1.8, leads): the unit's `fm.description` from the map — advisory prose,
     rendered as plain ink; the kind + owning module as a squared chip row (anti-capsule, §8.2).
   - **connections**: dependencies (edges out) and dependents (edges in) from the map's real
     edge set — each name is a link that resolves **by unit id** straight to that unit's card,
     a definite single answer (never back through the ranked-match path of step 1, where a
     common name like `render` appearing in many descs would surface a match list instead of
     the neighbor). A connection click is **navigation, not an ask** — it appends nothing to
     history; only Enter-submitted queries are recorded (§4). The card is a navigable
     neighborhood of the real graph, not prose about it. Empty sides render honestly
     (`none in the map`).
   - **technical layer, one click deep** (§1.8): an expandable section (house
     `grid-template-rows: 0fr→1fr`, 240ms, keyboard-instant — KEY_DECISIONS §4.2) holding the
     signature (`fm.interfaces`: each interface's name, accepts, returns), owned state fields
     (`fm.state`), and the **real source body** from `ctx.bodies` (`src/main.ts:255` boot-loads
     `bodies.json` into `ctx.bodies`; `src/core/context/context.ts:93`). The body renders as
     mono ink — **no syntax highlighting; code is ink, colour is meaning** (KEY_DECISIONS §7.5).
     `ctx.bodies` null or missing the id → the honest hint the source tab already uses (load
     bodies via the Bodies button / `npm run novakai:bodies`), never a fabricated body.
   - A modules-level ask (query matches a module node) gets the same card: module desc, its
     units as connections. One card grammar, no special cases.

Every element on the card is traceable to a field of the fetched map or `ctx.bodies` — the
same zero-fake-data bar the K2 contracts-render probe set (PROBES.md, probe-contracts-render).

---

## 2. Home vs Agents — the boundary (the disambiguation this spec exists to pin)

The master plan never separates "chat with AI" (Home) from "terminal with Claude Code"
(Agents). This section is the separation; both tabs cite it.

**The law in one line: Home answers from proven artifacts and can never change the repo;
Agents is the live generative session — it can change the repo, and anything it says is
generated in-session, never a proven artifact card.**

Stated honestly: Agents cannot be barred from answering questions — a real Claude Code
terminal answers whatever is typed into it. The enforceable axis is not *whether* a tab
answers but **how**: Home answers by proven artifact — instant, deterministic, gate-backed,
rendered as a card; Agents answers by generation inside a read-write interactive session,
rendered as a terminal stream. That axis survives real AI (§5): both paths may then ride the
K2 bridge, and the wall is permission + form — Home is one-shot, read-only, artifact-rendered;
Agents is interactive, tool-using, stream-rendered.

| | **Home (K8)** | **Agents (K6)** |
|---|---|---|
| verb | ask — understand the repo | delegate — do work in the repo |
| direction | **read-only**, always | read-write (full Claude Code) |
| ground truth | the verified map + `ctx.bodies` (gate-proven artifacts) | the live working tree |
| the reply | an **artifact card** (§1 step 4 — never a transcript, §3.9) | a live PTY byte stream in xterm.js |
| infrastructure | DOM + same-origin `fetch` — **zero bridge, zero WebSocket, zero PTY** | the K2(a) node-pty/WebSocket dev-server bridge |
| session | none — each question is answered fresh from the map | a persistent interactive terminal session |
| after real AI (§5) | one-shot Q&A grounded in the map; replies still artifact cards | interactive, tool-using Claude Code, unchanged |

Consequences pinned by this law:
- Home ships **no part of the K6 bridge** and takes no dependency on it existing. When the
  bridge lands, Home's AI seam (§5) may *call through it*; the bridge stays K6's module.
- Home never spawns, narrates, or impersonates an agent. There is no "agent is thinking"
  state anywhere in Home (PROTO_MANIFEST §4 — the narrated agent is the FAKE part).
- A work-shaped ask is not detected, judged, or half-answered — the static no-match pointers
  (§1 step 3) name Design and Agents, and that is the entire hand-off. Routing intent to tabs
  automatically is future judgment-work for the §5 AI layer, not for a lookup.

**The near boundary — Home vs Codebase.** Both read the same map, so this needs one line too:
**Codebase is spatial exploration of the whole graph** (the canvas — pan, zoom, drill, see
everything at once); **Home is a targeted question → one unit's artifact card + its
neighborhood**. Same substrate, different modality: *browse* in Codebase, *ask* in Home. A
card's connection links (§1 step 4) are the bridge for when an ask turns into a browse.

---

## 3. What answers draw on — the data path (traced, zero new parsing)

- **The map**: on every route entry, `home-model.ts` fetches `docs/novakai/_bundle.mmd` —
  same-origin, the exact pattern the app already uses for a docs path
  (`src/panel/unfold/unfold.ts:1190` fetches `docs/novakai/edge-advisory-allowlist.txt`) — and
  parses it with **`fromMermaid` from `src/io/mermaid.ts:212`**, the app's one serialiser/parser
  (onboard invariant 3). Importing it is house-sanctioned cross-module use of a pure function
  (precedent: `src/panel/planner/planner.ts:28`). `fromMermaid` already yields everything the
  card needs: nodes with `label`, `kind` (`%% kind`), `parent` (drill containment), frontmatter
  `fm` (`%% fm:meta` → `Frontmatter` — `name`, `description`, `state`, `interfaces` with
  accepts/returns; `src/core/types/types.ts:51`), plus the full edge set and group hierarchy.
  **No `%% src` handling is added**: the app parser does not read `%% src` (it is a tooling
  directive — CLAUDE.md conventions), so the card carries no source-path row; the body itself
  comes from `ctx.bodies`. Home adds **zero** directive parsing of its own — if a future card
  needs a directive the app parser skips, the parser grows in `io/mermaid.ts` behind its
  round-trip tests, never as a Home-side regex (A3: exactly two parsers, app and pipeline).
- **The index**: built from `ParseResult` per route entry — a plain in-memory array of
  `{ id, name, kind, module, desc, fm }` plus edge adjacency, where `name = fm?.name ??
  node.label` (`fm` is optional on `DiagramNode`, `src/core/types/types.ts` — un-annotated
  nodes stay searchable by their label). Rebuilt on every route entry, so a re-shipped map is
  picked up by navigating away and back; no cache invalidation machinery (ponytail: per-entry
  rebuild of a ~3k-line parse is instant on localhost; cache behind a content hash if a
  profiler ever says otherwise).
- **Index-not-ready is a pinned state, not a race**: `render()` returns immediately (§6) and
  kicks off the async fetch+parse; until `loadMapIndex()` resolves, the ask input renders
  **disabled** — the same disabled treatment as the fetch-failure state below, a state, not a
  spinner (§7 bans shimmer; on localhost the window is imperceptible). It enables when the
  index is ready, so an ask can never race the parse. The input's `disabled` attribute is the
  machine-readable ready signal the acceptance journeys await (§9 #8).
- **Repo scoping (R4) — stated, not dodged**: this slice answers from the **host-served
  repo's** map — the "one dev server per repo" world the app lives in today. K7's repo
  switching hands back File System Access *handles*, not same-origin URLs, so when K7 lands,
  the answer source must re-point to the loaded repo's map **through that handle** — an
  explicit K7 integration obligation this spec declares now (the §4 history key is the smaller
  half of the same obligation). Until then Home is honestly scoped: it answers about the repo
  the server serves, and the §3 footer line says which file that is.
- **Owning module** is derived the way the quiz defines it: walk drill `parent` links out of
  any subgraph grouping to the top-level unit (the map's own containment data, no heuristics).
- **The bodies**: read from `ctx.bodies` — already boot-loaded by `main.ts` section 7
  (`src/main.ts:255`) and typed on the context (`context.ts:93`). Home never fetches
  `bodies.json` itself (reuse, not a second copy) and renders the §1 honest hint when absent.
- **Fetch failure** (the file is not served — e.g. a static deploy without `docs/`): the page
  renders the input disabled with one dim line, `the map is not served here — run the local
  dev app`, and the command beneath (`npm run novakai:ship` regenerates it). Never a blank
  page, never a fake index.
- **Freshness is stated honestly**: the card's footer is one faint line, `from
  docs/novakai/_bundle.mmd as loaded` — the claim is "this is what the map says", proven at
  HEAD by the gate, not "this matches your uncommitted working tree" (see §7 for why the card
  therefore carries no teal).

## 4. Session history — questions, never answers

```ts
// home-model.ts — HOME RECORD v1. Any field change bumps HOME_RECORD_V and
// this spec section in the same PR.
export const HOME_RECORD_V = 1;

export interface HomeQuestion {
  v: typeof HOME_RECORD_V;   // schema version — consumers gate on this
  query: string;             // the asked text, verbatim
  askedAt: string;           // ISO 8601
}

/** localStorage['novakai.home.v1'] holds: HomeQuestion[] (newest first, capped at 50). */
```

**Answers are deliberately NOT persisted.** A stored answer is prose-shaped state that goes
stale the moment the map re-ships — exactly the drift novakai exists to kill. History rows
re-run `answerFor` against the current map on click; if a remembered unit no longer exists,
the honest no-match state (§1 step 3) is the correct answer *now*. The cap evicts oldest
silently (they are queries, not work — nothing is lost that a keystroke cannot re-create).

**Storage**: its own `localStorage` key, `novakai.home.v1`, read/written only by
`home-model.ts` — never folded into `persistence.ts`'s keys and never shared with
`novakai.design.v1` (same one-concern-one-key pattern SPEC_DESIGN §3 pinned). A stored record
whose `v` is unrecognized is dropped from the render, never migrated silently. Per-repo
scoping of the key is K7's job (R4), not K8's.

---

## 5. The seam to real AI — what ships instead now, and exactly where AI plugs in later

**What ships in this slice**: the deterministic map-lookup of §1/§3. It is not a placeholder
pretending to be AI — it is the verified-artifact answer layer that stays even after AI
arrives (instant, provable, zero-cost), the same way the map stays under any future feature.

**The seam is one function boundary**: `answerFor(query, index)` in `home-model.ts` is the
single choke point every ask flows through (typed input → typed `Answer` union: `card` /
`matches` / `none`). It is deliberately a named function, not a provider interface — one
implementation exists, so an abstraction would be speculative (ponytail; the boundary is the
*call site*, documented here, not a type).

**When real AI lands** (after the K6 bridge exists, per KEY_DECISIONS §1.11 and ruling R2):
- the AI layer is an **async second path behind the same call site** in `home.ts`: free-text
  queries that the lookup cannot answer (`none`) may be offered to the AI; lookup-answerable
  queries stay lookup-answered (instant and proven beats generated).
- the mechanism rides **K6's dev-server bridge** (the K2(a) probe's Vite plugin), e.g. a
  one-shot `claude -p "<question>"` scoped read-only, with the map as grounding context —
  Home still ships no bridge code of its own (§2).
- AI replies **render through the same artifact-card builders** — never a chat transcript
  (§3.9 is permanent law, not a v1 limitation). Claims that cite map units render as card
  links; uncited prose renders dim — honestly unproven under the colour law (§7).
- if the AI needs clarification it asks at most **ONE question** (KEY_DECISIONS §1.3), as a
  static fork the way SPEC_DESIGN §1 step 2 does it — never a dialogue.
- scope stays §2's: Home's AI is read-only Q&A; anything that edits the repo is Agents.

None of the above is built now; it is recorded so the slice that builds it inherits a settled
shape instead of re-litigating Home's identity.

---

## 6. Module breakdown, public API, wiring

Three TS files + one CSS file under `src/ide/**` (BLOCK-tier, K11). `css/styles.css` is
**never touched** — Home's styles live in a per-tab stylesheet imported by the tab module
(Vite handles CSS imports natively; the house `:root` vars are global, so `home.css` consumes
`--panel`/`--ink`/`--accent` etc. without duplication). A JS-injected style string (the
planner precedent, `src/panel/planner/planner.ts:10`) was considered and rejected: the §7
colour-law check greps a CSS file, and hues inlined in TS strings would dodge that audit; a
real `.css` file keeps every hue greppable, and the per-tab file is the Round-2 lane
convention (`css/styles.css` is frozen across all tab lanes).

| file | responsibility | rough size |
|---|---|---|
| `src/ide/home-model.ts` | `HOME_RECORD_V` + §4 types, `loadMapIndex()` (fetch + `fromMermaid` + index build), `answerFor(query, index)` (§5), history load/save/clear — no DOM. | ~130 lines |
| `src/ide/home-render.ts` | pure DOM builders: `renderRest(...)`, `renderMatches(...)`, `renderAnswerCard(...)`, technical-layer section — no business logic (mirrors the `design-render.ts` split). | ~150 lines |
| `src/ide/home.ts` | the factory: `initHome(ctx) => HomeApi`. Composes model + render, owns the current view (query/answer) in closure, `import './home.css'`. | ~60 lines |
| `src/ide/home.css` | the per-tab stylesheet — every Home selector prefixed `home-`. | ~80 lines |

Each function stays under the 60-line BLOCK limit; each file well under 500 (K11).

### Public API

```ts
// home.ts
export interface HomeApi {
  /** Render the current Home view fresh. Instant-swap, no lifecycle —
      called by the shell's page host exactly like renderDesign is today
      (shell.ts renderHost): rebuilt on every route entry. Returns
      immediately (input disabled) and kicks off the async map-index load;
      the input enables when the index resolves (§3, index-not-ready).
      Does nothing at construction time, so boot order is a non-issue. */
  render(): HTMLElement;
}
export function initHome(ctx: AppContext): HomeApi;
```

`initHome` takes `ctx` only — it reads `ctx.bodies` (§3) and needs nothing from any other
module's return value. No new hook, no `context.ts` change: shell→home is the same plain
one-way deps-injection K5 established (`initShell(ctx, { renderDesign })`, SPEC_DESIGN §4 —
"ctx.hooks exists to break cycles; a one-way shell→page call is a plain dependency").

### Wiring — rides the seam PR, not this lane

`src/main.ts`, `src/ide/shell.ts` and `src/ide/pages.ts` are frozen for this lane; their Home
edits belong to the **seam PR** (the orchestrator's, merged to `origin/main` before any lane
builds — the gate is verified by command: `git show origin/main:src/main.ts | grep -q
initHome`). The seam must land **three edits atomically** (precedented by K5's design wiring):

1. `main.ts`: `const home = initHome(ctx);` and the shell deps gain `renderHome: home.render`.
2. `shell.ts`: `renderHost` renders `deps.renderHome()` for `tab === 'home'`.
3. `pages.ts`: the `EMPTY` array **drops its `home` row** — this pins SPEC_SHELL §7's
   placeholder: Home's empty state is *retired*, not reworded, because a real page has no
   empty-state row (the exact precedent `design` set). `RAIL_ICONS.home` stays; the rest
   view's zero-state (§1) is the page's own honest face.

Atomicity is load-bearing: dropping the `EMPTY` row without the `renderHost` branch renders a
blank `#host` for `#home` (`shell.ts:94`'s `EMPTY.find` returns nothing). If the merged seam
lacks any of the three, this lane **stops and flags the orchestrator** — it never edits the
frozen files itself. This lane builds only `src/ide/home*.ts` + `src/ide/home.css` into the
stub the seam provides; if the merged seam's dep shape differs in name, the build adapts to
the seam (the seam is king over this section's identifier spelling).

---

## 7. Two-actor colour law compliance (KEY_DECISIONS §3.2)

| Home element | hue | var | why it's lawful |
|---|---|---|---|
| input focus, hover/selected match row, connection links | periwinkle | `--accent` | the human's focus and navigation — exactly the human actor |
| history rows, no-match state, card footer, source line | dim / faint | `--ink-dim` / `--ink-faint` | quiet, honestly unproven prose |
| desc, signature, body text | default ink | `--ink` | plain text and code-as-ink (§7.5 — no syntax highlighting) |

**No teal, no green, no amber anywhere in Home — including on the signature block.** The
reasoning is load-bearing, not stylistic: teal claims *machine-proven*, and the map's
signatures ARE gate-proven — **at HEAD**. But the file Home fetches can lag an uncommitted
working tree, and Home runs no live gate; painting the seam would bind a proof Home cannot
attest at render time. The card states its provenance honestly instead (§3 footer). The seam
grammar becomes available to a future slice that renders a *live verdict artifact* (K4's
territory), not to a static map read. No verdict → no green; nothing pending → no amber.
Any reviewer greps `src/ide/home.css` for `--proven`, `--attested`, `--edge-sel`,
`--accent-2` (the house amber var, `css/styles.css:14` — the form a violation would actually
take, never the raw hex), `--accent-3` (a blue outside the two-actor law, `css/styles.css:15`),
`#4fe0cd`, `#5fd0a0`, `#d9a066`, or any hex literal outside the house slate/ink set — a
nonzero result fails the colour law.

Motion: technical-layer expand/collapse is `grid-template-rows: 0fr→1fr`, 240ms, house
literal-duration style, keyboard-instant (KEY_DECISIONS §4.2/§3.5); everything else renders
instantly — no typing animation, no thinking shimmer, no stagger (an answer surface that
animates its answers is impersonating an agent, §2).

---

## 8. What K8 explicitly does NOT do (deferred, not designed away)

- Real AI, model calls, or the K6 bridge in any form — §5 records the seam; this slice ships
  the lookup layer only (KEY_DECISIONS §1.11, PROTO_MANIFEST §4).
- Intent detection / routing work-shaped asks — static pointers only (§1 step 3, §2).
- A second `.mmd` parse path or Home-side `%%` directive reading — the app parser is the only
  door (§3, A3).
- Persisting answers, exporting history, or per-repo history scoping (§4; R4 is K7's).
- Editing anything: the diagram model, `ctx.state`, the repo, `css/styles.css` (§2, §6).
- Proof seams, trust seals, verdicts — certificate grammar belongs to Contracts (K4); nothing
  Home renders carries a live verdict (§7).
- Search-quality machinery (fuzzy matching, stemming, embeddings) — ranked substring over
  name/module/desc is the whole v1 (ponytail: upgrade only when a real user's real miss shows
  the ranking failing, and prefer fixing the desc text in the map first).

---

## 9. Acceptance criteria

1. `docs/ide-vision/SPEC_HOME.md` exists (this file — `ide-roadmap.json` K8 check #1).
2. `grep -F "initHome" src/main.ts` is non-empty (K8 check #2 — lands with the seam PR) and
   `grep -F "renderHome" src/main.ts` is non-empty (the §6 deps wiring landed).
3. `grep -F "id: 'home'" src/ide/pages.ts` is empty (the `EMPTY` row is retired — §6);
   `grep -F "home:" src/ide/pages.ts` still finds the `RAIL_ICONS.home` glyph.
4. `grep -F "HOME_RECORD_V" src/ide/home-model.ts` is non-empty and every persisted record
   carries `v` (§4 is real, versioned code, not spec prose).
5. `grep -F "fromMermaid" src/ide/home-model.ts` is non-empty, and no Home file *parses* a
   `%%` directive itself:
   `grep -E "\.match\(.*%%|%%.*\.(match|test|includes|startsWith)\(|['\"]%%" src/ide/home*.ts`
   returns nothing — the check targets parse calls and `'%%'` string literals, deliberately
   NOT prose mentions, so honest comments about the data path never fail it (answers ride the
   app parser; Home adds zero directive parsing — §3).
6. `npm run lint` exits 0 — all `src/ide/home*.ts` files pass BLOCK tier (K11).
7. Colour law:
   `grep -E -- "--proven|--attested|--edge-sel|--accent-2|--accent-3|#4fe0cd|#5fd0a0|#d9a066" src/ide/home.css`
   returns nothing (§7 — the vars are grepped as well as the hexes, because a violating
   implementation would write `var(--accent-2)`, never the raw amber hex).
8. Real-Chromium journey A — ask lane (Playwright, house pattern, zero console/page errors):
   route to `#home` → **await the ask input enabling** (the index-ready signal, §3 — the
   journey never races the parse) → type a unit name that exists in the served map (resolve it
   from the fetched `_bundle.mmd` inside the test, never hardcoded) → Enter → the answer card renders
   with that unit's name, kind and owning module → expand the technical layer → the rendered
   signature text equals the map's `fm` interfaces for that unit (asserted against the
   independently fetched+parsed bundle) → click a connection link → the neighbor's card
   renders (by-id navigation, no history append — §1 step 4) → ask a second distinct typed
   query → reload → the history rows show exactly the two typed questions, newest first →
   click the oldest → its card re-renders (recomputed, §4).
9. Real-Chromium journey B — honest states + storage law: ask a string matching nothing → the
   no-match state renders with the `design`/`agents` pointers and no card (§1 step 3) → read
   `localStorage['novakai.home.v1']` in the test: every record is `{v, query, askedAt}` only —
   **no answer content persisted** (§4) → ask a query matching many units → the match list
   caps at 20 with the honest count line → `clear history` (accept the dialog) → rows gone
   after reload. Then the specified failure/edge states, driven by interception and seeding:
   with `docs/novakai/_bundle.mmd` intercepted to 404 (Playwright route), enter `#home` → the
   input renders disabled with the §3 `the map is not served here` line and its command —
   never a blank page; with `bodies.json` intercepted to 404 (so `ctx.bodies` is null), open a
   card's technical layer → the §1 step 4 honest load-bodies hint renders, no fabricated body;
   pre-seed `novakai.home.v1` with 50 records → ask once → the key holds exactly 50 and the
   oldest was evicted (§4).
10. `npm run novakai:ship` regenerates the map cleanly with the three new modules present as
    nodes (fragments scaffolded before the A1 gate is satisfied).
11. `npm run novakai:verify:full` green (inherited, `IDE_MASTER_PLAN.md` §3), J1 net green,
    idle screenshot byte-identical (idle = zero moving pixels).

**Proposed hardened K8 predicates** (for `docs/novakai/ide-roadmap.json` — that file is the
orchestrator's, frozen for this lane; the build PR proposes, the orchestrator applies):
`file src/ide/home.novakai.mmd` · `grep HOME_RECORD_V src/ide/home-model.ts` ·
`grep fromMermaid src/ide/home-model.ts` · manual: `card renders real _bundle.mmd data in
Chromium, zero console errors, colour law intact`.
