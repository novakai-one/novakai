import type { ContentDataSet, LayoutDataSet, DatabaseDataSet } from "../../types/types"
import type { SelectionPoint } from "../ClaudeSelectionManager/selectionState"

// The copy/cut buffer: the held slice plus the document order to re-emit it in. A module
// singleton, so it survives a rebuilt ClipboardManager (one clipboard for the session).
// "copy" leaves the source in place; "cut" means the source was removed on cut.

export type ClipboardMode = "copy" | "cut"

// A DocShape slice minus `file` — paste always targets the active file.
export interface ClipboardSlice {
    contentData:  ContentDataSet,
    layoutData:   LayoutDataSet,
    databaseData: DatabaseDataSet,
}

interface ClipboardBuffer {
    slice:      ClipboardSlice | null,
    mode:       ClipboardMode | null,
    orderedIds: string[],          // selected block ids in document order (paste walks this)
    sourceIds:  string[],          // ids the cut removed; empty for copy
    range:      SelectionPoint[],  // the copied selection's points (offsets) in document order
}

const buffer: ClipboardBuffer = {
    slice:      null,
    mode:       null,
    orderedIds: [],
    sourceIds:  [],
    range:      [],
}

export const clipboardStore = {
    hold(
        slice: ClipboardSlice,
        mode: ClipboardMode,
        orderedIds: string[],
        sourceIds: string[],
        range: SelectionPoint[] = [],
    ): void {
        buffer.slice = slice
        buffer.mode = mode
        buffer.orderedIds = orderedIds
        buffer.sourceIds = sourceIds
        buffer.range = range
    },

    read(): ClipboardSlice | null {
        return buffer.slice
    },

    mode(): ClipboardMode | null {
        return buffer.mode
    },

    orderedIds(): string[] {
        return buffer.orderedIds
    },

    sourceIds(): string[] {
        return buffer.sourceIds
    },

    // The copied selection's points (offsets) in document order. Empty for a
    // whole-block copy that carried no text range.
    range(): SelectionPoint[] {
        return buffer.range
    },

    hasContent(): boolean {
        return buffer.slice !== null
    },

    clear(): void {
        buffer.slice = null
        buffer.mode = null
        buffer.orderedIds = []
        buffer.sourceIds = []
        buffer.range = []
    },
}
