// ── Auth store ───────────────────────────────────────────────────────────────
// Single source of truth for "is someone signed in". Mirrors Supabase's auth
// session into zustand so components can react to it.
//
// The onAuthStateChange listener is wired once, at module load — it fires on the
// initial session restore, on magic-link return, and on sign-out, so we never
// poll. status starts "loading" until that first event lands.

import { create } from "zustand"
import type { Session, User } from "@supabase/supabase-js"
import { supabase } from "../lib/supabase"

type AuthStatus = "loading" | "signed-in" | "signed-out"

interface AuthStore {
    status: AuthStatus
    session: Session | null
    user: User | null
    // Send a magic link. Returns an error message, or null on success.
    signIn: (email: string) => Promise<string | null>
    signOut: () => Promise<void>
}

export const useAuthStore = create<AuthStore>(() => ({
    status: "loading",
    session: null,
    user: null,

    signIn: async (email) => {
        const { error } = await supabase.auth.signInWithOtp({
            email,
            options: {
                // Where the magic link sends the user back to. Must be listed in
                // Supabase → Authentication → URL Configuration → Redirect URLs.
                emailRedirectTo: window.location.origin,
            },
        })
        return error ? error.message : null
    },

    signOut: async () => {
        await supabase.auth.signOut()
    },
}))

// Wire the listener once. setSession runs on first load (session restore),
// on magic-link return, and on sign-out.
function setSession(session: Session | null): void {
    useAuthStore.setState({
        session,
        user: session?.user ?? null,
        status: session ? "signed-in" : "signed-out",
    })
}

supabase.auth.getSession().then(({ data }) => setSession(data.session))
supabase.auth.onAuthStateChange((_event, session) => setSession(session))
