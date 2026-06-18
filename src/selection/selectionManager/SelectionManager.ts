// SelectionManager.ts
//
// SM owns ALL selection logic and drives ALL highlight rendering. The actual
// DOM reading/writing lives in domHelpers.ts and the clipboard payload builders
// in clipboard.ts — SM holds the selection STATE (anchor / focus / resolved
// range, block selection, clipboard fallback) and the gesture logic.
//
// ── Module layout ────────────────────────────────────────────────────────
//   types.ts        — BlockType, ClipboardBlockData, ResolvedRange, handlers
//   SelectionPoint  — a single caret position
//   domHelpers.ts   — pure DOM read/write (the only place that touches the DOM)
//   clipboard.ts    — pure payload + plain-text builders
//   SelectionManager — state + gesture/keyboard logic (this file)
//
// ── Architecture ──────────────────────────────────────────────────────────
//   ContentArea / DragHandle / DragContainer / WSA root
//     → fire (data, trigger) up to WSA (the ONLY conduit)
//   WSA → forwards to sm.receiveMouseEvent / receiveKeyEvent / receiveLifecycleEvent
//   SM  → resolves caret positions, tracks anchor/focus, renders highlights,
//         drives structural mutations through registered callbacks
//
// Components NEVER call SM directly. SM NEVER attaches DOM listeners.
// Helpers (SM, DM) NEVER import each other.
//
// ── Selection model ───────────────────────────────────────────────────────
//   anchor — where the selection started (the fixed end)
//   focus  — where the selection currently ends (the moving end)
//   A selection always spans anchor → focus in document order regardless of
//   which direction the user dragged.
//
//   Single-block: anchor.blockId === focus.blockId
//   Cross-block:  anchor and focus in different blocks.
//                 _buildRange() resolves this into a ResolvedRange before
//                 highlight rendering — _resolved is always built before
//                 _applyHighlight is called (enforced in _rebuildAndRenderSelection).

import type {
    MouseEventData,
    KeyEventData,
    LifecycleEventData,
} from '../../types/types'
import type {
    BlockType,
    ClipboardBlockData,
    ResolvedRange,
    NewBlockHandler,
    DeleteBlockHandler,
    ContentRefreshHandler,
    PastedBlocksHandler,
} from './types'
import { CLIPBOARD_CUSTOM_TYPE } from './types'
import { SelectionPoint } from './SelectionPoint'
import {
    stripZWS,
    blockIdFromNode,
    snapshotBrowserCaret,
    caretPointFromCoordinates,
    getFirstTextNodeForBlock,
    getLastTextNodeForBlock,
    findEditableForBlock,
    getPrevTextNodeInBlock,
    getNextTextNodeInBlock,
    readBlockContent,
    coordinatesAreInsideBlock,
    pushCaretToDOM,
} from './domHelpers'
import { buildClipboardBlocks, computeSelectedText } from './clipboard'

// Re-export so existing callers can keep importing these through SM.
// New code SHOULD import them from their own modules.
export { SelectionPoint }
export type { BlockType, ClipboardBlockData, MouseEventData, KeyEventData, LifecycleEventData }


// ─────────────────────────────────────────────────────────────────────────────
// SelectionManager
// ─────────────────────────────────────────────────────────────────────────────

export default class SelectionManager {

    anchor: SelectionPoint = new SelectionPoint()
    focus:  SelectionPoint = new SelectionPoint()

    // Built by _buildRange() for cross-block selections. Always populated
    // before _applyHighlight is called — _rebuildAndRenderSelection guarantees
    // this by calling _buildRange first.
    public _resolved: ResolvedRange | null = null

    // Vertical-column memory across multiple up/down keypresses.
    // Cleared when any non-vertical key fires.
    private _targetOffset: number | null = null

    // In-memory clipboard fallback for browsers that block clipboard.read() (Firefox).
    // Validated against native plain-text before use — if the user copied
    // externally between our copy and paste, native text won't match and we
    // fall back to treating the native clipboard as a plain-text paste.
    private _internalClipboard: { blocks: ClipboardBlockData[]; plainText: string } | null = null

    // WSA hands SM the workspace element ONCE on mount. SM uses it as the
    // scoping root for every DOM query.
    private _wsaEl: HTMLElement | null = null

    // Ordered list of root block ids (document reading order). WSA pushes
    // this every time activeFile.content changes.
    private _blockOrder: string[] = []

    // Drag invalidation flag — set by trigger "drag-handle-mouse-down",
    // cleared by "workspace-mouse-up". While true, text-selection and
    // rubber-band paths bail in _handleMouseMove.
    private _isDragging: boolean = false

    // Rubber-band gesture state. Null while no rubber-band is in progress.
    private _rubberBandAnchor: { x: number; y: number; cmdKey: boolean } | null = null

    // Block selection store — SM-owned, exposed via useSyncExternalStore.
    // Snapshot stability: getSelectedBlocksSnapshot returns the same reference
    // until a mutation replaces the field with a new Set.
    private _selectedBlockIds: ReadonlySet<string> = new Set()
    private _blockSelectionListeners: Set<() => void> = new Set()

