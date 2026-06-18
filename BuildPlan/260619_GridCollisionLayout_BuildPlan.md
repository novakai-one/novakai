# Grid · Collision · Layout — Build Plan

Written 19/06/2026. Covers three interlocking systems. 
**Stage 1 (Grid) is built in this pass; Stages 2–3 are designed here and built next.**

---

## The non-negotiable rule (same as every prior plan)

WSA is the **only** conduit. New helpers `CollisionManager` (CM) and `LayoutManager` (LM) follow the exact contract SM and DM already live by:

- Helpers attach **no** DOM listeners.
- Helpers **never** import each other.
- Components **never** import helpers.
- Every mutation routes **through WorkspaceArea**, which owns the store writes + persistence.

CM and LM are **pure functions of layout**, not stateful gesture receivers like SM/DM. They take a `LayoutDataSet` (+ an anchor block id) and return a new `LayoutDataSet`. WSA calls them at the two structural moments it already owns:

```
            ┌──────────────── WorkspaceArea (ONLY conduit) ────────────────┐
 drop (DM)  ─┤  dm.onDrop(id, finalLocal)                                   │
            │        └─▶ snapToGrid → CM.resolve(layouts, movedId) ─▶ persist│
 delete(SM) ─┤  sm.registerDeleteBlockHandler                               │
            │        └─▶ LM.collapse(layouts, deletedRect) ─▶ persist        │
 newblock   ─┤  sm.registerNewBlockHandler                                  │
            │        └─▶ snapToGrid → CM.resolve(...) ─▶ persist             │
            └──────────────────────────────────────────────────────────────┘
```

CM and LM are stateless modules (plain exported functions), so "routed through WSA" means **WSA is the only caller**. They never touch the store, the DOM, or each other. This keeps them trivially unit-testable and keeps the conduit rule intact.

---

## Coordinate model (why this is simpler than React-Pieces)

React-Pieces ran on react-grid-layout: 12 columns, free x, `collides()` checks **both** x and y overlap. react-dev right now is **single-column**: x is locked (`PAGE_X`, `lockX = true` in DragManager), every block is full page-width. So:

> **Two blocks collide iff their vertical ranges overlap.** x always overlaps (same column, full width). Collision is purely 1-D vertical.

This is the assumption the user flagged: *"this is only applicable for full width components → so there needs to be no horizontal overlap → always true at the moment."* When real x/resize lands, CM's `collides` swaps back to the 2-D AABB test and the rest of the algorithm is unchanged.

All geometry is **pixels**, snapped to the grid. One grid unit `GU = 26px`.

---

## Stage 1 — Grid system  *(this pass)*

### 1.1 One grid unit, whole-number line-height

`GU = 26`. Body `p` line-height becomes a whole `26px` (was `1.65 × 16 = 26.4`) so one rendered line == one grid row exactly. Cells are square: `26 × 26`.

`src/layout/grid.ts` is the single source of truth:

```ts
export const GRID_UNIT = 26                 // px — one paragraph line; square cells
export const PAGE_X    = 56                 // left gutter (matches drag-container right gutter)

export const snapToGrid   = (px: number) => Math.round(px / GRID_UNIT) * GRID_UNIT
export const snapUpToGrid  = (px: number) => Math.ceil (px / GRID_UNIT) * GRID_UNIT
export const rowsForHeight = (px: number) => Math.max(1, Math.round(px / GRID_UNIT))
export const heightForRows = (rows: number) => rows * GRID_UNIT
```

`PAGE_X` moves here so DragContainer (currently a local const) and CM/LM share one number.

### 1.2 Square block rows (clean heights)

Drop the container's vertical padding (`padding: 2px 4px → 0 4px`) and set the editable's `min-height: 26px`. A one-line block is then exactly `26px` tall — a clean grid multiple — and an N-line block is `N × 26`. This makes "height in rows" exact, which Stage 2/3 depend on.

### 1.3 Visible grid (ruled-paper feel)

A subtle repeating background on `.workspace-area`, layered under the existing radial highlight. Horizontal lines every `26px` (prominent-ish), vertical lines every `26px` (very faint — "column width not important right now"). Origin at the workspace content-box top so lines align with snapped block tops.

### 1.4 Snap on every structural write

- **Drop:** WSA's `dm.onDrop` callback snaps `finalLocal.y` to `snapToGrid` before persisting.
- **New block (Enter):** snap the computed `newY` to grid.
- **Inserted block (panel):** snap `y` to grid.
- **Paste:** snap each `nextY` to grid.

x stays `PAGE_X` (locked). After Stage 1, every block top sits on a grid line.

### 1.5 Acceptance

Build is green; dragging a block snaps its top to a 26px line; new/Enter/paste blocks land on grid lines; one-line blocks are 26px tall; the ruled background is visible but quiet.

---

## Stage 2 — CollisionManager  *(next pass)*

Direct port of `React-Pieces/.../CollisionManager/CollisionManager.tsx`, reduced to 1-D vertical because react-dev is single-column. New module `src/layout/collisionManager.ts` — **plain functions, no class, no state.**

### Algorithm — REVISED to a cutoff sweep (built 19/06 pm)

