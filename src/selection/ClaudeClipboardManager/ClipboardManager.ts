import type { DocShape } from "../../types/types"
import { clipboardStore, type ClipboardMode } from "./clipboardStore"
import { copy } from "./copy"
import { cut } from "./cut"
import { paste } from "./paste"

// ── ClipboardManager ──────────────────────────────────────────────────────
// Helper class used BY SelectionManager. Not called by WSA directly.
//
// Single public method: receiveEvent. Same contract as every other helper:
//   receiveEvent(eventData, reactEvent, trigger, shape) -> shape
//
// receiveEvent routes by trigger string to a private path. No clipboard logic
// lives in this file — it only dispatches. copy/cut fill the internal buffer
// and return shape unchanged; paste returns a new shape with blocks merged in.
//
// The buffer (held slice + mode) lives in clipboardStore, not on this instance,
// so the held data survives even if SM rebuilds the manager. (Confirm whether
// that lifetime is wanted — see PLAN.md.)

// PLACEHOLDER trigger strings — confirm the exact strings SM sends.
const TRIGGER = {
    copy:  "clipboard-copy",
    cut:   "clipboard-cut",
    paste: "clipboard-paste",
    clear: "clipboard-clear",
} as const

// eventData is intentionally `unknown` at this boundary: copy/cut need the
// selected id set, paste needs the caret anchor id. The exact field carrying
// the selection is a PLACEHOLDER (see PLAN.md item 1) — typed loosely until the
// SM side is confirmed.
type ClipboardEventData = unknown

export class ClipboardManager {
    // The one public method. trigger picks the path; shape is returned either
    // untouched (copy/cut) or rebuilt (paste).
    receiveEvent(
        eventData: ClipboardEventData,
        reactEvent: React.SyntheticEvent | null,
        trigger: string,
        shape: DocShape,
    ): DocShape {
        switch (trigger) {
            case TRIGGER.copy:
                return copy(eventData, shape)

            case TRIGGER.cut:
                return cut(eventData, shape)

            case TRIGGER.paste:
                return paste(eventData, reactEvent, shape)

            case TRIGGER.clear:
                clipboardStore.clear()
                return shape

            default:
                // Unknown trigger — clipboard does nothing, passes shape through.
                return shape
        }
    }
}

// Re-export the mode type so SM can read it if needed without importing the store.
export type { ClipboardMode }