    // Structural callbacks fired from gesture handlers.
    private _onNewBlock:         NewBlockHandler        | null = null
    private _onDeleteBlock:      DeleteBlockHandler     | null = null
    private _onContentRefresh:   ContentRefreshHandler  | null = null
    private _onPastedBlocks:     PastedBlocksHandler    | null = null


    // ── Lifecycle (called by WSA) ─────────────────────────────────────────

    setWorkspaceEl = (el: HTMLElement | null): void => {
        this._wsaEl = el
    }

    setBlockOrder = (orderedBlockIds: string[]): void => {
        this._blockOrder = orderedBlockIds
    }


    // ── Structural-mutation callback registration ────────────────────────

    registerNewBlockHandler        = (h: NewBlockHandler):       void => { this._onNewBlock       = h }
    registerDeleteBlockHandler     = (h: DeleteBlockHandler):    void => { this._onDeleteBlock    = h }
    registerContentRefreshHandler  = (h: ContentRefreshHandler): void => { this._onContentRefresh = h }
    registerPastedBlocksHandler    = (h: PastedBlocksHandler):   void => { this._onPastedBlocks   = h }


    // ── Block selection store API (useSyncExternalStore compatible) ──────
    // Arrow-bound so WSA can pass sm.subscribe / sm.getSelectedBlocksSnapshot
    // directly without losing `this`.

    subscribe = (listener: () => void): (() => void) => {
        this._blockSelectionListeners.add(listener)
        return () => { this._blockSelectionListeners.delete(listener) }
    }

    getSelectedBlocksSnapshot = (): ReadonlySet<string> => this._selectedBlockIds

    private _emitBlockSelectionChange(): void {
        this._blockSelectionListeners.forEach(listener => listener())
    }

    clearSelectedBlocks = (): void => {
        if (this._selectedBlockIds.size === 0) return
        this._selectedBlockIds = new Set()
        this._emitBlockSelectionChange()
    }

    private _applyRubberBandSelection(blockIds: ReadonlySet<string>, replace: boolean): void {
        const next = replace ? new Set(blockIds) : new Set(this._selectedBlockIds)
        if (!replace) blockIds.forEach(id => next.add(id))
        this._selectedBlockIds = next
        this._emitBlockSelectionChange()
    }


    // ── Computed selection state ─────────────────────────────────────────

    get isCollapsed(): boolean {
        if (!this.anchor.isSet || !this.focus.isSet) return true
        // Node identity check is required: a block with <br> lines has multiple
        // text nodes. Two points in different text nodes at the same offset are
        // NOT collapsed.
        return (
            this.anchor.blockId === this.focus.blockId &&
            this.anchor.node    === this.focus.node    &&
            this.anchor.offset  === this.focus.offset
        )
    }

    hasActiveSelection(): boolean {
        return this.anchor.isSet && this.focus.isSet && !this.isCollapsed
    }

    get isSameType(): boolean {
        if (!this.anchor.isSet || !this.focus.isSet) return false
        return this.anchor.blockType === this.focus.blockType
    }

    private _canExtendTo(candidate: SelectionPoint): boolean {
        if (!this.anchor.isSet) return true
        return candidate.blockType === this.anchor.blockType
    }


    // ── Focus / anchor point helpers ─────────────────────────────────────

    private _setFocusPoint(node: Text, blockId: string, offset: number): void {
        this.focus.node      = node
        this.focus.nodeText  = stripZWS(node.data || '')
        this.focus.blockId   = blockId
        this.focus.blockType = "content-area"
        this.focus.offset    = offset
    }

    private _syncAnchorToFocusAndPushCaret(): void {
        this.anchor.copyFrom(this.focus)
        pushCaretToDOM(this.focus)
    }

    private _ensureAnchorIsSet(blockId: string): void {
        if (this.anchor.isSet) return
        const caret = snapshotBrowserCaret(blockId)
        if (!caret) return
        this.anchor.copyFrom(caret)
        this.focus.copyFrom(caret)
    }

    private _clearTargetOffset(): void {
        this._targetOffset = null
    }

    private _clearSelection(): void {
        this.anchor        = new SelectionPoint()
        this.focus         = new SelectionPoint()
        this._resolved     = null
        this._targetOffset = null
        CSS.highlights.clear()
    }


    // ── Public DOM-touching entry points ─────────────────────────────────

    // Public: focus a block's editable and place caret at offset 0.
    // Called by WSA after Enter creates a new block (via rAF so React has committed).
    focusBlockStart = (blockId: string): void => {
        if (!this._wsaEl) return
        const editable = findEditableForBlock(blockId, this._wsaEl)
        if (!editable) return

        editable.focus()

        // Empty editable: no text node exists. Create one so the caret has
        // somewhere to anchor and SM can track focus/anchor.
        let textNode = Array.from(editable.childNodes).find(
            n => n.nodeType === Node.TEXT_NODE
        ) as Text | undefined
        if (!textNode) {
            textNode = document.createTextNode('')
            editable.appendChild(textNode)
        }

        this._setFocusPoint(textNode, blockId, 0)
        this.anchor.copyFrom(this.focus)
        pushCaretToDOM(this.focus)
    }


    // ── Caret movement helpers (used by plain Arrow keys) ────────────────

