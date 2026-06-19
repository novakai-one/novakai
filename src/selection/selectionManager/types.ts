// types.ts
//
// Shared selection vocabulary: types, callback signatures, and constants used
// by SelectionManager and its helper modules. No DOM access, no state.

import type {
    TextElement,
    MouseEventData,
    KeyEventData,
    LifecycleEventData,
} from '../../types/types'
import type { SelectionPoint } from './SelectionPoint'

// Re-export event types so existing callers can still import them through SM.
// New code SHOULD import these directly from '../../types/types'.
export type { MouseEventData, KeyEventData, LifecycleEventData }
// ClipboardBlockData now lives in the shared types (BlockManager reads it too).
// Re-exported here so SM's existing importers keep working unchanged.
export type { ClipboardBlockData } from '../../types/types'


// ── BlockType ─────────────────────────────────────────────────────────────
//   Every SelectionPoint carries a blockType. Selection is only valid across
//   points of the same blockType. Currently only "content-area"; add new
//   types here.

export type BlockType = "content-area"   // Future: | "canvas-area" | "database-cell"


// Chrome requires the "web " prefix for unsanitised custom MIME types.
export const CLIPBOARD_CUSTOM_TYPE = "web application/x-novari-clipboard"


// ── ResolvedRange ─────────────────────────────────────────────────────────
// Built by SelectionManager._buildRange() for cross-block selections.

export interface ResolvedRange {
    start:  SelectionPoint
    middle: SelectionPoint[]   // fully-selected blocks between start and end
    end:    SelectionPoint
    type:   BlockType
}


// ── Structural-mutation callback signatures ──────────────────────────────
// WSA registers these on mount. SM fires them when a confirmed gesture
// (Enter, Backspace on empty, paste-with-extra-blocks) requires WSA to
// mutate the Zustand store.

export type NewBlockHandler        = (value: string, blockId: string, tag: TextElement['Tag']) => void
export type DeleteBlockHandler     = (blockId: string) => void
export type ContentRefreshHandler  = (value: string, blockId: string, tag: TextElement['Tag']) => void
export type PastedBlocksHandler    = (anchorBlockId: string, blocks: ClipboardBlockData[]) => void
