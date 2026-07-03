# Legacy-canvas parity checklist (M5 kickoff — M4 correction)

**Intent (restated):** unfold IS the app. The blue infinite canvas is legacy — same data,
superseded UX — retained only as a comparison surface until every row below is
`unfold-native`, `dropped-by-decision`, or explicitly deferred by Chris. Then it is deleted.
There is no state where the canvas is home; the ✕ on unfold must not exist.

**Provenance (recomputed, not trusted):** every row was enumerated from the gate-verified map
(`docs/flowmap/_bundle.mmd` descs + module edges), `public/bodies.json`
(`keyboard__initKeyboard`, `contextMenu__initContextMenu` bodies), `index.html` (toolbar,
tabs, overlays DOM), and `src/main.ts` (toolbar bindings, boot). Re-derive with:
`npm run flowmap:onboard`, then grep the units named in each row.

**Status vocabulary** (per row): `unfold-native` — already reachable in unfold ·
`migrating` — ruled into the M5 migration (a per-feature plan is authored for it) ·
`legacy-only` — reachable only on the canvas today · `candidate-drop` — editor-only by
nature; needs Chris's decision · `deferred-by-decision` — Chris ruled it backlog. As each
feature migrates, its row is meant to be superseded by a computed roadmap predicate
(`docs/flowmap/mvp-roadmap.json`), not by hand-editing this file.

**Rulings (Chris, 2026-07-03):** position editing is NOT dropped — manual node positioning
(drag; resize/nudge/align pending per-feature review) migrates INTO unfold; drag is planned
standalone, sequenced after the boot flip. Tidy remains an optional layout command;
positions stay user-editable in `ctx.state` (current tidy-overrides-drag behaviour is
acceptable, fix later). Export SVG/PNG deferred to backlog. `camera` is shared core and
survives (unfold needs screen-to-world math once it has drag). `wires` geometry moves to
core, the painter dies with legacy. `hooks.render` is surface-conditional during the compare
period, unfold-only after deletion.

**Rulings (Chris, 2026-07-03 — second pass):** the unfold panel must be **resizable and
collapsible** (today it is fixed open), and gains **tabs / sub-menus anchored at the "reveal"
strip** at the top of the panel — the panel body is at content capacity, so no migrated
affordance lands in it until those tabs exist, and the sleek/clean look is a hard design
constraint (§G). Wire routing avoiding only nodes but **not container groups** is ruled a
must-fix UX gap — on root a wire cuts through 2 levels of containers — sequenced first (§G).
All remaining `candidate-drop` rows are **deferred to backlog for MVP** (add later if wanted;
no longer blocking the deletion gate). **Diff/plan review migrate last** in the MVP order —
expected hardest; wait until the unfold home is complete.

