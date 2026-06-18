import './header.css'
import { useWorkspaceStore } from '../store/useWorkspaceStore'

export default function Header() {
    const activeFile = useWorkspaceStore(s => s.activeFile)

    return (
        <header className="header">
            <span className="header-crumb">Workspace</span>
            <span className="header-sep">/</span>
            <span className="header-title">{activeFile?.fileName ?? "Untitled"}</span>
        </header>
    )
}
