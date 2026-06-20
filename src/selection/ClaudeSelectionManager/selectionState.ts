// ── selectionState.ts ─────────────────────────────────────────────────────────
// Types + tiny pure state transforms.
// No DOM. No setters. No re-render.

export interface SelectionPoint {
    elementId: string; // the same as blockId
    offset: number;
}

export type SelectionMode = "caret" | "range" | "multi-block";

export interface SelectionState {
    anchor: SelectionPoint | null;
    focus:  SelectionPoint | null;
    mode:   SelectionMode;
}

// Starting selection: nothing selected.
export function emptySelection(): SelectionState {
    return { anchor: null, focus: null, mode: "caret" };
}

// Range -> caret. Collapses focus onto anchor.
export function collapse(state: SelectionState): SelectionState {
    return { ...state, focus: state.anchor, mode: "caret" };
}
