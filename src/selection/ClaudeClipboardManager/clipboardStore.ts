import type { ContentDataSet, LayoutDataSet, DatabaseDataSet } from "../../types/types"

// ── clipboardStore ────────────────────────────────────────────────────────
// The internal buffer. One job: hold the copied/cut slice and remember the mode.
//
// Holds a DocShape SLICE (no `file` — paste targets the active file) PLUS the
// ordered id list. The datasets are unordered Records; `orderedIds` carries the
// document order so paste re-emits blocks in the right sequence (LM relies on
// that order to position them).
//
// Module singleton, not class state, so the buffer outlives a rebuilt
// ClipboardManager. (Confirm that lifetime — PLAN.md. If the buffer should die
// with the manager, move this onto the ClipboardManager instance.)
//
// "copy" mode: paste leaves the source blocks in place.
// "cut"  mode: paste removes the source blocks (deletion deferred — PLAN.md 5).

export type ClipboardMode = "copy" | "cut"

// The held slice. Same three datasets as DocShape minus `file`.
export interface ClipboardSlice {
    contentData:  ContentDataSet,
    layoutData:   LayoutDataSet,
    databaseData: DatabaseDataSet,
}

interface ClipboardBuffer {
    slice: ClipboardSlice | null,
    mode:  ClipboardMode | null,
    // Selected block ids in DOCUMENT ORDER. Paste walks this to emit blocks in
    // sequence. Same list as sourceIds for a cut.
    orderedIds: string[],
    // The ids to delete from the source on a cut paste. Empty for copy.
    sourceIds: string[],
}

const buffer: ClipboardBuffer = {
    slice: null,
    mode: null,
    orderedIds: [],
    sourceIds: [],
}

export const clipboardStore = {
    // Write the buffer. Called by copy.ts / cut.ts after they build the slice.
    hold(
        slice: ClipboardSlice,
        mode: ClipboardMode,
        orderedIds: string[],
        sourceIds: string[],
    ): void {
        buffer.slice = slice
        buffer.mode = mode
        buffer.orderedIds = orderedIds
        buffer.sourceIds = sourceIds
    },

    // Read the current slice (null if nothing held). Used by paste.ts.
    read(): ClipboardSlice | null {
        return buffer.slice
    },

    mode(): ClipboardMode | null {
        return buffer.mode
    },

    // The held ids in document order. Paste iterates this, not Object.keys.
    orderedIds(): string[] {
        return buffer.orderedIds
    },

    sourceIds(): string[] {
        return buffer.sourceIds
    },

    // Is anything held. Internal use only — NOT exposed on ClipboardManager
    // (public surface stays receiveEvent alone — boundary held).
    hasContent(): boolean {
        return buffer.slice !== null
    },

    // Empty the buffer.
    clear(): void {
        buffer.slice = null
        buffer.mode = null
        buffer.orderedIds = []
        buffer.sourceIds = []
    },
}
