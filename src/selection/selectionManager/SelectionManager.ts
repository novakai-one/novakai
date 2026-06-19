// SelectionManager.ts
//
// The selection brain. WSA forwards every mouse / key / lifecycle event here;
// SM holds the selection state and routes each event to the helper that knows
// what to do. The fiddly DOM work lives in the helpers — SM stays a router you
// can read top to bottom.
//
// ── Module layout ────────────────────────────────────────────────────────────
//   SelectionPoint        — a single caret position
//   SelectionState        — what is selected (anchor / focus / resolved range)
//   blockSelectionStore   — block-id multi-select (rubber band), React store
//   domHelpers            — the only place that reads/writes the DOM
//   highlightRenderer     — paints the selection; builds the cross-block range
//   caretNavigation       — plain Arrow caret movement + focus-after-edit
//   selectionExtend       — Shift / Cmd+Shift extends + Select All
//   pointerGestures       — mouse: text drag + rubber band
//   clipboard             — pure payload / plain-text builders
//   clipboardController   — clipboard I/O + in-memory fallback
//   SelectionManager      — state + event routing (this file)
//
// ── Architecture ─────────────────────────────────────────────────────────────
//   ContentArea / DragHandle / DragContainer / WSA root
//     → fire (data, trigger) up to WSA (the ONLY conduit)
//   WSA → forwards to receiveMouseEvent / receiveKeyEvent / receiveLifecycleEvent
//   SM  → updates state via the helpers, then re-renders the highlight
//
// Components NEVER call SM directly. SM NEVER attaches DOM listeners.
// Helpers (SM, DM) NEVER import each other.

import type {
    MouseEventData,
    KeyEventData,
    LifecycleEventData,
    ContentDataSet,
    DocShape,
} from '../../types/types'
import type {
    BlockType,
    ClipboardBlockData,
    ContentRefreshHandler,
    PastedBlocksHandler,
} from './types'
import { SelectionPoint } from './SelectionPoint'
import { SelectionState } from './SelectionState'
import { BlockSelectionStore } from './blockSelectionStore'
import { ClipboardController } from './clipboardController'
import { buildResolvedRange, renderSelectionHighlight } from './highlightRenderer'
import { readBlockContent } from './domHelpers'
import * as caret from './caretNavigation'
import type { CaretContext } from './caretNavigation'
import * as extend from './selectionExtend'
import {
    handlePointerEvent,
    createGestureFlags,
    type GestureFlags,
    type PointerContext,
} from './pointerGestures'

// Re-export so existing callers can keep importing these through SM.
// New code SHOULD import them from their own modules.
export { SelectionPoint }
export type { BlockType, ClipboardBlockData, MouseEventData, KeyEventData, LifecycleEventData }


export default class SelectionManager {

    // What is selected, and the helpers that read/change it.
    private state          = new SelectionState()
    private _blockSelection = new BlockSelectionStore()
    private _clipboard      = new ClipboardController()
    private _gesture: GestureFlags = createGestureFlags()

    // Set once by WSA on mount; the scoping root for every DOM query.
    private _wsaEl: HTMLElement | null = null

    // Root block ids in document order. WSA pushes this on every content change.
    private _blockOrder: string[] = []

    // Structural callbacks WSA registers — SM fires them, WSA mutates the store.
    private _onContentRefresh: ContentRefreshHandler | null = null
    private _onPastedBlocks:   PastedBlocksHandler   | null = null


    // ── Lifecycle (called by WSA) ────────────────────────────────────────────

    setWorkspaceEl = (el: HTMLElement | null): void => { this._wsaEl = el }
    setBlockOrder  = (orderedBlockIds: string[]): void => { this._blockOrder = orderedBlockIds }


    // ── Structural-mutation callback registration ────────────────────────────

    registerContentRefreshHandler = (h: ContentRefreshHandler): void => { this._onContentRefresh = h }
    registerPastedBlocksHandler   = (h: PastedBlocksHandler):   void => { this._onPastedBlocks   = h }


    // ── Block selection store (useSyncExternalStore compatible) ──────────────
    // Delegated to BlockSelectionStore; arrow-bound there so `this` survives.

    subscribe                 = this._blockSelection.subscribe
    getSelectedBlocksSnapshot = this._blockSelection.getSnapshot
    clearSelectedBlocks       = this._blockSelection.clear


    // ── Public entry points (called only by WSA) ─────────────────────────────
    // Conduit shape: WSA threads the document shape through every helper. SM does
    // selection/caret side effects and returns the shape UNCHANGED — structural
    // create/delete is BlockManager's job, layout tidy is LayoutManager's.

    receiveMouseEvent = (mouseData: MouseEventData, trigger: string, shape: DocShape): DocShape => {
        if (!this._wsaEl) return shape
        handlePointerEvent(trigger, mouseData, this._pointerContext())
        this._rebuildAndRenderSelection()
        return shape
    }

    receiveKeyEvent = (keyData: KeyEventData, trigger: string, shape: DocShape): DocShape => {
        if (!this._wsaEl) return shape
        if (trigger !== "keydown") return shape       // keyup is currently a no-op
        this._handleKeyDown(keyData)
        this._rebuildAndRenderSelection()
        return shape
    }

    receiveLifecycleEvent = (data: LifecycleEventData, trigger: string, shape: DocShape): DocShape => {
        if (!this._wsaEl) return shape
        if (trigger === "content-area-blur") return this._commitContent(data.blockId, shape)
        return shape
    }


