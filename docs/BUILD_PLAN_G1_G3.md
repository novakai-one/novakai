# Build Plan — Group 1 (Foundation) + Group 3 (Navigation)

Status: proposed
Scope: verified against repo at time of writing. Every claim below was read from source, not assumed.
Re-verified independently on 2026-06-29 (source-read + dry-runs). Corrected claims are marked below; see "Re-verification corrections".

---

## Ground truth (verified, not guessed)

| Claim | File:evidence | Status |
|---|---|---|
| Backfill glob misses 1- and 2-level fragments | `package.json` → `flowmap:backfill` uses `src/*/*/*.flowmap.mmd` | BUG confirmed |
| Real fragments live at 1, 2, and 3 levels | `src/main.flowmap.mmd`, `src/io/files.flowmap.mmd`, `src/core/state/state.flowmap.mmd` | confirmed |
| `diff-core.mjs` is pure, zero IO, exports `diffSkeletons` | `tools/buildspec/diff-core.mjs` header + export | confirmed |
| Parser ignores unknown `%%` | `mmd-parse.mjs` → `if (/^%%/.test(t)) continue;` | confirmed |
| Parser returns `{dir,roots,nodes,edges,groups,fm}` | `mmd-parse.mjs` `parseMmd` return | confirmed |
| In-app serializer writes whole model only | `io/mermaid.ts toMermaid()`, `mmd-parse.mjs toMmd()` | confirmed (no slice exists) |
| Trace is TYPE-based, not call-spine | `render.ts` `runtime.tracedType` + `trace-hit`/`trace-dim` | confirmed (doc claim was wrong) |
| `ctx.bodies` is `Map<id,{kind,body,accepts,returns}>` | `context.ts` AppContext.bodies | confirmed |
| Source pane reads `ctx.bodies.get(id)`; id space matches | `inspector.ts` `updateSource`, `main.ts:227`, `_bundle.mmd` | CORRECTED — id is `container__symbol`, NOT bare (both sides) |
| Tabs are static buttons + union type | `tabs.ts` `showTab('insp'|'style'|'mmd'|'source')` | confirmed |
| Camera has `zoomToFit`, no `zoomToNode` | `camera.ts` CameraApi | confirmed (center-on-node is a gap) |
| `ctx.view.container` is drill level; no "home" HOOK | `context.ts`, `camera.ts` | confirmed — but a home VERB exists: `view.goTo(null)` |
| State exposes `childIdsOf`, `containerOf`, `containerPath`, `nodeCenter`, `worldBounds` | `state.ts` exports | confirmed |

Correction carried into plan: the doc's "#15 reuses `is-traced` at render.ts:95" is **wrong**. Node dimming uses `trace-hit`/`trace-dim` driven by `runtime.tracedType`. Focus mode reuses that path, not `is-traced` (which is on type chips inside the fm card).

### Re-verification corrections (2026-06-29) — read from source

- **Bodies key space is `container__symbol`, NOT bare id.**
  - `_bundle.mmd` node ids are `container__symbol` (e.g. `camera__zoomToFit`).
  - `extract.mjs` keys `bodies.json` by the same id.
  - `main.ts:227` = `new Map(Object.entries(data))` — loaded verbatim.
  - So `ctx.bodies` keys = state node ids = `container__symbol`.
  - "id space matches" stays TRUE; the reason is the shared `container__symbol`, not a bare id.
  - Impact: T1 `keyMode` bare branch is unneeded in-app; a bare key misses every lookup.

- **"Home" already exists: `view.goTo(null)`.**
  - `view.ts` exports `goTo(container|null)`; `goTo(null)` jumps to root.
  - `apply()` sets `ctx.view.container`, clears selection, renders, fits, refreshes breadcrumb.
  - The breadcrumb "Main" button already calls it.
  - Impact: T3 needs no new `goHome()` — just a toolbar button wired to `view.goTo(null)`.

- **`view.goTo`/`view.enter` clear selection and fit the whole level.**
  - `apply()` runs `state.sel.clear()` then `camera.zoomToFit()`.
  - Impact: T2 must order level-switch BEFORE select + center (see T2).

