// DragManager.ts
// Responsibilities: owns active drag state and moves the dragged container live.
// Pure receiver: WorkspaceArea is the ONLY conduit. DM attaches NO listeners of its own.
// It receives raw mouse events + a trigger and decides what to do based on its OWN state.

import type { MouseEventData, KeyEventData, LifecycleEventData, DocShape } from '../../types/types'

type Position = {
    x: number
    y: number
}

type OnDropCallback = (id: string, finalPosition: Position) => void

export default class DragManager {

    // DM owns all of its state.
    private activeEl: HTMLElement | null = null
    private activeId: string | null = null
    private isDragging: boolean = false

    // offset = distance between mouse and top-left corner of container when drag starts.
    // without this, the container would snap its top-left corner to the mouse position.
    private mouseOffset: Position = { x: 0, y: 0 }

    // last workspace-local position written during the active drag -> handed to onDrop.
    // Initialized in beginDrag from the container's CURRENT position so a click
    // without movement preserves the existing layout (was snapping to 0,0).
    private lastLocal: Position = { x: 0, y: 0 }

    // True once moveActive has applied at least one position update.
    // endDrag skips onDrop when false — a bare click on the handle is not a drop.
    private hasMoved: boolean = false

    // Horizontal movement is DISABLED for now — blocks are a single column pinned
    // to PAGE_X (see DragContainer). Dragging only reorders vertically. Flip to
    // false to re-enable free x once the collision manager + resizing exist.
    private lockX: boolean = true

    // WorkspaceArea hands DM the workspace element ONCE on mount.
    // DM measures it live on every move so scroll/resize never makes it stale.
    private workspaceEl: HTMLElement | null = null
    private onDrop: OnDropCallback | null = null


    // WorkspaceArea calls this on mount to give DM the workspace element.
    setWorkspaceEl = (el: HTMLElement | null): void => {
        this.workspaceEl = el
    }


    // WorkspaceArea passes its drop handler so DM can notify it when a drag ends.
    setOnDropCallback = (callback: OnDropCallback): void => {
        this.onDrop = callback
    }


    // Public entry points -> the ONLY things WorkspaceArea calls.
    // Conduit shape: WSA threads the document shape through every helper. DM does
    // drag side effects (moving the active container live) and returns the shape
    // UNCHANGED — drag commits placement separately via its onDrop callback.
    receiveMouseEvent = (mouseData: MouseEventData, trigger: string, shape: DocShape): DocShape => {
        if(trigger === "drag-handle-mouse-down") this.beginDrag(mouseData)
        if(trigger === "workspace-mouse-move")   this.moveActive(mouseData)
        if(trigger === "workspace-mouse-up")     this.endDrag(mouseData)
        return shape
    }

    // DM ignores keys and lifecycle, but takes them to keep the uniform conduit
    // signature: every helper has the same three receivers.
    receiveKeyEvent = (_keyData: KeyEventData, _trigger: string, shape: DocShape): DocShape => shape
    receiveLifecycleEvent = (_data: LifecycleEventData, _trigger: string, shape: DocShape): DocShape => shape


    // Find the container under the cursor and capture where inside it the mouse grabbed.
    private beginDrag = (mouseData: MouseEventData): void => {
        const target = document.elementFromPoint(mouseData.clientX, mouseData.clientY)
        const el = target?.closest('.drag-container') as HTMLElement | null
        if(!el) return

        const rect = el.getBoundingClientRect()

        this.activeEl = el
        this.activeId = el.id
        this.mouseOffset = {
            x: mouseData.clientX - rect.left,
            y: mouseData.clientY - rect.top,
        }

        // Seed lastLocal with the container's CURRENT workspace-local position so
        // a click-without-move doesn't snap to {0,0} on endDrag. The block is
        // absolute inside the SCROLLED workspace, so its content-space top is
        // rect.top - ws.top + scrollTop (getBoundingClientRect is viewport-space).
        if (this.workspaceEl) {
            const ws = this.workspaceEl.getBoundingClientRect()
            this.lastLocal = {
                x: rect.left - ws.left + this.workspaceEl.scrollLeft,
                y: rect.top  - ws.top  + this.workspaceEl.scrollTop,
            }
        } else {
            this.lastLocal = { x: rect.left, y: rect.top }
        }

        this.hasMoved = false
        this.isDragging = true
    }


    // The guard lives here -> DM decides whether a move matters.
    // Live-measure the workspace every move so the local coords are always correct.
    private moveActive = (mouseData: MouseEventData): void => {
        if(!this.isDragging || !this.activeEl || !this.workspaceEl) return

        const ws = this.workspaceEl.getBoundingClientRect()

        // .drag-container is absolute inside the relative, SCROLLABLE .workspace-area.
        // style.top is content-space (scrolls with the page), so convert the
        // viewport cursor to content-space: subtract ws.top, add scrollTop. Without
        // the scroll term a drop while scrolled lands near the top of the doc and
        // shoves everything above it down.
        let localX = mouseData.clientX - this.mouseOffset.x - ws.left + this.workspaceEl.scrollLeft
        let localY = mouseData.clientY - this.mouseOffset.y - ws.top  + this.workspaceEl.scrollTop

        // clamp to the scrollable content bounds (not just the visible window).
        localX = Math.max(0, Math.min(localX, this.workspaceEl.scrollWidth  - this.activeEl.offsetWidth))
        localY = Math.max(0, Math.min(localY, this.workspaceEl.scrollHeight - this.activeEl.offsetHeight))

        // X locked → leave style.left to CSS (PAGE_X) and keep the seeded x in
        // lastLocal so the drop preserves it. Only top moves.
        if (!this.lockX) {
            this.activeEl.style.left = `${localX}px`
        } else {
            localX = this.lastLocal.x
        }
        this.activeEl.style.top = `${localY}px`

        this.lastLocal = { x: localX, y: localY }
        this.hasMoved = true
    }


    // Hand the final workspace-local position to WorkspaceArea, then reset.
    // Only fire onDrop if the user actually moved — a bare click on the handle
    // is not a layout commit.
    private endDrag = (_mouseData: MouseEventData): void => {
        if(!this.isDragging || !this.activeId) return

        if(this.onDrop && this.hasMoved) {
            this.onDrop(this.activeId, this.lastLocal)
        }

        this.cleanup()
    }


    // Reset state. No listeners to remove -> DM never attached any.
    private cleanup = (): void => {
        this.activeEl = null
        this.activeId = null
        this.isDragging = false
        this.hasMoved = false
        this.mouseOffset = { x: 0, y: 0 }
        this.lastLocal = { x: 0, y: 0 }
    }
}
