import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useDocumentStorage } from '../../storage/useDocumentStorage'
import { COMPONENT_REGISTRY, type ComponentRegistryKey } from '../../types/registry'
import type {
    TextElement,
    MouseEventData,
    KeyEventData,
    LifecycleEventData,
    BlockEvent,
    FileData,
    FilesDataSet,
    LayoutDataSet,
} from '../../types/types'
import { layoutKey } from '../../types/types'
import { snapToGrid } from '../../layout/grid'
import type SelectionManager from '../../selection/selectionManager/SelectionManager'
// ClipboardBlockData stays on SM (it's a helper-owned payload, not a shared component type).
import type { ClipboardBlockData } from '../../selection/selectionManager/SelectionManager'
import type DragManager from '../../draggable/dragManager/DragManager'
import DragContainer from '../../draggable/dragContainer/DragContainer'
import WorkspaceEmptyState from './WorkspaceEmptyState'
import { useWorkspacePointerBridge, mouseEventDataFrom } from './useWorkspacePointerBridge'
import {
    insertPastedBlocks,
    applyDrop,
    type DocumentSlices,
    type WorkspaceWrite,
} from './blockMutations'
// BlockManager owns create/delete; LayoutManager (resolveEventLayout) validates;
// the store lets sibling components (LeftPanel) fire the same gestures.
import { runBlockEvent } from '../../blocks/blockManager'
import { resolveEventLayout, type ResolveOpts } from './workspaceLayout'
import { useBlockEventStore } from '../store/useBlockEventStore'
import './workspace.css'


