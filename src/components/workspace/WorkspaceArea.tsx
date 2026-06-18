import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useDocumentStorage } from '../../storage/useDocumentStorage'
import { COMPONENT_REGISTRY, type ComponentRegistryKey } from '../../types/registry'
import type {
    TextElement,
    ContentDataSet,
    FilesDataSet,
    FileData,
    LayoutDataSet,
    LayoutItem,
    MouseEventData,
    KeyEventData,
    LifecycleEventData,
} from '../../types/types'
import { layoutKey } from '../../types/types'
import type SelectionManager from '../../selection/selectionManager/SelectionManager'
// ClipboardBlockData stays on SM (it's a helper-owned payload, not a shared component type).
import type { ClipboardBlockData } from '../../selection/selectionManager/SelectionManager'
import type DragManager from '../../draggable/dragManager/DragManager'
import DragContainer from '../../draggable/dragContainer/DragContainer'
import './workspace.css'


interface WorkspaceAreaProps {
    sm: SelectionManager,
    dm: DragManager,
}

// Defaults for blocks created from Enter / paste (pixels — react-dev is not grid based).
const NEW_BLOCK_DEFAULT_W = 400
const NEW_BLOCK_DEFAULT_H = 80
const NEW_BLOCK_DEFAULT_X = 50
const NEW_BLOCK_VERTICAL_GAP = 16   // pixels between source and new block

// Single space so the editable mounts with a text node (caret target). Pure
// "" would render a child-less element, defeating min-height and confusing
// caretPositionFromPoint until focusBlockStart fixes it up.
const NEW_BLOCK_CONTENT = " "


function buildRoots(nodes: TextElement[]): TextElement[] {
    return nodes.filter(node => node.parentId === null)
}


