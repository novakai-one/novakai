import { useEffect, useRef } from 'react'
import './App.css'
import Editor from './components/Editor'
import LeftPanel from './components/panels/left-panel/LeftPanel'
import RightPanel from './components/panels/right-panel/RightPanel'
import { useDocumentStorage } from './storage/useDocumentStorage'
import { useWorkspaceStore } from './components/store/useWorkspaceStore'
import { useThemeStore } from './theme/useThemeStore'
import { useLayoutStore } from './layout/useLayoutStore'
import { useAuthStore } from './auth/useAuthStore'
import Login from './auth/Login'
import SelectionManager from './selection/selectionManager/SelectionManager'
import DragManager from './draggable/dragManager/DragManager'
import DesignDemo from './design-demo/DesignDemo' // ── DEMO TOGGLE: delete this line + the block below + the design-demo folder to remove ──

// Flag is read once at module load, so it never changes mid-session → hook order stays stable.
const SHOW_DESIGN_DEMO = new URLSearchParams(window.location.search).has('demo')

// SM and DM are long-lived stateful objects (anchor/focus, drag state, registered
// callbacks). They MUST survive across renders or any in-flight gesture is lost.
// Held in refs so a single instance threads through every child for the app's lifetime.
export default function App() {
    // ── DEMO TOGGLE: short-circuits to the concept preview when URL has ?demo. ──
    // Constant flag → safe early return (hook order never differs between renders).
    if (SHOW_DESIGN_DEMO) return <DesignDemo />

    const smRef = useRef<SelectionManager | null>(null)
    const dmRef = useRef<DragManager | null>(null)
    if (!smRef.current) smRef.current = new SelectionManager()
    if (!dmRef.current) dmRef.current = new DragManager()

    // Selectors (not destructure-of-full-state) — otherwise this component
    // re-renders on every store change, which used to recreate SM/DM mid-gesture.
    const setDataSet = useWorkspaceStore(s => s.setDataSet)
    const hydrateTheme = useThemeStore(s => s.hydrate)
    // Drives the page-width class on .app — the workspace.css presets read it.
    const pageWidth = useLayoutStore(s => s.pageWidth)
    const status = useAuthStore(s => s.status)
    const signOut = useAuthStore(s => s.signOut)
    const { loadDocument } = useDocumentStorage()

    // Theme + document both belong to the signed-in user, so they load only once
    // a session exists. status flips to "signed-in" after Supabase restores or
    // establishes the session (see useAuthStore).
    useEffect(() => {
        if (status !== 'signed-in') return
        void hydrateTheme()
    }, [status, hydrateTheme])

    useEffect(() => {
        if (status !== 'signed-in') return
        let cancelled = false
        void loadDocument().then(ds => {
            if (cancelled || !ds) return
            setDataSet(ds.files, ds.content, ds.layouts)
        })
        return () => { cancelled = true }
    }, [status, loadDocument, setDataSet])

    if (status === 'loading') return <div className="app-loading">Loading…</div>
    if (status === 'signed-out') return <Login />

    return (
        <div className={`app page-${pageWidth}`}>
            <button className="sign-out" onClick={() => void signOut()}>Sign out</button>
            <LeftPanel />
            <Editor sm={smRef.current} dm={dmRef.current} />
            <RightPanel />
        </div>
    )
}
