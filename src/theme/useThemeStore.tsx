// ── Theme store ─────────────────────────────────────────────────────────────
// Holds the user's theme choices and is the only thing that calls applyTheme().
// Choices persist to localStorage so the workspace re-opens in the same skin.
//
// Pattern note: actions call applyTheme() themselves (a deliberate side effect)
// so the DOM and the store never drift. Components just call setTheme/setAccent
// and read state for the active-highlight in the UI — they never touch the DOM.

import { create } from "zustand"
import { applyTheme } from "./applyTheme"
import { DEFAULT_THEME_ID } from "./themes"

const STORAGE_KEY = "theme_v1"

interface PersistedTheme {
    themeId: string
    accentHex: string | null
}

function loadPersisted(): PersistedTheme {
    try {
        const raw = localStorage.getItem(STORAGE_KEY)
        if (raw) return JSON.parse(raw) as PersistedTheme
    } catch {
        // Corrupt value — fall through to defaults.
    }
    return { themeId: DEFAULT_THEME_ID, accentHex: null }
}

function persist(state: PersistedTheme): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
    } catch {
        // Storage full / blocked — theme still works for this session.
    }
}

interface ThemeStore {
    themeId: string
    accentHex: string | null
    setTheme: (themeId: string) => void
    setAccent: (accentHex: string | null) => void
    // Push the persisted choice onto the DOM. Call once on app mount.
    hydrate: () => void
}

const initial = loadPersisted()

export const useThemeStore = create<ThemeStore>((set, get) => ({
    themeId: initial.themeId,
    accentHex: initial.accentHex,

    setTheme: (themeId) => {
        const { accentHex } = get()
        applyTheme(themeId, accentHex)
        persist({ themeId, accentHex })
        set({ themeId })
    },

    setAccent: (accentHex) => {
        const { themeId } = get()
        applyTheme(themeId, accentHex)
        persist({ themeId, accentHex })
        set({ accentHex })
    },

    hydrate: () => {
        const { themeId, accentHex } = get()
        applyTheme(themeId, accentHex)
    },
}))
