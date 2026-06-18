import { useEffect, useRef } from 'react'
import './App.css'
import Editor from './components/Editor'
import LeftPanel from './components/panels/left-panel/LeftPanel'
import RightPanel from './components/panels/right-panel/RightPanel'
import { useDocumentStorage } from './storage/useDocumentStorage'
import { useWorkspaceStore } from './components/store/useWorkspaceStore'
import { useThemeStore } from './theme/useThemeStore'
import SelectionManager from './selection/selectionManager/SelectionManager'
import DragManager from './draggable/dragManager/DragManager'

// SM and DM are long-lived stateful objects (anchor/focus, drag state, registered
// callbacks). They MUST survive across renders or any in-flight gesture is lost.
// Held in refs so a single instance threads through every child for the app's lifetime.
export default function App() {
    const smRef = useRef<SelectionManager | null>(null)
    const dmRef = useRef<DragManager | null>(null)
    if (!smRef.current) smRef.current = new SelectionManager()
    if (!dmRef.current) dmRef.current = new DragManager()

    // Selectors (not destructure-of-full-state) — otherwise this component
    // re-renders on every store change, which used to recreate SM/DM mid-gesture.
    const setDataSet = useWorkspaceStore(s => s.setDataSet)
    const hydrateTheme = useThemeStore(s => s.hydrate)
    const { loadDocument } = useDocumentStorage()

    // Paint the persisted theme onto :root before anything else renders.
    useEffect(() => {
        hydrateTheme()
    }, [hydrateTheme])

    useEffect(() => {
        const ds = loadDocument()
        if (!ds) return
        setDataSet(ds.files, ds.content, ds.layouts)
    }, [loadDocument, setDataSet])

    return (
        <div className="app">
            <LeftPanel />
            <Editor sm={smRef.current} dm={dmRef.current} />
            <RightPanel />
        </div>
    )
}
