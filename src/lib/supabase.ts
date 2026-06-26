import { createClient } from "@supabase/supabase-js"

// Single Supabase client for the whole app.
//
// Values come from Vite env vars (VITE_ prefix = exposed to the browser bundle).
// The anon key is *designed* to be public — it only grants what your row-level
// security policies allow, so shipping it in the client is expected. The
// service_role key must NEVER appear here or anywhere client-side.
const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
    throw new Error(
        "Missing Supabase env vars. Copy .env.example to .env.local and fill in " +
        "VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (Supabase dashboard → Project Settings → API).",
    )
}

// @flowmap-node supabase kind=service
export const supabase = createClient(url, anonKey, {
    auth: {
        // Keep the session in localStorage and refresh it automatically. This is
        // per-browser (each browser logs in once via magic link) — the *data*
        // is what now lives server-side and follows the user everywhere.
        persistSession: true,
        autoRefreshToken: true,
        // Parse the magic-link token out of the URL on return, then clean it up.
        detectSessionInUrl: true,
    },
})
