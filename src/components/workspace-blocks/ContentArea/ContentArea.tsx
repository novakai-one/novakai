import { useEffect, useRef, useState } from 'react'
import type {
    ContentDataSet,
    TextElement,
    MouseEventData,
    KeyEventData,
    LifecycleEventData,
} from '../../../types/types'
import './content-area.css'


// Per-tag hint shown in an empty block so freshly-added blocks are visible and
// the user knows where to type. Plain <p> gets the generic prompt.
const PLACEHOLDERS: Record<string, string> = {
    h1: 'Heading 1',
    h2: 'Heading 2',
    h3: 'Heading 3',
    blockquote: 'Quote',
    p:  'Write something…',
}


interface ContentAreaProps {
    activeContent: TextElement,
    contentDataSet: ContentDataSet,
    cbMouseEvent:     (mouseData: MouseEventData, trigger: string) => void,
    cbKeyboardEvent:  (keyData: KeyEventData, trigger: string) => void,
    cbLifecycleEvent: (lifecycleData: LifecycleEventData, trigger: string) => void,
}


export default function ContentArea({
    activeContent,
    contentDataSet,
    cbMouseEvent,
    cbKeyboardEvent,
    cbLifecycleEvent,
}: ContentAreaProps) {
    const { Tag, innerContent, id, classNames, children, component } = activeContent
    const contentRef = useRef<HTMLElement>(null)

    // Drives the empty-block placeholder. Tracked in React (not via :empty) because
    // focusing an empty editable injects a zero-length text node, which would
    // defeat the :empty selector. Leaf blocks only — a block with nested children
    // is never "empty".
    const isLeaf = !children || children.length === 0
    const [isEmpty, setIsEmpty] = useState(isLeaf && innerContent.trim() === '')

    // Seed the editable on mount. innerText (not innerHTML) is mandatory:
    // SM persists via innerText too, so the round-trip stays consistent. Using
    // innerHTML here would render saved <br> tags as literal text on the next
    // mount. See SelectionManager._readBlockContent for the symmetric read.
    useEffect(() => {
        if (!contentRef.current) return
        contentRef.current.innerText = innerContent
    }, [])

    // Keep the placeholder in sync as the user types. textContent (not innerText)
    // is the cheap read here; we only care whether anything is there.
    const handleInput = () => {
        if (!isLeaf) return
        const text = contentRef.current?.textContent ?? ''
        setIsEmpty(text.length === 0)
    }


    // Mouse, keyboard, lifecycle bodies — built in the body, never inline in
    // JSX. ContentArea stays dumb: it just shapes the payload and forwards.
    // SM owns every decision (and every preventDefault).
    const handleMouseEvent = (e: React.MouseEvent, trigger: string) => {
        const mouseData: MouseEventData = {
            clientX:  e.clientX,
            clientY:  e.clientY,
            blockId:  id,
            blockType: component,
            shiftKey: e.shiftKey,
            metaKey:  e.metaKey,
            ctrlKey:  e.ctrlKey,
            altKey:   e.altKey,
            button:   e.button,
            buttons:  e.buttons,
        }
        cbMouseEvent(mouseData, trigger)
    }

    const handleKeyboardEvent = (e: React.KeyboardEvent, trigger: string) => {
        // nativeEvent is the live React event — SM owns preventDefault, so the
        // chain CA → WSA → SM must stay synchronous (no setTimeout / Promise.then).
        const keyData: KeyEventData = {
            key:       e.key,
            shiftKey:  e.shiftKey,
            metaKey:   e.metaKey,
            ctrlKey:   e.ctrlKey,
            altKey:    e.altKey,
            blockId:   id,
            blockType: component,
            nativeEvent: e,
        }
        cbKeyboardEvent(keyData, trigger)
    }

    const handleLifecycleEvent = (trigger: string) => {
        console.log(trigger) //to get around Supabase error
        // Lifecycle events carry no DOM event reference — SM reads th
        // e live DOM itself.
        /* commented out 19th June to see if anything breaks. Seems unnecessary
        const lifecycleData: LifecycleEventData = {
            blockId:   id,
            blockType: component,
        }
        cbLifecycleEvent(lifecycleData, trigger)
        */
    }


    return (
        <div className="content-area">
            <Tag
                ref={contentRef as React.Ref<never>}
                id={id}
                data-blockid={id}
                data-empty={isEmpty ? "true" : undefined}
                data-placeholder={PLACEHOLDERS[Tag as string] ?? PLACEHOLDERS.p}
                className={classNames}
                contentEditable={true}
                suppressContentEditableWarning={true}
                onInput={handleInput}
                onMouseDown={(event) => handleMouseEvent(event, "content-area-mouse-down")}
                onMouseUp={(event)   => handleMouseEvent(event, "content-area-mouse-up")}
                onClick={(event)     => handleMouseEvent(event, "content-area-click")}
                onKeyDown={(event)   => handleKeyboardEvent(event, "keydown")}
                onKeyUp={(event)     => handleKeyboardEvent(event, "keyup")}
                onBlur={()           => handleLifecycleEvent("content-area-blur")}
            >
                {children?.map((child) => {
                    const childNode = contentDataSet[child]
                    return (
                        <ContentArea
                            key={child}
                            activeContent={childNode}
                            contentDataSet={contentDataSet}
                            cbMouseEvent={cbMouseEvent}
                            cbKeyboardEvent={cbKeyboardEvent}
                            cbLifecycleEvent={cbLifecycleEvent}
                        />
                    )
                })}
            </Tag>
        </div>
    )
}
