// DragContainer — absolutely-positioned wrapper around one block.
// Owns: position (inline top from saved layout), the drag handle, and the
// block-level selection ring (.is-selected, toggled from the committed shape).
// Does NOT own content layout (columns, nesting) — that's the inner ContentArea.
//
// Top ownership: during an active drag, DragManager writes style.top straight to
// this node. React must not also write top, or a commit mid-drag (a debounced
// save landing, a selection change) re-renders this block and snaps it back to
// the stale stored y — the teleport bug. So this component asks DM whether it is
// the active drag target and, if so, omits top entirely. DM is then the single
// owner of top for the gesture. On drop DM clears its active state BEFORE the
// commit re-renders, so top resumes from the freshly committed layout with no
// race and no dependence on event ordering.

import DragHandle from '../dragHandle/DragHandle'
import type { DragContainerProps } from '../../../../types/types'
import { PAGE_X } from '../../../../managers/layout/grid/grid'
import './drag-container.css'


// @flowmap-node dragContainer kind=component
export default function DragContainer({
    id,
    children,
    cbMouseEvent,
    layoutData,
    isSelected,
    dm,
}: DragContainerProps) {
    // CSS owns position:absolute and left (PAGE_X, single-column). top comes from
    // saved layout EXCEPT while this block is the active drag target, when DM owns
    // it directly on the DOM. Fallback 50 covers the window before a saved layout.
    // @flowmap-node dragContainer__topGuard kind=function
    const draggingThis = dm?.isDragging(id) ?? false
    const style: React.CSSProperties = draggingThis
        ? { left: PAGE_X }
        : { left: PAGE_X, top: layoutData?.y ?? 50 }

    const className = `drag-container${isSelected ? " is-selected" : ""}`

    return (
        <div
            className={className}
            id={id}
            data-blockid={id}
            style={style}
        >
            {/* Container hands the conduit straight down — never decides, never wraps. */}
            <DragHandle id={id} cbMouseEvent={cbMouseEvent} />
            {/* @flowmap-node dragContainer__content kind=component */}
            {children}
        </div>
    )
}
