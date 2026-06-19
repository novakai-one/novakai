// useWorkspacePointerBridge.ts
//
// Wires document-level mousemove / mouseup into WSA's conduit while WSA is
// mounted.
//
// These two MUST be on document, not the workspace div. If the user releases
// the mouse (or drags) outside the workspace, React's onMouseUp on the div
// never fires — DM would stay isDragging=true, SM would stay _isDragging=true,
// and rubber-band selection would spread across the page. mousedown stays
// React-side on the div (the in-workspace gesture entrypoint).
//
// The bridge does NO logic: it shapes the native event and hands (data, trigger)
// to the single forward callback WSA passes in (its router). Every helper gates
// cheaply when nothing is active.

import { useEffect } from 'react'
import type { MouseEventData } from '../../types/types'


type ForwardMouse = (data: MouseEventData, trigger: string) => void


export function useWorkspacePointerBridge(forward: ForwardMouse): void {
    useEffect(() => {
        const onMouseMove = (e: MouseEvent) => forward(mouseEventDataFrom(e), "workspace-mouse-move")
        const onMouseUp   = (e: MouseEvent) => forward(mouseEventDataFrom(e), "workspace-mouse-up")

        document.addEventListener('mousemove', onMouseMove)
        document.addEventListener('mouseup',   onMouseUp)
        return () => {
            document.removeEventListener('mousemove', onMouseMove)
            document.removeEventListener('mouseup',   onMouseUp)
        }
    }, [forward])
}


// Build the shared MouseEventData shape from a native or React mouse event.
// blockId / blockType are empty here — workspace-level events carry no block.
export function mouseEventDataFrom(e: MouseEvent | React.MouseEvent): MouseEventData {
    return {
        clientX: e.clientX,
        clientY: e.clientY,
        blockId: "",
        blockType: "",
        shiftKey: e.shiftKey,
        metaKey:  e.metaKey,
        ctrlKey:  e.ctrlKey,
        altKey:   e.altKey,
        button:   e.button,
        buttons:  e.buttons,
    }
}