- **T4 must NOT import `tools/` into `src/`.**
  - `slice-core.mjs` lives in `tools/` — dev-time, not app runtime (CLAUDE.md invariant).
  - `src/` importing it breaks the app/tooling split and bundles `.mjs`.
  - The slice data shape (`parseMmd` model) differs from `ctx.state` anyway.
  - Impact: T4 computes the spine on `ctx.state.edges` in `src/`; T1 `slice-core` stays in `tools/`.

- **T0 is not zero-effect.**
  - Fixed backfill injects interfaces into 2 fragments: `io/layout` (`isSpineEdge`), `render/wires` (`boundaryStub`).
  - Proven by `scaffold.mjs --backfill <f> --tsconfig tsconfig.json --dry` across all 34 fragments (32 no-op, 2 write).
  - Impact: T0 pass/fail must diff fragments + re-run `flowmap:ship` + `spec:gate`.

- **Slice walks `solid` only.** Repo has 0 thick (`==>`) edges, so safe here. Add thick handling only if `slice-core` is reused on a repo that uses `==>` for the spine.

---

## Build order

```
T0  glob fix          (no deps)        — ship first, today
T1  slice-core.mjs    (no deps)        — pure module, CLI + browser
T2  navigator         (reads state)    — parallel with T1
T3  home + root ring  (reads camera)   — parallel
T4  focus mode        (reuses trace)   — after T2 (shares zoomToNode)
T5  continuous gate   (reads bodies)   — after T1 (reuses slice-core diff)
T6  assertions        (extends gate)   — last; only real design work
T7  app shell tab     (extends tabs)   — wraps T2/T5 panes
```

T0–T4 are mechanical, AI-churnable. T6 is the one piece needing your judgment.

---

# GROUP 1 — Foundation

## T0 — Backfill glob fix (#7)

Problem: `src/*/*/*.flowmap.mmd` requires exactly 3 path levels under `src`.
Misses: `src/main.flowmap.mmd` (1), all of `src/io/`, `src/render/`, `src/interaction/`, `src/panel/` (2). Catches only `src/core/*/` (3).

Change: `package.json`

```
"flowmap:backfill": "for f in $(find src -name '*.flowmap.mmd'); do node tools/buildspec/scaffold.mjs --backfill \"$f\" --tsconfig tsconfig.json; done",
```

(`find` is used over a glob because the shell does not expand `**` without globstar.)

Pass/fail (measured):
- Before: old glob loop → 11 of 34 (`core/*` only).
- After: `find` loop → all 34 (`find src -name '*.flowmap.mmd' | wc -l` = 34, verified).
- Effect (from `--dry` across all 34): backfill writes 2 fragments — `io/layout.flowmap.mmd` (+`isSpineEdge`), `render/wires.flowmap.mmd` (+`boundaryStub`). Other 32 no-op (already have interfaces, or no `%% src`).
- Post-run gate: `git diff --stat` shows only `package.json` + those 2 fragments; `npm run flowmap:ship` green; `npm run spec:gate` exit 0.
- Rollback: `git checkout package.json src/io/layout.flowmap.mmd src/render/wires.flowmap.mmd`.

Effort: low. NOT zero-effect — review the 2-fragment diff before commit.

---

## T1 — Slice core (#3)

New file: `tools/buildspec/slice-core.mjs`. Pure, zero IO. Reuses `parseMmd`.

API:
```
sliceModel(model, rootIds, opts) -> model'
  // model = parseMmd output
  // rootIds = node ids to slice around
  // opts = { up:bool (ancestors), down:bool (descendants), refs:bool (dotted neighbours) }
  // returns a new {dir,roots,nodes,edges,groups,fm} containing only kept ids + edges between them
```

Algorithm (all data already in `parseMmd` output):
1. seed = rootIds.
2. if `down`: walk `edges` where `style==='solid'`, from→to, collect reachable.
3. if `up`: walk solid edges to→from, collect ancestors.
4. if `refs`: add direct `style==='dotted'` neighbours of seed (1 hop).
5. keep = union. Filter `nodes`, `fm` to keep. Filter `edges` to those with both ends in keep.
6. serialize via existing `toMmd(model')`.

Why pure graph ops: no new concepts. `edges[].style` already distinguishes solid/dotted (`mmd-parse.mjs` EDGE_RE).