    private _moveCaretRight(): void {
        if (!this.focus.node || !this._wsaEl) return

        if (this.focus.offset < this.focus.node.length) {
            this.focus.offset++
            this._syncAnchorToFocusAndPushCaret()
            return
        }

        const nextInBlock = getNextTextNodeInBlock(this.focus.node)
        if (nextInBlock) {
            this._setFocusPoint(nextInBlock, this.focus.blockId, 0)
            this._syncAnchorToFocusAndPushCaret()
            return
        }

        const idx = this._blockOrder.indexOf(this.focus.blockId)
        if (idx === -1 || idx === this._blockOrder.length - 1) return
        const nextBlockId = this._blockOrder[idx + 1]
        const firstNode = getFirstTextNodeForBlock(nextBlockId, this._wsaEl)
        if (!firstNode) return
        this._setFocusPoint(firstNode, nextBlockId, 0)
        this._syncAnchorToFocusAndPushCaret()
    }

    private _moveCaretLeft(): void {
        if (!this.focus.node || !this._wsaEl) return

        if (this.focus.offset > 0) {
            this.focus.offset--
            this._syncAnchorToFocusAndPushCaret()
            return
        }

        const prevInBlock = getPrevTextNodeInBlock(this.focus.node)
        if (prevInBlock) {
            this._setFocusPoint(prevInBlock, this.focus.blockId, prevInBlock.length)
            this._syncAnchorToFocusAndPushCaret()
            return
        }

        const idx = this._blockOrder.indexOf(this.focus.blockId)
        if (idx <= 0) return
        const prevBlockId = this._blockOrder[idx - 1]
        const lastNode = getLastTextNodeForBlock(prevBlockId, this._wsaEl)
        if (!lastNode) return
        this._setFocusPoint(lastNode, prevBlockId, lastNode.length)
        this._syncAnchorToFocusAndPushCaret()
    }

    private _moveCaretUp(): void {
        if (!this.focus.node || !this._wsaEl) return

        const prevInBlock = getPrevTextNodeInBlock(this.focus.node)
        if (prevInBlock) {
            const targetOffset = Math.min(this.focus.offset, prevInBlock.length)
            this._setFocusPoint(prevInBlock, this.focus.blockId, targetOffset)
            this._syncAnchorToFocusAndPushCaret()
            return
        }

        const idx = this._blockOrder.indexOf(this.focus.blockId)
        if (idx <= 0) return
        const prevBlockId = this._blockOrder[idx - 1]
        const lastNode = getLastTextNodeForBlock(prevBlockId, this._wsaEl)
        if (!lastNode) return
        const targetOffset = Math.min(this.focus.offset, lastNode.length)
        this._setFocusPoint(lastNode, prevBlockId, targetOffset)
        this._syncAnchorToFocusAndPushCaret()
    }

    private _moveCaretDown(): void {
        if (!this.focus.node || !this._wsaEl) return

        const nextInBlock = getNextTextNodeInBlock(this.focus.node)
        if (nextInBlock) {
            const targetOffset = Math.min(this.focus.offset, nextInBlock.length)
            this._setFocusPoint(nextInBlock, this.focus.blockId, targetOffset)
            this._syncAnchorToFocusAndPushCaret()
            return
        }

        const idx = this._blockOrder.indexOf(this.focus.blockId)
        if (idx === -1 || idx === this._blockOrder.length - 1) return
        const nextBlockId = this._blockOrder[idx + 1]
        const firstNode = getFirstTextNodeForBlock(nextBlockId, this._wsaEl)
        if (!firstNode) return
        const targetOffset = Math.min(this.focus.offset, firstNode.length)
        this._setFocusPoint(firstNode, nextBlockId, targetOffset)
        this._syncAnchorToFocusAndPushCaret()
    }


    // ── Collapse selection on plain arrow keys ──────────────────────────

    private _collapseToEnd(): void {
        const isSingleBlock = this.anchor.blockId === this.focus.blockId
        if (isSingleBlock) {
            const endOffset = Math.max(this.anchor.offset, this.focus.offset)
            this.anchor.offset = endOffset
            this.focus.offset  = endOffset
        } else {
            const endPoint = this._resolved ? this._resolved.end : this.focus
            this.anchor.copyFrom(endPoint)
            this.focus.copyFrom(endPoint)
        }
        this._resolved = null
        CSS.highlights.clear()
        pushCaretToDOM(this.focus)
    }

    private _collapseToStart(): void {
        const isSingleBlock = this.anchor.blockId === this.focus.blockId
        if (isSingleBlock) {
            const startOffset = Math.min(this.anchor.offset, this.focus.offset)
            this.anchor.offset = startOffset
            this.focus.offset  = startOffset
        } else {
            const startPoint = this._resolved ? this._resolved.start : this.anchor
            this.anchor.copyFrom(startPoint)
            this.focus.copyFrom(startPoint)
        }
        this._resolved = null
        CSS.highlights.clear()
        pushCaretToDOM(this.focus)
    }


    // ─────────────────────────────────────────────────────────────────────
    // PUBLIC ENTRY POINTS (called only by WSA)
    // ─────────────────────────────────────────────────────────────────────

