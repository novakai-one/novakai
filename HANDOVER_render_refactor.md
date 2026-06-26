# Flowmap — render refactor handover (model = single source of truth)

One agent task, start to finish. Phase 1 is already implemented; Phases 2–3 are yours.
You can compile and run; do so. Runtime visual desync is the main failure mode — a green `tsc`
does NOT mean done. Verify in the browser with the checklist after every phase.

## Why this exists
The recurring drag/render bugs (trailing labels, stranded boundary stubs, shimmer, mis-scoped
hides) share ONE root cause: two sources of truth — the model AND the live DOM — kept in sync by
hand, with per-interaction fast-paths that bypass `render()`, plus code that reads geometry back
from the DOM. Every divergence is a bug. This refactor removes the class, not the instances.

### Target invariant (enforce in review; this is the whole point)
1. The model (`ctx.state.nodes`, `ctx.state.edges`, layout fields) is the ONLY source of truth.
2. DOM is derived. NEVER read geometry from the DOM (`getBoundingClientRect`, `offsetWidth/Height`,
   `clientWidth/Height`, `measuredBlockHeight`). A node's size lives in the model.
3. All DOM mutation flows through `render()` / `drawWires()`, except ONE explicit live hot-path
   (drag), which writes only `transform` on the moved elements and is reconciled by `render()` on drop.

## Build / run
- Stack: TypeScript + Vite, vanilla (no framework). Entry `src/main.ts`, styles `css/styles.css`.
- Typecheck: `npx tsc --noEmit`
- Build: `npm run build`
- Dev (manual test): `npm run dev`, open the printed localhost URL.
- No automated UI tests. Verify by the checklist below in a browser.

## Status

### Phase 1 — DONE (already in the tree)
`initRender` in `src/render/render.ts` rewritten to a keyed diff.
- Added persistent `nodeEls: Map<id, HTMLElement>`.
- `render()` now: builds the level's id set; removes cached els whose id left the level; creates
  only new ids; for existing ids patches `className` + `left/top/width/height` + `background` in
  place; rebuilds a node's inner DOM ONLY when its structural signature (`nodeSig`) changes; toggles
  inline-edit `contenteditable` on the persistent label every render; re-appends els in z-order
  (moves, never destroy+rebuild).
- New helpers: `isSvgShape`, `classFor`, `nodeSig`, `buildInner`.
- Preserved exactly: per-node DOM shape, z-order (groups first, container last), empty-state,
  drill-in, inline edit, frontmatter cards, svg shapes, ports, resize handles. `render()` signature
  unchanged → no caller touched. Edge labels/boundary stubs are still owned and cleared by
  `drawWires()` (called at the end of `render()`), unchanged.
- Confirm Phase 1 with the checklist BEFORE starting Phase 2.

### Phase 2 — TODO: remove DOM geometry reads (the actual root fix)
Goal: nothing reads node/card geometry from the DOM; it comes from the model.

Find every read:
```
grep -rn "getBoundingClientRect\|offsetWidth\|offsetHeight\|clientWidth\|clientHeight\|measuredBlockHeight" src/
```
Known sites:
- `src/render/wires.ts` → `drawWires()` obstacle loop reads `.fmcard` `offsetWidth`/`offsetHeight`
  to size the label-avoidance obstacles.
- The Tidy/layout path (`src/io/layout.ts` and its `workspaceLayout` collision helper
  `resolveFileCollisions`) reads a measured block height from the live DOM.

Plan:
1. Store measured size in the model. Add a measured field to the node/layout state, e.g.
   `measured?: { cardW: number; cardH: number }` per node (or a `Map<id,{w,h}>` in `state`). Keep
   `n.w/n.h` as the box; the card is the extra overlay height.
2. Populate it in ONE place: a single post-render measure pass. After `render()` paints, inside a
   `requestAnimationFrame` (or a `ResizeObserver` on `.fmcard`), read each visible card's size once
   and write it into the model; if any value changed, schedule a single wire redraw. Never measure
   inside `drawWires` or layout.
3. Repoint readers at the model: `drawWires` obstacle sizing and `resolveFileCollisions` read the
   stored size — no DOM access.
4. First-frame guard: before a measurement exists, fall back to `n.w/n.h` (card-less) so nothing
   reads `undefined`.

Acceptance: the grep returns zero hits in render/layout/wires hot paths; Tidy and label-avoidance
behave identically with frontmatter cards ON and OFF; toggling cards re-measures and re-routes once.

### Phase 3 — TODO: collapse the drag fast-path hacks
Now that `render()` is cheap and identity-stable, the drag path shrinks to the one legitimate
hot-path. Current drag code (`src/interaction/pointer.ts`, `pointermove`/`pointerup` drag branches)
does: hide-incident-labels-on-first-move, pin base `left/top`, `will-change`, per-frame `transform`,
bake-on-drop, scoped `redrawWiresFor`. Keep `transform` + bake. Re-evaluate the label/stub hide:
with Phase 2 done you may instead let incident labels/stubs follow live in the scoped path, or keep
hiding them — choose whichever is smoother at ~206 nodes by testing. Whatever you keep, the rule
holds: the ONLY thing the hot-path writes is `transform` on moved els; everything else is reconciled
by `render()` on drop.

Acceptance: drag a node (cards on) — no trailing labels, no stranded stubs, no shimmer; drop
reconciles to final positions; multi-select drag, group drag (carries children), and resize all
behave; undo/redo, marquee, link-mode, drill-in, mermaid Apply all still work.

## Verification checklist (run in the browser after EACH phase)
Paste the ~206-node NovaKai bundle into the app. Run once with frontmatter cards ON, once OFF.
No console errors, and:
- [ ] Drag a single node: follows cursor; its in/out labels + arrows don't strand; no shimmer;
      every OTHER node's labels stay put and in place.
- [ ] Drop: wires route around boxes; labels reappear at correct anchors.
- [ ] Multi-select drag (marquee a few, then drag): all move together; reconcile on drop.
- [ ] Group drag: contained children move with the group.
- [ ] Resize (single-select handles): live resize; wires follow; persists on drop.
- [ ] Inline edit: double-click renames; caret stays; commit updates label + mermaid text.
- [ ] Selection: click / shift-click / marquee; selected ring + resize handles correct.
- [ ] Drill-in: enter a container, edit inside, breadcrumb back; node set swaps cleanly.
- [ ] Type-trace: click a type chip — matches light up, rest dim; click again clears.
- [ ] Tidy: runs, no crash, canvas stays interactive (Phase 2: identical with cards on/off).
- [ ] Undo / redo across the above.
- [ ] Add shape; delete (Backspace on empty); link via amber port.
- [ ] PNG / SVG export renders.
- [ ] Mermaid tab: Apply text → canvas; Copy.

## Rollback
All changes are in git; commit per phase so each is independently reversible.
- Phase 1: `git checkout -- src/render/render.ts`
- Phases 2/3 touch: `src/render/wires.ts`, `src/io/layout.ts` (+ its `workspaceLayout` helper),
  `src/core/state.ts` (new measured field), `src/interaction/pointer.ts`.

## Out of scope — do NOT fold in
The mmd spec / extract / diff / CI tooling is a separate track. This refactor changes only the
render + interaction layer. `.mmd` syntax, `src/io/mermaid.ts`, and persistence are untouched and
must stay untouched.
