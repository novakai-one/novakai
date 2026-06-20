import type {
    DocShape,
    ContentDataSet,
    LayoutDataSet,
    DatabaseDataSet,
    FileData,
} from "../../types/types"
import { layoutKey, databaseKey } from "../../types/types"
import type { SelectionPoint } from "../ClaudeSelectionManager/selectionState"
import { clipboardStore } from "./clipboardStore"
import { buildSlice } from "./copy"
import { resolveSelectedIds } from "./selectionRange"

// Cut = copy into the buffer, then remove the source blocks from the document, so the
// block disappears immediately (scenario 2). A later paste keeps the same id, reading as
// the same block relocated. Clipboard returns the new shape only — no LayoutManager
// signaling; LM closes the resulting hole on its own pass.

export function cut(range: SelectionPoint[], shape: DocShape): DocShape {
    const ids = resolveSelectedIds(range, shape)
    if (ids.length === 0) return { ...shape }

    const { slice, orderedIds } = buildSlice(ids, shape)
    clipboardStore.hold(slice, "cut", orderedIds, orderedIds, range)

    return removeBlocks(orderedIds, shape)
}

// Returns a new shape with the given blocks removed from every dataset and from the
// ordered content list, in lockstep. The input shape is never mutated.
function removeBlocks(ids: string[], shape: DocShape): DocShape {
    const fileId = shape.file?.id ?? ""
    const idsToRemove = new Set(ids)

    const contentData:  ContentDataSet  = { ...shape.contentData }
    const layoutData:   LayoutDataSet   = { ...shape.layoutData }
    const databaseData: DatabaseDataSet = { ...shape.databaseData }

    for (const id of ids) {
        delete contentData[id]
        delete layoutData[layoutKey(fileId, id)]
        delete databaseData[databaseKey(id)] // identity key; harmless if not a db block
    }

    return {
        file: removeFromContent(shape.file, idsToRemove),
        contentData,
        layoutData,
        databaseData,
    }
}

function removeFromContent(file: FileData | null, idsToRemove: Set<string>): FileData | null {
    if (!file) return file
    return { ...file, content: file.content.filter(id => !idsToRemove.has(id)) }
}