Bodies slice (the token-saver): given keep-set, filter `bodies.json` by key. Key space is `container__symbol` on BOTH sides — CLI (`extract.mjs`) and in-app (`ctx.bodies`, `main.ts:227` loads `bodies.json` verbatim; state ids come from `_bundle.mmd`). No bare-id space exists at runtime. Default `keyMode='container__symbol'`; a bare branch is only for a caller that passes a map whose node ids are already bare.

CLI bin: `flowmap-slice --map _bundle.mmd --node renderFn --down --up --refs --bodies public/bodies.json`

Pass/fail (deterministic):
- Slice of a known node returns the expected id set. Fixture: pick `initCamera`, `--down`, assert output contains its solid-edge children and excludes unrelated containers.
- Token check: serialized slice of one render node + its spine is < 4k tokens vs full bundle. Measure with `wc -c` / 4.
- Round-trip: `parseMmd(toMmd(slice))` equals `slice` (no data lost).
- Edge integrity: no edge in output references an id absent from output.

In-app surface (later, feeds T7): a "Slice" button on selected node → calls same logic on `state` (adapt `state.nodes`/`state.edges` to the `parseMmd` shape, or run on the loaded `.mmd`).

Effort: low. AI-churnable. The fixture is the spec.

---

## T6 — Assertions (#16)  [the hard one — do last]

Two tiers. Tier A is free (data exists). Tier B needs new annotation.

### Tier A — assertions over data already parsed (no new format needed)
Each is a declarative line the gate evaluates against `parseMmd` output:

| Assertion | Data source | Check |
|---|---|---|
| forbidden edge `auth -/-> raw_db` | `edges` | assert no edge from→to matches |
| fan-out ≤ N on node X | `edges` filter from===X | count ≤ N |
| state count ≤ N on node X | `fm[X].state.length` | ≤ N |
| change-boundary: only ids {…} may differ | diff two bundles via `diffSkeletons` | changed set ⊆ allowed |
| solid-edge subgraph acyclic | `edges` style==='solid' | DFS, no back-edge |

### Tier B — needs new model data (honest gap)
- "node must not trigger re-render of X" — flowmap models no effects. New annotation `%% assert <id> no-rerender <target>` required. Not free. Defer or scope out.

### Design work (this is the part AI cannot just churn)
1. Assertion grammar: where do they live? Proposal: `%% assert <kind> <args>` lines in the `.mmd`, ignored by `parseMmd` (already skips unknown `%%`), read by a new `parseAssertions(text)`.
2. Lifecycle: authored in app → exported in sliced contract → run by gate pre-merge.
3. Gate integration: extend `gate.mjs` to load assertions, run them after `diffSkeletons`, emit pass/fail per assertion.

Pass/fail (end-to-end, the real proof):
- Author `%% assert forbidden-edge auth raw_db`.
- Add edge `auth --> raw_db` to code-side extract.
- Run gate → exits non-zero, names the violated assertion.
- Remove edge → gate exits zero.

Effort: Tier A medium, Tier B high. Tier A is the shippable unit. Decide grammar before writing — that decision is yours, not the AI's.

---

# GROUP 3 — Navigation

## T2 — Node navigator (#4)

New file: `src/panel/navigator.ts`. New pane in `index.html` + tab.

Reads only: `ctx.state.nodes`, `ctx.state.edges`, existing state helpers.
Writes: selection (`SelectionApi.selectOnly`), view (`ViewApi.goTo` — level switch), camera (new `zoomToNode`, see T2.1).
Deps wiring: `initNavigator(ctx, { selection, view, camera })` in `main.ts`, built after `view` (main.ts:109). Modules receive apis as deps (e.g. `initView(ctx, camera)`); these are not hooks.

UI: searchable list. Each row = node id + kind badge + container label.
Filters (all pure on `state.nodes`):
- by kind: `n.kind === k`
- by container: `containerOf(state, id) === c`
- by edge participation: `edges.some(e => e.from===id || e.to===id)`

Row click → switch level if needed, then select, then center:
```
const level = containerOf(state, id);
if (ctx.view.container !== level) view.goTo(level); // clears sel, renders, fits level
selection.selectOnly(id);                            // re-renders WITH selection (selection.ts)
camera.zoomToNode(id);                               // overrides the level fit
```
`render()` draws ONLY `ctx.view.container`'s level (verified `render.ts`). Without the `goTo`, a node in another container is not drawn and the camera centers on empty space. `view.goTo` and `selectOnly` both call `render` already.

