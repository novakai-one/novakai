//use markup to fill in content.

import { useEffect, useRef, type HTMLElementType, type KeyboardEventHandler } from 'react'
import './content-area.css'
import type { ContentDataSet, TextElement} from '../../../types/types'
import type SelectionManager from '../../../selection/selectionManager/SelectionManager'
import type { CaretPointParams } from '../../../selection/selectionManager/SelectionManager'


interface ContentAreaProps {
    activeContent: TextElement,
    contentDataSet: ContentDataSet,
    cbKeyEvent: (updatedElement: TextElement, trigger: string) => void,
    cbMouseEvent:(caretPoint: CaretPointParams, e: React.MouseEvent) => void,
    sm: SelectionManager
}


export default function ContentArea( {activeContent, contentDataSet, cbKeyEvent, sm, cbMouseEvent }: ContentAreaProps) {
    const {Tag, innerContent, id, classNames, children} = activeContent
    const contentRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if(!contentRef.current)return
        contentRef.current.innerText = innerContent
    },[])
    
    

    
    //Pass all events up to workspace -> Leave ContentArea dumb regarding decisions.
    const handleKeyEvent = (e: React.KeyboardEvent<Element>, trigger: string) => {
        
        //need to pass up x and y - might not be true as x and y could change.
        const w = window.getSelection()
        if(!w) return
        //const { anchorOffset, focusOffset } = w
        //console.dir(anchorOffset, focusOffset)
        
        //const caret = document.caretPositionFromPoint(e.clientX, e.clientY)
        const target = e.currentTarget as HTMLElement 
        const updatedElement: TextElement = {
         ...activeContent, innerContent: target.innerText
        }

        cbKeyEvent(updatedElement, trigger)
        
    }

    
    interface CaretPointProps {
        //can I place it via x and y -> when i move to absolute positioning.
        childNodeIndex: number,
        node: Text | HTMLBRElement,
        caretOffset: number
    }
    
    
    //To be moved to selection manager object
    const createCaretPoint = ({childNodeIndex, node, caretOffset}: CaretPointProps): CaretPointParams => {
        //When re-rendering I will be able to find blockId, then get to the childNode and then place offset.
        const caretPosition: CaretPointParams = {
            blockType: "ContentArea",
            blockId: id,
            childNodeIndex,
            node,
            caretOffset,
        }
        return caretPosition;
    }

    //handleCLick needs to pass up the object data that WorkspaceArea needs.
    //WSA needs the SelecitonPointData for the SM && event data to decide what to do.
    //For now this is the wrong spot but it's workable. For when I move it - just note that clientX and clientY need to be passed up
    //as the event wont accurately capture x and y one it moves up.
    
    const handleClick = (e: React.MouseEvent) => {
        const caretPosition = document.caretPositionFromPoint(e.clientX, e.clientY)
        if(!caretPosition) return
        const node: any = caretPosition?.offsetNode
        if(!node) return
        
        const length = node.length
        
        //find the node location climbing parent.
        const childNodes = (node.parentNode?.childNodes)
        if(!childNodes) return
        
        const indexed = Array.from(childNodes)
        
        //This is the location that will be stored so I can find the Text node within HTMLElement on re-render
        const childNodeIndex = indexed.indexOf(node,0)
        
        const caretOffset = caretPosition.offset
        const caretPoint = createCaretPoint({childNodeIndex, node, caretOffset})
        cbMouseEvent(caretPoint, e)

    }

    

    return (
        <div className="content-area">
            <Tag 
            ref={contentRef as React.Ref<never>}
            id={id}
            className={classNames}
            contentEditable={true}
            onKeyUp={(event) => handleKeyEvent(event, "keyUp")}
            onClick={handleClick}
            
            >
                
                {children?.map((child) => {
                    const childNode = contentDataSet[child]
                    return <ContentArea 
                        activeContent={childNode}
                        contentDataSet={contentDataSet} 
                        cbKeyEvent={cbKeyEvent}
                        cbMouseEvent={cbMouseEvent}
                        sm={sm}
                        />
                })}
            </Tag>
        </div>
    )
}