    receiveMouseEvent = (mouseData: MouseEventData, trigger: string): void => {
        if (!this._wsaEl) return

        switch (trigger) {
            case "drag-handle-mouse-down":
                this._isDragging = true
                this._clearSelection()
                // Also clear the browser's native selection — _clearSelection
                // only clears SM state + CSS Highlights. A stale window.getSelection
                // would keep the OS-blue range visible while the user drags.
                window.getSelection()?.removeAllRanges()
                break

            case "content-area-mouse-down":
                this._handleContentMouseDown(mouseData)
                break
            case "content-area-mouse-up":
                this._handleContentMouseUp(mouseData)
                break
            case "content-area-click":
                this._handleContentClick(mouseData)
                break

            case "workspace-mouse-down":
                this._handlePageMouseDown(mouseData)
                break
            case "workspace-mouse-move":
                this._handleMouseMove(mouseData)
                break
            case "workspace-mouse-up":
                this._handleMouseUp(mouseData)
                break
        }

        this._rebuildAndRenderSelection()
    }

    receiveKeyEvent = (keyData: KeyEventData, trigger: string): void => {
        if (!this._wsaEl) return
        if (trigger !== "keydown") return    // keyup is currently no-op
        this._handleKeyDown(keyData)
        this._rebuildAndRenderSelection()
    }

    receiveLifecycleEvent = (data: LifecycleEventData, trigger: string): void => {
        if (!this._wsaEl) return
        if (trigger === "content-area-blur") {
            this._handleBlur(data.blockId)
        }
    }


    // ── Mouse handler bodies ─────────────────────────────────────────────

    private _handleContentMouseDown(mouseData: MouseEventData): void {
        if (mouseData.button !== 0) return
        // Any mouse interaction starts a fresh selection — clear vertical column memory
        this._clearTargetOffset()

        const point = caretPointFromCoordinates(mouseData.clientX, mouseData.clientY, this._wsaEl!)
        if (!point) return

        if (mouseData.shiftKey && this.anchor.isSet) {
            if (!this._canExtendTo(point)) return
            this.focus.copyFrom(point)
        } else {
            this.anchor.copyFrom(point)
            this.focus.copyFrom(point)
        }
        this._resolved = null
    }

    private _handleContentMouseUp(mouseData: MouseEventData): void {
        // Most cleanup happens in workspace-mouse-up (which always fires due to
        // event bubbling). content-area-mouse-up just refines focus to release coords.
        if (mouseData.button !== 0) return
        if (this._isDragging) return
        if (this._rubberBandAnchor) return

        const point = caretPointFromCoordinates(mouseData.clientX, mouseData.clientY, this._wsaEl!)
        if (!point) return
        if (!this._canExtendTo(point)) return

        this.focus.copyFrom(point)
        this._resolved = null
    }

    private _handleContentClick(mouseData: MouseEventData): void {
        // Click = content refresh point. SM reads the live DOM and fires the
        // structural callback so WSA can persist any pending edits.
        const snapshot = readBlockContent(mouseData.blockId, this._wsaEl!)
        if (!snapshot) return
        this._onContentRefresh?.(snapshot.value, mouseData.blockId, snapshot.tag)
    }

    private _handlePageMouseDown(mouseData: MouseEventData): void {
        if (mouseData.button !== 0) return
        // Gate: ignore mousedown that originated inside any block — those have
        // their own gestures (content-area-mouse-down sets anchor; drag-handle
        // starts a drag).
        if (coordinatesAreInsideBlock(mouseData.clientX, mouseData.clientY)) return

        this._clearSelection()
        const cmdKey = mouseData.metaKey || mouseData.ctrlKey
        this._rubberBandAnchor = { x: mouseData.clientX, y: mouseData.clientY, cmdKey }

        if (!cmdKey) {
            this._applyRubberBandSelection(new Set(), true)
        }
    }

    private _handleMouseMove(mouseData: MouseEventData): void {
        // Gate: drag in progress — neither rubber-band nor text-extension runs.
        if (this._isDragging) return
        // Gate: primary button not held — hover, not drag.
        if (mouseData.buttons !== 1) return

        // Path 1: rubber-band
        if (this._rubberBandAnchor) {
            this._updateRubberBandSelection(mouseData.clientX, mouseData.clientY)
            return
        }

        // Path 2: text selection extension
        if (!this.anchor.isSet) return
        const point = caretPointFromCoordinates(mouseData.clientX, mouseData.clientY, this._wsaEl!)
        if (!point) return
        if (!this._canExtendTo(point)) return

        this.focus.copyFrom(point)
        this._resolved = null
    }

    private _handleMouseUp(mouseData: MouseEventData): void {
        // workspace-mouse-up always fires due to bubbling — single cleanup point.
        // ALWAYS clear _isDragging first so DM's cleanup and SM's stay coincident.
        this._isDragging = false

        if (this._rubberBandAnchor) {
            this._updateRubberBandSelection(mouseData.clientX, mouseData.clientY)
            this._rubberBandAnchor = null
            return
        }

        if (mouseData.button !== 0) return
        const point = caretPointFromCoordinates(mouseData.clientX, mouseData.clientY, this._wsaEl!)
        if (!point) return
        if (!this._canExtendTo(point)) return

        this.focus.copyFrom(point)
        this._resolved = null
    }