**Rulings (Chris, 2026-07-03 — third pass):** **nav is closed** — unfold's browse search IS the
replacement, the navigator dies with legacy (dropped-by-decision, no port). **slice and style
migrate as new tabs** on the P-panel dock (plan `m5-p-tabs2`). The tab strip becomes **two
stacked rows** so future tabs never produce one over-long row (row assignment is a free
decision, easy to reorder). **Diff/plan review move OUT of the MVP entirely** — post-MVP,
substantial work expected; they stay reachable in legacy until then (supersedes "last in the
MVP order": now not in the MVP at all). **§A model verbs migrate** (plan `m5-a-verbs`) with
minimal, hidden-by-default affordances matching unfold's design language. The **legacy surface
is retained as a reference** until Chris rules deletion; when legacy interferes with the new
design, the clash is surfaced for a ruling instead of built around — first recorded instance:
the legacy theme system (`THEMES` → `--*` vars) styles only the canvas; unfold consumes none
of those endpoints and has its own light/dark, so the style tab ports **font** (one source,
`FONTS`, reaching unfold via a `--uf-font` var) and hosts unfold's appearance control, while
the **theme chips stay legacy-only pending a ruling** on mapping `THEMES` to unfold's palette.
**Select-all is deferred to backlog** alongside multi-select (unfold is a single-selection
surface; a select-all verb has no meaning on it yet).

**Rulings (Chris, 2026-07-04):** 2026-07-04/1 — **Plan review re-enters the MVP** (supersedes
2026-07-03/3 for plan review only): required for the M9 recorded demo on novakai (human review
→ approve → export). Reachable from unfold io tab via ctx.hooks.plannerOpen; planner overlay
stacks above unfold (z 80>70). Diff review (raw proposal) stays post-MVP.

## A. Model verbs (surface-independent; must be reachable from unfold)

| Feature | Trigger(s) today | Owning module(s) | Status |
|---|---|---|---|
| Add node (9 shapes) | shape toolbar, `1`–`9`, dblclick canvas, ctx-menu "Add box here", footer "+ Add box" | `nodes` (addNode) | migrating (m5-a-verbs) |
| Create edge | link mode (`L` / linkBtn) + port drag | `pointer` (startLink) → `nodes` (makeEdge) | migrating (m5-a-verbs) |
| Delete selection | `Delete`/`Backspace`, ctx menu, inspector | `nodes` (deleteSelection) | migrating (m5-a-verbs) |
| Rename node | `Enter` / dblclick | `inlineEdit` (canvas) · unfold `ufRenameInPlace` | unfold-native |
| Copy / paste / duplicate | `⌘C/V/D`, ctx menu | `clipboard` | migrating (m5-a-verbs) |
| Select all | `⌘A`, ctx menu | `selection` | deferred-by-decision (backlog, with multi-select — 2026-07-03/3) |
| Undo / redo | `⌘Z/⇧Z/Y`, toolbar | `history` (engine is shared; buttons are canvas toolbar) | migrating (m5-a-verbs) |
| Wrap selection in group | multi-inspector | `nodes` (wrapInGroup) | migrating (m5-a-verbs) |
| Edit frontmatter | inspector fm editor | `inspectorFrontmatter` · unfold `ufMountFrontmatter` | unfold-native |
| Edge: label / reverse / delete | edge inspector | `inspector` (renderEdgeInspector) → `nodes` | migrating (m5-a-verbs) |
| Node kind / desc edit | single inspector | `inspector` (renderSingleInspector) | migrating (m5-a-verbs) |
| Clear all | footer "Clear" | inline in `main.ts` | migrating (m5-a-verbs) |

## B. IO + review (surface-independent; affordance must move to unfold)

| Feature | Trigger(s) today | Owning module(s) | Status |
|---|---|---|---|
| Save .mmd | saveBtn · unfold io tab | `files` (saveMmd) | migrating (P-panel) |
| Load .mmd | loadInput · unfold io tab | `files` (loadMmdText) | migrating (P-panel) |
| Load bodies.json | bodiesInput · unfold io tab | `files` (loadBodies); unfold already reads `ctx.bodies` | migrating (P-panel) |
| Mermaid text view + apply + copy | mermaid tab, applyMmd, copyMmd · unfold mermaid tab | `mermaid` (only serialiser; unfold applies through it) | migrating (P-panel) |
| Diff review (raw proposal) | diffBtn → `planner.openProposal` | `planner` (own overlay, isolation pattern) | deferred-by-decision¹ (post-MVP) |
| Plan review | plannerBtn → `planner.open` | `planner` | unfold-reachable (io tab → ctx.hooks.plannerOpen; ruling 2026-07-04/1) |
| Export SVG / PNG | exportPngBtn/exportSvgBtn | `exporter` (draws editor-style boxes) | deferred-by-decision² |
| Neighbourhood slice (+ copy) | slice tab · unfold slice tab | `slice` | migrating (m5-p-tabs2) |
| Node search / kind filter / jump | nav tab | `navigator` (navigateTo drives canvas camera) | dropped-by-decision (unfold browse search is the replacement — 2026-07-03/3) |
| Source body viewer | source tab | `inspector` (updateSource) · unfold `ufRenderInspector` | unfold-native |
| Theme / font selection | style tab · unfold style tab | `styleControls` → `theming` (CSS vars, app-wide) | migrating (m5-p-tabs2; font + appearance — theme chips legacy-only pending ruling, 2026-07-03/3) |
| Autosave + restore, prefs | automatic | `persistence` | unfold-native (surface-independent) |

¹ applies to diff review (raw proposal) only (plan review moved out under ruling
2026-07-04/1, below). It is a fullscreen overlay with its own DOM/CSS (the pattern unfold
copied). Ruled (2026-07-03/3, superseding /2's "last in the MVP order"): **post-MVP** —
substantial work expected; stays reachable in legacy until then. Correction found in code
(2026-07-04): the "works over unfold unchanged" assumption was wrong — planner's overlay was
z-index 60 vs unfold's 70 (rendered underneath), fixed to 80 for plan review; diff review's
own overlay is still unverified against unfold's z-index and needs the same live check before
it can follow plan review out of backlog.
² exporter renders the editor's visual (absolute x/y boxes). Exporting the unfold view is a
different feature. Ruled deferred (backlog) — revisit after the migration spine lands.

## C. Spatial-editor interactions (position editing migrates per ruling; chrome-level rows still need decisions)

| Feature | Trigger(s) today | Owning module(s) | Status |
|---|---|---|---|
| Drag node to reposition | pointer drag | `pointer` (startDrag) | migrating³ |
| Corner resize | pointer drag | `pointer` (startResize) | migrating³ |
| Marquee multi-select | drag on empty canvas | `pointer` (startMarquee) | deferred-by-decision⁴ |
| Shift-click multi-select | click | `pointer`/`selection` | deferred-by-decision⁴ |
| Arrow-key nudge (+Shift grid) | arrows | `keyboard` (writes x/y) | migrating³ |
| Snap-to-grid | snapBtn, style toggle | `pointer` + prefs | migrating³ |
| Alignment guides | during drag | `pointer` (addGuide/showAlignGuides) | migrating³ |
| Align / distribute | multi-inspector | `nodes` (alignNodes) | migrating³ |
| Auto-layout "Tidy" | layoutBtn | `layout` (writes x/y) | migrating⁵ |
| Bring to front | ctx menu | `nodes` (bringToFront, paint order) | deferred-by-decision⁶ |
| Edge label drag / bend drag | pointer drag | `pointer` (startLabelDrag/startBendDrag) | deferred-by-decision⁶ |
| Fill colour / shape / size+pos edit | single inspector | `inspector` | deferred-by-decision⁶ |
| Edge line style / routing / reset | edge inspector | `inspector` | deferred-by-decision⁶ |
| Dot grid / minimap / route-style prefs | style tab | `styleControls` | deferred-by-decision⁶ |
| Fm-cards toggle + width | style tab | `styleControls` (canvas fm cards ≠ unfold cards) | deferred-by-decision⁶ |

³ Ruled (2026-07-03): manual node positioning migrates INTO unfold. Drag is a standalone
per-feature plan (likely the largest migration item), sequenced after the boot flip. Which
of resize / nudge / align / snap / guides survive is decided inside that plan's review, not
here. Positions stay user-editable in `ctx.state`; unfold's stage pills already consume
those positions (centroid angles).
⁴ Unfold's selection today is single card / wire / group / type-focus. Multi-select in unfold
is a possible M5 feature, not a port of marquee. Ruled (2026-07-03/2): deferred to backlog
for MVP — add later if wanted.
⁵ Ruled: Tidy remains an optional layout command over `ctx.state` positions. Its current
click behaviour overrides manual moves — acceptable for now, an easy later fix inside the
drag plan's design.
⁶ Ruled (2026-07-03/2): deferred to backlog for MVP — visual/chrome-level editing of the
legacy surface; revisit after the migration spine lands. No longer blocking the deletion gate.

## D. Navigation, camera, chrome

| Feature | Trigger(s) today | Owning module(s) | Status |
|---|---|---|---|
| Pan (scroll / space-drag / middle-drag) | pointer, wheel | `pointer`, `keyboard`, `camera` | unfold-native (own stage panning) |
| Zoom (pinch / ⌘-scroll / +− / %) | keyboard, zoom overlay | `camera` | legacy-only⁷ |
| Zoom to fit (`F`) | keyboard, zFit | `camera` (zoomToFit) | unfold-native (`ufReframe`, auto) |
| Drill into container | ctx "Open internals", `view.enter` | `view` | unfold-native (expand card / stage mode / travel) |
| Go up / go to root / breadcrumb | zHome, breadcrumb, Esc | `view` | unfold-native (collapse / stage exit; crumbs in inspector) |
| Minimap | minimap canvas | `minimap` | deferred-by-decision⁶ |
| Status bar (node/edge/sel counts) | passive | `inspector` (updateStatus) | deferred-by-decision (trivial to re-add) |
| Toast notifications | app-wide via `ctx.hooks.toast` | `tabs` (toast) — chrome module owns a shared hook | legacy-only⁸ |
| Right panel + tabs + resize + Tab toggle | tabs strip | `tabs` | dropped-by-decision (superseded by unfold's own dock tabs — §G) |
| Help overlay (`?`) | helpBtn | inline in `main.ts` | legacy-only (unfold needs its own shortcut ref) |
| Context menu | right-click | `contextMenu` | legacy-only (unfold has no ctx menu) |
| Esc behaviour | keyboard | `keyboard` (editor) · unfold outermost-Esc **closes to editor — must be removed per intent** | legacy-only |

⁷ Unfold reframes automatically; whether the user also gets manual zoom is an M5 design
question, not a straight port. Camera is ruled shared core (drag needs screen-to-world math),
so manual zoom in unfold costs little if wanted.
⁸ `toast` must be extracted from `tabs` (or re-owned) before `tabs` can die.

## E. Already unfold-native (no legacy dependency) — for completeness

Folded containment rendering, aggregated orthogonal wires with libavoid routing, calls/deps
layer gates, trust layer (advisory allowlist), blast-radius (`ufComputeBlast`), reading
inspector (kind/crumbs/desc/interfaces/blast/connections/source), type focus, stage mode +
proxy pills + travel, group select + external connections, wire select + underlying
relations, per-diagram ViewSpec persistence, selection sync across the boundary, staggered
entrance / focus dim / reframe.

## F. Boot + runtime findings surfaced by this audit (inputs to the design doc)

- `resolveBootSurface` / `SURFACE_KEY` (`src/main.ts:236`, `core/viewspec`, `core/config`)
  implement sticky surface choice with an empty-model-boots-editor rule — **contradicts the
  intent** (boot → unfold, always; empty model must boot unfold's empty state). Slated for
  removal; any remnant needs written justification.
- `unfold.ufClose` writes `SURFACE_KEY='edit'` and is wired to the dock ✕ and outermost Esc —
  the ✕ path dies with the correction; close-to-editor becomes the explicit legacy-compare
  affordance only.
- `initDiffWorkspace` (`src/panel/diff-workspace.ts:30`) is **never called** anywhere in
  `src/` since D2 routed diffBtn → `planner.openProposal`; its `#diffOverlay` DOM in
  `index.html` is runtime-dead. Cleanup candidate independent of parity. The bundle still
  shows a `main -->|29 diff workspace|` module edge — not backed by a call in `main.ts`.
- unfold imports `routeGraph` from `render/avoidRouter` (`src/panel/unfold.ts:35`) but the
  bundle's module-edge list for unfold (config, selection, camera, state, wires,
  inspectorFrontmatter, viewspec) does not include avoidRouter — map-completeness gap to fix
  at re-sync.

## G. Unfold UX work ruled into M5 (Chris, 2026-07-03/2 — new unfold features, not legacy ports)

Not parity rows: these are gaps in the primary surface itself, ruled into the M5 sequence
because readability of the home surface is broken without them (wires) or because the §B tab
migrations have no clean landing zone without them (panel).

| Work item | Today | Status |
|---|---|---|
| Wire routing avoids **container groups**, not just nodes | on root a wire cuts through 2 levels of containers — significant readability gap | migrating (P-wires; sequenced first) |
| Inspector dock **resize + collapse** | dock is fixed open | migrating (P-panel) |
| Panel **tabs / sub-menus** anchored at the "reveal" strip | panel body is at content capacity; migrated affordances need a home; clean design is a hard constraint | migrating (P-panel; prerequisite for the §B tab migrations) |