### T2.1 — `zoomToNode(id)` (camera gap)
`camera.ts` has `zoomToFit` (level bounds) but nothing centres one node. Add:
```
zoomToNode(id): center cam on nodeCenter(state.nodes[id]) at current or fixed zoom, applyCam()
```
Reuses `nodeCenter` (state.ts) + the cam math already in `zoomAt`.

Pass/fail:
- Filter "function" → list length === count of nodes with `kind==='function'` in state.
- Click row → that id is the sole member of `state.sel`, and `nodeCenter` maps to viewport centre (within pad).
- Search "camera" → only ids/labels containing "camera" shown.

Effort: low-med. ~150 lines. AI-churnable once `zoomToNode` exists.

---

## T3 — Home + root ring (#6)

Home ALREADY EXISTS: `view.goTo(null)` (`view.ts`). It sets `ctx.view.container=null`, clears selection, renders, fits, refreshes breadcrumb. The breadcrumb "Main" button already calls it.
No new `goHome()` needed. (`enterContainer`/`view.enter` only drill *in*; `goTo(null)` is the inverse and already shipped.)

T3 = add a `⌂` toolbar button in `index.html`, bound in `main.ts` to `view.goTo(null)` (mirror `$('zFit').onclick = camera.zoomToFit` at main.ts:170).

Root ring: in `render.ts classFor`, append `' is-root'` when `id` is in `state.roots`. Add CSS `.node.is-root { outline: ... }`.

Pass/fail:
- Drill into a container (`view.container !== null`), click Home → `view.container === null` and camera frames root bounds (`worldBounds`).
- A node whose id is in `state.roots` renders with the ring class; others do not.

Effort: low. Subsumes the navigator's "root at top" once T2 lands.

---

## T4 — Focus mode (#15)

Click node → dim everything except its call spine. Reuses the **trace-dim path**, not `is-traced`.

Mechanism (verified): `render.ts classFor` already applies `trace-hit` / `trace-dim` based on `runtime.tracedType`. Add a parallel transient: `runtime.focusSpine: Set<string> | null` in `runtime.ts`.

In `classFor`, when `focusSpine` is set:
- `focusSpine.has(id)` → `' focus-hit'`
- else → `' focus-dim'`

Spine computation = walk `ctx.state.edges` IN `src/` (NOT `tools/slice-core.mjs` — `src` importing `tools` breaks the app/tooling split, and the data shapes differ):
- down: solid edges from→to, transitive.
- up: solid edges to→from, transitive.
- refs: 1-hop dotted neighbours of the clicked id.
Same algorithm as T1, different data shape (`state.edges` vs `parseMmd` model). Two small impls, by design.
Cross-level caveat: `render()` draws only the current level, so a spine spanning drill levels only dims/highlights nodes at `ctx.view.container`. Either restrict focus to the current level or document the limit.

Toggle: click node with a modifier (or a "Focus" inspector button) sets `focusSpine`; click empty / Esc clears it.

