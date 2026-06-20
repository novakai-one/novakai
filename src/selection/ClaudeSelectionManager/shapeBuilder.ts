// ── shapeBuilder.ts ───────────────────────────────────────────────────────────
// Produces the new DocShape SM returns to WSA.
// Applies any content edits, then returns a new object.
// Does NOT call setters. Returning the shape is what lets React diff downstream.

import type { DocShape } from "./docShape";
import type { SelectionState } from "./selectionState";

// Build the new shape. Selection state is read here only to apply edits
// (e.g. delete a range, insert at caret). Selection itself never enters the shape.
// Placeholder: edit application added during migration.
export function buildShape(
    shape: DocShape,
    state: SelectionState,
): DocShape {
    console.log("placeholder - trigger", state);
    return { ...shape };
}
