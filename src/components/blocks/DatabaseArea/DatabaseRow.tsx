// DatabaseRow — the per-row draggable wrapper inside a DatabaseArea.
//
// Mirrors DragContainer's ROLE (a draggable wrapper around content with a
// DragHandle) but NOT its geometry: a top-level DragContainer is position:
// absolute and page-pinned, which would rip a row out of the database box. A
// row instead flows vertically inside the table, so it gets its own .db-row
// wrapper. The drag EVENT path is identical — the handle fires the same
// "drag-handle-mouse-down" through the same cbMouseEvent conduit, and
// DragManager finds the dragged element by its .drag-container/.db-row id.
//
// Dumb wrapper: forwards the conduit, renders the handle and the row's cells.
// Owns no logic and no row state.

import DragHandle from '../draggable/dragHandle/DragHandle'
import type { MouseEventData } from '../../../types/types'
import type { TriggerWord } from '../../../types/trigger-words'
import type { ReactNode } from 'react'


interface DatabaseRowProps {
    rowId: string,
    // Inline grid-template-columns built from the schema so the row's cells line
    // up with the header. Passed down rather than recomputed per row.
    gridTemplateColumns: string,
    isSelected?: boolean,
    // The conduit — same shape DragContainer/DragHandle forward. Never decides.
    cbMouseEvent: (mouseData: MouseEventData, trigger: TriggerWord) => void,
    children: ReactNode,
}


export default function DatabaseRow({
    rowId,
    gridTemplateColumns,
    isSelected,
    cbMouseEvent,
    children,
}: DatabaseRowProps) {
    const className = `db-row${isSelected ? ' is-selected' : ''}`

    return (
        <div
            className={className}
            id={rowId}
            data-rowid={rowId}
            data-blockid={rowId}
        >
            {/* Same handle, same conduit, same trigger as a top-level block. */}
            <DragHandle id={rowId} cbMouseEvent={cbMouseEvent} />
            <div className="db-row__cells" style={{ gridTemplateColumns }}>
                {children}
            </div>
        </div>
    )
}