    private _updateRubberBandSelection(x: number, y: number): void {
        if (!this._rubberBandAnchor || !this._wsaEl) return

        const { x: anchorX, y: anchorY, cmdKey } = this._rubberBandAnchor
        const rectLeft   = Math.min(anchorX, x)
        const rectRight  = Math.max(anchorX, x)
        const rectTop    = Math.min(anchorY, y)
        const rectBottom = Math.max(anchorY, y)

        // Hit-test against DragContainer's data-blockid (the visual outer box).
        // ContentArea's inner Tag also carries data-blockid (for text-node walks)
        // — we filter to the outermost match per id by using getBoundingClientRect
        // on the largest matched element (DragContainer wraps ContentArea).
        const blockEls = this._wsaEl.querySelectorAll<HTMLElement>('.drag-container[data-blockid]')
        const overlappingIds = new Set<string>()

        blockEls.forEach(el => {
            const blockId = el.getAttribute('data-blockid')
            if (!blockId) return
            const bounds = el.getBoundingClientRect()
            const overlaps =
                bounds.left   < rectRight  &&
                bounds.right  > rectLeft   &&
                bounds.top    < rectBottom &&
                bounds.bottom > rectTop
            if (overlaps) overlappingIds.add(blockId)
        })

        this._applyRubberBandSelection(overlappingIds, !cmdKey)
    }


    // ── Lifecycle handler ────────────────────────────────────────────────

    private _handleBlur(blockId: string): void {
        const snapshot = readBlockContent(blockId, this._wsaEl!)
        if (!snapshot) return
        this._onContentRefresh?.(snapshot.value, blockId, snapshot.tag)
    }


    // ── Keyboard switch ──────────────────────────────────────────────────
    // SM owns every preventDefault. Component → WSA → SM chain MUST stay synchronous.

    private _handleKeyDown(keyData: KeyEventData): void {
        const cmd = keyData.metaKey || keyData.ctrlKey
        const event = keyData.nativeEvent

        switch (keyData.key) {

            case 'Enter': {
                if (keyData.shiftKey) return    // Shift+Enter = visual line break, native
                event.preventDefault()
                const snapshot = readBlockContent(keyData.blockId, this._wsaEl!)
                if (!snapshot) return
                this._onNewBlock?.(snapshot.value, keyData.blockId, snapshot.tag)
                return
            }

            case 'Tab':
                event.preventDefault()    // suppress focus tab-out
                return

            case 'Backspace': {
                // Only intercept when the contentEditable is empty.
                const target = event.currentTarget as HTMLElement
                if ((target.textContent ?? '').length !== 0) return
                event.preventDefault()
                this._onDeleteBlock?.(keyData.blockId)
                return
            }

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
                this._pasteAtCurrentCaret()
                return

            case 'a':
                if (!cmd) return
                event.preventDefault()
                this._handleSelectAll(keyData.blockId)
                return

            case 'ArrowRight':
                event.preventDefault()
                if (keyData.shiftKey && cmd)        this._handleCmdShiftArrowRight(keyData.blockId)
                else if (keyData.shiftKey)          this._handleShiftArrowRight(keyData.blockId)
                else                                this._handleArrowRight(keyData.blockId)
                return

            case 'ArrowLeft':
                event.preventDefault()
                if (keyData.shiftKey && cmd)        this._handleCmdShiftArrowLeft(keyData.blockId)
                else if (keyData.shiftKey)          this._handleShiftArrowLeft(keyData.blockId)
                else                                this._handleArrowLeft(keyData.blockId)
                return

            case 'ArrowUp':
                event.preventDefault()
                if (keyData.shiftKey && cmd)        this._handleCmdShiftArrowUp(keyData.blockId)
                else if (keyData.shiftKey)          this._handleShiftArrowUp(keyData.blockId)
                else                                this._handleArrowUp(keyData.blockId)
                return

            case 'ArrowDown':
                event.preventDefault()
                if (keyData.shiftKey && cmd)        this._handleCmdShiftArrowDown(keyData.blockId)
                else if (keyData.shiftKey)          this._handleShiftArrowDown(keyData.blockId)
                else                                this._handleArrowDown(keyData.blockId)
                return
        }
    }


    // ── Plain arrow handlers ─────────────────────────────────────────────

    private _handleArrowRight(blockId: string): void {
        this._clearTargetOffset()
        if (this.hasActiveSelection()) { this._collapseToEnd(); return }
        if (!this.focus.isSet) {
            const caret = snapshotBrowserCaret(blockId)
            if (!caret) return
            this.anchor.copyFrom(caret)
            this.focus.copyFrom(caret)
        }
        this._moveCaretRight()
    }

    private _handleArrowLeft(blockId: string): void {
        this._clearTargetOffset()
        if (this.hasActiveSelection()) { this._collapseToStart(); return }
        if (!this.focus.isSet) {
            const caret = snapshotBrowserCaret(blockId)
            if (!caret) return
            this.anchor.copyFrom(caret)
            this.focus.copyFrom(caret)
        }
        this._moveCaretLeft()
    }

