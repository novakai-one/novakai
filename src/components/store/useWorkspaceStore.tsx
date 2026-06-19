import { create } from 'zustand'
import type { FileData, FilesDataSet, ContentDataSet, LayoutDataSet, DatabaseDataSet } from '../../types/types'

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
    // Caret target after a create/delete commits (see PendingFocus).
    pendingFocus: PendingFocus,
    setPendingFocus: (pendingFocus: PendingFocus) => void,
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
    activeFile: null,
    setActiveFile: (selectedFile) => set({ activeFile: selectedFile }),
    files: null,
    content: null,
    layouts: null,
    databases: null,
    setDataSet: (files, content, layouts, databases) => set({ files, content, layouts, databases }),
    setContent: (content) => set({ content }),
    setLayouts: (layouts) => set({ layouts }),
    setDatabases: (databases) => set({ databases }),
    pendingFocus: null,
    setPendingFocus: (pendingFocus) => set({ pendingFocus }),
}))
