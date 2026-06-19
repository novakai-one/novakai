import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useDocumentStorage } from '../../storage/useDocumentStorage'
import { COMPONENT_REGISTRY, type ComponentRegistryKey } from '../../types/registry'
import type {
    TextElement,
    MouseEventData,
    KeyEventData,
    LifecycleEventData,
    FilesDataSet,
    DocShape,
} from '../../types/types'
import { layoutKey } from '../../types/types'
import type SelectionManager from '../../selection/selectionManager/SelectionManager'
import type DragManager from '../../draggable/dragManager/DragManager'
import type BlockManager from '../workspace-blocks/blocks/blockManager'
import type LayoutManager from '../../layout/layoutManager'
import DragContainer from '../../draggable/dragContainer/DragContainer'
import WorkspaceEmptyState from './WorkspaceEmptyState'
import { useWorkspacePointerBridge, mouseEventDataFrom } from './useWorkspacePointerBridge'
import './workspace.css'


interface WorkspaceAreaProps {
    sm: SelectionManager,
    dm: DragManager,
    bm: BlockManager,
    lm: LayoutManager,
}


function buildRoots(nodes: TextElement[]): TextElement[] {
    return nodes.filter(node => node.parentId === null)
}


export default function WorkspaceArea({ sm, dm, bm, lm }: WorkspaceAreaProps) {
    // Selectors instead of a full-state destructure — keeps WSA out of the
    // re-render loop when unrelated fields change.
    const activeFile      = useWorkspaceStore(s => s.activeFile)
    const contentDataSet  = useWorkspaceStore(s => s.content)
    const layouts         = useWorkspaceStore(s => s.layouts)
    const setDataSet      = useWorkspaceStore(s => s.setDataSet)
    const { saveDocument } = useDocumentStorage()
    const wsaRef = useRef<HTMLDivElement>(null)

    // After a create, this carries the id to focus once React has committed the
    // new contentEditable. Cleared by the focus effect below.
    const pendingFocusRef = useRef<string | null>(null)


    // ── Commit: write the shape back, let React diff ─────────────────────────
    // If no helper changed anything the references match the store and we skip
    // the write. Queues focus for any block that appeared this pass.
    const commit = useCallback((shape: DocShape): void => {
        const state = useWorkspaceStore.getState()
        if (!shape.file || !state.files) return
        if (
            shape.contentData === state.content &&
            shape.layoutData === state.layouts &&
            shape.databaseData === state.databases
        ) return

        const prior = state.content ?? {}
        for (const id of Object.keys(shape.contentData)) {
            if (!prior[id]) { pendingFocusRef.current = id; break }
        }

        const updatedFiles: FilesDataSet = { ...state.files, [shape.file.id]: shape.file }
        saveDocument(updatedFiles, shape.contentData, shape.layoutData, shape.databaseData)
        setDataSet(updatedFiles, shape.contentData, shape.layoutData, shape.databaseData)
    }, [saveDocument, setDataSet])


    // ── The conduit: one router, one uniform shape, every helper ─────────────
    // WSA reads its rendered store state into a DocShape, threads it through
    // every helper in a fixed order, and commits whatever comes out. WSA makes
    // NO decision — each helper switches on the trigger and either acts or
    // returns the shape untouched. Order: BlockManager creates/deletes, SM
    // adjusts selection/caret, DM handles drag, LayoutManager tidies last.
    const route = useCallback((
        channel: 'mouse' | 'key' | 'lifecycle',
        data: MouseEventData | KeyEventData | LifecycleEventData,
        trigger: string,
    ): void => {
        const state = useWorkspaceStore.getState()
        if (!state.content) return

        let shape: DocShape = {
            file: state.activeFile,
            contentData: state.content,
            layoutData: state.layouts ?? {},
            databaseData: state.databases ?? {},
        }

        if (channel === 'mouse') {
            const d = data as MouseEventData
            shape = bm.receiveMouseEvent(d, trigger, shape)
            shape = sm.receiveMouseEvent(d, trigger, shape)
            shape = dm.receiveMouseEvent(d, trigger, shape)
            shape = lm.receiveMouseEvent(d, trigger, shape)
        } else if (channel === 'key') {
            const d = data as KeyEventData
            shape = bm.receiveKeyEvent(d, trigger, shape)
            shape = sm.receiveKeyEvent(d, trigger, shape)
            shape = dm.receiveKeyEvent(d, trigger, shape)
            shape = lm.receiveKeyEvent(d, trigger, shape)
        } else {
            const d = data as LifecycleEventData
            shape = bm.receiveLifecycleEvent(d, trigger, shape)
            shape = sm.receiveLifecycleEvent(d, trigger, shape)
            shape = dm.receiveLifecycleEvent(d, trigger, shape)
            shape = lm.receiveLifecycleEvent(d, trigger, shape)
        }

        commit(shape)
    }, [bm, sm, dm, lm, commit])


    // ── Hand the workspace element to the helpers that query the DOM ─────────
    //19th June -> need to check as these might be redundant now that everything flows back through WSA.
    useEffect(() => {
        sm.setWorkspaceEl(wsaRef.current)
        bm.setWorkspaceEl(wsaRef.current)
        dm.setWorkspaceEl(wsaRef.current)
    }, [sm, bm, dm])

    useEffect(() => {
        if (!activeFile) return
        sm.setBlockOrder(activeFile.content)
    }, [sm, activeFile])


    // ── Focus the freshly-created block once it's in the DOM ─────────────────
    // Parent effects fire AFTER children, so React has committed the new block's
    // contentEditable by the time this runs.
    useEffect(() => {
        if (pendingFocusRef.current) {
            sm.focusBlockStart(pendingFocusRef.current)
            pendingFocusRef.current = null
        }
    }, [sm, activeFile])


    // ── Document-level mouse move/up bridge (see hook for why on document) ────
    // The bridge forwards those two triggers straight into the same router.

    const forwardMouse = useCallback(
        (data: MouseEventData, trigger: string) => route('mouse', data, trigger),
        [route],
    )
    useWorkspacePointerBridge(forwardMouse)


    // ── Block selection store (SM is the source of truth) ────────────────────

    const selectedBlockIds = useSyncExternalStore(sm.subscribe, sm.getSelectedBlocksSnapshot)


    // ── DragManager drop: move the placement, then tidy via LayoutManager ────

    useEffect(() => {
        dm.setOnDropCallback((id, finalLocal) => {
            const state = useWorkspaceStore.getState()
            if (!state.activeFile || !state.content) return

            const moved = movePlacement(
                { file: state.activeFile, contentData: state.content, layoutData: state.layouts ?? {}, databaseData: state.databases ?? {} },
                state.activeFile.id, id, finalLocal,
            )

            const tidied = lm.receiveMouseEvent(
                { ...EMPTY_MOUSE, blockId: state.activeFile.id }, "workspace-click", moved,
            )

            commit(tidied)
        })
    }, [dm, lm, commit])


    // ── Thin DOM-event adapters: shape the native event, hand to the router ──
    // No logic beyond shaping. A block's own handlers fire with that block's id;
    // the workspace root fires for canvas events.

    const handleMouseEvent = useCallback(
        (data: MouseEventData, trigger: string) => route('mouse', data, trigger), [route])
    const handleKeyEvent = useCallback(
        (data: KeyEventData, trigger: string) => route('key', data, trigger), [route])
    const handleLifecycleEvent = useCallback(
        (data: LifecycleEventData, trigger: string) => route('lifecycle', data, trigger), [route])

    const handleWorkspaceMouseEvent = (e: React.MouseEvent, trigger: string) => {
        handleMouseEvent(mouseEventDataFrom(e), trigger)
    }

    // Background click → "workspace-click" tagged with the active file id. The
    // target guard is DOM event routing (this handler owns only the canvas, not
    // its children), not a gesture decision — BlockManager owns the create guards.
    const handleWorkspaceClick = (e: React.MouseEvent) => {
        if (e.target !== e.currentTarget) return
        const fileId = useWorkspaceStore.getState().activeFile?.id ?? ""
        handleMouseEvent({ ...mouseEventDataFrom(e), blockId: fileId }, "workspace-click")
    }


    // Resolve roots only when the document is loaded. The workspace <div> ALWAYS
    // renders so wsaRef attaches on first commit.
    const roots: TextElement[] = activeFile && contentDataSet
        ? buildRoots(activeFile.content.map(id => contentDataSet[id]).filter(Boolean))
        : []


    return (
        <div className="workspace-area"
            ref={wsaRef}
            //mousedown only — workspace-mouse-move/up live on document so they
            //fire even when the cursor leaves the workspace mid-gesture.
            onMouseDown={(event) => handleWorkspaceMouseEvent(event, "workspace-mouse-down")}
            //click on empty canvas creates a block at that grid row (see handler).
            onClick={handleWorkspaceClick}>

            {roots.length === 0 && <WorkspaceEmptyState />}

            {contentDataSet && roots.map((node) => {
                const ComponentToRender = COMPONENT_REGISTRY[node.component as ComponentRegistryKey]
                const isSelected = selectedBlockIds.has(node.id)
                return (
                    <DragContainer key={node.id}
                        id={node.id}
                        layoutData={activeFile ? layouts?.[layoutKey(activeFile.id, node.id)] : undefined}
                        isSelected={isSelected}
                        cbMouseEvent={handleMouseEvent}>
                        <ComponentToRender
                            contentDataSet={contentDataSet}
                            activeContent={node}
                            cbMouseEvent={handleMouseEvent}
                            cbKeyboardEvent={handleKeyEvent}
                            cbLifecycleEvent={handleLifecycleEvent}
                        />
                    </DragContainer>
                )
            })}
        </div>
    )
}


// A neutral MouseEventData for synthesising a non-DOM tidy pass (e.g. after a
// drop). Only blockId (the file id) and the trigger matter to LayoutManager.
const EMPTY_MOUSE: MouseEventData = {
    clientX: 0, clientY: 0, blockId: "", blockType: "",
    shiftKey: false, metaKey: false, ctrlKey: false, altKey: false,
    button: 0, buttons: 0,
}


// Move one block's placement to a new workspace-local point on the given file.
// Pure: returns a new shape; LayoutManager tidies overlaps afterwards.
function movePlacement(
    shape: DocShape,
    fileId: string,
    blockId: string,
    finalLocal: { x: number, y: number },
): DocShape {
    const key = layoutKey(fileId, blockId)
    const existing = shape.layoutData[key]
    if (!existing) return shape
    const layoutData = {
        ...shape.layoutData,
        [key]: { ...existing, x: finalLocal.x, y: finalLocal.y },
    }
    return { ...shape, layoutData }
}
