//use markup to fill in content.

import { useRef, type HTMLElementType } from 'react'
import './content-area.css'



interface ContentAreaProps{
    children?: string,
    Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "p" | "span",
    id: string
}

export default function ContentArea({children, Tag, id}: ContentAreaProps){
    
    //need to save data as I go.
    const handleKeyEvent = (event: React.KeyboardEvent) => {
        //on key event update the stored saved data.
        //give this back to whoever called it.
    }

    const contentRef = useRef<HTMLParagraphElement | HTMLHeadingElement>(null);
    

    return (
        <div>
            
            <Tag 
            ref={contentRef}
            className="content-area"
            contentEditable={true}
            onKeyUp={handleKeyEvent}

             >{children}</Tag>
             
        </div>
    )
}