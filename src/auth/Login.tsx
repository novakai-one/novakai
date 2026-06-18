import { useState } from "react"
import { useAuthStore } from "./useAuthStore"

// Magic-link login screen. No password — the user types their email, gets a
// link, clicks it, and Supabase drops them back into the app already signed in.
export default function Login() {
    const signIn = useAuthStore((s) => s.signIn)
    const [email, setEmail] = useState("")
    const [sent, setSent] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!email || busy) return
        setBusy(true)
        setError(null)
        const err = await signIn(email.trim())
        setBusy(false)
        if (err) setError(err)
        else setSent(true)
    }

    return (
        <div style={styles.wrap}>
            <div style={styles.card}>
                <h1 style={styles.title}>Sign in</h1>

                {sent ? (
                    <p style={styles.muted}>
                        Check <strong>{email}</strong> for a sign-in link. Open it in any
                        browser to load your workspace.
                    </p>
                ) : (
                    <form onSubmit={handleSubmit} style={styles.form}>
                        <input
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@example.com"
                            style={styles.input}
                            autoFocus
                        />
                        <button type="submit" disabled={busy} style={styles.button}>
                            {busy ? "Sending…" : "Send magic link"}
                        </button>
                        {error && <p style={styles.error}>{error}</p>}
                    </form>
                )}
            </div>
        </div>
    )
}

const styles: Record<string, React.CSSProperties> = {
    wrap: {
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100vh",
        width: "100vw",
    },
    card: {
        width: 320,
        padding: 32,
        borderRadius: 12,
        border: "1px solid rgba(128,128,128,0.25)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
    },
    title: { margin: "0 0 16px", fontSize: 20 },
    form: { display: "flex", flexDirection: "column", gap: 12 },
    input: {
        padding: "10px 12px",
        borderRadius: 8,
        border: "1px solid rgba(128,128,128,0.4)",
        fontSize: 14,
    },
    button: {
        padding: "10px 12px",
        borderRadius: 8,
        border: "none",
        background: "#4f46e5",
        color: "#fff",
        fontSize: 14,
        cursor: "pointer",
    },
    muted: { fontSize: 14, lineHeight: 1.5, color: "rgba(128,128,128,1)" },
    error: { color: "#dc2626", fontSize: 13, margin: 0 },
}
