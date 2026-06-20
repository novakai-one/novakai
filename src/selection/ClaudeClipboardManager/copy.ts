import type {
    DocShape,
    ContentDataSet,
    LayoutDataSet,
    DatabaseDataSet,
    TextElement,
} from "../../types/types"
import { layoutKey, databaseKey } from "../../types/types"
import type { SelectionPoint } from "../ClaudeSelectionManager/selectionState"
import { clipboardStore, type ClipboardSlice } from "./clipboardStore"
import { resolveSelectedIds } from "./selectionRange"

// Copies the selected blocks into the buffer. Selection arrives as the SM-built range
// (SelectionPoint[]); copy never mutates the document.

export function copy(range: SelectionPoint[], shape: DocShape): void {
    const ids = resolveSelectedIds(range, shape)
    if (ids.length === 0) return

    const { slice, orderedIds } = buildSlice(ids, shape)
    // range stored so a text paste can read the copied offsets back (block[0] /
    // block[last] substrings are sliced by these offsets at paste time).
    clipboardStore.hold(slice, "copy", orderedIds, [], range)
}

export interface BuiltSlice {
    slice: ClipboardSlice,
    orderedIds: string[],
}

// Collects the records for the given block ids (already in document order) into a
// clipboard slice. Pure read — touches neither the buffer nor the shape. Reused by cut.
export function buildSlice(ids: string[], shape: DocShape): BuiltSlice {
    const contentData:  ContentDataSet  = {}
    const layoutData:   LayoutDataSet   = {}
    const databaseData: DatabaseDataSet = {}
    const fileId = shape.file?.id ?? ""
    const collectedIds: string[] = []

    for (const id of ids) {
        const block = shape.contentData[id]
        if (!block) continue

        contentData[id] = block
        collectedIds.push(id)
        copyPlacementInto(layoutData, shape, fileId, id)
        if (isDatabaseBlock(block)) copyDatabaseConfigInto(databaseData, shape, id)
    }

    return { slice: { contentData, layoutData, databaseData }, orderedIds: collectedIds }
}

function isDatabaseBlock(block: TextElement): boolean {
    return block.component === "DatabaseArea"
}

function copyPlacementInto(target: LayoutDataSet, shape: DocShape, fileId: string, blockId: string): void {
    const key = layoutKey(fileId, blockId)
    const placement = shape.layoutData[key]
    if (placement) target[key] = placement
}

function copyDatabaseConfigInto(target: DatabaseDataSet, shape: DocShape, blockId: string): void {
    const key = databaseKey(blockId)
    const config = shape.databaseData[key]
    if (config) target[key] = config
}
