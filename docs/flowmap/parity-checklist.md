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

## A. Model verbs (surface-independent; must be reachable from unfold)

| Feature | Trigger(s) today | Owning module(s) | Status |
|---|---|---|---|
| Add node (9 shapes) | shape toolbar, `1`–`9`, dblclick canvas, ctx-menu "Add box here", footer "+ Add box" | `nodes` (addNode) | legacy-only |
| Create edge | link mode (`L` / linkBtn) + port drag | `pointer` (startLink) → `nodes` (makeEdge) | legacy-only |
| Delete selection | `Delete`/`Backspace`, ctx menu, inspector | `nodes` (deleteSelection) | legacy-only |
| Rename node | `Enter` / dblclick | `inlineEdit` (canvas) · unfold `ufRenameInPlace` | unfold-native |
| Copy / paste / duplicate | `⌘C/V/D`, ctx menu | `clipboard` | legacy-only |
| Select all | `⌘A`, ctx menu | `selection` | legacy-only |
| Undo / redo | `⌘Z/⇧Z/Y`, toolbar | `history` (engine is shared; buttons are canvas toolbar) | legacy-only |
| Wrap selection in group | multi-inspector | `nodes` (wrapInGroup) | legacy-only |
| Edit frontmatter | inspector fm editor | `inspectorFrontmatter` · unfold `ufMountFrontmatter` | unfold-native |
| Edge: label / reverse / delete | edge inspector | `inspector` (renderEdgeInspector) → `nodes` | legacy-only |
| Node kind / desc edit | single inspector | `inspector` (renderSingleInspector) | legacy-only |
| Clear all | footer "Clear" | inline in `main.ts` | legacy-only |

## B. IO + review (surface-independent; affordance must move to unfold)

| Feature | Trigger(s) today | Owning module(s) | Status |
|---|---|---|---|
| Save .mmd | saveBtn | `files` (saveMmd) | legacy-only |
| Load .mmd | loadInput | `files` | legacy-only |
| Load bodies.json | bodiesInput | `files` (applyBodies); unfold already reads `ctx.bodies` | legacy-only |
| Mermaid text view + apply + copy | mermaid tab, applyMmd, copyMmd | `mermaid` (only serialiser; textarea DOM is panel-bound) | legacy-only |
| Diff review (raw proposal) | diffBtn → `planner.openProposal` | `planner` (own overlay, isolation pattern) | legacy-only¹ |
| Plan review | plannerBtn → `planner.open` | `planner` | legacy-only¹ |
| Export SVG / PNG | exportPngBtn/exportSvgBtn | `exporter` (draws editor-style boxes) | deferred-by-decision² |
| Neighbourhood slice (+ copy) | slice tab | `slice` | legacy-only |
| Node search / kind filter / jump | nav tab | `navigator` (navigateTo drives canvas camera) | legacy-only |
| Source body viewer | source tab | `inspector` (updateSource) · unfold `ufRenderInspector` | unfold-native |
| Theme / font selection | style tab | `styleControls` → `theming` (CSS vars, app-wide) | legacy-only |
| Autosave + restore, prefs | automatic | `persistence` | unfold-native (surface-independent) |

¹ planner is a fullscreen overlay with its own DOM/CSS (the pattern unfold copied) — expected
to work over unfold unchanged; needs a live check, then only the *button* migrates.
² exporter renders the editor's visual (absolute x/y boxes). Exporting the unfold view is a
different feature. Ruled deferred (backlog) — revisit after the migration spine lands.

## C. Spatial-editor interactions (position editing migrates per ruling; chrome-level rows still need decisions)

| Feature | Trigger(s) today | Owning module(s) | Status |
|---|---|---|---|
| Drag node to reposition | pointer drag | `pointer` (startDrag) | migrating³ |
| Corner resize | pointer drag | `pointer` (startResize) | migrating³ |
| Marquee multi-select | drag on empty canvas | `pointer` (startMarquee) | candidate-drop⁴ |
| Shift-click multi-select | click | `pointer`/`selection` | candidate-drop⁴ |
| Arrow-key nudge (+Shift grid) | arrows | `keyboard` (writes x/y) | migrating³ |
| Snap-to-grid | snapBtn, style toggle | `pointer` + prefs | migrating³ |
| Alignment guides | during drag | `pointer` (addGuide/showAlignGuides) | migrating³ |
| Align / distribute | multi-inspector | `nodes` (alignNodes) | migrating³ |
| Auto-layout "Tidy" | layoutBtn | `layout` (writes x/y) | migrating⁵ |
| Bring to front | ctx menu | `nodes` (bringToFront, paint order) | candidate-drop⁶ |
| Edge label drag / bend drag | pointer drag | `pointer` (startLabelDrag/startBendDrag) | candidate-drop⁶ |
| Fill colour / shape / size+pos edit | single inspector | `inspector` | candidate-drop⁶ |
| Edge line style / routing / reset | edge inspector | `inspector` | candidate-drop⁶ |
| Dot grid / minimap / route-style prefs | style tab | `styleControls` | candidate-drop⁶ |
| Fm-cards toggle + width | style tab | `styleControls` (canvas fm cards ≠ unfold cards) | candidate-drop⁶ |

³ Ruled (2026-07-03): manual node positioning migrates INTO unfold. Drag is a standalone
per-feature plan (likely the largest migration item), sequenced after the boot flip. Which
of resize / nudge / align / snap / guides survive is decided inside that plan's review, not
here. Positions stay user-editable in `ctx.state`; unfold's stage pills already consume
those positions (centroid angles).
⁴ Unfold's selection today is single card / wire / group / type-focus. Multi-select in unfold
is a possible M5 feature, not a port of marquee.
⁵ Ruled: Tidy remains an optional layout command over `ctx.state` positions. Its current
click behaviour overrides manual moves — acceptable for now, an easy later fix inside the
drag plan's design.
⁶ Not yet ruled — visual/chrome-level editing of the legacy surface. Needs a decision before
the deletion gate; not blocking the boot flip or the drag plan.

## D. Navigation, camera, chrome

| Feature | Trigger(s) today | Owning module(s) | Status |
|---|---|---|---|
| Pan (scroll / space-drag / middle-drag) | pointer, wheel | `pointer`, `keyboard`, `camera` | unfold-native (own stage panning) |
| Zoom (pinch / ⌘-scroll / +− / %) | keyboard, zoom overlay | `camera` | legacy-only⁷ |
| Zoom to fit (`F`) | keyboard, zFit | `camera` (zoomToFit) | unfold-native (`ufReframe`, auto) |
| Drill into container | ctx "Open internals", `view.enter` | `view` | unfold-native (expand card / stage mode / travel) |
| Go up / go to root / breadcrumb | zHome, breadcrumb, Esc | `view` | unfold-native (collapse / stage exit; crumbs in inspector) |
| Minimap | minimap canvas | `minimap` | candidate-drop⁶ |
| Status bar (node/edge/sel counts) | passive | `inspector` (updateStatus) | candidate-drop (trivial to re-add) |
| Toast notifications | app-wide via `ctx.hooks.toast` | `tabs` (toast) — chrome module owns a shared hook | legacy-only⁸ |
| Right panel + tabs + resize + Tab toggle | tabs strip | `tabs` | candidate-drop (unfold has its own inspector dock) |
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
