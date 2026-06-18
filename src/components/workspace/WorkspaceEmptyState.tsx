import './workspace-empty-state.css'

// Shown when the active file has no blocks (or no file is open yet). An empty
// canvas reads as "broken/unfinished"; a centred prompt reads as "ready". Purely
// presentational — pointer-events are off in CSS so it never intercepts the
// mouse-down that starts a rubber-band selection on the canvas underneath.
export default function WorkspaceEmptyState() {
    return (
        <div className="workspace-empty" aria-hidden="true">
            <div className="workspace-empty-glyph">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none">
                    <rect x="3.5" y="3.5" width="17" height="17" rx="3"
                        stroke="currentColor" strokeWidth="1.4" />
                    <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.4"
                        strokeLinecap="round" />
                </svg>
            </div>
            <h2 className="workspace-empty-title">A blank canvas</h2>
            <p className="workspace-empty-sub">
                Pick a block from the left panel, or describe what you want and let
                the workspace build it.
            </p>
        </div>
    )
}
