// workspaceLayout.ts
//
// Measurement + placement helpers shared by WorkspaceArea's block mutations.
// All the "where does a block sit, and what does collision resolution do with
// it" logic lives here, separate from React.
//
// Heights come from the live DOM, not the stored LayoutItem.h. Stored h is
// unreliable (defaults to 80, or 0 on drop) and never tracks content, so the
// collision pass needs a fresh measurement to keep blocks flush.

import { GRID_UNIT, rowsForHeight, heightForRows, snapToGrid } from '../grid/grid'
import { resolveCollisions } from '../collision-manager/collisionManager'
import { layoutKey } from '../../../model/model'
import type { LayoutDataSet, LayoutItem } from '../../../types/types'


// Defaults for newly created blocks (pixels — not grid based).
export const NEW_BLOCK_DEFAULT_W = 400
export const NEW_BLOCK_DEFAULT_H = 80
export const NEW_BLOCK_DEFAULT_X = 50
export const NEW_BLOCK_VERTICAL_GAP = 6     // pixels between a block and the next
export const NEW_BLOCK_TOP = 50             // y for the very first block on an empty canvas
export const NEW_BLOCK_CONTENT = ""         // empty so the caret sits flush left


// The block's ACTUAL rendered height from the DOM, falling back to a stored
// value only when the element isn't mounted yet. Reading the live box avoids
// the huge gap the stale 80px default used to leave after Enter.
export function measuredBlockHeight(blockId: string, fallback: number): number {
    const el = document.querySelector<HTMLElement>(`.drag-container[data-blockid="${blockId}"]`)
    return el ? el.getBoundingClientRect().height : fallback
}


// One file's placements with FRESH, grid-snapped heights. CollisionManager and
// LayoutManager need accurate h; heights don't depend on position, so measuring
// before the re-render is safe.
export function measuredItemsForFile(
    fileId: string,
    content: string[],
    layouts: LayoutDataSet,
): LayoutItem[] {
    const items: LayoutItem[] = []
    for (const blockId of content) {
        const item = layouts[layoutKey(fileId, blockId)]
        if (!item) continue
        // Round to the NEAREST whole row, not up: snapping up turned a 26.0001px
        // block into 52, pushing the next block a full row too far. Round keeps a
        // one-line block at exactly one row → flush.
        const h = heightForRows(rowsForHeight(measuredBlockHeight(blockId, item.h || GRID_UNIT)))
        items.push({ ...item, h })
    }
    return items
}


// Moved here from layoutManager.ts to break a circular import (both files now
// live in layout/; layoutManager imports from this file, so this function could
// not import back). Flagged in layoutManager: collapse should eventually route
// through the normal key-event handler.
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


// Runs CollisionManager over one file's placements and folds the resolved items
// back into the full (multi-file) LayoutDataSet. Pure given its inputs.
// @flowmap-node layout__resolve kind=function
export function resolveFileCollisions(
    fileId: string,
    content: string[],
    layouts: LayoutDataSet,
    movedBlockId: string,
): LayoutDataSet {
    const resolved = resolveCollisions(measuredItemsForFile(fileId, content, layouts), movedBlockId)
    const merged: LayoutDataSet = { ...layouts }
    for (const item of resolved) merged[layoutKey(fileId, item.blockId)] = item
    return merged
}


// Sort block ids by their placement: top first (y), then left (x). Keeps
// document order in step with vertical position. `fallback` is the value used
// when a placement is missing (drops use 50, fresh blocks use 0).
// @flowmap-node layout__orderBy kind=function
export function orderByPosition(
    blockIds: string[],
    fileId: string,
    layouts: LayoutDataSet,
    fallback: number,
): string[] {
    return [...blockIds].sort((idA, idB) => {
        const a = layouts[layoutKey(fileId, idA)]
        const b = layouts[layoutKey(fileId, idB)]
        const ay = a?.y ?? fallback, ax = a?.x ?? fallback
        const by = b?.y ?? fallback, bx = b?.x ?? fallback
        return (ay - by) || (ax - bx)
    })
}


// ── LayoutManager: the one entry WSA calls after a create/delete ─────────────
// BlockManager has already proposed where the new block sits (or which block
// left). WSA merged that into `layouts`, then hands it here with the SAME event
// intent (add vs delete). This validates the proposal: it measures live heights,
// resolves any overlap (add) or closes the hole (delete) via the pure helpers,
// then re-orders the file's block ids by top-left so reading order tracks the
// layout. It is the ONLY writer whose output the store trusts.

export type ResolveOpts =
    | { mode: "add";    subjectIds: string[] }              // the new block ids
    | { mode: "delete"; deletedY: number; deletedH: number } // the vacated rect

export function resolveEventLayout(
    fileId: string,
    content: string[],
    layouts: LayoutDataSet,
    opts: ResolveOpts,
): { layouts: LayoutDataSet; content: string[] } {
    let next: LayoutDataSet

    if (opts.mode === "add") {
        // Resolve per new id so a block wedged between two others pushes the rest
        // down. resolveFileCollisions re-measures heights from the DOM each pass.
        next = layouts
        for (const id of opts.subjectIds) {
            next = resolveFileCollisions(fileId, content, next, id)
        }
    } else {
        // `layouts` already has the deleted placement stripped; pull the rest up.
        const collapsed = collapseAfterDelete(
            measuredItemsForFile(fileId, content, layouts),
            opts.deletedY, opts.deletedH, NEW_BLOCK_VERTICAL_GAP,
        )
        next = { ...layouts }
        for (const item of collapsed) next[layoutKey(fileId, item.blockId)] = item
    }

    const ordered = orderByPosition(content, fileId, next, 0)
    return { layouts: next, content: ordered }
}
