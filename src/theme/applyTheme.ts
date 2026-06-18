// ── applyTheme ──────────────────────────────────────────────────────────────
// The single place that mutates the DOM for theming. It writes a theme's tokens
// onto :root as CSS custom properties, optionally overriding the accent with a
// user-picked colour. Everything visual flows from these vars, so this one
// function is enough to re-skin the whole app.

import { getTheme, hexToRgba, type ThemeTokens } from "./themes"

// Build the final token set: start from the theme, then layer an accent
// override (and its two derived values) if the user picked one.
function resolveTokens(themeId: string, accentHex: string | null): ThemeTokens {
    const theme = getTheme(themeId)
    if (!accentHex) return theme.tokens

    // Light themes want a subtler fill than dark ones, otherwise the accent
    // wash reads as muddy on white.
    const fillAlpha = theme.mode === "light" ? 0.1 : 0.14
    return {
        ...theme.tokens,
        accent: accentHex,
        "accent-bg": hexToRgba(accentHex, fillAlpha),
        "accent-border": hexToRgba(accentHex, 0.5),
    }
}

export function applyTheme(themeId: string, accentHex: string | null): void {
    const tokens = resolveTokens(themeId, accentHex)
    const root = document.documentElement

    for (const [key, value] of Object.entries(tokens)) {
        root.style.setProperty(`--${key}`, value)
    }

    // Tell the browser which form controls / scrollbars to render, and expose
    // the active theme for any CSS that wants to branch on it.
    const mode = getTheme(themeId).mode
    root.style.setProperty("color-scheme", mode)
    root.setAttribute("data-theme", themeId)
}
