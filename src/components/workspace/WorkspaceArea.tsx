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
import { snapToGrid, GRID_UNIT, PAGE_X, rowsForHeight, heightForRows } from '../../layout/grid'
import { resolveCollisions } from '../../layout/collisionManager'
import { collapseAfterDelete } from '../../layout/layoutManager'
import type SelectionManager from '../../selection/selectionManager/SelectionManager'
// ClipboardBlockData stays on SM (it's a helper-owned payload, not a shared component type).
import type { ClipboardBlockData } from '../../selection/selectionManager/SelectionManager'
import type DragManager from '../../draggable/dragManager/DragManager'
import DragContainer from '../../draggable/dragContainer/DragContainer'
import WorkspaceEmptyState from './WorkspaceEmptyState'
import './workspace.css'


interface WorkspaceAreaProps {
    sm: SelectionManager,
    dm: DragManager,
}

// Defaults for blocks created from Enter / paste (pixels — react-dev is not grid based).
const NEW_BLOCK_DEFAULT_W = 400
const NEW_BLOCK_DEFAULT_H = 80
const NEW_BLOCK_DEFAULT_X = 50
const NEW_BLOCK_VERTICAL_GAP = 6     // pixels between source and new block

// The new block sits below the source's ACTUAL rendered height, not the stored
// layout h (which defaults to 80 and never tracks content — that was the source
// of the huge gap after Enter). Reads the live DragContainer box; falls back to
// the stored h only if the element isn't in the DOM yet.
function measuredBlockHeight(blockId: string, fallback: number): number {
    const el = document.querySelector<HTMLElement>(`.drag-container[data-blockid="${blockId}"]`)
    return el ? el.getBoundingClientRect().height : fallback
}

// Builds the placement list for one file with FRESH, grid-snapped heights read
// from the DOM. CollisionManager/LayoutManager need accurate h, but the stored
// LayoutItem.h is unreliable (defaults to 80, or 0 on drop). Heights don't
// depend on position, so measuring before the re-render is safe.
function measuredItemsForFile(
    fileId: string,
    content: string[],
    layouts: LayoutDataSet,
): LayoutItem[] {
    const items: LayoutItem[] = []
    for (const bid of content) {
        const li = layouts[layoutKey(fileId, bid)]
        if (!li) continue
        // Round to the NEAREST whole row, not up. snapUp turned a 26.0001px block
        // into 52, so the collision pushed the next block a full row too far and
        // left a gap. Round keeps a one-line block at exactly one row → flush.
        const h = heightForRows(rowsForHeight(measuredBlockHeight(bid, li.h || GRID_UNIT)))
        items.push({ ...li, h })
    }
    return items
}

// Runs CollisionManager over one file's placements and folds the resolved items
// back into the full (multi-file) LayoutDataSet. Pure given its inputs.
function resolveFileCollisions(
    fileId: string,
    content: string[],
    layouts: LayoutDataSet,
    movedBlockId: string,
): LayoutDataSet {
    const resolved = resolveCollisions(measuredItemsForFile(fileId, content, layouts), movedBlockId)
    const merged: LayoutDataSet = { ...layouts }
    for (const it of resolved) merged[layoutKey(fileId, it.blockId)] = it
    return merged
}

