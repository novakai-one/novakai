// ── LayoutManager ───────────────────────────────────────────────────────────
// Keeps the document tidy after structural changes: pulls blocks up to fill the
// hole a deleted block left behind. Pure functions, no state, no DOM, no store —
// WSA is the only caller (it measures the deleted rect and persists the result).
//
// Single-column assumption (same as CollisionManager): a full-width delete pulls
// EVERYTHING below up by the vacated height. When x unlocks, restrict the pull
// to blocks whose x-range overlaps the deleted column.

import type { LayoutItem, MouseEventData, KeyEventData, LifecycleEventData, DocShape } from '../types/types'
import { snapToGrid } from './grid'
import { resolveFileCollisions, orderByPosition } from '../components/workspace/workspaceLayout'


/**
 * After a block at `deletedY` (height `deletedH`) is removed, raise every block
 * below it by the vacated height + the gap that sat beneath it, so the doc
 * closes the hole. Results snap back to the grid. Inputs are not mutated.
 *
 * `items` is the REMAINING placements for one file (the deleted one already
 * dropped). Only blocks strictly below the deleted top move.
 */
export function collapseAfterDelete(
    items: LayoutItem[],
    deletedY: number,
    deletedH: number,
    gap: number,
): LayoutItem[] {
    const shift = deletedH + gap
    if (shift <= 0) return items.map(i => ({ ...i }))

    return items.map(item => {
        if (item.y <= deletedY) return { ...item }
        return { ...item, y: snapToGrid(Math.max(deletedY, item.y - shift)) }
    })
}


// ── LayoutManager (class) ────────────────────────────────────────────────
// The last helper in WSA's conduit. Receives the shape AFTER BlockManager has
// added or removed a block, tidies the layout (resolve overlaps, re-order the
// file's block ids top-left), and returns the shape for WSA to commit. Triggers
// with no layout consequence return the shape untouched.
//
// It tidies whenever the layout could have changed (a structural key or click).
// Resolving an already-tidy layout is a no-op that returns equal data, so an
// over-eager pass costs nothing — React diffs by reference at commit.
export default class LayoutManager {

    receiveMouseEvent = (_mouseData: MouseEventData, trigger: string, shape: DocShape): DocShape => {
        if (trigger === "workspace-click") return this._tidy(shape)
        return shape
    }

    receiveKeyEvent = (keyData: KeyEventData, trigger: string, shape: DocShape): DocShape => {
        if (trigger !== "keydown") return shape
        if (keyData.key === "Enter" || keyData.key === "Backspace") return this._tidy(shape)
        return shape
    }

    receiveLifecycleEvent = (_data: LifecycleEventData, _trigger: string, shape: DocShape): DocShape => {
        return shape
    }


    // ── Tidy the active file: resolve overlaps, re-order ids top-left ────────
    // Works off the shape's own file + layout (BlockManager already applied the
    // create/delete). Pushes any overlap down, then sorts the file's block ids
    // by placement so document order tracks the layout.
    private _tidy = (shape: DocShape): DocShape => {
        if (!shape.file) return shape
        const fileId = shape.file.id

        const fileItems = Object.values(shape.layoutData).filter(item => item.fileId === fileId)
        if (fileItems.length === 0) return shape

        // Top-left order, and the lowest placement is the freshest mover.
        const orderedIds = [...fileItems]
            .sort((a, b) => (a.y - b.y) || (a.x - b.x))
            .map(item => item.blockId)
        const movedId = this._lowestPlacedId(fileItems)

        const layoutData = resolveFileCollisions(fileId, orderedIds, shape.layoutData, movedId)
        const content = orderByPosition(orderedIds, fileId, layoutData, 0)
        return { file: { ...shape.file, content }, contentData: shape.contentData, layoutData, databaseData: shape.databaseData }
    }

    // The block at the greatest y — the one BlockManager most likely just placed.
    private _lowestPlacedId = (items: LayoutItem[]): string => {
        let pick = items[0]
        for (const item of items) if (item.y >= pick.y) pick = item
        return pick.blockId
    }
}
