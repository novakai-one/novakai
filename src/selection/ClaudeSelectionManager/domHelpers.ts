// ── domHelpers.ts ─────────────────────────────────────────────────────────────
// The ONLY module that reads/writes the DOM.
// Reads return plain values. Writes paint directly (e.g. CSS Highlights API).
// Never calls a setter. Never returns a shape. Never triggers re-render.

import type { SelectionPoint } from "./selectionState";

// Maps a viewport point to a document position.
// Args are clientX / clientY (canonical MouseEventData fields).
// Placeholder: real version wraps caretPositionFromPoint.
export function pointToPosition(clientX: number, clientY: number): SelectionPoint {
    console.log("placeholder - trigger", clientX, clientY);
    return { elementId: "", offset: 0 };
}

// Maps a document position back to viewport coords.
// Placeholder.
export function positionToCoords(point: SelectionPoint): { clientX: number; clientY: number } {
    console.log("placeholder - trigger", point);
    return { clientX: 0, clientY: 0 };
}

// Reads text content of a block by id.
// Placeholder.
export function getElementText(blockId: string): string {
    console.log("placeholder - trigger", blockId);
    return "";
}