interface WorkspaceAreaProps {
    sm: SelectionManager,
    dm: DragManager,
}


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

    // After Enter inserts a new block, this carries the id we need to focus once
    // React has committed the new contentEditable. Cleared by the focus effect.
    const pendingFocusRef = useRef<string | null>(null)

    // Same idea, but lands the caret at the END of the block — used after
    // Backspace deletes an empty block so focus falls to the previous block.
    const pendingFocusEndRef = useRef<string | null>(null)

    // Where the last workspace-background mousedown landed. Used to tell a click
    // (create a block here) apart from a rubber-band drag (don't).
    const bgPointerDownRef = useRef<{ x: number; y: number } | null>(null)


    // ── SM: workspace element on mount, block order whenever it changes ──────

    useEffect(() => {
        sm.setWorkspaceEl(wsaRef.current)
    }, [sm])

    useEffect(() => {
        if (!activeFile) return
        sm.setBlockOrder(activeFile.content)
    }, [sm, activeFile])

    // ── Focus the freshly-created block once it's in the DOM ─────────────────
    //
    // Parent effects fire AFTER children, so by the time this runs React has
    // committed the new block's contentEditable and ContentArea's mount effect
    // has set innerText. focusBlockStart can safely place the caret. rAF here
    // would be racy under StrictMode and concurrent rendering.
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


    // ── Document-level mouse move/up bridge (see hook for why on document) ───

    useWorkspacePointerBridge(sm, dm)


    // ── Block selection store (SM is the source of truth) ────────────────────

    const selectedBlockIds = useSyncExternalStore(sm.subscribe, sm.getSelectedBlocksSnapshot)


    // ── Persist helpers shared by every structural mutation ──────────────────

    // The freshest store slices, or null if the document isn't loaded. Read via
    // getState() so handlers never close over stale state.
    const currentSlices = useCallback((): DocumentSlices | null => {
        const state = useWorkspaceStore.getState()
        if (!state.activeFile || !state.content || !state.files) return null
        return { file: state.activeFile, dataSet: state.content, files: state.files, layouts: state.layouts ?? {} }
    }, [])

    // Save + push a content/layout change to the store.
    const commitWrite = useCallback((write: WorkspaceWrite): void => {
        saveDocument(write.files, write.dataSet, write.layouts)
        setDataSet(write.files, write.dataSet, write.layouts)
        setActiveFile(write.updatedFile)
    }, [saveDocument, setDataSet, setActiveFile])


    // ── The structural pipeline: one funnel for every create/delete ──────────
    // BlockManager proposes (blocks + placement) → WSA merges the placement into
    // the layout set → LayoutManager resolves/collapses → WSA commits + focuses.
    // WSA is the only place that touches the store, the save hook, and the
    // focus refs, so the managers stay pure.
    const runStructuralEvent = useCallback((event: BlockEvent): void => {
        const slices = currentSlices()
        if (!slices) return

        const proposal = runBlockEvent(event, slices)
        if (!proposal) return

        // Merge BlockManager's proposed placements into the live layout set,
        // then tell LayoutManager what changed so it runs the right pass.
        const mergedLayouts: LayoutDataSet = { ...slices.layouts }
        let opts: ResolveOpts
        if (proposal.mode === "add") {
            for (const p of proposal.newPlacements) {
                mergedLayouts[layoutKey(slices.file.id, p.blockId)] = p
            }
            opts = { mode: "add", subjectIds: proposal.subjectIds }
        } else {
            if (proposal.deleted) delete mergedLayouts[proposal.deleted.key]
            opts = {
                mode: "delete",
                deletedY: proposal.deleted?.y ?? 0,
                deletedH: proposal.deleted?.h ?? 0,
            }
        }

        const resolved = resolveEventLayout(slices.file.id, proposal.content, mergedLayouts, opts)

        const updatedFile: FileData = { ...slices.file, content: resolved.content }
        const updatedFiles: FilesDataSet = { ...slices.files, [slices.file.id]: updatedFile }

        // Queue focus for the post-commit effect (block isn't in the DOM yet).
        if (proposal.focusStartId) pendingFocusRef.current = proposal.focusStartId
        if (proposal.focusEndId)   pendingFocusEndRef.current = proposal.focusEndId

        commitWrite({ files: updatedFiles, dataSet: proposal.dataSet, layouts: resolved.layouts, updatedFile })
    }, [currentSlices, commitWrite])


    // Register the pipeline so sibling components (LeftPanel) can fire the same
    // gestures through the store. Cleared on unmount so a stale closure never runs.
    useEffect(() => {
        useBlockEventStore.getState().setHandler(runStructuralEvent)
        return () => { useBlockEventStore.getState().setHandler(null) }
    }, [runStructuralEvent])


    // ── Structural callbacks: SM decides; WSA mutates store + persists ───────
    // SM fires these synchronously inside its gesture handlers. Each computes
    // the next slices via blockMutations, then commits.

    useEffect(() => {

        // Enter / Backspace are gestures SM detects; it still decides WHAT
        // happened, then fires the event through the same funnel everyone uses.
        const dispatch = useBlockEventStore.getState().dispatch

        const handleNewBlock = (value: string, blockId: string, tag: TextElement['Tag']) => {
            dispatch({ trigger: "enter", callerId: blockId, payload: { value, tag } })
        }

        const handleDeleteBlock = (blockId: string) => {
            dispatch({ trigger: "delete", callerId: blockId })
        }

        const handleContentRefresh = (value: string, blockId: string, tag: TextElement['Tag']) => {
            const ds = useWorkspaceStore.getState().content
            if (!ds) return
            const el = ds[blockId]
            if (!el) return
            // Skip writes that change nothing — avoids a storm of saves on click.
            if (el.innerContent === value && el.Tag === tag) return

            const newDataSet = { ...ds, [blockId]: { ...el, innerContent: value, Tag: tag } }
            saveContentData(newDataSet)
            setContent(newDataSet)
        }

        const handlePastedBlocks = (anchorBlockId: string, blocks: ClipboardBlockData[]) => {
            const slices = currentSlices()
            if (!slices) return
            const result = insertPastedBlocks(slices, anchorBlockId, blocks)
            if (!result) return
            commitWrite(result)
        }

        sm.registerNewBlockHandler(handleNewBlock)
        sm.registerDeleteBlockHandler(handleDeleteBlock)
        sm.registerContentRefreshHandler(handleContentRefresh)
        sm.registerPastedBlocksHandler(handlePastedBlocks)
    }, [sm, currentSlices, commitWrite, saveContentData, setContent])


    // ── DragManager: drop moves a placement, re-resolves, re-orders ──────────

    useEffect(() => {
        dm.setWorkspaceEl(wsaRef.current)
        dm.setOnDropCallback((id, finalLocal) => {
            if (!contentDataSet || !activeFile || !files) return
            const result = applyDrop({ file: activeFile, files, layouts: layouts ?? {} }, id, finalLocal)
            // Drop changes placement only — content text is untouched.
            saveDocument(result.files, contentDataSet, result.layouts)
            setLayouts(result.layouts)
            setActiveFile(result.updatedFile)
        })
    }, [dm, contentDataSet, activeFile, files, layouts, saveDocument, setLayouts, setActiveFile])


    // ── Conduit: every event from every component flows through these ────────
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
        handleMouseEvent(mouseEventDataFrom(e), trigger)
    }


    // Click on empty canvas → drop a fresh block on the clicked grid row and
    // focus it. Structural mutation, so it lives in WSA (the conduit), not SM.
    // Guards: background only, plain left click, no drag.
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


    // Click on empty canvas → fire a canvas-click create at that grid row. The
    // pipeline handles placement, collision and focus like every other gesture.
    const createBlockAt = (y: number) => {
        const fileId = useWorkspaceStore.getState().activeFile?.id ?? ""
        useBlockEventStore.getState().dispatch({ trigger: "canvas-click", callerId: fileId, payload: { y } })
    }


    // Resolve roots only when the document is loaded. The workspace <div> ALWAYS
    // renders so wsaRef attaches on first commit — otherwise SM.setWorkspaceEl
    // would capture null and every key/mouse handler would bail.
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