    private _handleArrowUp(blockId: string): void {
        if (this.hasActiveSelection()) this._collapseToStart()
        if (!this.focus.isSet) {
            const caret = snapshotBrowserCaret(blockId)
            if (!caret) return
            this.anchor.copyFrom(caret)
            this.focus.copyFrom(caret)
        }
        this._moveCaretUp()
    }

    private _handleArrowDown(blockId: string): void {
        if (this.hasActiveSelection()) this._collapseToEnd()
        if (!this.focus.isSet) {
            const caret = snapshotBrowserCaret(blockId)
            if (!caret) return
            this.anchor.copyFrom(caret)
            this.focus.copyFrom(caret)
        }
        this._moveCaretDown()
    }


    // ── Shift+Arrow handlers (extend within current line) ───────────────

    private _handleShiftArrowRight(blockId: string): void {
        this._clearTargetOffset()
        this._ensureAnchorIsSet(blockId)
        if (this.focus.offset < this.focus.nodeText.length) this.focus.offset++
        this._resolved = null
    }

    private _handleShiftArrowLeft(blockId: string): void {
        this._clearTargetOffset()
        this._ensureAnchorIsSet(blockId)
        if (this.focus.offset > 0) this.focus.offset--
        this._resolved = null
    }


    // ── Cmd+Shift+Arrow handlers (extend to line/document boundary) ─────

    private _handleCmdShiftArrowRight(blockId: string): void {
        this._clearTargetOffset()
        this._ensureAnchorIsSet(blockId)
        if (this.focus.node) this.focus.offset = this.focus.node.length
        this._resolved = null
    }

    private _handleCmdShiftArrowLeft(blockId: string): void {
        this._clearTargetOffset()
        this._ensureAnchorIsSet(blockId)
        this.focus.offset = 0
        this._resolved    = null
    }

    private _handleCmdShiftArrowUp(blockId: string): void {
        this._ensureAnchorIsSet(blockId)
        if (!this._wsaEl) return
        const firstBlockId = this._blockOrder[0]
        if (!firstBlockId) return
        const firstNode = getFirstTextNodeForBlock(firstBlockId, this._wsaEl)
        if (!firstNode) return
        this._setFocusPoint(firstNode, firstBlockId, 0)
        this._resolved = null
    }

    private _handleCmdShiftArrowDown(blockId: string): void {
        this._ensureAnchorIsSet(blockId)
        if (!this._wsaEl) return
        const lastBlockId = this._blockOrder[this._blockOrder.length - 1]
        if (!lastBlockId) return
        const lastNode = getLastTextNodeForBlock(lastBlockId, this._wsaEl)
        if (!lastNode) return
        this._setFocusPoint(lastNode, lastBlockId, lastNode.length)
        this._resolved = null
    }


    // ── Shift+ArrowUp / Shift+ArrowDown ─────────────────────────────────

    private _handleShiftArrowUp(blockId: string): void {
        this._ensureAnchorIsSet(blockId)
        if (!this.anchor.isSet || !this._wsaEl) return

        if (this._targetOffset === null) this._targetOffset = this.focus.offset

        const focusNode = this.focus.node
        const focusBlockIdx = this._blockOrder.indexOf(this.focus.blockId)
        if (focusBlockIdx === -1) return

        const isFirstLineOfFirstBlock = focusBlockIdx === 0 && focusNode && !getPrevTextNodeInBlock(focusNode)
        if (isFirstLineOfFirstBlock) {
            this._targetOffset = 0
            this._extendFocusToBlock(this.focus.blockId, focusNode!)
            return
        }

        const prevInBlock = focusNode ? getPrevTextNodeInBlock(focusNode) : null
        if (prevInBlock) {
            this._extendFocusToBlock(this.focus.blockId, prevInBlock)
            return
        }

        const blockAboveId = this._blockOrder[focusBlockIdx - 1]
        const lastNodeAbove = getLastTextNodeForBlock(blockAboveId, this._wsaEl)
        if (!lastNodeAbove) return
        this._extendFocusToBlock(blockAboveId, lastNodeAbove)
    }

    private _handleShiftArrowDown(blockId: string): void {
        this._ensureAnchorIsSet(blockId)
        if (!this.anchor.isSet || !this._wsaEl) return

        if (this._targetOffset === null) this._targetOffset = this.focus.offset

        const focusNode = this.focus.node
        const focusBlockIdx = this._blockOrder.indexOf(this.focus.blockId)
        if (focusBlockIdx === -1) return

        const isLastLineOfLastBlock =
            focusBlockIdx === this._blockOrder.length - 1 &&
            focusNode &&
            !getNextTextNodeInBlock(focusNode)
        if (isLastLineOfLastBlock) {
            this._targetOffset = focusNode!.length
            this._extendFocusToBlock(this.focus.blockId, focusNode!)
            return
        }

        const nextInBlock = focusNode ? getNextTextNodeInBlock(focusNode) : null
        if (nextInBlock) {
            this._extendFocusToBlock(this.focus.blockId, nextInBlock)
            return
        }

        const blockBelowId = this._blockOrder[focusBlockIdx + 1]
        const firstNodeBelow = getFirstTextNodeForBlock(blockBelowId, this._wsaEl)
        if (!firstNodeBelow) return
        this._extendFocusToBlock(blockBelowId, firstNodeBelow)
    }

