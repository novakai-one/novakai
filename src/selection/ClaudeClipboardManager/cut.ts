import type { DocShape } from "../../types/types"
import { clipboardStore } from "./clipboardStore"
import { buildSlice, readSelection } from "./copy"
import { resolveSelectedIds } from "./selectionRange"

// ── cut ───────────────────────────────────────────────────────────────────
// Same as copy, except mode is "cut" and the selected ids are recorded as the
// source set to delete. Whether the source blocks are removed NOW or on the next
// paste is a PLACEHOLDER decision (PLAN.md item 5).
//
// Current behaviour: cut does NOT mutate the document here. It records the
// ordered ids (also used as sourceIds) and mode "cut". Deletion is deferred.
// This keeps cut+escape non-destructive — nothing lost if paste never happens.
//
// Deleting a block also needs its layout + content-order entry pulled and the
// hole closed. That is LayoutManager's job, so cut should likely SIGNAL the
// delete rather than perform it. Confirm the boundary before wiring deletion.

export function cut(eventData: unknown, shape: DocShape): DocShape {
    const ids = resolveSelectedIds(readSelection(eventData), shape)
    if (ids.length === 0) return shape

    const { slice, orderedIds } = buildSlice(ids, shape)
    clipboardStore.hold(slice, "cut", orderedIds, orderedIds)

    // PLACEHOLDER: returning shape unchanged — deletion deferred.
    return shape
}
