import './panel-toggle.css'

interface PanelToggleProps {
    cn: string;
    handleClick: () => void;
    panelOpen: boolean;
}

// A clean chevron that rotates with state — collapsed points the way the panel
// will open, expanded points back toward the edge it tucks into.
export default function PanelToggle({ cn, handleClick, panelOpen }: PanelToggleProps) {
    return (
        <button
            type="button"
            aria-label={panelOpen ? "Collapse panel" : "Expand panel"}
            aria-expanded={panelOpen}
            className={`${cn} panel-toggle panel-toggle-open-${panelOpen}`}
            onClick={handleClick}
        >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path d="M10 4 L6 8 L10 12" stroke="currentColor" strokeWidth="1.6"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        </button>
    )
}
