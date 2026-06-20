// ── selectionExtend.ts ────────────────────────────────────────────────────────
// Shift and Cmd/Ctrl+Shift movement — extends the selection instead of moving a
// caret. Anchor stays put; focus moves; the pair becomes a range. Plus Select All.
// Standard text-editor behaviour.
//
// Pure: selection state in -> new selection state out.
// No DOM writes. No setters. No re-render.

import type { SelectionState } from "./selectionState";
import type { KeyEventData } from "./eventData";

// ── Shift + Arrow: extend by one unit ────────────────────────────────────────

export function shiftArrowLeft(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    // Placeholder: keep anchor, move focus one char left, mode -> range.
    return { ...state, mode: "range" };
}

export function shiftArrowRight(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    return { ...state, mode: "range" };
}

export function shiftArrowUp(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    return { ...state, mode: "range" };
}

export function shiftArrowDown(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    return { ...state, mode: "range" };
}

// ── Cmd/Ctrl + Shift + Arrow: extend by word / line / document edge ──────────

export function cmdShiftArrowLeft(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    // Placeholder: extend focus to start of word / line.
    return { ...state, mode: "range" };
}

export function cmdShiftArrowRight(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    return { ...state, mode: "range" };
}

export function cmdShiftArrowUp(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    // Placeholder: extend focus to start of document.
    return { ...state, mode: "range" };
}

export function cmdShiftArrowDown(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    // Placeholder: extend focus to end of document.
    return { ...state, mode: "range" };
}

// ── Select All ────────────────────────────────────────────────────────────────

export function selectAll(state: SelectionState, key: KeyEventData, blockOrder: string[]): SelectionState {
    // Placeholder: anchor -> first block start, focus -> last block end.
    return { ...state, mode: "multi-block" };
}
