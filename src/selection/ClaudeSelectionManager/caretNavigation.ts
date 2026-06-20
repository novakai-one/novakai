// ── caretNavigation.ts ────────────────────────────────────────────────────────
// Plain caret movement (no Shift). Collapses any range, then moves the caret one
// unit in the requested direction. Standard text-editor behaviour.
//
// Pure: selection state in -> new selection state out.
// No DOM writes. No setters. No re-render. (Reads via domHelpers only.)

import type { SelectionState } from "./selectionState";
import { collapse } from "./selectionState";
import type { KeyEventData } from "./eventData";

// blockOrder (shape.file.content) is the source of truth for crossing block
// boundaries — e.g. ArrowLeft at offset 0 moves to the end of the previous block.

export function arrowLeft(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    // Placeholder: collapse to caret, move focus one char left, cross block at offset 0.
    return collapse(state);
}

export function arrowRight(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    // Placeholder: collapse to caret, move focus one char right, cross block at line end.
    return collapse(state);
}

export function arrowUp(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    // Placeholder: collapse, move focus one visual line up (or previous block).
    return collapse(state);
}

export function arrowDown(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    // Placeholder: collapse, move focus one visual line down (or next block).
    return collapse(state);
}
