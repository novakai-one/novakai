import type { DocShape, KeyEventData } from "../../../types/types"
import { clipboardStore } from "./clipboardStore"
import { activeFileId } from "./pasteShared"
import { pasteIntoText } from "./pasteIntoText"
import { pasteAsBlocks } from "./pasteAsBlocks"

// ── paste.ts — paste router ───────────────────────────────────────────────────
// Merges the buffered slice into the document AT THE CARET and returns a new
// shape. Clipboard decides WHERE blocks land; LayoutManager fixes any collisions
// after, trusting that file.content stays in correct document order.
//
// This module is a ROUTER ONLY. It reads the buffer, resolves the anchor and
// file, picks one of two paste strategies, and delegates. It is the only module
// that imports pasteIntoText / pasteAsBlocks; those two never import each other
// and share logic solely through pasteShared.
//
//   text selection  — the keystroke fired from a content-area block. The caret
//                     sits INSIDE a block's text. -> pasteIntoText
//   block selection — the keystroke fired anywhere else (block-level). Whole
//                     blocks are inserted below the anchor. -> pasteAsBlocks

export function paste(
    eventData: unknown,
    _reactEvent: React.SyntheticEvent | null,
    trigger: string,
    shape: DocShape,
): DocShape {
    const buffer = clipboardStore.read()
    if (!buffer) return shape

    const fileId   = activeFileId(shape)
    const anchorId = readAnchorId(eventData)

    return isTextSelectionPaste(trigger)
        ? pasteIntoText(shape, eventData, anchorId, fileId)
        : pasteAsBlocks(shape, buffer, clipboardStore.orderedIds(), anchorId, fileId)
}

// Text-vs-block split: a paste whose keystroke originated in a content-area block
// is a caret/text paste; everything else is a block-level paste.
function isTextSelectionPaste(trigger: string): boolean {
    return trigger.startsWith("content-area")
}

// The pasted block carries the caret's blockId — confirmed KeyEventData.blockId
// (cmd+v fires a key-down on the focused block).
function readAnchorId(eventData: unknown): string | null {
    return (eventData as KeyEventData)?.blockId ?? null
}
