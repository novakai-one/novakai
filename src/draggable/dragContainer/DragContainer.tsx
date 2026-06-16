/*
responsibilities; Dragging. Resizing. Positioning.
Does not control the content layout e.g. columns. This is beyond scope.

*/

import './drag-container.css'
import DragHandle from '../dragHandle/DragHandle'
import {useRef} from 'react'
import type { COMPONENT_REGISTRY } from '../../types/types'
//actually might not know its own positioning like this.
type LayoutData = {
    x: number,
    y: number,
    w: number,
    h: number
}

interface DragContainerProps {
    dragHandleIcon: string, //have a record to extract these from 
    children:  React.ReactNode,//COMPONENT_REGISTRY,
    id?: number,
    styles?: string,
    draggable?: boolean,
    resizable?: boolean,
    scrollable?: boolean,
    dragHandlePos?: "N" | "W", //start with 2 options to keep flexbox direction simple.
}

interface DragContainerPropsxx {
    
}

export default function DragContainer(props: DragContainerProps) {
    const dragRef = useRef<HTMLDivElement>(null)
    const { dragHandleIcon, children } = props
    //container needs x y w h 
    //id 
    
    const handleClick = (e: React.MouseEvent) => {
        console.dir(e)
        dragRef.current.style.x

    }

    

    return (
        <div className="drag-container" id="1"
            ref={dragRef}
            onClick={handleClick}>
            <DragHandle id="1">
                {dragHandleIcon}
            </DragHandle>
            {children}
        </div>
    )
}