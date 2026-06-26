import { create } from 'zustand'
import type { FileData, FilesDataSet, ContentDataSet, LayoutDataSet, DatabaseDataSet, SelectionSnapshot } from '../../types/types'
import { emptySelectionSnapshot } from '../../managers/draft'

// Which block to put the caret in after a structural change has rendered.
// BlockManager sets it; WSA reads it once in a post-render effect and clears it.
// "start" = caret to the front (a freshly created block); "end" = caret to the
// tail of the previous block (after a delete).
export type PendingFocus = { id: string, edge: "start" | "end" } | null

interface WorkspaceStore {
    activeFile: FileData | null
    setActiveFile: (activeFile: FileData) => void,
    files: FilesDataSet | null,
    content: ContentDataSet | null,
    // Placements (the "where") — split out of the blocks so one block can be
    // rendered in many files. Keyed by layoutKey(fileId, blockId).
    layouts: LayoutDataSet | null,
    // Database configurations (schema + rows + view state) keyed by the
    // DatabaseArea block id. Split out of the blocks for the same reason
    // layouts are: the block is a dumb renderer, the data lives beside it.
    databases: DatabaseDataSet | null,
    setDataSet: (files: FilesDataSet, content: ContentDataSet, layouts: LayoutDataSet, databases: DatabaseDataSet) => void,
    setContent: (content: ContentDataSet) => void,
    setLayouts: (layouts: LayoutDataSet) => void,
    setDatabases: (databases: DatabaseDataSet) => void,
    // The selection result SM writes into the committed shape: which whole
    // blocks are highlighted + the caret target. Read by WSA to flag each
    // DragContainer, replacing the old SM subscription store.
    selection: SelectionSnapshot,
    setSelection: (selection: SelectionSnapshot) => void,
    // Caret target after a create/delete commits (see PendingFocus).
    pendingFocus: PendingFocus,
    setPendingFocus: (pendingFocus: PendingFocus) => void,
}

// @flowmap-node store kind=store
export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
    activeFile: null,
    // @flowmap-node store__setActiveFile kind=function
    setActiveFile: (selectedFile) => set({ activeFile: selectedFile }),
    files: null,
    content: null,
    layouts: null,
    databases: null,
    // @flowmap-node store__setDataSet kind=function
    setDataSet: (files, content, layouts, databases) => set({ files, content, layouts, databases }),
    // @flowmap-node store__setContent kind=function
    setContent: (content) => set({ content }),
    // @flowmap-node store__setLayouts kind=function
    setLayouts: (layouts) => set({ layouts }),
    // @flowmap-node store__setDatabases kind=function
    setDatabases: (databases) => set({ databases }),
    selection: emptySelectionSnapshot(),
    // @flowmap-node store__setSelection kind=function
    setSelection: (selection) => set({ selection }),
    pendingFocus: null,
    // @flowmap-node store__setPendingFocus kind=function
    setPendingFocus: (pendingFocus) => set({ pendingFocus }),
}))
