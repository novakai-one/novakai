import { create } from 'zustand'
import type { FileData, FilesDataSet, ContentDataSet, LayoutDataSet } from '../../types/types'

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
}))
