// ── router.ts ─────────────────────────────────────────────────────────────────
// Reads trigger, picks one handler, returns new selection state.
// Pure. No DOM writes. No setters. No re-render.
//
// blockOrder (shape.file.content) is threaded in so handlers can cross block
// boundaries from the single source of truth — never from DOM order.

import type { SelectionState } from "./selectionState";
import type { MouseEventData, KeyEventData, LifecycleEventData } from "./eventData";
import {
    handleMouseDown,
    handleMouseDrag,
    handleMouseUp,
} from "./mouseHandlers";
import { handleKeyDown, type KeyCommandHooks } from "./keyHandlers";
import { handleBlur } from "./lifecycleHandlers";

// Mouse: trigger -> one mouse handler.
export function routeMouse(
    state: SelectionState,
    mouseData: MouseEventData,
    trigger: string,
    blockOrder: string[],
): SelectionState {
    switch (trigger) {
        case "mousedown": return handleMouseDown(state, mouseData);
        case "mousemove": return handleMouseDrag(state, mouseData);
        case "mouseup":   return handleMouseUp(state, mouseData);
        default:          return state;
    }
}

// Key: keydown -> the full command map. keyup is a no-op for now.
export function routeKey(
    state: SelectionState,
    keyData: KeyEventData,
    trigger: string,
    blockOrder: string[],
    hooks: KeyCommandHooks,
): SelectionState {
    if (trigger !== "keydown") return state;
    return handleKeyDown(state, keyData, blockOrder, hooks);
}

// Lifecycle: trigger -> one lifecycle handler.
export function routeLifecycle(
    state: SelectionState,
    lifecycleData: LifecycleEventData,
    trigger: string,
): SelectionState {
    switch (trigger) {
        case "content-area-blur": return handleBlur(state, lifecycleData);
        default:                  return state;
    }
}