The first cut ported the react-grid model literally: pin the top-left block and
shift **every** block at/below it down. That preserves spacing but drifts the
whole document downward on every rearrange — endlessly, even when the blocks
below had room. The user flagged this: a push must be ABSORBED by the first gap
and stop. So the algorithm is now a single flush downward sweep:

```
resolve(items, movedId):
  sort by y asc (tie → movedId first, so the dropped block wins its row)
  for i in 1..n:
    minY = items[i-1].y + items[i-1].h          # bottom of the block above
    if items[i].y < minY:                        # overlap → push flush
      items[i].y = minY
    # else: gap → leave it. A non-pushed block can't shove the next one,
    #       so the sweep dies at the first gap. THAT gap is the cutoff.
  return items
```

Invariants:

- **Flush, not by a height** — a pushed block lands exactly on the block above's bottom (`minY`), no gap.
- **Cutoff at the first gap** — the moment a block already clears the one above, it and everything below are untouched. No whole-document drift.
- **Blocks above the drop never move** (sweep only pushes downward).
- **`movedId` only breaks y-ties** so the dropped block pins its row.

`collides()` is implicit in `items[i].y < minY` (vertical only). When x unlocks, the sweep restricts the "above" comparison to blocks sharing the column.

Heights fed in are rounded to the NEAREST row (`heightForRows(rowsForHeight(px))`), not ceil — `snapUp` turned a 26.0001px block into 52 and opened a one-row gap.

### Wiring (WSA only)

WSA measures fresh heights from the DOM (`measuredItemsForFile`), runs `resolveCollisions`, folds the result back into the multi-file `LayoutDataSet`, and re-sorts content order by y. Called from the drop callback, `handleNewBlock`, `handlePastedBlocks`, and `createBlockAt`.

### Acceptance

Drop a block into a gap → nothing below moves. Drop onto a tight run → the run stacks flush and the sweep stops at the first gap below. Blocks above never move. (6 unit tests cover these.)

---

## Stage 3 — LayoutManager  *(next pass)*

New module `src/layout/layoutManager.ts` — plain functions. Two responsibilities.

### 3.1 Collapse on delete (pull the doc up)

When a full-width block is deleted, everything below should rise by the deleted block's height to fill the hole.

```
collapse(layouts, deletedRect):
  gap = deletedRect.h + VERTICAL_GAP
  shift every item with y > deletedRect.y up by gap
  return layouts
```

Guard: only when nothing horizontally overlaps the deleted block (always true while single-column). When x unlocks, restrict the pull-up to blocks whose x-range overlaps the deleted column.

Wired in WSA's `handleDeleteBlock` (which already removes the block + its layout). Add: capture the deleted block's rect first, then `layouts = collapse(layouts, rect)` before persist. The existing Backspace→focus-previous behaviour stays.

### 3.2 Grid as the set of allowable positions

Snapping (Stage 1) already constrains y to grid lines. Stage 3 formalises it: a block's placement is `{ row, rows }` (top row index + height in rows) derived from pixels via `grid.ts`. CM/LM math can move to integer rows (cleaner, no float drift). Pixel x/y/w/h stay the persisted truth; rows are a derived view for the managers.

### 3.3 Pre-filled placeholder blocks  *(design — most open-ended)*

Goal: a fresh doc isn't an empty void; the page comes seeded with empty blocks so the user clicks any line and types. And after a block is dragged away, the vacated space refills so the page never has dead holes.

Proposed model (to validate before building):

- **`ensureFill(layouts, content, viewportRows)`** — a pure pass that, given the current blocks and the visible page height, appends empty placeholder blocks so every grid row from the last real block down to the viewport bottom has a clickable block.
- Placeholders are ordinary empty `p` blocks (same as today's empty block) — no new type. They render the focus-only placeholder hint already built.
- Run `ensureFill` after load, after delete/collapse, and after drop. It only ever *appends* into empty rows — it never reorders or touches non-empty blocks.
- **Open question:** do placeholders persist to disk, or are they ephemeral (regenerated on load)? Leaning ephemeral — persisting a screenful of empty blocks bloats storage and fights collapse. If ephemeral, they need a `transient: true` flag so save skips them and they're rebuilt by `ensureFill` on load.
- **Open question:** click-to-focus on a placeholder — does it "commit" that placeholder (stop being transient) only once the user types? Probably yes: typing flips `transient → false` via the existing content-refresh path.

This sub-stage has the most unknowns and should be its own mini-plan once 3.1/3.2 are green.

### Acceptance (3.1/3.2)

Delete a mid-doc block → everything below rises by its height, no hole; blocks above unmoved. Manager math agrees with the rendered pixels.

---

## Build order

1. **Stage 1 now.** Grid module, line-height, square rows, visible grid, snap-on-write.
2. Stage 2 next — CM port + WSA drop wiring. Independently testable.
3. Stage 3 — LM collapse + grid-rows, then the placeholder mini-plan last.

Each stage compiles and is acceptance-checked before the next starts. CM and LM land as pure modules called only from WSA — if either ever imports a store, the DOM, SM, or DM, stop and re-read the conduit rule.
