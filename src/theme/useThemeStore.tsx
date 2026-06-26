// ── Theme store ─────────────────────────────────────────────────────────────
// Holds the user's theme choices and is the only thing that calls applyTheme().
//
// Choices now persist to Supabase (workspaces.theme) instead of localStorage, so
// the workspace re-opens in the same skin on any browser. The store starts on
// the default theme and is corrected by hydrate() once the user is signed in.
//
// Pattern note: actions call applyTheme() themselves (a deliberate side effect)
// so the DOM and the store never drift. Components just call setTheme/setAccent
// and read state for the active-highlight — they never touch the DOM.

import { create } from "zustand"
import { applyTheme } from "./applyTheme"
import { DEFAULT_THEME_ID } from "./themes"
import { supabase } from "../lib/supabase"

const PERSIST_DEBOUNCE_MS = 600

interface PersistedTheme {
    themeId: string
    accentHex: string | null
}

let persistTimer: ReturnType<typeof setTimeout> | null = null

// @flowmap-node themeStore__currentUserId kind=function
async function currentUserId(): Promise<string | null> {
    const { data } = await supabase.auth.getSession()
    return data.session?.user.id ?? null
}

// Debounced upsert of just the theme column. onConflict user_id leaves the
// document column untouched — document and theme persist independently.
// @flowmap-node themeStore__persist kind=function
function persist(state: PersistedTheme): void {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(async () => {
        const uid = await currentUserId()
        if (!uid) return
        const { error } = await supabase
            .from("workspaces")
            .upsert(
                { user_id: uid, theme: state, updated_at: new Date().toISOString() },
                { onConflict: "user_id" },
            )
        if (error) console.error("Failed to save theme:", error)
    }, PERSIST_DEBOUNCE_MS)
}

interface ThemeStore {
    themeId: string
    accentHex: string | null
    setTheme: (themeId: string) => void
    setAccent: (accentHex: string | null) => void
    // Pull the persisted choice from Supabase and paint it onto :root.
    // Async now (network). Call once the user is signed in.
    hydrate: () => Promise<void>
}

// @flowmap-node themeStore kind=store
export const useThemeStore = create<ThemeStore>((set, get) => ({
    themeId: DEFAULT_THEME_ID,
    accentHex: null,

    // @flowmap-node themeStore__setTheme kind=function
    setTheme: (themeId) => {
        const { accentHex } = get()
        applyTheme(themeId, accentHex)
        persist({ themeId, accentHex })
        set({ themeId })
    },

    // @flowmap-node themeStore__setAccent kind=function
    setAccent: (accentHex) => {
        const { themeId } = get()
        applyTheme(themeId, accentHex)
        persist({ themeId, accentHex })
        set({ accentHex })
    },

    // @flowmap-node themeStore__hydrate kind=function
    hydrate: async () => {
        try {
            const uid = await currentUserId()
            if (uid) {
                const { data, error } = await supabase
                    .from("workspaces")
                    .select("theme")
                    .eq("user_id", uid)
                    .maybeSingle()
                if (error) throw error
                const t = data?.theme as PersistedTheme | null
                if (t?.themeId) set({ themeId: t.themeId, accentHex: t.accentHex ?? null })
            }
        } catch (err) {
            console.error("Failed to load theme:", err)
        }
        const { themeId, accentHex } = get()
        applyTheme(themeId, accentHex)
    },
}))
