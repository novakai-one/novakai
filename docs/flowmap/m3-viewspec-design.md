# M3 — ViewSpec contract: design

This document is the reviewed design contract for M3. It names every file, export, command and
predicate before the code lands, so the build (this PR's later commits, and any follow-up) has a
machine-checkable target (`npm run flowmap:mvp` computes how much of it has landed — this doc
never says).

The roadmap intent it serves, quoted from `docs/flowmap/mvp-roadmap.json`:

> Serializable ViewSpec JSON; renderer = pure function of spec; checkboxes and future LLM both
> write same spec. Every migrated feature lands as render(spec), no direct DOM-toggle handlers.

The doctrine anchor is approved design decision #6 (SESSION_HANDOFF DO-NOT-REGRESS list):
*every interaction mutates one serializable spec object; screen = render(spec)* — and the
approved prototype states it literally (`prototypes/unfold-v3-stage.html`:
`// ViewSpec — screen = render(spec). Phase 2: LLM writes this.`).

## 1. Purpose & scope

Today the reading-mode view is ~10 closure variables inside `initUnfold`
(`expanded`/`hidden` Sets, `SEL`, `SELW`, `QUERY`, `layers`, `STAGE`, `FOCUS_TYPE`, `FM_OPEN`) —
the source even annotates them `// spec.stage`, `// spec.focusType`. Handlers mutate the
variables directly and call hand-picked render subsets; `persistView` serializes an ad-hoc
`{expanded, hidden, layers}` triple. Nothing but unfold's own closures can read, write, validate
or replay what is on screen — an LLM (or the M9 ViewSpec editor) has no object to write.

Deliverables, all in this PR (doc commits first so review order is doc → code):

- `src/core/viewspec/viewspec.ts` — a new pure core module (the `core/plan` pattern: types +
  pure helpers, no DOM, zero imports) holding `ViewSpec`, `ViewAction`, `ViewModelIndex`,
  `emptyViewSpec`, `normalizeViewSpec`, `reduceView`.
- `src/panel/unfold.ts` refactor — one `spec` object replaces the closure variables; a single
  `commit(action)` entry applies `reduceView` then paints; `persistView` stores the full spec
  and loads through `normalizeViewSpec`.
- `docs/flowmap/plans/m3-viewspec.plan.json` — the plan artifact, the first in this repo to
  carry H1 projection acceptance cases.
- `tools/buildspec/viewspec.test.mjs` — properties too fiddly for JSON cases.
- Map fragments (`src/core/viewspec/viewspec.flowmap.mmd`, `root.mmd`, unfold fragment) and the
  M3 predicate conversion in `docs/flowmap/mvp-roadmap.json` (§6).

M4 (unfold → main-app surface) and M5 (per-feature migration) then build **through** this seam;
they are explicitly out of scope here (§8).

## 2. The ViewSpec shape

All fields are plain JSON values — the "future LLM writes the same spec" requirement rules out
Sets, Maps and functions.

```ts
export interface ViewSpec {
  v: 1;                                       // schema version; a bump is detectable, never guessed
  expanded: string[];                         // containers unfolded in place
  hidden: string[];                           // ids removed from the canvas
  layers: Record<string, boolean>;            // calls/deps/desc/iface/metrics/color/trust/blast
  sel: string | null;                         // selected node or group
  selWire: { a: string; b: string } | null;   // selected wire, keyed by its rendered rep pair
  query: string;                              // browse-tree filter text
  stage: string | null;                       // staged container (the second projection)
  focusType: string | null;                   // type-focus token
  fmOpen: boolean;                            // inspector frontmatter editor open
}
```

**The boundary, stated once:** the spec determines WHAT is on screen. Animation infrastructure
(`prevShown`, `wireEnterAt`, `wiresEverDrawn`, `firstFit`, `ROUTES`) determines only HOW the
screen transitions and stays out. The derived model (`U`, `ROOTS`, `EDGES`, fan-in) is a function
of `ctx.state`, not view state, and stays out.

**Design judgments (with the rejected alternatives):**

- **`Z` (pan/zoom) is OUT** — human verdict (Chris, 2026-07-03). Z is continuous per-gesture
  motion (wheel/pointermove), largely *derived* (`fitView`/`reframeToFit` recompute it from DOM
  content size, so a stored Z goes stale the moment the spec changes structure), and an LLM
  directing attention says `sel`/`stage`/`layers`, never pixels. Rejected alternative: the
  strict reading ("the viewport is part of the screen") would route every pointermove through
  the commit seam — a hot path with no semantic gain. If ever wanted, `camera: {x,y,k} | null`
  is an additive v2 field.
- **`fmOpen` is IN.** Its current handler (`FM_OPEN = !FM_OPEN; renderInspector()`) is exactly
  the "direct DOM-toggle handler" the intent bans; excluding it would grandfather a permanent
  exemption on day one. Rejected alternative: treating it as ephemeral micro-UI — but it is one
  serializable boolean and the rule stays clean.
- **Versioning is a `v: 1` literal.** The legacy localStorage shape (`{expanded?, hidden?,
  layers?}`, no `v`) is a strict subset of the v1 spec, so `normalizeViewSpec` migrates it with
  no shape branch at all.
- **The type lives beside its helpers in `src/core/viewspec/`, not in `core/types`.** Precedent:
  `src/core/plan/plan.ts` ("Pure module: types + pure helpers only"). `types.ts` stays the
  editor-model vocabulary; ViewSpec is a view-domain contract whose normalizer and reducer form
  one reviewable module — and one map node.

## 3. `normalizeViewSpec(raw: unknown, known?: string[] | null): ViewSpec`

The "schema validated" half of the old manual note, in the codebase's established form — a
hand-rolled tolerant normalizer (`normalizePlan`, `normalizeFrontmatter` precedent; no schema
library exists in `src` and none is introduced).

Contract:

- Garbage in (null, non-object, wrong-typed fields) → `emptyViewSpec()` field-by-field: every
  field is individually coerced, never trusted.
- The legacy stored shape `{expanded?, hidden?, layers?}` is a valid subset — migration is free.
- `layers` absent → the calls-only default (approved decision #1: wires are the story, ON for a
  fresh view). `layers` present → each of the 8 known keys coerced with `!!`; **stored prefs
  win** (a stored `{deps: true}` yields `calls: false`, not the fresh-view default).
- `known` (when given) confines the spec to a real model: `expanded`/`hidden` filtered to known
  ids, `sel`/`stage`/`focusType`… `sel` and `stage` nulled when unknown, `selWire` nulled when
  either endpoint is unknown. `query` and layer prefs survive — they are not id-keyed.
- Idempotent on a valid spec.

**Why `known` is a `string[]`, not a callback:** acceptance cases pipe args as JSON into a
subprocess (`tools/buildspec/acceptance.mjs`); a `(id) => boolean` parameter would make the
id-filtering half of the schema untestable. Unfold passes `[...U.keys()]` — negligible cost.

## 4. `reduceView(spec, action, model): ViewSpec` and the commit seam

The reducer is where "renderer = pure function of spec" becomes real rather than cosmetic: the
view-mutation logic currently scattered through unfold's handlers moves into one pure function,
and each invariant becomes an acceptance case.

```ts
export type ViewAction =
  | { type: 'toggleExpand'; id: string }   // collapse folds ALL descendants (today's fold walk)
  | { type: 'reveal'; id: string }         // unhide the ancestor chain + expand ancestors
  | { type: 'hide'; id: string }           // refuses the last visible root; clears sel if hidden
  | { type: 'select'; id: string | null }  // toggle; clears selWire/focusType/fmOpen
  | { type: 'selectWire'; a: string; b: string } // toggle by pair; clears sel/focusType/fmOpen
  | { type: 'focusType'; t: string | null }      // when set, clears sel + selWire
  | { type: 'setStage'; id: string | null }      // clears selWire (a projection change invalidates reps)
  | { type: 'toggleLayer'; key: string }
  | { type: 'setQuery'; q: string }
  | { type: 'setFmOpen'; open: boolean }
  | { type: 'foldAll' };                   // clears expanded/hidden/sel/selWire/query/focusType/stage

export interface ViewModelIndex {          // plain-data containment slice — JSON-expressible
  parents: Record<string, string | null>;
  children: Record<string, string[]>;
  roots: string[];
}
```

Invariants the reducer centralizes (each previously an inline handler fragment):
collapse-folds-descendants; reveal-unhides-chain-and-expands-ancestors; the last-visible-root
hide guard; the `sel`/`selWire`/`focusType`/`fmOpen` mutual exclusions; stage-invalidates-selWire;
and `setStage` on an unknown id normalizes to `null` (today's `stageMode` guard).

`reduceView` returns a **new** spec and never mutates its input (the input may be frozen — the
bundled test locks this).

**In unfold, the single mutation entry:**

```ts
function commit(a: ViewAction): void {
  spec = deepFreeze(reduceView(spec, a, modelIndex()));
  paint(a);
}
```

- `paint(a)` transcribes today's hand-picked render subsets per action (select without blast →
  focusDim + tree + inspector + deferred wires; structural actions → full `render(true)`; layer
  toggles → class application + `render(false)`; …). The subsets are the approved animation
  quality (stagger, pill stability, focus flow) — they become an *internal optimization behind
  the commit boundary*, not a rule violation, because no handler mutates anything directly.
- The install is deep-frozen: a surviving direct write (`spec.sel = x`) throws in dev, and the
  old closure variables are deleted, so shadow view-state is a compile error. Exactly three
  spec-assignment sites exist: `commit`, `persistView('load')`, and `build()`'s stale-id drop
  (which becomes one `normalizeViewSpec(spec, [...U.keys()])` call).
- One behavioural move (not a pure transcription, called out honestly): the selWire
  dies-with-its-reps rule ran *inside* `render()` (a render-time model write). It moves into the
  reducer/normalizer path. Everything else is a mechanical substitution.

**Rejected alternatives for the seam:**

- *Spec + commit(mutator-callback) without a reducer* — the mutation logic stays inline in
  handlers; nothing but the load boundary is testable; the contract is convention, not machine.
- *Full derive layer (`deriveView(spec, model) → {shownIds, dims, wires…}` + dumb painters)* —
  honest but requires rewriting ~1000 lines of tuned DOM/animation code; that is M4/M5 migration
  work which can grow behind this same commit seam. Gold-plating for M3.

## 5. Persistence

`persistView` keeps its exact identity and cap semantics — key `unfold.view`, fingerprint =
sorted containment roots joined `|`, 24-entry FIFO cap — but the stored value becomes the full
v1 spec, and load goes through the schema boundary:

```ts
// save
all[fp] = spec;
// load
const loaded = normalizeViewSpec(all[fp], [...U.keys()]);
spec = deepFreeze({ ...emptyViewSpec(),
  expanded: loaded.expanded, hidden: loaded.hidden,
  layers: { ...loaded.layers, trust: loaded.layers.trust && TRUST_SRC } });
```

- Backward compatibility is free: a pre-M3 stored entry is a valid subset.
- Load applies only the durable trio (`expanded`/`hidden`/`layers`) — exactly today's session
  semantics. `sel`/`stage`/`query` are stored (the format carries them) but not restored:
  `selectSync('open')` owns selection seeding at the mode boundary. Restoring them is an M4
  decision, additive when wanted.
- The `TRUST_SRC` gate stays at the call site — it is a runtime capability (is an advisory
  source present?), not part of the schema.

## 6. Roadmap predicate conversion

The M3 `checks` in `docs/flowmap/mvp-roadmap.json` are replaced by (the `manual` note is dropped
entirely — `roadmap.mjs` treats a manual check as never-passing, so keeping it would cap M3
below its ceiling forever; the M2b precedent):

```json
"checks": [
  { "kind": "file", "path": "docs/flowmap/m3-viewspec-design.md", "minBytes": 2000 },
  { "kind": "grep", "path": "src/core/viewspec/viewspec.ts", "pattern": "export interface ViewSpec" },
  { "kind": "grep", "path": "src/panel/unfold.ts", "pattern": "normalizeViewSpec\\(", "count": 2 },
  { "kind": "grep", "path": "src/panel/unfold.ts", "pattern": "reduceView\\(" },
  { "kind": "cmd",  "run": "! grep -qE 'let (SEL|SELW|QUERY|STAGE|FOCUS_TYPE|FM_OPEN)' src/panel/unfold.ts" },
  { "kind": "cmd",  "run": "npm run flowmap:acceptance -- --plan docs/flowmap/plans/m3-viewspec.plan.json" },
  { "kind": "cmd",  "run": "node tools/buildspec/run-bundled-test.mjs tools/buildspec/viewspec.test.mjs" }
]
```

Design of the set — each predicate proves *wiring or behaviour*, never mere existence:

- **design-doc file (minBytes 2000)**: the reviewed contract is part of the computed score; the
  byte floor blocks a hollow stub (F-04).
- **type grep**: the contract type exists in real TypeScript, path-anchored (subsumes the old
  repo-wide `grep -rq ViewSpec src` cmd).
- **normalizer grep with `count: 2` in unfold.ts**: an import line does not match the call form
  `normalizeViewSpec(`; two call sites prove BOTH boundaries route through the schema — the
  persist-load and `build()`'s stale-id drop. A defined-but-unused normalizer fails.
- **reducer grep in unfold.ts**: the reducer is what `commit` applies — the render(spec) seam is
  live in the only view surface, not just exported.
- **negative cmd**: the old closure view variables are gone. This is the machine form of "one
  serializable spec object / no direct DOM-toggle handlers" — shadow view-state cannot re-enter
  without failing it. (`roadmap.mjs` runs cmd predicates via the shell, where POSIX `!` inverts
  grep's exit.)
- **acceptance cmd**: the behavioural half of the old manual note ("render purity confirmed") —
  the plan's projection cases (migration, id-confinement, fold/reveal/guard/exclusion
  invariants) run against the real code via the map's `%% src`, red before implementation,
  green only when behaviour matches. First plan in the repo to exercise the H1 harness.
- **bundled-test cmd**: locks the properties JSON cases can't express — normalizer idempotence
  and the reducer's never-mutates-frozen-input guarantee.

`npm run flowmap:mvp` computes where M3 stands against these checks at any moment — that
command, not this doc, is the status.

## 7. Build order in this PR (test-first)

1. **This doc** (commit 1 — review order is doc → code).
2. **Map fragments**: `src/core/viewspec/viewspec.flowmap.mmd` (new module fragment: 3 type
   nodes + 3 function nodes with `%% src`/`%% fm:meta`), `docs/flowmap/root.mmd` (module node,
   `%% kind viewspec module`, `%% group-member g_reading viewspec`, edge
   `unfold -.->|normalize, reduce| viewspec`), unfold fragment (`ufCommit` node, `ufPersistView`
   desc refresh). Bundle so `%% src viewspec__*` resolves.
3. **Plan** `docs/flowmap/plans/m3-viewspec.plan.json`: `plan-check` green; `flowmap:acceptance`
   **red** — the contract is falsifiable before any code.
4. **Bundled test** `tools/buildspec/viewspec.test.mjs`: red.
5. **Implement** `src/core/viewspec/viewspec.ts` → steps 3–4 green.
6. **Refactor** `src/panel/unfold.ts` (§4–§5); typecheck per stage; manual animation QA in
   `npm run dev` (stagger, staged pill stability, wire flow, travel, reload persistence
   including a pre-M3 stored view).
7. **Roadmap conversion** (§6 verbatim) + register the bundled test in `spec:test:all`.
8. **Ship + prove**: `flowmap:ship`, `spec:test:all`, `typecheck`, `flowmap:mvp`,
   `flowmap:roadmap:audit`.

## 8. Out of scope / future

- The live spec-editor / spec-inspector panel (M9's "review in ViewSpec editor").
- An LLM actually writing specs (Phase 2) — M3 only guarantees it *could*.
- Migrating other features (import, mmd sync, slice, plan view, diff workspace, export,
  frontmatter) onto ViewSpec = M5; promoting unfold to the main app surface = M4.
- Camera/Z in the spec (§2 verdict; additive v2 field if reversed).
- Editor-side ViewSpec — the canvas editor keeps StateStore/Prefs/Camera as-is.
- The full `deriveView` + dumb-painter layer (§4 rejected alternative) — grows behind the same
  commit seam during M4/M5.
- Cross-reload restore of `sel`/`stage`/`query` (§5 — stored, deliberately not applied).
