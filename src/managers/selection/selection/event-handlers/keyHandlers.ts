// ── keyHandlers.ts ────────────────────────────────────────────────────────────
// The full keyboard command map. One pure function that reads a KeyEventData and
// dispatches to the right caret / extend / control action. Mirrors standard
// text-editor behaviour: plain arrows move a caret, Shift extends, Cmd+Shift
// extends by line / document edge, plus Tab / Escape / select-all.
//
// preventDefault policy: SM suppresses the native action only when it OWNS the
// result — extend (Shift), select-all, span-delete, Tab, Escape. Plain arrow
// caret movement is left to the browser (no caret-to-DOM writer is wired), so SM
// only tracks the resulting position from the next event's offset.
//
// Clipboard (copy / cut / paste) is NOT handled here. ClipboardManager reads the
// same key event upstream and owns those keystrokes. This module stays pure
// w.r.t. selection state and never touches the clipboard.

import type { SelectionState, SelectionPoint } from "../core/selectionState";
import type { KeyEventData } from "./eventData";
import * as caret from "../caret/caretNavigation";
import * as extend from "../core/selectionExtend";

// Single entry point used by the router. trigger is "content-area-key-down"
// only for now; key-up is a no-op at the router level.
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

        case "Backspace":
        case "Delete":
            // The text removal itself happens in shapeBuilder (it owns document
            // edits). Here we only collapse the selection to a caret at the
            // start of the deleted span, so the caret lands correctly afterwards.
            // A collapsed selection (no span) is left to the browser's own
            // editing — SM does not preventDefault single-character deletes.
            if (!hasTextSpan(state)) return state;
            pd();
            return collapseToSpanStart(state, blockOrder);

        case "a":
            if (!cmd) return state;
            pd();
            return extend.selectAll(state, key, blockOrder);

        case "ArrowLeft":
            if (key.shiftKey && cmd) { pd(); return extend.cmdShiftArrowLeft(state, key, blockOrder); }
            if (key.shiftKey)        { pd(); return extend.shiftArrowLeft(state, key, blockOrder); }
            return caret.arrowLeft(state, key, blockOrder);   // native caret move; no preventDefault

        case "ArrowRight":
            if (key.shiftKey && cmd) { pd(); return extend.cmdShiftArrowRight(state, key, blockOrder); }
            if (key.shiftKey)        { pd(); return extend.shiftArrowRight(state, key, blockOrder); }
            return caret.arrowRight(state, key, blockOrder);

        case "ArrowUp":
            if (key.shiftKey && cmd) { pd(); return extend.cmdShiftArrowUp(state, key, blockOrder); }
            if (key.shiftKey)        { pd(); return extend.shiftArrowUp(state, key, blockOrder); }
            return caret.arrowUp(state, key, blockOrder);

        case "ArrowDown":
            if (key.shiftKey && cmd) { pd(); return extend.cmdShiftArrowDown(state, key, blockOrder); }
            if (key.shiftKey)        { pd(); return extend.shiftArrowDown(state, key, blockOrder); }
            return caret.arrowDown(state, key, blockOrder);

        default:
            return state;
    }
}


// ── Deletion helpers ─────────────────────────────────────────────────────────

// True when the key removes the selected span (so shapeBuilder should cut text
// and the caret should collapse). Read by SM to drive the buildShape delete flag.
export function isDeleteKey(key: KeyEventData): boolean {
    return key.key === "Backspace" || key.key === "Delete";
}

// A non-collapsed selection sitting in text (the span shapeBuilder will delete).
function hasTextSpan(state: SelectionState): boolean {
    if (!state.anchor || !state.focus) return false;
    const sameSpot = state.anchor.blockId === state.focus.blockId
        && state.anchor.offset === state.focus.offset;
    return !sameSpot;
}

// Collapse the selection onto the start of the deleted span, in document order,
// so the caret sits where the removed text began.
function collapseToSpanStart(state: SelectionState, order: string[]): SelectionState {
    const anchor = state.anchor!;
    const focus  = state.focus!;
    const start  = earlierInDocument(anchor, focus, order);
    const caretPoint: SelectionPoint = { blockId: start.blockId, offset: start.offset, offsetEnd: start.offset };
    return { anchor: caretPoint, focus: caretPoint, mode: "caret" };
}

// The selection point that appears first in document order.
function earlierInDocument(a: SelectionPoint, b: SelectionPoint, order: string[]): SelectionPoint {
    return order.indexOf(a.blockId) <= order.indexOf(b.blockId) ? a : b;
}
