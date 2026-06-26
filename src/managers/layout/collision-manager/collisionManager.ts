// ── CollisionManager ────────────────────────────────────────────────────────
// Resolves block overlaps after a drop / insert. Pure functions, no state, no
// DOM, no store — WSA is the only caller (it measures heights and feeds them in,
// then persists the result). Geometry is PIXELS (x/y/w/h), the one stored shape.
//
// Single-column model: blocks are full-width, so two blocks collide iff their
// vertical ranges overlap. When real columns land, add an x-range test here.
//
// Flush downward sweep with a cutoff: sort by y, push a block down only if it
// overlaps the one above it (just enough to sit flush), and STOP at the first
// gap — so a rearrange never drifts the whole document.

import type { LayoutItem } from '../../../types/types'


/**
 * Resolve overlaps introduced by `movedBlockId`.
 *
 * `items` is one file's placements, each with an accurate height (WSA measures
 * from the DOM). Returns a new array; inputs are not mutated. `movedBlockId`
 * only breaks y-ties so the dropped block wins its row.
 */
export function resolveCollisions(items: LayoutItem[], movedBlockId: string): LayoutItem[] {
    const sorted = items
        .map(i => ({ ...i }))
        .sort((a, b) => {
            if (a.y !== b.y) return a.y - b.y
            if (a.blockId === movedBlockId) return -1
            if (b.blockId === movedBlockId) return 1
            return 0
        })

    for (let i = 1; i < sorted.length; i++) {
        const minY = sorted[i - 1].y + sorted[i - 1].h
        if (sorted[i].y < minY) {
            sorted[i] = { ...sorted[i], y: minY }
        }
    }

    return sorted
}