    private _extendFocusToBlock(targetBlockId: string, textNode: Text): void {
        const targetText = stripZWS(textNode.data || '')
        const desiredOffset = this._targetOffset ?? this.focus.offset
        const newOffset = Math.min(desiredOffset, targetText.length)
        this._setFocusPoint(textNode, targetBlockId, newOffset)
        this._resolved = null
    }


    // ── Cmd+A — first press selects current block, second press escalates ───

    private _handleSelectAll(blockId: string): void {
        if (!this._wsaEl) return
        this._clearTargetOffset()

        const currentTextNode = getFirstTextNodeForBlock(blockId, this._wsaEl)
        if (!currentTextNode) return
        const currentText = stripZWS(currentTextNode.data || '')

        const isCurrentBlockFullySelected =
            this.anchor.blockId === blockId &&
            this.focus.blockId  === blockId &&
            this.anchor.offset  === 0 &&
            this.focus.offset   >= currentText.length

        if (isCurrentBlockFullySelected && this._blockOrder.length > 1) {
            const firstBlockId = this._blockOrder[0]
            const lastBlockId  = this._blockOrder[this._blockOrder.length - 1]
            const firstNode = getFirstTextNodeForBlock(firstBlockId, this._wsaEl)
            const lastNode  = getLastTextNodeForBlock(lastBlockId, this._wsaEl)
            if (!firstNode || !lastNode) return

            this.anchor.node      = firstNode
            this.anchor.nodeText  = stripZWS(firstNode.data || '')
            this.anchor.blockId   = firstBlockId
            this.anchor.blockType = "content-area"
            this.anchor.offset    = 0

            this._setFocusPoint(lastNode, lastBlockId, lastNode.length)
        } else {
            this.anchor.node      = currentTextNode
            this.anchor.nodeText  = currentText
            this.anchor.blockId   = blockId
            this.anchor.blockType = "content-area"
            this.anchor.offset    = 0

            this._setFocusPoint(currentTextNode, blockId, currentTextNode.length)
        }
        this._resolved = null
    }


    // ── Cross-block highlight pipeline ──────────────────────────────────

    private _rebuildAndRenderSelection(): void {
        if (!this._wsaEl) return

        if (!this.hasActiveSelection()) {
            CSS.highlights.clear()
            return
        }
        if (!this.isSameType) {
            CSS.highlights.clear()
            return
        }

        const isCrossBlock = this.anchor.blockId !== this.focus.blockId
        if (isCrossBlock) this._buildRange()

        this._applyHighlight()
    }

    private _buildRange(): void {
        if (!this._wsaEl) return

        const anchorIdx = this._blockOrder.indexOf(this.anchor.blockId)
        const focusIdx  = this._blockOrder.indexOf(this.focus.blockId)
        if (anchorIdx === -1 || focusIdx === -1) return

        const [startPoint, endPoint] = anchorIdx <= focusIdx
            ? [this.anchor, this.focus]
            : [this.focus,  this.anchor]

        const startIdx = Math.min(anchorIdx, focusIdx)
        const endIdx   = Math.max(anchorIdx, focusIdx)

        const middlePoints: SelectionPoint[] = []
        for (let i = startIdx + 1; i < endIdx; i++) {
            const blockId  = this._blockOrder[i]
            const textNode = getFirstTextNodeForBlock(blockId, this._wsaEl)
            if (!textNode) continue

            const mp = new SelectionPoint()
            mp.node      = textNode
            mp.nodeText  = stripZWS(textNode.data || '')
            mp.blockId   = blockId
            mp.blockType = "content-area"
            mp.offset    = textNode.length    // raw — Range endpoint, ZWS rule
            middlePoints.push(mp)
        }

        this._resolved = {
            start:  startPoint.clone(),
            middle: middlePoints,
            end:    endPoint.clone(),
            type:   "content-area",
        }
    }

    private _applyHighlight(): void {
        CSS.highlights.clear()
        if (!this.hasActiveSelection() || !this._wsaEl) return

        const ranges: Range[] = []
        const isSingleBlock = this.anchor.blockId === this.focus.blockId

        if (isSingleBlock) {
            if (!this.anchor.node || !this.focus.node) return

            if (this.anchor.node === this.focus.node) {
                const startOffset = Math.min(this.anchor.offset, this.focus.offset)
                const endOffset   = Math.max(this.anchor.offset, this.focus.offset)
                if (startOffset === endOffset) return
                const range = new Range()
                range.setStart(this.anchor.node, startOffset)
                range.setEnd(this.anchor.node, endOffset)
                ranges.push(range)
            } else {
                // Anchor and focus in different text nodes within the same block
                const anchorIsBeforeFocus =
                    !!(this.anchor.node.compareDocumentPosition(this.focus.node) & Node.DOCUMENT_POSITION_FOLLOWING)
                const [startNode, startOffset, endNode, endOffset] = anchorIsBeforeFocus
                    ? [this.anchor.node, this.anchor.offset, this.focus.node, this.focus.offset]
                    : [this.focus.node,  this.focus.offset,  this.anchor.node, this.anchor.offset]
                const range = new Range()
                range.setStart(startNode, startOffset)
                range.setEnd(endNode, endOffset)
                ranges.push(range)
            }
        } else {
            if (!this._resolved) return

            if (this._resolved.start.node) {
                const lastNode = getLastTextNodeForBlock(this._resolved.start.blockId, this._wsaEl)
                            ?? this._resolved.start.node
                const range = new Range()
                range.setStart(this._resolved.start.node, this._resolved.start.offset)
                range.setEnd(lastNode, lastNode.length)
                ranges.push(range)
            }

            for (const mp of this._resolved.middle) {
                if (!mp.node) continue
                const lastNode = getLastTextNodeForBlock(mp.blockId, this._wsaEl) ?? mp.node
                const range = new Range()
                range.setStart(mp.node, 0)
                range.setEnd(lastNode, lastNode.length)
                ranges.push(range)
            }

            if (this._resolved.end.node) {
                const firstNode = getFirstTextNodeForBlock(this._resolved.end.blockId, this._wsaEl)
                            ?? this._resolved.end.node
                const range = new Range()
                range.setStart(firstNode, 0)
                range.setEnd(this._resolved.end.node, this._resolved.end.offset)
                ranges.push(range)
            }
        }

        if (ranges.length > 0) {
            CSS.highlights.set("highlight", new Highlight(...ranges))
        }
    }


