// ── keyHandlers.ts ────────────────────────────────────────────────────────────
// The full keyboard command map. One pure function that reads a KeyEventData,
// owns every preventDefault (via key.nativeEvent), and dispatches to the right
// caret / extend / control action. Mirrors standard text-editor behaviour:
// plain arrows move a caret, Shift extends, Cmd+Shift extends by word/line,
// plus Tab / Escape / select-all.
//
// Clipboard (copy / cut / paste) is NOT handled here. ClipboardManager reads the
// same key event upstream and owns those keystrokes. This module stays pure
// w.r.t. selection state and never touches the clipboard.

import type { SelectionState } from "./selectionState";
import type { KeyEventData } from "./eventData";
import * as caret from "./caretNavigation";
import * as extend from "./selectionExtend";

// Single entry point used by the router. trigger is "keydown" only for now;
// keyup is a no-op at the router level.
export function handleKeyDown(
    state: SelectionState,
    key: KeyEventData,
    blockOrder: string[],
): SelectionState {

    const cmd   = key.metaKey || key.ctrlKey;
    const event = key.nativeEvent;
    const pd    = () => { event?.preventDefault?.(); };

    switch (key.key) {

        case "Tab":
            pd();                       // suppress focus tab-out
            return state;

        case "Escape":
            pd();
            return { ...state, anchor: null, focus: null, mode: "caret" };

        case "a":
            if (!cmd) return state;
            pd();
            return extend.selectAll(state, key, blockOrder);

        case "ArrowLeft":
            pd();
            if (key.shiftKey && cmd) return extend.cmdShiftArrowLeft(state, key, blockOrder);
            if (key.shiftKey)        return extend.shiftArrowLeft(state, key, blockOrder);
            return caret.arrowLeft(state, key, blockOrder);

        case "ArrowRight":
            pd();
            if (key.shiftKey && cmd) return extend.cmdShiftArrowRight(state, key, blockOrder);
            if (key.shiftKey)        return extend.shiftArrowRight(state, key, blockOrder);
            return caret.arrowRight(state, key, blockOrder);

        case "ArrowUp":
            pd();
            if (key.shiftKey && cmd) return extend.cmdShiftArrowUp(state, key, blockOrder);
            if (key.shiftKey)        return extend.shiftArrowUp(state, key, blockOrder);
            return caret.arrowUp(state, key, blockOrder);

        case "ArrowDown":
            pd();
            if (key.shiftKey && cmd) return extend.cmdShiftArrowDown(state, key, blockOrder);
            if (key.shiftKey)        return extend.shiftArrowDown(state, key, blockOrder);
            return caret.arrowDown(state, key, blockOrder);

        default:
            return state;
    }
}
