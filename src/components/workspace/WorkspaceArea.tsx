import { useWorkspaceStore } from '../store/useWorkspaceStore'
import './workspace.css'
import CanvasArea from '../workspace-interactives/CanvasArea/CanvasArea'
import ContentArea from '../workspace-interactives/ContentArea/ContentArea'
import type { ReactElement } from 'react'


//workspace represents the middle body - canvas or page

export default function WorkspaceArea() {
    const { activeContent } = useWorkspaceStore()

    const handleKeyEvent = (event: KeyboardEvent, ) => {
        //need to get the id of content.
    }
    
    return (
        <div className="workspace-area">
            {activeContent?.component === "canvas" 
            ? <CanvasArea /> 
            : <ContentArea Tag="p" id="content-1" >{activeContent?.workspaceContent}</ContentArea>
        }
        </div>
    )
}