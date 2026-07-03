# M5 — unfold-primary design (M4 correction)

**Supersedes the reading of M4 encoded in `m4-read-primary-design.md` and the old M4
predicates.** The shipped M4 treated unfold as a sticky *surface choice* over the editor.
The corrected intent: **unfold IS the app.** The blue infinite canvas is legacy — same data,
superseded UX — retained temporarily as a comparison surface to prove no feature loss, then
deleted. There is no state where the canvas is home. The ✕ on unfold must not exist; nothing
legitimate sits behind it.

Companion artifact: `docs/flowmap/parity-checklist.md` — the recomputed per-feature
inventory whose rows drive the migration plans and the deletion gate. Rulings of 2026-07-03
are recorded in its header and assumed here.

## 1. State machine

```
boot ──────────────► UNFOLD  (always; no SURFACE_KEY read, no stickiness, no empty-model
                              exception — an empty model boots unfold's empty state)

UNFOLD ──[compare affordance]──► LEGACY-COMPARE   (explicit, visibly temporary)
LEGACY-COMPARE ──[return affordance / Esc]──► UNFOLD
```

No other surfaces. Planner remains a fullscreen overlay invocable from either (it is
surface-independent by construction). Reload from any state lands on UNFOLD.

Consequences, enumerated:
- `resolveBootSurface` and `SURFACE_KEY` are **removed** (function, constant, both
  `localStorage.setItem` writes in `unfold.ts`, the `main.ts:236` call, and the
  `AppSurface` type if nothing else consumes it). No remnant is currently justified; if the
  legacy-compare affordance later wants "reopen compare where you left it", that is new
  compare-scoped state, not a resurrected boot decision.
- The unfold dock ✕ dies. `ufClose` survives only as the internal transition invoked by the
  compare affordance; outermost-Esc no longer exits to the editor.
- The empty-model rule inverts: today `resolveBootSurface(_, hasNodes=false) = 'edit'`;
  after the flip, an empty model shows unfold's empty state (which must exist and offer a
  create path once authoring verbs migrate — until then it may show the seed/load
  affordances).

## 2. Architecture rulings (decided 2026-07-03, restated as constraints)

1. **`camera` is shared core and survives** — unfold needs screen-to-world math once drag
   lands. Its `applyCam`/`#world` DOM binding is legacy-scoped; the math is not.
2. **`render/wires` splits**: the pure geometry (`orthoPath`, `polyPath`) moves to `core/`
   (unfold already imports it); the SVG painter dies with the legacy canvas.
3. **`ctx.hooks.render` is surface-conditional during the compare period** (repaint the
   canvas only when legacy-compare is open; repaint/derive unfold otherwise) **and
   unfold-only after deletion.** Same rule applies to the hooks `selectOnly` fans into
   (`renderInspector`, `renderSlice`) while their panels still exist.
4. **`tabs.toast` is extracted** (or re-owned) before `tabs` dies — it backs the app-wide
   `ctx.hooks.toast`.
5. **Legacy-only inits go lazy**: `minimap, wires(painter), render, pointer, inlineEdit,
   contextMenu, keyboard(editor bindings), inspector, navigator, slice, tabs,
   styleControls, view` initialize on first legacy-compare open, and are deleted with the
   canvas. Shared core stays eager: `persistence, history, selection, nodes, clipboard,
   mermaid, theming, files, planner, camera, unfold`.
6. **Positions stay user-editable in `ctx.state`**; Tidy remains an optional layout command.
   Tidy currently overwrites manual moves on click — accepted for now; revisit inside the
   drag plan.

## 3. Migration order (smallest-risk first; one plan.json per row)

Each item is a per-feature plan with acceptance red before code, per the loop. The parity
checklist row flips to `unfold-native` only when that plan's gate is green and a 0-context
agent confirms from output alone.

