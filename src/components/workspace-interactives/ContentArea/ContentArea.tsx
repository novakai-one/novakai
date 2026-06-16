import { useEffect, useRef } from 'react'
import './content-area.css'
import type { ContentDataSet, TextElement } from '../../../types/types'
import type { MouseEventData } from '../../../selection/selectionManager/SelectionManager'


interface ContentAreaProps {
    activeContent: TextElement,
    contentDataSet: ContentDataSet,
    cbKeyEvent: (updatedElement: TextElement, trigger: string) => void,
    cbMouseEvent: (mouseData: MouseEventData, trigger: string) => void,
}


export default function ContentArea({ activeContent, contentDataSet, cbKeyEvent, cbMouseEvent }: ContentAreaProps) {
    const { Tag, innerContent, id, classNames, children, component } = activeContent
    const contentRef = useRef<HTMLElement>(null)

    useEffect(() => {
        if(!contentRef.current) return
        contentRef.current.innerText = innerContent
    }, [])


    //Pass events up to workspace -> CA stays dumb. No decisions, no construction.
    const handleKeyEvent = (e: React.KeyboardEvent<Element>, trigger: string) => {
        const target = e.currentTarget as HTMLElement
        const updatedElement: TextElement = {
            ...activeContent, innerContent: target.innerText
        }
        cbKeyEvent(updatedElement, trigger)
    }


    //Hand up raw mouse coords + own identity (id, component type). 
    //SM will do caretPositionFromPoint + childNode indexing once it has this.
    //One mouse callback, trigger string distinguishes the event -> mirrors key event shape.
    const handleMouseEvent = (e: React.MouseEvent, trigger: string) => {
        const mouseData: MouseEventData = {
            clientX: e.clientX,
            clientY: e.clientY,
            blockId: id,
            blockType: component,
        }
        cbMouseEvent(mouseData, trigger)
    }


    return (
        <div className="content-area">
            <Tag
                ref={contentRef as React.Ref<never>}
                id={id}
                className={classNames}
                contentEditable={true}
                onKeyUp={(event) => handleKeyEvent(event, "keyUp")}
                onClick={(event) => handleMouseEvent(event, "click")}
                
            >
                {children?.map((child) => {
                    const childNode = contentDataSet[child]
                    return <ContentArea
                        activeContent={childNode}
                        contentDataSet={contentDataSet}
                        cbKeyEvent={cbKeyEvent}
                        cbMouseEvent={cbMouseEvent}
                    />
                })}
            </Tag>
        </div>
    )
}