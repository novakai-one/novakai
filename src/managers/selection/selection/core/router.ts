// ── router.ts ─────────────────────────────────────────────────────────────────
// Reads trigger, picks one handler, returns new selection state.
// Pure. No DOM writes. No setters. No re-render.
//
// blockOrder (shape.file.content) is threaded in so handlers can cross block
// boundaries from the single source of truth — never from DOM order.

import type { SelectionState } from "./selectionState";
import type { MouseEventData, KeyEventData, LifecycleEventData } from "../event-handlers/eventData";
import {
    handleMouseDown,
    handleMouseDrag,
    handleMouseUp,
} from "../event-handlers/mouseHandlers";
import { handleKeyDown } from "../event-handlers/keyHandlers";
import { handleBlur } from "../event-handlers/lifecycleHandlers";

// Mouse: trigger -> one mouse handler. blockOrder is unused for mouse routing
// (the handlers resolve position from the DOM via clientX/clientY), kept in the
// signature so all three channels read uniformly.
// @flowmap-node selection__route kind=function
export function routeMouse(
    state: SelectionState,
    mouseData: MouseEventData,
    trigger: string,
    _blockOrder: string[],
): SelectionState {
    switch (trigger) {
        case "content-area-mouse-down":   return handleMouseDown(state, mouseData);
        case "workspace-area-mouse-move": return handleMouseDrag(state, mouseData);
        case "workspace-area-mouse-up":   return handleMouseUp(state, mouseData);
        default:                       return state;
    }
}

// Key: content-area-key-down -> the full command map. key-up is a no-op for now.
// Clipboard keystrokes (c/x/v) are handled by ClipboardManager, not here.
export function routeKey(
    state: SelectionState,
    keyData: KeyEventData,
    trigger: string,
    blockOrder: string[],
): SelectionState {
    if (trigger !== "content-area-key-down") return state;
    return handleKeyDown(state, keyData, blockOrder);
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
