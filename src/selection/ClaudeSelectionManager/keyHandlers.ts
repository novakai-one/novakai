// ── keyHandlers.ts ────────────────────────────────────────────────────────────
// The full keyboard command map. One pure function that reads a KeyEventData,
// owns every preventDefault (via key.nativeEvent), and dispatches to the right
// caret / extend / clipboard / control action. Mirrors standard text-editor
// behaviour: plain arrows move a caret, Shift extends, Cmd+Shift extends by
// word/line, plus Tab / Escape / copy / paste / select-all.
//
// Returns new selection state. Clipboard + clear are side-effect actions exposed
// as optional callbacks so this module stays pure w.r.t. selection state and
// never imports the clipboard controller directly (no helper-imports-helper).

import type { SelectionState } from "./selectionState";
import type { KeyEventData } from "./eventData";
import * as caret from "./caretNavigation";
import * as extend from "./selectionExtend";

// Side-effect hooks the class wires in. Keep selection logic pure; let the class
// own the impure clipboard / clear calls. All optional — undefined = no-op.
export interface KeyCommandHooks {
    copy?:        () => void;
    pasteAtCaret?: () => void;
    clearAll?:    () => void;   // Escape: clear text + block selection
}

// Single entry point used by the router. trigger is "keydown" only for now;
// keyup is a no-op at the router level.
export function handleKeyDown(
    state: SelectionState,
    key: KeyEventData,
    blockOrder: string[],
    hooks: KeyCommandHooks = {},
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
            hooks.clearAll?.();
            return { ...state, anchor: null, focus: null, mode: "caret" };

        case "c":
            if (!cmd) return state;
            pd();
            hooks.copy?.();
            return state;

        case "v":
            if (!cmd) return state;
            pd();
            hooks.pasteAtCaret?.();
            return state;

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
