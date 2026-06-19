import { create } from 'zustand'
import type { FileData, FilesDataSet, ContentDataSet, LayoutDataSet } from '../../types/types'

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
    setDataSet: (files: FilesDataSet, content: ContentDataSet, layouts: LayoutDataSet) => void,
    setContent: (content: ContentDataSet) => void,
    setLayouts: (layouts: LayoutDataSet) => void,
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
    setDataSet: (files, content, layouts) => set({ files, content, layouts }),
    setContent: (content) => set({ content }),
    setLayouts: (layouts) => set({ layouts }),
    pendingFocus: null,
    setPendingFocus: (pendingFocus) => set({ pendingFocus }),
}))