export default function WorkspaceArea({ sm, dm }: WorkspaceAreaProps) {
    // Selectors instead of a full-state destructure — keeps WSA out of the
    // re-render loop when unrelated fields change.
    const activeFile      = useWorkspaceStore(s => s.activeFile)
    const files           = useWorkspaceStore(s => s.files)
    const contentDataSet  = useWorkspaceStore(s => s.content)
    const layouts         = useWorkspaceStore(s => s.layouts)
    const setContent      = useWorkspaceStore(s => s.setContent)
    const setLayouts      = useWorkspaceStore(s => s.setLayouts)
    const setActiveFile   = useWorkspaceStore(s => s.setActiveFile)
    const setDataSet      = useWorkspaceStore(s => s.setDataSet)
    const { saveDocument, saveContentData } = useDocumentStorage()
    const wsaRef = useRef<HTMLDivElement>(null)

    // After Enter inserts a new block, this carries the id we need to focus
    // once React has committed the new contentEditable to the DOM. Cleared
    // by the useEffect below as soon as it lands the caret.
    const pendingFocusRef = useRef<string | null>(null)


    // ── SM: workspace element on mount, block order whenever it changes ──

    useEffect(() => {
        sm.setWorkspaceEl(wsaRef.current)
    }, [sm])

    useEffect(() => {
        if (!activeFile) return
        sm.setBlockOrder(activeFile.content)
    }, [sm, activeFile])

    // ── Focus the freshly-created block once it's in the DOM ─────────────
    //
    // Parent effects fire AFTER children, so by the time this runs:
    //  1. React has committed the new block's contentEditable to the DOM
    //  2. ContentArea's mount effect has set innerText (clearing/seeding)
    // focusBlockStart can safely call editable.focus() and place the caret.
    // Using rAF here would be racy under StrictMode and concurrent rendering.
    useEffect(() => {
        if (!pendingFocusRef.current) return
        sm.focusBlockStart(pendingFocusRef.current)
        pendingFocusRef.current = null
    }, [sm, activeFile])


    // ── Block selection store (SM is the source of truth) ───────────────

    const selectedBlockIds = useSyncExternalStore(sm.subscribe, sm.getSelectedBlocksSnapshot)


    // ── Structural callbacks: SM decides; WSA mutates store + persists ──
    //
    // Bodies read latest state via useWorkspaceStore.getState() to dodge stale
    // closures. SM fires these synchronously inside its own gesture handlers.

    useEffect(() => {

        const handleNewBlock = (sourceValue: string, sourceBlockId: string, sourceTag: TextElement['Tag']) => {
            const state = useWorkspaceStore.getState()
            const file  = state.activeFile
            const ds    = state.content
            const fs    = state.files
            const ls    = state.layouts ?? {}
            if (!file || !ds || !fs) return

            const sourceEl = ds[sourceBlockId]
            if (!sourceEl) return

            // Save source's edits first.
            const updatedSource: TextElement = {
                ...sourceEl,
                innerContent: sourceValue,
                Tag: sourceTag,
            }

            // Build the new block immediately below the source. Position now comes
            // from the source's PLACEMENT in this file (layouts), not the block.
            const newId = crypto.randomUUID()
            const sourceLayout = ls[layoutKey(file.id, sourceBlockId)]
            const newY = (sourceLayout?.y ?? NEW_BLOCK_DEFAULT_X) + (sourceLayout?.h ?? NEW_BLOCK_DEFAULT_H) + NEW_BLOCK_VERTICAL_GAP
            const newX = sourceLayout?.x ?? NEW_BLOCK_DEFAULT_X

            const newBlock: TextElement = {
                id: newId,
                component: "ContentArea",
                Tag: sourceTag,
                styles: "",
                classNames: "",
                innerContent: NEW_BLOCK_CONTENT,
                parentId: null,
                children: null,
                files: [],
            }

            // The new block's placement on this file's canvas — its own item.
            const newLayout: LayoutItem = {
                blockId: newId,
                fileId:  file.id,
                x: newX, y: newY, w: NEW_BLOCK_DEFAULT_W, h: NEW_BLOCK_DEFAULT_H,
            }

            const newDataSet: ContentDataSet = { ...ds, [sourceBlockId]: updatedSource, [newId]: newBlock }
            const newLayouts: LayoutDataSet  = { ...ls, [layoutKey(file.id, newId)]: newLayout }

            // Insert directly after source in document order.
            const sourceIdx = file.content.indexOf(sourceBlockId)
            const newContent = sourceIdx === -1
                ? [...file.content, newId]
                : [...file.content.slice(0, sourceIdx + 1), newId, ...file.content.slice(sourceIdx + 1)]

            const updatedFile: FileData = { ...file, content: newContent }
            const updatedFiles: FilesDataSet = { ...fs, [file.id]: updatedFile }

            // Stash the new block's id so the focus effect can pick it up after
            // React commits. See pendingFocusRef declaration for the why.
            pendingFocusRef.current = newId

            saveDocument(updatedFiles, newDataSet, newLayouts)
            setDataSet(updatedFiles, newDataSet, newLayouts)
            setActiveFile(updatedFile)
        }

        const handleDeleteBlock = (blockId: string) => {
            const state = useWorkspaceStore.getState()
            const file  = state.activeFile
            const ds    = state.content
            const fs    = state.files
            const ls    = state.layouts ?? {}
            if (!file || !ds || !fs) return

            const newDataSet: ContentDataSet = { ...ds }
            delete newDataSet[blockId]

            // Drop this file's placement of the block. (Other files' placements,
            // if any, are left intact — that's the point of per-file placements.)
            const newLayouts: LayoutDataSet = { ...ls }
            delete newLayouts[layoutKey(file.id, blockId)]

            const newContent = file.content.filter(id => id !== blockId)
            const updatedFile: FileData = { ...file, content: newContent }
            const updatedFiles: FilesDataSet = { ...fs, [file.id]: updatedFile }

            saveDocument(updatedFiles, newDataSet, newLayouts)
            setDataSet(updatedFiles, newDataSet, newLayouts)
            setActiveFile(updatedFile)
        }

        const handleContentRefresh = (value: string, blockId: string, tag: TextElement['Tag']) => {
            const state = useWorkspaceStore.getState()
            const ds    = state.content
            if (!ds) return
            const el = ds[blockId]
            if (!el) return

            // Skip writes that wouldn't change anything — avoids storm-of-saves on click.
            if (el.innerContent === value && el.Tag === tag) return

            const updated: TextElement = { ...el, innerContent: value, Tag: tag }
            const newDataSet: ContentDataSet = { ...ds, [blockId]: updated }
            saveContentData(newDataSet)
            setContent(newDataSet)
        }

        const handlePastedBlocks = (anchorBlockId: string, blocks: ClipboardBlockData[]) => {
            const state = useWorkspaceStore.getState()
            const file  = state.activeFile
            const ds    = state.content
            const fs    = state.files
            const ls    = state.layouts ?? {}
            if (!file || !ds || !fs) return

            const anchorEl = ds[anchorBlockId]
            if (!anchorEl) return

            const anchorLayout = ls[layoutKey(file.id, anchorBlockId)]
            const baseX = anchorLayout?.x ?? NEW_BLOCK_DEFAULT_X
            let   nextY = (anchorLayout?.y ?? NEW_BLOCK_DEFAULT_X) + (anchorLayout?.h ?? NEW_BLOCK_DEFAULT_H) + NEW_BLOCK_VERTICAL_GAP

            const newLayouts: LayoutDataSet = { ...ls }

            const newBlocks: TextElement[] = blocks.map(b => {
                const id = crypto.randomUUID()
                const geom = b.layout ?? { x: baseX, y: nextY, w: NEW_BLOCK_DEFAULT_W, h: NEW_BLOCK_DEFAULT_H }
                nextY = geom.y + geom.h + NEW_BLOCK_VERTICAL_GAP
                const tag = (b.tag as TextElement['Tag']) || 'p'
                const block: TextElement = {
                    id,
                    component: "ContentArea",
                    Tag: tag,
                    styles: "",
                    classNames: "",
                    innerContent: b.html,
                    parentId: null,
                    children: null,
                    files: [],
                }
                // Placement for this pasted block on the current file's canvas.
                newLayouts[layoutKey(file.id, id)] = { blockId: id, fileId: file.id, ...geom }
                return block
            })

            const newDataSet: ContentDataSet = { ...ds }
            for (const b of newBlocks) newDataSet[b.id] = b

            const anchorIdx = file.content.indexOf(anchorBlockId)
            const insertIds = newBlocks.map(b => b.id)
            const newContent = anchorIdx === -1
                ? [...file.content, ...insertIds]
                : [...file.content.slice(0, anchorIdx + 1), ...insertIds, ...file.content.slice(anchorIdx + 1)]

            const updatedFile: FileData = { ...file, content: newContent }
            const updatedFiles: FilesDataSet = { ...fs, [file.id]: updatedFile }

            saveDocument(updatedFiles, newDataSet, newLayouts)
            setDataSet(updatedFiles, newDataSet, newLayouts)
            setActiveFile(updatedFile)
        }

        sm.registerNewBlockHandler(handleNewBlock)
        sm.registerDeleteBlockHandler(handleDeleteBlock)
        sm.registerContentRefreshHandler(handleContentRefresh)
        sm.registerPastedBlocksHandler(handlePastedBlocks)
    }, [sm, saveDocument, saveContentData, setContent, setDataSet, setActiveFile])


    // ── Document-level mouse listeners ───────────────────────────────────
    //
    // Move + up MUST be on document, not the workspace div. If the user releases
    // the mouse (or drags) outside the workspace, React's onMouseUp on the div
    // never fires — DM stays in isDragging=true and SM stays in _isDragging=true.
    // Rubber-band selection would also spread across the page.
    //
    // The workspace's onMouseDown stays React-side (it's the gesture entrypoint
    // for in-workspace clicks). Move/up bail cheaply when nothing is active:
    // SM gates on buttons!==1, DM gates on !isDragging.

    useEffect(() => {
        const dataFromNative = (e: MouseEvent): MouseEventData => ({
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
        })

        const onDocMouseMove = (e: MouseEvent) => {
            const data = dataFromNative(e)
            sm.receiveMouseEvent(data, "workspace-mouse-move")
            dm.receiveMouseEvent(data, "workspace-mouse-move")
        }
        const onDocMouseUp = (e: MouseEvent) => {
            const data = dataFromNative(e)
            sm.receiveMouseEvent(data, "workspace-mouse-up")
            dm.receiveMouseEvent(data, "workspace-mouse-up")
        }
        document.addEventListener('mousemove', onDocMouseMove)
        document.addEventListener('mouseup',   onDocMouseUp)
        return () => {
            document.removeEventListener('mousemove', onDocMouseMove)
            document.removeEventListener('mouseup',   onDocMouseUp)
        }
    }, [sm, dm])


    // ── DragManager: drop callback (existing — unchanged shape) ──────────

    useEffect(() => {
        dm.setWorkspaceEl(wsaRef.current)
        dm.setOnDropCallback((id, finalLocal) => {
            if (!contentDataSet || !activeFile || !files) return
            const ls = layouts ?? {}
            const key = layoutKey(activeFile.id, id)
            const prev = ls[key]

            // A drop only moves a PLACEMENT — content is untouched. Update (or
            // create) this block's LayoutItem for the active file.
            const updated: LayoutItem = {
                blockId: id,
                fileId:  activeFile.id,
                w: prev?.w ?? 0,
                h: prev?.h ?? 0,
                x: finalLocal.x,
                y: finalLocal.y,
                resizable: prev?.resizable,
                draggable: prev?.draggable,
                locked:    prev?.locked,
            }
            const newLayouts: LayoutDataSet = { ...ls, [key]: updated }

            // Re-order content keys by top-left position (y first, then x),
            // reading geometry from this file's placements.
            const orderedKeys = [...activeFile.content].sort((keyA, keyB) => {
                const a = newLayouts[layoutKey(activeFile.id, keyA)]
                const b = newLayouts[layoutKey(activeFile.id, keyB)]
                const ay = a?.y ?? 50, ax = a?.x ?? 50
                const by = b?.y ?? 50, bx = b?.x ?? 50
                return (ay - by) || (ax - bx)
            })

            const updatedFile = { ...activeFile, content: orderedKeys }
            const updatedFiles = { ...files, [activeFile.id]: updatedFile }

            saveDocument(updatedFiles, contentDataSet, newLayouts)
            setLayouts(newLayouts)
            setActiveFile(updatedFile)
        })
    }, [dm, contentDataSet, activeFile, files, layouts, saveDocument, setLayouts, setActiveFile])


    // ── Conduit: every event from every component flows through these ───
    // WSA is the ONLY place that knows about both SM and DM.

    const handleMouseEvent = (mouseData: MouseEventData, trigger: string) => {
        sm.receiveMouseEvent(mouseData, trigger)
        dm.receiveMouseEvent(mouseData, trigger)
    }

    const handleKeyEvent = (keyData: KeyEventData, trigger: string) => {
        sm.receiveKeyEvent(keyData, trigger)
    }

    const handleLifecycleEvent = (lifecycleData: LifecycleEventData, trigger: string) => {
        sm.receiveLifecycleEvent(lifecycleData, trigger)
    }


    // WSA root's own DOM events — build the shared MouseEventData here, never inline in JSX.
    const handleWorkspaceMouseEvent = (e: React.MouseEvent, trigger: string) => {
        const mouseData: MouseEventData = {
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
        handleMouseEvent(mouseData, trigger)
    }


    // Resolve roots only when the document is loaded. The workspace <div> ALWAYS
    // renders so wsaRef attaches on first commit — SM.setWorkspaceEl(wsaRef.current)
    // would otherwise capture `null` and every key/mouse handler would bail
    // (every SM receive* method early-returns on !_wsaEl).
    const roots: TextElement[] = activeFile && contentDataSet
        ? buildRoots(activeFile.content.map(id => contentDataSet[id]).filter(Boolean))
        : []


    return (
        <div className="workspace-area"
            ref={wsaRef}
            //mousedown only — workspace-mouse-move/up live on document so they
            //fire even when the cursor leaves the workspace mid-gesture.
            onMouseDown={(event) => handleWorkspaceMouseEvent(event, "workspace-mouse-down")}>

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
