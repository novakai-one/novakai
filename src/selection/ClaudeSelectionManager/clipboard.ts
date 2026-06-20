// ── clipboard.ts ──────────────────────────────────────────────────────────────
// Clipboard scaffolding. SCAFFOLDING ONLY — every method is a placeholder.
// This surface impacts paste-as-blocks, cross-block copy, and the content store,
// so it needs close attention later. For now it defines the responsibility and
// the shape of the exports; no real I/O.
//
// Boundary notes for the real implementation:
//   - copy / getSelectedText READ selection + DOM, produce a payload — no setter.
//   - paste / insertAtCaret are impure (navigator.clipboard, DOM) and ASYNC.
//   - Structural paste (new blocks) must NOT be done here — it is BlockManager's
//     job via a BlockEvent. This module only produces the payload; the class
//     hands it onward. Keeps "selection never creates/deletes blocks" intact.

import type { SelectionState } from "./selectionState";
import type { ClipboardBlockData } from "../../types/types";

export class ClipboardController {

    // Copy the current selection to the system clipboard.
    // Placeholder: build a structured payload from state + blockOrder, write it.
    copy = async (
        state: SelectionState,
        blockOrder: string[],
        wsaEl: HTMLElement | null,
    ): Promise<void> => {
        // Placeholder — no clipboard write yet.
    };

    // Read structured blocks from the clipboard (internal format if present,
    // else plain text mapped to blocks).
    // Placeholder: returns empty until clipboard read is implemented.
    paste = async (): Promise<ClipboardBlockData[]> => {
        return [];
    };

    // Insert an HTML fragment at the current caret (intra-block paste).
    // Placeholder: returns the affected blockId or null.
    insertAtCaret = (html: string, wsaEl: HTMLElement | null): string | null => {
        return null;
    };

    // Plain-text projection of the current selection (for Cmd+C fallbacks).
    // Placeholder.
    selectedText = (state: SelectionState): string => {
        return "";
    };
}