// Empty so the block shows its placeholder and the caret sits flush left. A
// leading space used to push the first character right, then "snap" back as the
// user typed. Empty is safe: caretPointFromCoordinates (click) and
// focusBlockStart (Enter) both create a text node on demand, and min-height in
// content-area.css keeps the empty block clickable.
const NEW_BLOCK_CONTENT = ""


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

    // Same idea as pendingFocusRef, but lands the caret at the END of the block —
    // used after Backspace deletes an empty block so focus falls to the previous
    // block where the user was heading.
    const pendingFocusEndRef = useRef<string | null>(null)

    // Where the last workspace-background mousedown landed. Used to tell a click
    // (create a block here) apart from a rubber-band drag (don't).
    const bgPointerDownRef = useRef<{ x: number; y: number } | null>(null)


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
        if (pendingFocusRef.current) {
            sm.focusBlockStart(pendingFocusRef.current)
            pendingFocusRef.current = null
        }
        if (pendingFocusEndRef.current) {
            sm.focusBlockEnd(pendingFocusEndRef.current)
            pendingFocusEndRef.current = null
        }
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
            const sourceH = measuredBlockHeight(sourceBlockId, sourceLayout?.h ?? NEW_BLOCK_DEFAULT_H)
            const newY = snapToGrid((sourceLayout?.y ?? NEW_BLOCK_DEFAULT_X) + sourceH + NEW_BLOCK_VERTICAL_GAP)
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
            // h starts at one grid row (an empty block is one line tall) so the
            // collision pass below doesn't over-push using the stale 80px default.
            const newLayout: LayoutItem = {
                blockId: newId,
                fileId:  file.id,
                x: newX, y: newY, w: NEW_BLOCK_DEFAULT_W, h: GRID_UNIT,
            }

            const newDataSet: ContentDataSet = { ...ds, [sourceBlockId]: updatedSource, [newId]: newBlock }

            // Insert directly after source in document order.
            const sourceIdx = file.content.indexOf(sourceBlockId)
            const newContent = sourceIdx === -1
                ? [...file.content, newId]
                : [...file.content.slice(0, sourceIdx + 1), newId, ...file.content.slice(sourceIdx + 1)]

            // A new block wedged between two existing blocks overlaps the one
            // below — resolve so everything below slides down to make room.
            const newLayouts: LayoutDataSet = resolveFileCollisions(
                file.id, newContent, { ...ls, [layoutKey(file.id, newId)]: newLayout }, newId,
            )

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

            // Capture the deleted block's rect BEFORE removing it (it's still in
            // the DOM — Backspace runs synchronously). LayoutManager pulls the
            // blocks below up by this height to close the hole.
            const deletedLayout = ls[layoutKey(file.id, blockId)]
            const deletedY = deletedLayout?.y ?? 0
            const deletedH = heightForRows(rowsForHeight(measuredBlockHeight(blockId, deletedLayout?.h ?? GRID_UNIT)))

            // Drop this file's placement of the block. (Other files' placements,
            // if any, are left intact — that's the point of per-file placements.)
            const strippedLayouts: LayoutDataSet = { ...ls }
            delete strippedLayouts[layoutKey(file.id, blockId)]

            // The block to land the caret on after delete: the one above in
            // document order. None if we just deleted the first block.
            const deletedIdx = file.content.indexOf(blockId)
            const prevBlockId = deletedIdx > 0 ? file.content[deletedIdx - 1] : null
            if (prevBlockId) pendingFocusEndRef.current = prevBlockId

            const newContent = file.content.filter(id => id !== blockId)

            // Pull everything below the hole up by the vacated height.
            const collapsed = collapseAfterDelete(
                measuredItemsForFile(file.id, newContent, strippedLayouts),
                deletedY, deletedH, NEW_BLOCK_VERTICAL_GAP,
            )
            const newLayouts: LayoutDataSet = { ...strippedLayouts }
            for (const it of collapsed) newLayouts[layoutKey(file.id, it.blockId)] = it

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
            const anchorH = measuredBlockHeight(anchorBlockId, anchorLayout?.h ?? NEW_BLOCK_DEFAULT_H)
            let   nextY = snapToGrid((anchorLayout?.y ?? NEW_BLOCK_DEFAULT_X) + anchorH + NEW_BLOCK_VERTICAL_GAP)

            const newLayouts: LayoutDataSet = { ...ls }

            const newBlocks: TextElement[] = blocks.map(b => {
                const id = crypto.randomUUID()
                const geom = b.layout ?? { x: baseX, y: nextY, w: NEW_BLOCK_DEFAULT_W, h: NEW_BLOCK_DEFAULT_H }
                nextY = snapToGrid(geom.y + geom.h + NEW_BLOCK_VERTICAL_GAP)
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

            // The pasted group is stacked internally without overlap, but its tail
            // can land on the first pre-existing block below the anchor. Resolve
            // per pasted id so the cascade pushes everything below down.
            let resolvedLayouts = newLayouts
            for (const id of insertIds) {
                resolvedLayouts = resolveFileCollisions(file.id, newContent, resolvedLayouts, id)
            }

            const updatedFile: FileData = { ...file, content: newContent }
            const updatedFiles: FilesDataSet = { ...fs, [file.id]: updatedFile }

            saveDocument(updatedFiles, newDataSet, resolvedLayouts)
            setDataSet(updatedFiles, newDataSet, resolvedLayouts)
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
            // create) this block's LayoutItem for the active file. y snaps to the
            // grid so the block top lands on a ruled line; x stays PAGE_X (x is
            // locked — see DragContainer / DragManager.lockX).
            const updated: LayoutItem = {
                blockId: id,
                fileId:  activeFile.id,
                w: prev?.w ?? 0,
                h: prev?.h ?? 0,
                x: finalLocal.x,
                y: snapToGrid(finalLocal.y),
                resizable: prev?.resizable,
                draggable: prev?.draggable,
                locked:    prev?.locked,
            }
            const droppedLayouts: LayoutDataSet = { ...ls, [key]: updated }

            // Resolve any overlap the drop caused: the moved block pins/pushes
            // per CollisionManager, everything below slides down to stay flush.
            const newLayouts = resolveFileCollisions(activeFile.id, activeFile.content, droppedLayouts, id)

            // Re-order content keys by top-left position (y first, then x),
            // reading geometry from this file's resolved placements.
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
        // Remember where a background press started so the click handler can
        // reject rubber-band drags (down → moved → up) and only fire on true clicks.
        if (trigger === "workspace-mouse-down" && e.target === e.currentTarget) {
            bgPointerDownRef.current = { x: e.clientX, y: e.clientY }
        }
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


    // Click on empty canvas → drop a fresh block on the clicked grid row and
    // focus it. This is the "click a space and start writing" affordance: rather
    // than pre-seeding the page with placeholder blocks, an empty row becomes a
    // block on demand. Structural mutation, so it lives in WSA (the conduit),
    // not in SM. Guards: background only, plain left click, no drag.
    const handleWorkspaceClick = (e: React.MouseEvent) => {
        if (e.target !== e.currentTarget) return                  // clicked a block, not the canvas
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
        const down = bgPointerDownRef.current
        bgPointerDownRef.current = null
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4) return   // was a drag

        const wsa = wsaRef.current
        if (!wsa) return
        const rect = wsa.getBoundingClientRect()
        const localY = snapToGrid(e.clientY - rect.top + wsa.scrollTop)
        createBlockAt(localY)
    }


    // Builds a new empty paragraph block at workspace-local y, resolves any
    // overlap, focuses it. Shares the store-write shape with the other handlers.
    const createBlockAt = (y: number) => {
        const state = useWorkspaceStore.getState()
        const file  = state.activeFile
        const ds    = state.content
        const fs    = state.files
        const ls    = state.layouts ?? {}
        if (!file || !ds || !fs) return

        const newId = crypto.randomUUID()
        const newBlock: TextElement = {
            id: newId, component: "ContentArea", Tag: "p",
            styles: "", classNames: "", innerContent: "",
            parentId: null, children: null, files: [],
        }
        const newLayout: LayoutItem = {
            blockId: newId, fileId: file.id,
            x: PAGE_X, y, w: NEW_BLOCK_DEFAULT_W, h: GRID_UNIT,
        }

        const newContent = [...file.content, newId]
        const newLayouts = resolveFileCollisions(
            file.id, newContent, { ...ls, [layoutKey(file.id, newId)]: newLayout }, newId,
        )

        // Keep document order in sync with vertical position.
        const orderedKeys = [...newContent].sort((a, b) => {
            const la = newLayouts[layoutKey(file.id, a)]
            const lb = newLayouts[layoutKey(file.id, b)]
            return ((la?.y ?? 0) - (lb?.y ?? 0)) || ((la?.x ?? 0) - (lb?.x ?? 0))
        })

        const newDataSet: ContentDataSet = { ...ds, [newId]: newBlock }
        const updatedFile: FileData = { ...file, content: orderedKeys }
        const updatedFiles: FilesDataSet = { ...fs, [file.id]: updatedFile }

        pendingFocusRef.current = newId

        saveDocument(updatedFiles, newDataSet, newLayouts)
        setDataSet(updatedFiles, newDataSet, newLayouts)
        setActiveFile(updatedFile)
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
