// ── Theme model ───────────────────────────────────────────────────────────
// A theme is just a bag of values for the CSS custom properties that the rest
// of the app already reads (see index.css). Keys here map 1:1 to those var
// names *without* the leading `--`. applyTheme() writes each onto :root, so
// switching a theme is a single pass of element.style.setProperty calls — no
// re-render, no recompiling CSS. This keeps the styling layer (CSS) and the
// data layer (these objects) cleanly separated.

export type ThemeMode = "light" | "dark"

// The set of tokens a theme controls. Same names the components reference.
export interface ThemeTokens {
    bg: string                 // --bg            page background
    "bg-h": string             // --bg-h          selected / active fill
    "bg-hover": string         // --bg-hover      hover fill
    surface: string            // --surface       panels, header, footer
    "surface-secondary": string// --surface-secondary  nested chrome
    border: string             // --border
    text: string               // --text          body text
    "text-secondary": string   // --text-secondary
    "text-h": string           // --text-h        headings / strong
    "code-bg": string          // --code-bg
    accent: string             // --accent        the one brand colour
    "accent-bg": string        // --accent-bg     accent at low alpha (fills)
    "accent-border": string    // --accent-border accent at mid alpha (rings)
    shadow: string             // --shadow
}

export interface Theme {
    id: string
    name: string
    mode: ThemeMode
    tokens: ThemeTokens
}

// hex (#rrggbb) → "rgba(r, g, b, a)". Used to derive the soft accent fill and
// the accent ring from a single accent colour, so the accent picker only needs
// one value from the user.
export function hexToRgba(hex: string, alpha: number): string {
    const h = hex.replace("#", "")
    const r = parseInt(h.slice(0, 2), 16)
    const g = parseInt(h.slice(2, 4), 16)
    const b = parseInt(h.slice(4, 6), 16)
    return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

// ── Prebuilt themes ─────────────────────────────────────────────────────────
// Six palettes spanning light + dark. Tuned to read as calm, professional
// workspaces (Linear / Craft / Coda territory) rather than high-contrast demos.

export const THEMES: Theme[] = [
    {
        id: "graphite",
        name: "Graphite",
        mode: "dark",
        tokens: {
            bg: "#0f1011",
            "bg-h": "rgba(255, 255, 255, 0.06)",
            "bg-hover": "rgba(255, 255, 255, 0.03)",
            surface: "#161718",
            "surface-secondary": "#1c1d1f",
            border: "#262729",
            text: "#9b9ba4",
            "text-secondary": "#c3c4cc",
            "text-h": "#f2f3f5",
            "code-bg": "#1a1b1d",
            accent: "#6e7bf2",
            "accent-bg": hexToRgba("#6e7bf2", 0.14),
            "accent-border": hexToRgba("#6e7bf2", 0.5),
            shadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
        },
    },
    {
        id: "paper",
        name: "Paper",
        mode: "light",
        tokens: {
            bg: "#ffffff",
            "bg-h": "rgba(0, 0, 0, 0.05)",
            "bg-hover": "rgba(0, 0, 0, 0.03)",
            surface: "#f7f7f5",
            "surface-secondary": "#efefec",
            border: "#e6e6e1",
            text: "#5f5f5a",
            "text-secondary": "#3d3d39",
            "text-h": "#1a1a17",
            "code-bg": "#f2f1ec",
            accent: "#5856eb",
            "accent-bg": hexToRgba("#5856eb", 0.1),
            "accent-border": hexToRgba("#5856eb", 0.45),
            shadow: "0 8px 24px rgba(15, 15, 15, 0.08)",
        },
    },
    {
        id: "midnight",
        name: "Midnight",
        mode: "dark",
        tokens: {
            bg: "#0b1020",
            "bg-h": "rgba(120, 160, 255, 0.1)",
            "bg-hover": "rgba(120, 160, 255, 0.05)",
            surface: "#121829",
            "surface-secondary": "#18203a",
            border: "#232d44",
            text: "#8a93ad",
            "text-secondary": "#b6bfd6",
            "text-h": "#eef2fb",
            "code-bg": "#141b2e",
            accent: "#38bdf8",
            "accent-bg": hexToRgba("#38bdf8", 0.14),
            "accent-border": hexToRgba("#38bdf8", 0.5),
            shadow: "0 8px 28px rgba(0, 0, 0, 0.5)",
        },
    },
    {
        id: "sand",
        name: "Sand",
        mode: "light",
        tokens: {
            bg: "#faf8f3",
            "bg-h": "rgba(120, 90, 40, 0.08)",
            "bg-hover": "rgba(120, 90, 40, 0.04)",
            surface: "#f3efe6",
            "surface-secondary": "#ebe5d8",
            border: "#e2dac9",
            text: "#6b6356",
            "text-secondary": "#4a4338",
            "text-h": "#2a251c",
            "code-bg": "#f0ebe0",
            accent: "#d97706",
            "accent-bg": hexToRgba("#d97706", 0.12),
            "accent-border": hexToRgba("#d97706", 0.45),
            shadow: "0 8px 24px rgba(80, 60, 20, 0.1)",
        },
    },
    {
        id: "forest",
        name: "Forest",
        mode: "dark",
        tokens: {
            bg: "#0d1310",
            "bg-h": "rgba(80, 220, 160, 0.08)",
            "bg-hover": "rgba(80, 220, 160, 0.04)",
            surface: "#141c17",
            "surface-secondary": "#1a241d",
            border: "#25322a",
            text: "#8fa396",
            "text-secondary": "#bccabf",
            "text-h": "#eef5f0",
            "code-bg": "#16201a",
            accent: "#34d399",
            "accent-bg": hexToRgba("#34d399", 0.14),
            "accent-border": hexToRgba("#34d399", 0.5),
            shadow: "0 8px 24px rgba(0, 0, 0, 0.45)",
        },
    },
    {
        id: "mono",
        name: "Mono",
        mode: "light",
        tokens: {
            bg: "#ffffff",
            "bg-h": "rgba(0, 0, 0, 0.06)",
            "bg-hover": "rgba(0, 0, 0, 0.03)",
            surface: "#fafafa",
            "surface-secondary": "#f0f0f0",
            border: "#e4e4e4",
            text: "#666666",
            "text-secondary": "#333333",
            "text-h": "#111111",
            "code-bg": "#f4f4f4",
            accent: "#111111",
            "accent-bg": hexToRgba("#111111", 0.06),
            "accent-border": hexToRgba("#111111", 0.35),
            shadow: "0 8px 24px rgba(0, 0, 0, 0.08)",
        },
    },
]

// ── Accent swatches ─────────────────────────────────────────────────────────
// Independent of theme. Picking one overrides --accent (and its derived fill /
// ring) on top of whatever palette is active.
export interface AccentSwatch {
    id: string
    name: string
    hex: string
}

export const ACCENTS: AccentSwatch[] = [
    { id: "indigo", name: "Indigo", hex: "#6e7bf2" },
    { id: "violet", name: "Violet", hex: "#a855f7" },
    { id: "cyan", name: "Cyan", hex: "#38bdf8" },
    { id: "emerald", name: "Emerald", hex: "#34d399" },
    { id: "amber", name: "Amber", hex: "#f59e0b" },
    { id: "rose", name: "Rose", hex: "#f43f5e" },
    { id: "blue", name: "Blue", hex: "#3b82f6" },
    { id: "slate", name: "Slate", hex: "#64748b" },
]

export const DEFAULT_THEME_ID = "graphite"

export function getTheme(id: string): Theme {
    return THEMES.find(t => t.id === id) ?? THEMES[0]
}
