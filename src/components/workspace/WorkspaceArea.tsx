import { useWorkspaceStore } from '../store/useWorkspaceStore'
import './workspace.css'
import CanvasArea from '../workspace-interactives/CanvasArea/CanvasArea'
import ContentArea from '../workspace-interactives/ContentArea/ContentArea'
import type { TextElement, ContentDataSet } from '../../types/types'
import { useDocumentStorage } from '../../storage/useDocumentStorage'
import type SelectionManager from '../../selection/selectionManager/SelectionManager'
import type { MouseEventData } from '../../selection/selectionManager/SelectionManager'
import DragContainer from '../../draggable/dragContainer/DragContainer'


interface WorkspaceAreaProps {
    sm: SelectionManager
}


const COMPONENT_REGISTRY = {
    ContentArea,
    CanvasArea,
}


function buildRoots(nodes: TextElement[]): TextElement[] {
    return nodes.filter(node => node.parentId === null)
}


export default function WorkspaceArea({ sm }: WorkspaceAreaProps) {
    const { activeFile, content: contentDataSet, setContent } = useWorkspaceStore()
    const { saveContentData } = useDocumentStorage()

    if(!activeFile) return
    if(!contentDataSet) return

    const { content: contentKeys } = activeFile
    const fileContents: TextElement[] = contentKeys.map((item) => contentDataSet[item])

    const roots = buildRoots(fileContents)
    if(!roots) return


    const handleKeyEvent = (updatedElement: TextElement, trigger: string) => {
        //Save content to storage and update store.
        const updatedData = { [updatedElement.id]: updatedElement }
        const newDataSet: ContentDataSet = { ...contentDataSet, ...updatedData }
        saveContentData(newDataSet)
        setContent(newDataSet)
    }


    //WSA is the conduit -> CA never touches SM directly.
    //Just forward the raw mouse data + trigger to SM's public method.
    const handleMouseEvent = (mouseData: MouseEventData, trigger: string) => {
        sm.receiveMouseEvent(mouseData, trigger)
        console.dir(sm)
    }


    return (
        <div className="workspace-area">
            <DragContainer 
                dragHandleIcon=". . ."
                >
                <p>Drag me</p>
            </DragContainer>
            {/* Take the root nodes and turn each of them into a component. */}
            {roots.map((node) => {
                const ComponentToRender = COMPONENT_REGISTRY[node.component as keyof typeof COMPONENT_REGISTRY]
                return <ComponentToRender
                    contentDataSet={contentDataSet}
                    activeContent={node}
                    cbKeyEvent={handleKeyEvent}
                    cbMouseEvent={handleMouseEvent}
                    
                />
            })}
        </div>
    )
}