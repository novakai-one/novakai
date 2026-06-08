import {create} from 'zustand'
import type { PageContent } from '../panels/shared/panel/Panel'

interface WorkspaceStore{
    activeContent: PageContent | null
    setActiveContent: (content: PageContent) => void
}

//create workspace store const and put in 2 things - state and actions.
export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
    activeContent:null,
    setActiveContent: (content) => set({activeContent: content})
}))