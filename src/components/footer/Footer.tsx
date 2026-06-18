import './footer.css'
import { useWorkspaceStore } from '../store/useWorkspaceStore'
import { useThemeStore } from '../../theme/useThemeStore'
import { getTheme } from '../../theme/themes'

// Status bar — replaces the old literal "footer" boilerplate. Quiet, always-on
// chrome: a live "saved" indicator on the left, the active theme on the right.
export default function Footer() {
    const activeFile = useWorkspaceStore(s => s.activeFile)
    const themeId = useThemeStore(s => s.themeId)
    const theme = getTheme(themeId)

    return (
        <footer className="footer">
            <div className="footer-left">
                <span className="footer-dot" aria-hidden="true" />
                <span>{activeFile ? 'Saved' : 'Ready'}</span>
            </div>
            <div className="footer-right">
                <span className="footer-theme">{theme.name}</span>
            </div>
        </footer>
    )
}
