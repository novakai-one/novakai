import './drag-handle.css'
import type { MouseEventData } from '../../types/types'
import type { TriggerWord } from '../../types/trigger-words'

interface DragHandleProps {
    id: string,
    //the conduit -> handle forwards raw mouse data + trigger, never decides.
    cbMouseEvent: (mouseData: MouseEventData, trigger: TriggerWord) => void,
}

export default function DragHandle({ id, cbMouseEvent }: DragHandleProps) {

    //Hand up raw mouse coords + own identity -> handle just forwards, never decides.
    //One mouse callback, trigger string distinguishes the event -> mirrors ContentArea.
    //The JSX only forwards (event, trigger); all construction happens here in the body.
    const handleMouseEvent = (e: React.MouseEvent, trigger: TriggerWord) => {
        const mouseData: MouseEventData = {
            clientX: e.clientX,
            clientY: e.clientY,
            blockId: id,
            blockType: "",
            shiftKey: e.shiftKey,
            metaKey:  e.metaKey,
            ctrlKey:  e.ctrlKey,
            altKey:   e.altKey,
            button:   e.button,
            buttons:  e.buttons,
            nativeEvent: e,
        }
        cbMouseEvent(mouseData, trigger)
    }

    return (
        <div className="drag-handle"
            id={id}
            //preventDefault here suppresses the browser's native text-selection
            //drag — without it, dragging the handle over text in other blocks
            //extends a blue OS selection across all visible components.
            onMouseDown={(event) => { event.preventDefault(); handleMouseEvent(event, "drag-handle-mouse-down") }}>
            <div className="drag-handle__dots">
                {[...Array(6)].map((_, i) => (
                    <span key={i} className="drag-handle__dot" />
                ))}
            </div>
        </div>
    )
}
