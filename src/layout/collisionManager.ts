// ── CollisionManager ────────────────────────────────────────────────────────
// Resolves block overlaps after a drop / insert. Pure functions, no state, no
// DOM, no store — WSA is the only caller (it measures heights and feeds them in,
// then persists the result). This keeps the conduit rule intact and makes the
// algorithm trivially testable.
//
// Single-column model: react-dev blocks are full page-width (x locked), so two
// blocks collide iff their vertical ranges overlap. When x/resize land, the
// overlap test grows an x condition and the sweep restricts to the column.
//
// ── The cutoff ──────────────────────────────────────────────────────────────
// The first version pushed EVERY block below the collision down (the react-grid
// model). That preserves spacing but drifts the whole document downward on every
// rearrange — endless, even when the blocks below had room. The user asked for a
// cutoff: a push should be ABSORBED by the first gap and stop there.
//
// So instead of pin-and-push-all, this does a single downward sweep:
//   sort by y, walk top→bottom, and push a block down ONLY if it overlaps the
//   block above it — just far enough to sit flush (overlap distance, no gap).
//   The moment a block already clears the one above (there's a gap), the sweep
//   leaves it and everything below untouched. That gap is the cutoff.
//
// Result: dropping a block stacks the touching run flush and stops at the first
// breathing room below. Blocks above are never touched; existing gaps below are
// never consumed by drift.

import type { LayoutItem } from '../types/types'


/**
 * Resolve overlaps introduced by `movedBlockId` with a flush downward sweep.
 *
 * `items` is the placement list for ONE file, each with an ACCURATE height (WSA
 * measures from the DOM before calling — stored h is unreliable). Returns a new
 * array; inputs are not mutated. `movedBlockId` only breaks y-ties, so the block
 * the user just dropped wins its row and pushes the other down.
 */
export function resolveCollisions(items: LayoutItem[], movedBlockId: string): LayoutItem[] {
    const sorted = items
        .map(i => ({ ...i }))
        .sort((a, b) => {
            if (a.y !== b.y) return a.y - b.y
            // Same row → the moved block sorts first so it pins and the other moves.
            if (a.blockId === movedBlockId) return -1
            if (b.blockId === movedBlockId) return 1
            return 0
        })

    for (let i = 1; i < sorted.length; i++) {
        const above = sorted[i - 1]
        const minY  = above.y + above.h
        // Overlap → push flush. Gap (cur.y >= minY) → leave it and STOP cascading
        // through this block's descendants implicitly: a non-pushed block can't
        // shove the next one, so the sweep naturally dies at the first gap.
        if (sorted[i].y < minY) {
            sorted[i] = { ...sorted[i], y: minY }
        }
    }

    return sorted
}
