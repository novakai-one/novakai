import type {
    DocShape,
    ContentDataSet,
    LayoutDataSet,
    DatabaseDataSet,
    LayoutItem,
} from "../../types/types"
import { layoutKey, databaseKey } from "../../types/types"
import type { SelectionState } from "../ClaudeSelectionManager/selectionState"
import { clipboardStore, type ClipboardSlice } from "./clipboardStore"
import { resolveSelectedIds } from "./selectionRange"

// ── copy ──────────────────────────────────────────────────────────────────
// Build a DocShape slice from the selected blocks and put it in the buffer.
// Returns shape UNCHANGED — copy never mutates the document.
//
// Steps (runtime order):
//   1. Resolve the SelectionState into an ordered id list (selectionRange).
//   2. For each id, IN ORDER: pull its TextElement from shape.contentData.
//   3. Pull that block's LayoutItem from shape.layoutData (keyed fileId:blockId).
//   4. If the block is a DatabaseArea: pull its DatabaseConfiguration too.
//   5. hold the slice + the ordered id list in the buffer, mode "copy".
//   6. return shape (unchanged).
//
// The ORDERED id list is held alongside the slice. Datasets are unordered
// Records; paste needs the document order to re-emit blocks correctly for LM.

// Where the selection comes from. SM passes its SelectionState. PLACEHOLDER
// field name (`selection`) until the SM-side eventData shape is confirmed — the
// resolver itself is final.
function readSelection(eventData: unknown): SelectionState | null {
    const e = eventData as { selection?: SelectionState }
    return e?.selection ?? null
}

// Shared slice builder — cut.ts reuses this. Pulls the records for `ids` (already
// ordered) out of `shape`. Does NOT touch the buffer or the shape. Returns both
// the slice and the same ordered id list so the caller can hand it to the store.
export function buildSlice(
    ids: string[],
    shape: DocShape,
): { slice: ClipboardSlice; orderedIds: string[] } {
    const contentData:  ContentDataSet  = {}
    const layoutData:   LayoutDataSet   = {}
    const databaseData: DatabaseDataSet = {}

    const fileId = shape.file?.id ?? ""
    const kept: string[] = []

    for (const id of ids) {
        const block = shape.contentData[id]
        if (!block) continue
        contentData[id] = block
        kept.push(id)

        // Placement for this block in the active file.
        const lKey: string = layoutKey(fileId, id)
        const placement: LayoutItem | undefined = shape.layoutData[lKey]
        if (placement) layoutData[lKey] = placement

        // Database config, only for DatabaseArea blocks.
        if (block.component === "DatabaseArea") {
            const dKey: string = databaseKey(id)
            const config = shape.databaseData[dKey]
            if (config) databaseData[dKey] = config
        }
    }

    return { slice: { contentData, layoutData, databaseData }, orderedIds: kept }
}

export function copy(eventData: unknown, shape: DocShape): DocShape {
    const ids = resolveSelectedIds(readSelection(eventData), shape)
    if (ids.length === 0) return shape

    const { slice, orderedIds } = buildSlice(ids, shape)
    clipboardStore.hold(slice, "copy", orderedIds, [])

    return shape
}

// Exported for cut.ts to reuse the selection reader.
export { readSelection }