    // ── Clipboard public API ─────────────────────────────────────────────
    // SM owns clipboard I/O + the in-memory fallback. The payload/plain-text
    // builders live in clipboard.ts (pure); SM just feeds them its state.

    copyToClipboard = async (): Promise<void> => {
        if (!this._wsaEl) return
        if (!this.hasActiveSelection()) return

        // Cross-block selections need a resolved range before the builders run.
        if (this.anchor.blockId !== this.focus.blockId && !this._resolved) this._buildRange()

        const blocks = buildClipboardBlocks(this.anchor, this.focus, this._resolved, this._wsaEl)
        if (blocks.length === 0) return

        const plainText = this.getSelectedText()

        // Keep in-memory copy for browsers that block clipboard.read() (Firefox).
        this._internalClipboard = { blocks, plainText }

        const structuredBlob = new Blob([JSON.stringify(blocks)], { type: CLIPBOARD_CUSTOM_TYPE })
        const plainBlob      = new Blob([plainText],              { type: 'text/plain' })

        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/plain':            plainBlob,
                    [CLIPBOARD_CUSTOM_TYPE]: structuredBlob,
                })
            ])
        } catch {
            try {
                await navigator.clipboard.writeText(plainText)
            } catch (err) {
                console.error('Clipboard write failed:', err)
            }
        }
    }

    pasteFromClipboard = async (): Promise<ClipboardBlockData[]> => {
        // 1. Native structured format
        try {
            const items = await navigator.clipboard.read()
            for (const item of items) {
                if (item.types.includes(CLIPBOARD_CUSTOM_TYPE)) {
                    const blob = await item.getType(CLIPBOARD_CUSTOM_TYPE)
                    return JSON.parse(await blob.text()) as ClipboardBlockData[]
                }
            }
        } catch {
            // clipboard.read() blocked (Firefox) — fall through
        }

        // 2. In-memory fallback (validate against native plain text)
        try {
            const nativePlainText = await navigator.clipboard.readText()
            const inMemoryValid = this._internalClipboard && nativePlainText === this._internalClipboard.plainText
            if (inMemoryValid) return this._internalClipboard!.blocks

            // 3. External plain-text paste — split lines into <p> blocks
            if (!nativePlainText) return []
            return nativePlainText.split('\n').map(line => ({ html: line, tag: 'p' }))
        } catch (err) {
            console.error('Clipboard read failed:', err)
            return []
        }
    }

    // Inserts HTML at the current browser caret. Returns the block id receiving
    // the insertion, or null if there is no active caret.
    insertAtCaret = (html: string): string | null => {
        if (!this._wsaEl) return null
        const browserSelection = window.getSelection()
        if (!browserSelection || browserSelection.rangeCount === 0) return null

        const range   = browserSelection.getRangeAt(0)
        const blockId = blockIdFromNode(range.startContainer, this._wsaEl)

        range.deleteContents()

        if (html) {
            const wrapper = document.createElement('div')
            wrapper.innerHTML = html
            const fragment = document.createDocumentFragment()
            while (wrapper.firstChild) fragment.appendChild(wrapper.firstChild)

            const lastInsertedNode = fragment.lastChild
            range.insertNode(fragment)

            if (lastInsertedNode) {
                range.setStartAfter(lastInsertedNode)
                range.collapse(true)
                browserSelection.removeAllRanges()
                browserSelection.addRange(range)
            }
        }

        return blockId
    }

    private _pasteAtCurrentCaret(): void {
        this.pasteFromClipboard().then(blocks => {
            if (blocks.length === 0) return
            const anchorBlockId = this.insertAtCaret(blocks[0].html)
            if (blocks.length > 1 && anchorBlockId) {
                this._onPastedBlocks?.(anchorBlockId, blocks.slice(1))
            }
        })
    }


    // ── Text extraction (plain-text fallback for getSelected) ────────────

    getSelectedText = (): string => {
        if (!this.hasActiveSelection()) return ""
        return computeSelectedText(this.anchor, this.focus, this._resolved)
    }
}
