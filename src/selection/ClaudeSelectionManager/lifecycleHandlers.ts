// ── lifecycleHandlers.ts ──────────────────────────────────────────────────────
// Pure lifecycle logic (blur now; focus / input later).
// Selection state in -> new selection state out.
// No DOM writes. No setters. No re-render.

import type { SelectionState } from "./selectionState";
import type { LifecycleEventData } from "./eventData";

// Blur: a block lost focus. Placeholder — decide whether selection persists,
// collapses, or clears on blur during migration.
export function handleBlur(
    state: SelectionState,
    lifecycleData: LifecycleEventData,
): SelectionState {
    console.log("placeholder - trigger", lifecycleData);
    return state;
}
