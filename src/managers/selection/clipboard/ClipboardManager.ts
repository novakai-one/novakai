import type { DocShape, KeyEventData } from "../../../types/types"
import type { SelectionPoint } from "../selection/core/selectionState"
import type { ClipboardMode } from "./clipboardStore"
import { copy } from "./copy"
import { cut } from "./cut"
import { paste } from "./paste"


type ClipboardCommand = "copy" | "cut" | "paste"

// @flowmap-node selection__clip kind=function
export class ClipboardManager {
    receiveEvent(
        eventData: unknown,
        reactEvent: React.SyntheticEvent | null,
        trigger: string,
        shape: DocShape,
        range: SelectionPoint[] = [],
    ): DocShape {
        const command = detectCommand(trigger, eventData)
        if (command === null) return freshShape(shape)   // not a clipboard keystroke

        // CM owns preventDefault for c/x/v so the browser's native clipboard does
        // not also fire. Synchronous — no awaits before this point.
        preventNativeClipboard(eventData)

        switch (command) {
            case "copy":
                copy(range, shape)            // fills the buffer; no document change
                return freshShape(shape)
            case "cut":
                return cut(range, shape)      // fills the buffer and removes the source
            case "paste":
                return paste(eventData, reactEvent, trigger, shape)
        }
    }
}

// Reads the key event and returns the clipboard command it represents, or null.
// Only key-down events with the platform modifier (cmd on mac, ctrl elsewhere) count;
// the component prefix is irrelevant, so any "*-key-down" trigger qualifies.
function detectCommand(trigger: string, eventData: unknown): ClipboardCommand | null {
    if (!isKeyDownTrigger(trigger)) return null

    const keyEvent = eventData as KeyEventData
    const platformModifierHeld = keyEvent?.metaKey || keyEvent?.ctrlKey
    if (!platformModifierHeld) return null

    switch (keyEvent.key?.toLowerCase()) {
        case "c": return "copy"
        case "x": return "cut"
        case "v": return "paste"
        default:  return null
    }
}

function isKeyDownTrigger(trigger: string): boolean {
    // Any component-prefixed "*-key-down" trigger word (e.g.
    // "content-area-key-down"). The prefix is irrelevant to the clipboard decision.
    return trigger.endsWith("-key-down");
}

// Suppress the browser's native copy/cut/paste so only CM's buffer is in play.
// Reads the same nativeEvent SM threads through; no-op if it is missing.
function preventNativeClipboard(eventData: unknown): void {
    const keyEvent = eventData as KeyEventData
    keyEvent?.nativeEvent?.preventDefault?.()
}

// A new top-level shape with the same dataset references — a fresh identity for React
// when clipboard made no document change. Spreads the source so `selection` (and any
// future field) carries through unchanged.
function freshShape(shape: DocShape): DocShape {
    return { ...shape }
}

export type { ClipboardMode }
