import { useState } from 'react'
import './right-panel.css'
import { useThemeStore } from '../../../theme/useThemeStore'
import { useLayoutStore } from '../../../layout/useLayoutStore'
import { THEMES, ACCENTS, getTheme, type Theme } from '../../../theme/themes'
import type { PageWidth } from '../../../types/types'

// The three page-width presets, in order, with the glyph + label each button
// shows. Kept as data so the control is a single map, not three hand-written
// buttons. Glyphs echo the reference's ⬜ ▭ ⬛ width metaphor.
const PAGE_WIDTHS: { id: PageWidth, label: string, glyph: string }[] = [
    { id: "normal", label: "Normal", glyph: "▦" },
    { id: "narrow", label: "Narrow", glyph: "▯" },
    { id: "full",   label: "Full",   glyph: "▩" },
]

// ── Right panel: the theme studio ───────────────────────────────────────────
// Self-contained (not the shared Panel) because its content is controls, not a
// file/block list. Two jobs: pick a base palette, then optionally recolour the
// accent. Both write straight to the theme store, which repaints :root live.
// Collapse state is local UI — it doesn't need to persist or be shared.

// A miniature of the actual product, painted from the theme's own tokens — a
// titlebar, a sidebar, content lines and an accent chip. This "show, don't
// label" preview is what makes a theme picker read as premium rather than as a
// settings form.
function ThemeCard({ theme, active, onSelect }: {
    theme: Theme
    active: boolean
    onSelect: (id: string) => void
}) {
    const t = theme.tokens
    return (
        <button
            type="button"
            className={`rp-card ${active ? 'is-active' : ''}`}
            onClick={() => onSelect(theme.id)}
            aria-pressed={active}
        >
            <span className="rp-mock" style={{ background: t.bg }}>
                <span className="rp-mock-bar" style={{ background: t.surface, borderColor: t.border }}>
                    <span className="rp-mock-dot" style={{ background: t.accent }} />
                    <span className="rp-mock-dot" style={{ background: t['text-secondary'], opacity: 0.4 }} />
                    <span className="rp-mock-dot" style={{ background: t['text-secondary'], opacity: 0.25 }} />
                </span>
                <span className="rp-mock-body">
                    <span className="rp-mock-side" style={{ background: t.surface, borderColor: t.border }}>
                        <span className="rp-mock-side-line" style={{ background: t.accent }} />
                        <span className="rp-mock-side-line" style={{ background: t['text-secondary'], opacity: 0.35 }} />
                        <span className="rp-mock-side-line" style={{ background: t['text-secondary'], opacity: 0.35 }} />
                    </span>
                    <span className="rp-mock-main">
                        <span className="rp-mock-line rp-mock-line-lg" style={{ background: t['text-h'] }} />
                        <span className="rp-mock-line" style={{ background: t['text-secondary'], opacity: 0.55 }} />
                        <span className="rp-mock-line rp-mock-line-sm" style={{ background: t['text-secondary'], opacity: 0.35 }} />
                        <span className="rp-mock-chip" style={{ background: t['accent-bg'], borderColor: t.accent, color: t.accent }} />
                    </span>
                </span>
            </span>

            <span className="rp-card-meta">
                <span className="rp-card-name">{theme.name}</span>
                <span className={`rp-card-mode rp-card-mode-${theme.mode}`}>{theme.mode}</span>
            </span>

            {active && (
                <span className="rp-card-check" aria-hidden="true">
                    <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                        <path d="M3.5 8.5 L6.5 11.5 L12.5 4.5" stroke="currentColor"
                            strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </span>
            )}
        </button>
    )
}

export default function RightPanel() {
    const themeId = useThemeStore(s => s.themeId)
    const accentHex = useThemeStore(s => s.accentHex)
    const setTheme = useThemeStore(s => s.setTheme)
    const setAccent = useThemeStore(s => s.setAccent)

    const pageWidth = useLayoutStore(s => s.pageWidth)
    const setPageWidth = useLayoutStore(s => s.setPageWidth)

    const [open, setOpen] = useState(true)
    const activeTheme = getTheme(themeId)

    return (
        <aside className={`right-panel rp-open-${open}`}>
            <button
                type="button"
                className="rp-toggle"
                aria-label={open ? 'Collapse theme panel' : 'Expand theme panel'}
                aria-expanded={open}
                onClick={() => setOpen(p => !p)}
            >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M6 4 L10 8 L6 12" stroke="currentColor" strokeWidth="1.6"
                        strokeLinecap="round" strokeLinejoin="round" />
                </svg>
            </button>

            <div className="rp-content">
                <header className="rp-head">
                    <div className="rp-head-row">
                        <span className="rp-head-glyph" aria-hidden="true">
                            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
                                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.4" />
                                <path d="M8 2 a6 6 0 0 1 0 12 z" fill="currentColor" />
                            </svg>
                        </span>
                        <h3 className="rp-head-title">Appearance</h3>
                    </div>
                    <p className="rp-head-sub">Tune your workspace. Changes apply live.</p>
                </header>

                <section className="rp-section">
                    <div className="rp-label">
                        <span>Layout</span>
                        <span className="rp-label-value rp-label-value-cap">{pageWidth}</span>
                    </div>
                    <div className="rp-seg">
                        {PAGE_WIDTHS.map(option => (
                            <button
                                key={option.id}
                                type="button"
                                className={`rp-seg-btn ${pageWidth === option.id ? 'is-active' : ''}`}
                                onClick={() => setPageWidth(option.id)}
                                aria-pressed={pageWidth === option.id}
                                title={`${option.label} page width`}
                            >
                                <span className="rp-seg-glyph" aria-hidden="true">{option.glyph}</span>
                                {option.label}
                            </button>
                        ))}
                    </div>
                </section>

                <div className="rp-divider" />

                <section className="rp-section">
                    <div className="rp-label">
                        <span>Theme</span>
                        <span className="rp-label-value">{activeTheme.name}</span>
                    </div>
                    <div className="rp-grid">
                        {THEMES.map(theme => (
                            <ThemeCard
                                key={theme.id}
                                theme={theme}
                                active={theme.id === themeId}
                                onSelect={setTheme}
                            />
                        ))}
                    </div>
                </section>

                <div className="rp-divider" />

                <section className="rp-section">
                    <div className="rp-label">
                        <span>Accent</span>
                    </div>
                    <div className="rp-accent-row">
                        <button
                            type="button"
                            className={`rp-accent rp-accent-auto ${accentHex === null ? 'is-active' : ''}`}
                            onClick={() => setAccent(null)}
                            title="Match theme default"
                            aria-label="Match theme default accent"
                            aria-pressed={accentHex === null}
                        />
                        {ACCENTS.map(a => (
                            <button
                                key={a.id}
                                type="button"
                                className={`rp-accent ${accentHex === a.hex ? 'is-active' : ''}`}
                                style={{ '--swatch': a.hex } as React.CSSProperties}
                                onClick={() => setAccent(a.hex)}
                                title={a.name}
                                aria-label={a.name}
                                aria-pressed={accentHex === a.hex}
                            />
                        ))}
                    </div>
                </section>
            </div>
        </aside>
    )
}
