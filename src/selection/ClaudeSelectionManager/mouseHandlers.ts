// ── mouseHandlers.ts ──────────────────────────────────────────────────────────
// Pure mouse gesture logic.
// Selection state in -> new selection state out.
// No DOM writes. No setters. No re-render.

import type { SelectionState } from "./selectionState";
import type { MouseEventData } from "./eventData";
import { pointToPosition } from "./domHelpers";

// Press: set anchor + focus to the clicked point. Collapse to caret.
export function handleMouseDown(
    state: SelectionState,
    mouseData: MouseEventData,
): SelectionState {
    console.log("placeholder - trigger", state);
    const point = pointToPosition(mouseData.clientX, mouseData.clientY);
    return { anchor: point, focus: point, mode: "caret" };
}

// Drag: keep anchor, move focus. Becomes a range.
export function handleMouseDrag(
    state: SelectionState,
    mouseData: MouseEventData,
): SelectionState {
    const point = pointToPosition(mouseData.clientX, mouseData.clientY);
    return { ...state, focus: point, mode: "range" };
}

// Release: finalise focus at release point.
export function handleMouseUp(
    state: SelectionState,
    mouseData: MouseEventData,
): SelectionState {
    const point = pointToPosition(mouseData.clientX, mouseData.clientY);
    return { ...state, focus: point };
}