Pass/fail:
- Click node X → every id in X's solid spine has `focus-hit`, every other rendered id has `focus-dim`.
- Clear → no node carries focus classes.
- Spine set equals the in-app keep-set from the `state.edges` walk for X (same algorithm as T1's `sliceModel`, computed on `state`).

Effort: low. ~50 lines render + reuse of T1. Depends on T1 keep-set.

---

## T5 — Continuous in-browser gate (#14)

When `ctx.bodies` is loaded, both sides are in memory:
- spec side: `state.nodes[id].fm.interfaces` (declared accepts/returns)
- code side: `ctx.bodies.get(id)` → `{accepts, returns}`

Key space matches: both sides keyed `container__symbol` (state ids from the loaded `_bundle.mmd`; `ctx.bodies` from `bodies.json`, same ids). The lookup `ctx.bodies.get(id)` works because of this — NOT because the id is bare.

Port the comparison only (not full `diffSkeletons` — that needs skeleton maps). New `src/core/drift/drift.ts`:
```
checkDrift(state, bodies) -> { inSync:number, total:number, drift:[{id, reason}] }
  for each id in bodies:
    declared = state.nodes[id]?.fm?.interfaces?.[0]   // fm AND interfaces both optional (types.ts)
    if (!declared) continue                            // node carries no interface
    real = bodies.get(id)
    compare arity ((declared.accepts ?? []).length vs (real.accepts ?? []).length)
    compare return-ness (declared.returns.length > 0 vs real.returns != null)
  // declared.returns is string[] (model); real.returns is string|null (bodies) — asymmetry handled above
  // NOTE: checks interfaces[0] ONLY; multi-interface classes (i1+) are not compared.
```

Live badge in status bar: `✓ 250/250 in sync` or `⚠ 3 drift`.

Note: this is a lighter check than the CLI gate (arity + return only, no kind/parent). State it as such; it is a fast smoke signal, not the authoritative gate.

Pass/fail:
- Load matching bundle + bodies → badge shows `total/total`, drift empty.
- Hand-edit one node's `fm` accepts to add a phantom param → badge shows 1 drift naming that id.
- Remove bodies → badge hidden (no false green).

Effort: low-med. Pure compare, no IO beyond the already-loaded map.

---

## T7 — App shell tab (#17)

`tabs.ts` already switches panes via a union + static buttons. Extend, don't rebuild.

1. Add `'nav'` (and later `'review'`) to the `showTab` union in `tabs.ts` and `context.ts` Hooks.
2. Add `tabNav` button + `paneNav` div in `index.html`, mirroring `tabSource`/`paneSource`.
3. Branch in `showTab`: toggle active + display, call `navigator.render()`.

Pass/fail:
- Click Nav tab → `paneNav` visible, others hidden, `tabNav` active.
- Type-check passes with extended union (every `showTab` call site covers `'nav'`).

Effort: med. Pure plumbing once T2 exists.

---

## What this plan deliberately does NOT claim

- It does not reuse `is-traced` for focus mode (doc was wrong; uses `trace-hit/dim`).
- Bundle ids === bodies ids === `container__symbol` (re-verified, CLI and in-app). slice-core defaults to that key space; `keyMode` covers only bare-id input maps.
- Continuous gate (#14) is arity+return only, not the full structural gate. Not overstated.
- Assertions Tier B (re-render effects) is flagged as a real gap, not a freebie.

## Recommended cut for a first shippable slice
T0 (today) → T1 + T2.1 + T2 (the navigator is the highest daily-use payoff and unlocks T4) → T3 → T4. Defer T5/T6/T7 until the navigation loop feels right in hand.

---

# Execution plan — T0–T4 (grounded in re-verification)

Order: T0 → T1 → T2.1 → T2 → T3 → T4.
T1 before T4 only as the algorithm reference; T4 reimplements on `ctx.state` (no `src`→`tools` import).

Pre-flight (once): `git status` clean. Baseline green: `npm run typecheck`, `npm run flowmap:ship`, `npm run spec:gate` (exit 0). These are the regression baseline for every step.

## T0 — glob fix
- File: `package.json` L19.
- Change: `for f in src/*/*/*.flowmap.mmd` → `for f in $(find src -name '*.flowmap.mmd')`.
- Run: `npm run flowmap:backfill`.
- Expect diff: `package.json` + `src/io/layout.flowmap.mmd` (+`isSpineEdge`) + `src/render/wires.flowmap.mmd` (+`boundaryStub`).
- Pass/fail: `git diff --stat` = 3 files; `npm run flowmap:ship` green; `npm run spec:gate` exit 0.
- Rollback: `git checkout package.json src/io/layout.flowmap.mmd src/render/wires.flowmap.mmd`.
- Blast radius: 2 fragments → bundle → gate. Contained; diff-reviewed.

## T1 — slice-core (tooling only; `src` untouched)
- Files: new `tools/buildspec/slice-core.mjs`; new `tools/buildspec/slice-core.test.mjs`.
- Imports: `parseMmd`, `toMmd` from `./mmd-parse.mjs`. Core fn does zero IO.
- API: `sliceModel(model, rootIds, {up,down,refs}) -> model'`.
- Algorithm: seed=rootIds; down=solid from→to (transitive); up=solid to→from (transitive); refs=1-hop dotted; keep=union; filter `nodes`/`fm`/`edges` (both ends in keep); `toMmd(model')`.
- Bodies filter: key space `container__symbol`; default `keyMode='container__symbol'`.
- Pass/fail (`node --test`): fixed id-set for a known node; round-trip `parseMmd(toMmd(slice))` deep-equals `slice`; no edge end outside keep; serialized slice token budget < 4k.
- Blast radius: zero runtime. No `src` import. CLI bin optional.
- Caveat: solid-only walk; repo has 0 `==>`.

## T2.1 — `camera.zoomToNode`
- File: `src/core/camera/camera.ts` (`CameraApi` + impl).
- Change: add `zoomToNode: (id: string) => void`. Impl: guard missing node; set `cam.x`/`cam.y` so `nodeCenter(state.nodes[id])` maps to viewport centre at current `cam.z`; `applyCam(); ctx.hooks.persist();`.
- Reuse: `nodeCenter` (state.ts); the `cam.x/y` math pattern in `zoomAt`.
- Wiring: returned in `CameraApi`; reached as a dep (modules already receive `camera`).
- Pass/fail: `npm run typecheck`; manual — `zoomToNode(id)` puts node centre within pad of viewport centre.
- Blast radius: additive method; no existing call site changes.

## T2 — navigator
- Files: new `src/panel/navigator.ts`; `index.html` (pane `paneNav` + button `tabNav`, mirror `paneSource`/`tabSource`); `main.ts` (build + deps).
- Wiring: `const navigator = initNavigator(ctx, { selection, view, camera });` after `view` (main.ts:109).
- Reads: `state.nodes`, `state.edges`, `containerOf`, `childIdsOf`.
- Filters (pure): kind `n.kind===k`; container `containerOf(state,id)===c`; edge `edges.some(e=>e.from===id||e.to===id)`.
- Row click (verified sequence): `if (ctx.view.container!==containerOf(state,id)) view.goTo(level)` → `selection.selectOnly(id)` → `camera.zoomToNode(id)`.
- Pass/fail: filter "function" length === count `kind==='function'`; click → id sole member of `state.sel` AND drawn at current level; search filters id/label.
- Blast radius: new module; only `main.ts` + `index.html` touch existing files.
- Note: showTab union extension (`'nav'`) is T7; for a standalone T2, toggle the pane directly or land the union early (3 spots: `tabs.ts`×2, `context.ts:51`).

## T3 — home button + root ring
- Files: `index.html` (`⌂` button), `main.ts` (bind), `src/render/render.ts` (`classFor`), CSS.
- Home: bind `⌂` → `view.goTo(null)` (mirror main.ts:170). No new verb.
- Root ring: in `classFor` append `+ (state.roots.includes(id) ? ' is-root' : '')`; add `.node.is-root { outline: … }`.
- Pass/fail: drill in, click `⌂` → `ctx.view.container===null`, camera frames root; node in `state.roots` has `is-root` (bundle has 1 root).
- Blast radius: `classFor` is hot path but the change is a pure string append; 1 ring node.
- Rollback: revert the 3 files + CSS.

## T4 — focus mode
- Files: `src/core/runtime/runtime.ts` (add `focusSpine: Set<string> | null`, init `null`); `src/render/render.ts` (`classFor`); trigger (`pointer.ts` modifier-click or an inspector "Focus" button); CSS.
- `classFor`: when `runtime.focusSpine` set → `focusSpine.has(id) ? ' focus-hit' : ' focus-dim'` (`classFor` already reads `ctx.runtime`).
- Spine: compute on `ctx.state.edges` in `src` (solid up/down + 1-hop dotted). NOT `tools/slice-core`.
- Toggle: trigger sets `focusSpine` + `render`; Esc / empty click clears.
- Pass/fail: click X → X's spine ids `focus-hit`, other RENDERED ids `focus-dim`; clear → none; spine set === `state.edges` walk for X.
- Cross-level caveat: only current-level nodes are drawn/affected.
- Blast radius: 1 runtime field + `classFor` append + trigger. Contained.

## Per-step gate (run after every T)
`npm run typecheck` → `npm run flowmap:ship` → `npm run spec:gate`. All must stay green. Commit per T for clean rollback.