    // ── Focus a block after a structural change (called by WSA) ──────────────

    focusBlockStart = (blockId: string): void => {
        if (!this._wsaEl) return
        caret.focusBlockStart(this.state, blockId, this._wsaEl)
    }

    focusBlockEnd = (blockId: string): void => {
        if (!this._wsaEl) return
        caret.focusBlockEnd(this.state, blockId, this._wsaEl)
    }


    // ── Clipboard public API (delegated to ClipboardController) ───────────────

    copyToClipboard    = (): Promise<void> => this._clipboard.copy(this.state, this._blockOrder, this._wsaEl)
    pasteFromClipboard = (): Promise<ClipboardBlockData[]> => this._clipboard.paste()
    insertAtCaret      = (html: string): string | null => this._clipboard.insertAtCaret(html, this._wsaEl)
    getSelectedText    = (): string => this._clipboard.selectedText(this.state)


    // ── Keyboard command map ─────────────────────────────────────────────────
    // SM owns every preventDefault. The Component → WSA → SM chain MUST stay
    // synchronous, so the heavy lifting runs here, not in a later microtask.

    private _handleKeyDown(keyData: KeyEventData): void {
        const cmd   = keyData.metaKey || keyData.ctrlKey
        const event = keyData.nativeEvent
        const ctx   = this._caretContext()

        switch (keyData.key) {

            case 'Tab':
                event.preventDefault()             // suppress focus tab-out
                return

            case 'Escape':
                event.preventDefault()
                this.clearSelectedBlocks()
                this._clearSelection()
                return

            case 'c':
                if (!cmd) return
                event.preventDefault()
                this.copyToClipboard()
                return

            case 'v':
                if (!cmd) return
                event.preventDefault()
                this._clipboard.pasteAtCaret(this._wsaEl, this._onPastedBlocks)
                return

            case 'a':
                if (!cmd) return
                event.preventDefault()
                extend.selectAll(ctx, keyData.blockId)
                return

            case 'ArrowRight':
                event.preventDefault()
                if (keyData.shiftKey && cmd) extend.cmdShiftArrowRight(ctx, keyData.blockId)
                else if (keyData.shiftKey)   extend.shiftArrowRight(ctx, keyData.blockId)
                else                         caret.arrowRight(ctx, keyData.blockId)
                return

            case 'ArrowLeft':
                event.preventDefault()
                if (keyData.shiftKey && cmd) extend.cmdShiftArrowLeft(ctx, keyData.blockId)
                else if (keyData.shiftKey)   extend.shiftArrowLeft(ctx, keyData.blockId)
                else                         caret.arrowLeft(ctx, keyData.blockId)
                return

            case 'ArrowUp':
                event.preventDefault()
                if (keyData.shiftKey && cmd) extend.cmdShiftArrowUp(ctx, keyData.blockId)
                else if (keyData.shiftKey)   extend.shiftArrowUp(ctx, keyData.blockId)
                else                         caret.arrowUp(ctx, keyData.blockId)
                return

            case 'ArrowDown':
                event.preventDefault()
                if (keyData.shiftKey && cmd) extend.cmdShiftArrowDown(ctx, keyData.blockId)
                else if (keyData.shiftKey)   extend.shiftArrowDown(ctx, keyData.blockId)
                else                         caret.arrowDown(ctx, keyData.blockId)
                return
        }
    }


    // ── Selection rebuild + render ───────────────────────────────────────────

    private _rebuildAndRenderSelection(): void {
        if (!this._wsaEl) return

        // No active, same-type selection — clear any painted highlight and stop.
        if (!this.state.hasActiveSelection() || !this.state.isSameType) {
            CSS.highlights.clear()
            return
        }

        // Cross-block selections need their range flattened before painting.
        if (this.state.anchor.blockId !== this.state.focus.blockId) {
            this.state.resolved = buildResolvedRange(this.state.anchor, this.state.focus, this._blockOrder, this._wsaEl)
        }
        renderSelectionHighlight(this.state, this._wsaEl)
    }


    // ── Internal helpers ─────────────────────────────────────────────────────

    // Blur: read the block's live text/tag from the DOM and fold it into the
    // shape so the edit persists through the conduit. Returns the shape unchanged
    // when nothing differs, so an idle blur commits nothing.
    private _commitContent(blockId: string, shape: DocShape): DocShape {
        const snapshot = readBlockContent(blockId, this._wsaEl!)
        if (!snapshot) return shape
        const el = shape.contentData[blockId]
        if (!el) return shape
        if (el.innerContent === snapshot.value && el.Tag === snapshot.tag) return shape
        const contentData: ContentDataSet = {
            ...shape.contentData,
            [blockId]: { ...el, innerContent: snapshot.value, Tag: snapshot.tag },
        }
        return { ...shape, contentData }
    }

    private _clearSelection(): void {
        this.state.clear()
        CSS.highlights.clear()
    }

    private _caretContext(): CaretContext {
        return { state: this.state, blockOrder: this._blockOrder, wsaEl: this._wsaEl! }
    }

    private _pointerContext(): PointerContext {
        return {
            state:            this.state,
            wsaEl:            this._wsaEl!,
            blockSelection:   this._blockSelection,
            gesture:          this._gesture,
            onContentRefresh: this._onContentRefresh,
        }
    }
}
