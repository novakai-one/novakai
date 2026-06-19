import './left-panel.css'
import Panel from '../shared/panel/Panel'
import type {
    FilePanelTile,
    BlockPanelTile,
    PanelTile,
    BlockSpec,
    FileData,
    FilesDataSet,
} from '../../../types/types'
import { useWorkspaceStore } from '../../../components/store/useWorkspaceStore'
import { useBlockEventStore } from '../../../components/store/useBlockEventStore'
import { useLayoutStore } from '../../../layout/useLayoutStore'
import { useDocumentStorage } from '../../../storage/useDocumentStorage'

// Real, insertable blocks — each maps to a semantic tag rendered by ContentArea.
// (Lists are left out for now: ul/ol need nested <li> children, which the insert
//  flow below doesn't build yet.)
const BLOCK_OPTIONS: BlockPanelTile = {
    type: "blocks",
    tileName: "Blocks",
    panelBody: [
        { id: "block-h1",    block: "Heading 1",  component: "ContentArea", Tag: "h1" },
        { id: "block-h2",    block: "Heading 2",  component: "ContentArea", Tag: "h2" },
        { id: "block-h3",    block: "Heading 3",  component: "ContentArea", Tag: "h3" },
        { id: "block-p",     block: "Paragraph",  component: "ContentArea", Tag: "p" },
        { id: "block-quote", block: "Quote",      component: "ContentArea", Tag: "blockquote" },
    ],
}

// File names double as PanelBody keys + click lookups, so a new file needs a
// name no existing file already uses. "Untitled", then "Untitled 2", "3", …
function uniqueFileName(files: FilesDataSet): string {
    const taken = new Set(Object.values(files).map(f => f.fileName))
    if (!taken.has("Untitled")) return "Untitled"
    let n = 2
    while (taken.has(`Untitled ${n}`)) n++
    return `Untitled ${n}`
}

export default function LeftPanel() {
    // Subscribe to files via selector so unrelated store updates don't re-render.
    const files = useWorkspaceStore(s => s.files)
    const setDataSet = useWorkspaceStore(s => s.setDataSet)
    const setActiveFile = useWorkspaceStore(s => s.setActiveFile)
    const leftPanelOpen = useLayoutStore(s => s.leftPanelOpen)
    const { saveDocument } = useDocumentStorage()

    const fileData: FilePanelTile = {
        type: "files",
        tileName: "Files",
        panelBody: files ? Object.values(files) : [],
    }

    const panelData: PanelTile[] = [fileData, BLOCK_OPTIONS]

    // Create a blank file, push it into the store so it shows immediately, then
    // persist. Read content/layouts via getState() (not selectors) so adding a
    // file doesn't re-render LeftPanel on every content edit. Same pattern WSA
    // uses for its structural mutations.
    const handleAddFile = () => {
        const state = useWorkspaceStore.getState()
        const currentFiles = state.files ?? {}
        const content = state.content ?? {}
        const layouts = state.layouts ?? {}
        const databases = state.databases ?? {}

        const newFile: FileData = {
            id: crypto.randomUUID(),
            metaData: { dateCreated: new Date().toISOString() },
            tags: [],
            fileName: uniqueFileName(currentFiles),
            content: [],
        }

        const updatedFiles: FilesDataSet = { ...currentFiles, [newFile.id]: newFile }

        setDataSet(updatedFiles, content, layouts, databases)
        saveDocument(updatedFiles, content, layouts, databases)
        setActiveFile(newFile)
    }

    // Insert the chosen block via the shared funnel. BlockManager places it at
    // the bottom of the active canvas, LayoutManager resolves, WSA commits — the
    // same path Enter and canvas-click use. The panel only names WHAT to insert;
    // it no longer builds geometry or saves. getState().dispatch reaches WSA
    // across the sibling gap without a re-render.
    const handleInsertBlock = (spec: BlockSpec) => {
        useBlockEventStore.getState().dispatch({
            trigger: "block-panel-selection",
            callerId: spec.id,
            payload: { spec },
        })
    }

    return (
        <Panel
            cn="left-panel"
            panelData={panelData}
            open={leftPanelOpen}
            onAddFile={handleAddFile}
            onInsertBlock={handleInsertBlock}
        />
    )
}
