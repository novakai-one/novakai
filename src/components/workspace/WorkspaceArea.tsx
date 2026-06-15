//Workspace area gets the content from store.

import { useWorkspaceStore } from '../store/useWorkspaceStore'
import './workspace.css'
import CanvasArea from '../workspace-interactives/CanvasArea/CanvasArea'
import ContentArea from '../workspace-interactives/ContentArea/ContentArea'
import type { TextElement, ContentDataSet } from '../../types/types'
import { useDocumentStorage } from '../../storage/useDocumentStorage'
import type SelectionManager from '../../selection/selectionManager/SelectionManager'
import type { CaretPointParams } from '../../selection/selectionManager/SelectionManager'
interface WorkspaceAreaProps {
    sm: SelectionManager
}


const COMPONENT_REGISTRY = {
    ContentArea,
    CanvasArea,
  }

function buildRoots(nodes: TextElement[]): TextElement[] {
    return nodes
    .filter(node => node.parentId === null)
}


export default function WorkspaceArea({sm}: WorkspaceAreaProps) {
    const { activeFile, content: contentDataSet, setContent } = useWorkspaceStore()
    const { saveContentData } = useDocumentStorage()
    
    
    if(!activeFile) return
    if(!contentDataSet) return
    
    const { content: contentKeys } = activeFile
    const fileContents: TextElement[] = contentKeys.map((item) => contentDataSet[item])

    const roots = buildRoots(fileContents)
    if(!roots) return
    
    
    const handleKeyEvent = ( updatedElement: TextElement, trigger: string ) => {
        
        //save content to storage and update store.
        const updatedData = { [updatedElement.id]: updatedElement }
        const newDataSet: ContentDataSet = {...contentDataSet, ...updatedData  }
        saveContentData(newDataSet)
        setContent(newDataSet);
    }

    //needs the caret position.
    const handleMouseEvent = (caretPoint: CaretPointParams, e: React.MouseEvent) => {
        //need caret pos 
        console.log("Here")
        sm.receiveMouseEvent(caretPoint)
        console.dir(sm)
        console.dir(e)

    }
    
    return (
        <div className="workspace-area">
          {/*  Take the root nodes and turn each of them into a component. Children will be populated iteratively inside component as children willl be passed down.*/ }
           {roots.map((node) => {
            const ComponentToRender = COMPONENT_REGISTRY[node.component as keyof typeof COMPONENT_REGISTRY]
            return <ComponentToRender 
                    contentDataSet={contentDataSet}
                    activeContent={node}
                    cbKeyEvent={handleKeyEvent} 
                    cbMouseEvent={handleMouseEvent}
                    sm={sm}
                    
                    />
           })}
        </div>
    )
}

