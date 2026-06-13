import { create } from 'zustand'
import type { FileData } from '../../types/types'
import type { TextElement, MetaData } from '../../types/types'

interface WorkspaceStore {
    activeFile: FileData | null
    setActiveFile: (activeFile: FileData) => void
}


export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
    activeFile: null,
    setActiveFile: (selectedFile) => set({ activeFile: selectedFile })
}))