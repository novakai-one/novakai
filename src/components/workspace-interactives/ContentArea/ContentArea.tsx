//use markup to fill in content.

import { useEffect, useRef, type HTMLElementType, type KeyboardEventHandler } from 'react'
import './content-area.css'
import type { ContentDataSet, TextElement, Tag } from '../../../types/types'


interface ContentAreaProps {
    activeContent: TextElement,
    contentDataSet: ContentDataSet,
    cbKeyEvent: (updatedElement: TextElement, trigger: string) => void
}


export default function ContentArea( {activeContent, contentDataSet, cbKeyEvent }: ContentAreaProps) {
    const {Tag, innerContent, id, classNames, children} = activeContent
    const contentRef = useRef<HTMLElement>(null);
    useEffect(() => {
        if(!contentRef.current)return
        contentRef.current.innerText = innerContent
    },[])
    
    

    
    //Pass all events up to workspace -> Leave ContentArea dumb regarding decisions.
    const handleKeyEvent = (e: React.KeyboardEvent<Element>, trigger: string) => {
        console.dir(e)
        //need to pass up x and y
        const w = window.getSelection()
        if(!w) return
        const { anchorOffset, focusOffset } = w
     
        
        //const caret = document.caretPositionFromPoint(e.clientX, e.clientY)
        const target = e.currentTarget as HTMLElement 
        const updatedElement: TextElement = {
         ...activeContent, innerContent: target.innerText
        }

        cbKeyEvent(updatedElement, trigger)
        
    }

    

    return (
        <div className="content-area">
            <Tag 
            ref={contentRef as React.Ref<never>}
            id={id}
            className={classNames}
            contentEditable={true}
            onKeyUp={(event) => handleKeyEvent(event, "keyUp")}
            
            >
                
                {children?.map((child) => {
                    const childNode = contentDataSet[child]
                    return <ContentArea 
                        activeContent={childNode}
                        contentDataSet={contentDataSet} 
                        cbKeyEvent={cbKeyEvent}
                        />
                })}
            </Tag>
        </div>
    )
}