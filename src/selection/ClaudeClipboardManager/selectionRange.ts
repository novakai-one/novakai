import type { DocShape } from "../../types/types"
import type { SelectionState } from "../ClaudeSelectionManager/selectionState"

// ── selectionRange ────────────────────────────────────────────────────────
// One job: turn a SelectionState (anchor + focus) into an ORDERED list of the
// selected block ids, using FileData.content[] as the source of order.
//
// SelectionState gives two endpoint ids:
//   anchor.elementId  — where the selection started
//   focus.elementId   — where it ended
// Either can come first in the document (a user can drag upward), so order is
// resolved by INDEX in file.content, never by which one is the anchor.
//
//   file.content:  [ A, B, C, D, E ]   (the reliable order)
//   anchor = D, focus = B
//        -> indices 3 and 1
//        -> slice 1..3 inclusive
//        -> [ B, C, D ]
//
// Block count (1 / 2 / many) falls out of the returned length — clipboard reads
// that, it is not a separate flag.

export function resolveSelectedIds(
    selection: SelectionState | null,
    shape: DocShape,
): string[] {
    if (!selection) return []
    if (!selection.anchor || !selection.focus) return []
    if (!shape.file) return []

    const order = shape.file.content
    const anchorId = selection.anchor.elementId
    const focusId = selection.focus.elementId

    const anchorIdx = order.indexOf(anchorId)
    const focusIdx = order.indexOf(focusId)

    // An endpoint id not found in content order — cannot resolve a range.
    if (anchorIdx === -1 || focusIdx === -1) return []

    // Single block — both endpoints on the same block.
    if (anchorIdx === focusIdx) return [order[anchorIdx]]

    // Normalise direction by index, then slice inclusive.
    const start = Math.min(anchorIdx, focusIdx)
    const end = Math.max(anchorIdx, focusIdx)

    return order.slice(start, end + 1)
}
