import type {
    DocShape,
    ContentDataSet,
    LayoutDataSet,
    DatabaseDataSet,
    LayoutItem,
} from "../../types/types"
import { layoutKey, databaseKey } from "../../types/types"
import { clipboardStore, type ClipboardSlice } from "./clipboardStore"
import { regenerateIds } from "./ids"
import { insertIndexAfter, bottomEdgeOfAnchor, insertIntoContent } from "./pasteShared"

// ── pasteAsBlocks.ts ──────────────────────────────────────────────────────────
// Block-selection paste. Whole blocks land as NEW blocks directly below the
// anchor block. Insert index is the slot AFTER the anchor in file.content (end of
// document when no anchor), so document order stays correct for LayoutManager's
// collision pass.
//
// This module owns buffer preparation for paste: COPY mints fresh ids, CUT keeps
// them. prepareBufferForPaste runs here (only block pastes consume PastedBlocks),
// so the router stays thin and never touches id regeneration.
//
// PUBLIC INTERFACE: pasteAsBlocks only. prepareBufferForPaste, mergePastedBlocks,
// and stackAt are private to the block-paste concern.

export function pasteAsBlocks(
    shape: DocShape,
    buffer: ClipboardSlice,
    orderedSourceIds: string[],
    anchorId: string | null,
    fileId: string,
): DocShape {
    const pasted    = prepareBufferForPaste(buffer, orderedSourceIds, fileId)
    const insertIdx = insertIndexAfter(anchorId, shape)
    const firstY    = bottomEdgeOfAnchor(anchorId, shape)
    return mergePastedBlocks(shape, pasted, fileId, firstY, insertIdx)
}

interface PastedBlocks {
    slice: ClipboardSlice,
    orderedIds: string[],
}

// COPY mints new ids; CUT keeps them. Returns the re-keyed slice and its block ids
// in document order (the order LayoutManager relies on).
function prepareBufferForPaste(
    buffer: ClipboardSlice,
    orderedSourceIds: string[],
    fileId: string,
): PastedBlocks {
    const keepSameIds = clipboardStore.mode() === "cut"
    const { slice, idMap } = regenerateIds(buffer, fileId, { keepSameIds })
    const orderedIds = orderedSourceIds
        .map(sourceId => idMap[sourceId])
        .filter((id): id is string => Boolean(id))
    return { slice, orderedIds }
}

// Adds the pasted blocks to fresh copies of each dataset, stacking each block
// directly below the previous one, and splices their ids into file.content at
// insertIdx (the slot after the anchor). Never mutates `shape`.
function mergePastedBlocks(
    shape: DocShape,
    pasted: PastedBlocks,
    fileId: string,
    firstY: number,
    insertIdx: number,
): DocShape {
    const contentData:  ContentDataSet  = { ...shape.contentData }
    const layoutData:   LayoutDataSet   = { ...shape.layoutData }
    const databaseData: DatabaseDataSet = { ...shape.databaseData }

    let nextY = firstY
    for (const id of pasted.orderedIds) {
        const block = pasted.slice.contentData[id]
        if (!block) continue
        contentData[id] = block

        const placement = pasted.slice.layoutData[layoutKey(fileId, id)]
        if (placement) {
            const placed = stackAt(placement, fileId, nextY)
            layoutData[layoutKey(fileId, id)] = placed
            nextY = placed.y + placed.h
        }

        const dbConfig = pasted.slice.databaseData[databaseKey(id)]
        if (dbConfig) databaseData[databaseKey(id)] = dbConfig
    }

    return {
        file: insertIntoContent(shape.file, pasted.orderedIds, insertIdx),
        contentData,
        layoutData,
        databaseData,
    }
}

function stackAt(placement: LayoutItem, fileId: string, y: number): LayoutItem {
    return { ...placement, fileId, y }
}