1. **P-boot — boot flip** (this correction's first plan; acceptance set in §6).
2. **P-io — save/load/bodies affordances in unfold** (model-level, no new interaction:
   `files.saveMmd`, `.mmd` load, bodies.json load).
3. **P-review — Plan/Diff buttons in unfold** (planner overlay already surface-independent;
   verify-over-unfold + affordance only).
4. **P-mmd — mermaid text view + apply from unfold** (serialiser is shared; needs an unfold
   home for the textarea contract).
5. **P-search — navigator parity** (search/kind-filter/jump mapped to unfold focus/travel
   instead of canvas camera).
6. **P-slice — neighbourhood slice from unfold selection.**
7. **P-verbs — model verbs**: add node, delete, wrap-in-group, edge label/reverse/delete,
   clear-all, copy/paste/duplicate, undo/redo bindings, help overlay. Several small plans,
   grouped here for ordering; each stays its own plan.
8. **P-edges — edge creation** (link affordance rethought for cards, not a port-drag port).
9. **P-drag — manual positioning in unfold** (§4; largest item, standalone).
10. **P-style — theme/font controls reachable from unfold.**
11. **P-delete — legacy deletion** (gated by §5).

Deferred: export SVG/PNG (backlog). Undecided (not blocking): multi-select, bring-to-front,
edge geometry drag, fill/shape/size editing, dot-grid/minimap prefs, fm-cards width, status
bar (checklist footnotes ⁴/⁶).

## 4. Drag-in-unfold — the real design question

Today unfold owns geometry by **flow**: `ufRenderCanvas` lays out containment as nested flex
cards; `ufReframe` rescales to fit; stage pills sample `ctx.state` x/y only for centroid
angles. The editor owns geometry by **position**: every node has manual x/y in `ctx.state`.
Drag-in-unfold makes these coexist. The conflict is concrete: *the user drags a card, then
expands a group — flex reflow recomputes every card's place. Who owns the resulting
geometry?* Options, not choices:

**Q1 — what does a drag write?**
- **A. `ctx.state` x/y** (one geometry, two projections). Editor, Tidy and stage-pill angles
  all see the same numbers. But unfold's flex layout does not consume x/y today, so this
  only means something combined with Q2-C or a hybrid.
- **B. A ViewSpec position layer** (per-diagram card offsets/pins in the persisted spec,
  reduced through `reduceView` like every other view mutation — M3-consistent). `ctx.state`
  x/y remains the editor's; unfold's arrangement is reading-surface state. Cost: two
  geometries forever, and "positions stay user-editable in ctx.state" is satisfied only via
  the legacy editor until it dies.
- **C. Both** (drag writes ctx.state x/y; ViewSpec stores only pin flags). Keeps one
  coordinate truth but couples unfold drags to Tidy overrides (accepted behaviour today).

**Q2 — how does dragged geometry survive reflow (the expand-a-group moment)?**
- **A. Flow wins**: drags are ephemeral; any structural change (expand/collapse/hide) reflows
  and discards them. Honest and cheap; user arrangement is lost, which reads as breakage
  once drag is a first-class feature.
- **B. Offset deltas**: a drag stores a delta relative to the card's flow position;
  reflow recomputes flow positions and re-applies deltas; `ufReframe` accounts for offset
  cards. Arrangement survives, but deltas can land cards somewhere nonsensical after a big
  reflow.
- **C. Pinning**: a dragged card becomes pinned (absolute within its parent container, out
  of flex flow); unpinned cards keep flowing around the hole or reflow densely; an explicit
  unpin returns it. Persisted in ViewSpec; reflow never moves pinned cards. Clearest mental
  model of the three, adds a visible pinned/unpinned distinction to render + inspector.
- **D. Mode-scoped**: manual arrangement exists only in a dedicated arrange context (e.g.
  stage mode or an explicit arrange toggle); explore view stays flow-owned. Smallest blast
  radius, but positions then aren't "in" the primary reading view.

**Q3 — do containers constrain dragging?**
- **A. Constrained**: a card drags only within its parent group's bounds; containment never
  changes by drag. Reparenting stays a model verb (P-verbs).
- **B. Reparent-by-drag**: dragging across a boundary reparents (editor-canvas semantics).
  Powerful, but couples the largest interaction feature to model mutation + history +
  re-derive on day one.
- **C. Constrained first, reparent later** as a separate plan on top.

**Interaction surface** (applies under any of the above): drag starts from the card body
with a movement threshold so click-to-select, dblclick-rename, wire hits and stage panning
keep working; `camera`'s screen-to-world math maps pointer to unfold's world transform
(shared-core ruling); snap/guides/nudge/align enter only in the P-drag review, and only if
ruled to survive.

The P-drag plan is authored against ONE selected option per question; this section exists so
that choice is made consciously by Chris at that plan's review, with the trade-offs already
on the table. (A leaning, if useful: Q1-C + Q2-C + Q3-C — one coordinate truth, pinning as
the reflow contract, containment constrained first. Not a decision.)

## 5. Deletion criteria (the legacy canvas is removed when…)

Every parity-checklist row is `unfold-native`, `deferred-by-decision` with a backlog entry,
or dropped by an explicit ruling recorded in the checklist header — no row left
`legacy-only`, `migrating`, or undecided `candidate-drop`. Concretely, before `P-delete`:
the checklist has zero rows whose status column reads `legacy-only` or `migrating` and zero
un-ruled `candidate-drop` rows; `hooks.render` has flipped to unfold-only; the
`wires`-geometry extraction has landed; and a 0-context agent, booting the app fresh,
reaches every checklist capability without the compare affordance. The compare affordance
and every module in §2.5's lazy list are then deleted in one plan, and the map re-synced.

## 6. Roadmap changes + boot-flip acceptance

The old M4 checks asserted the wrong behaviour (`resolveBootSurface(` present in `main.ts`,
`SURFACE_KEY` ×3 in `unfold.ts` — i.e. sticky surface choice). They are **rewritten** in
`docs/flowmap/mvp-roadmap.json` to assert unfold-primary boot: this design doc + the parity
checklist exist; `main.ts` and `unfold.ts` contain **no** `SURFACE_KEY`/`resolveBootSurface`
references; boot opens unfold unconditionally; and the boot-flip plan's acceptance passes.
M5's item points at the parity checklist as its feature enumeration; per-feature checks are
added as each plan is authored. `flowmap:roadmap:audit` stays clean (this doc and the
checklist carry no hand-written status markers; roadmap state remains computed).

First acceptance set (P-boot, red before code):
1. Fresh profile (no localStorage) with a non-empty model boots into unfold.
2. Fresh profile with an **empty** model boots into unfold (empty state), not the editor.
3. No ✕ exists on the unfold dock; outermost Esc does not exit unfold.
4. The legacy canvas is reachable only via the explicit compare affordance, and returning
   lands back on unfold.
5. Reload after visiting legacy-compare still boots unfold (no stickiness).
6. Zero console errors through boot → compare → return → reload.
7. `SURFACE_KEY`/`resolveBootSurface` are absent from `src/` (or each remnant carries a
   written justification in this doc — currently none is justified).
