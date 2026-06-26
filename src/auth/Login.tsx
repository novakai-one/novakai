import { useState } from "react"
import { useAuthStore } from "./useAuthStore"

// Email + password login. Toggles between signing in and creating an account.
// On success the auth listener (useAuthStore) flips the app into the workspace —
// this component doesn't navigate, it just submits.
// @flowmap-node auth__login kind=component
export default function Login() {
    const signIn = useAuthStore((s) => s.signIn)
    const signUp = useAuthStore((s) => s.signUp)

    const [mode, setMode] = useState<"signin" | "signup">("signin")
    const [email, setEmail] = useState("")
    const [password, setPassword] = useState("")
    const [message, setMessage] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault()
        if (!email || !password || busy) return
        setBusy(true)
        setMessage(null)
        const fn = mode === "signin" ? signIn : signUp
        const err = await fn(email.trim(), password)
        setBusy(false)
        if (err) setMessage(err)
    }

    const isSignup = mode === "signup"

    return (
        <div style={styles.wrap}>
            <form onSubmit={handleSubmit} style={styles.card}>
                <h1 style={styles.title}>{isSignup ? "Create account" : "Sign in"}</h1>

                <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    style={styles.input}
                    autoFocus
                />
                <input
                    type="password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password"
                    autoComplete={isSignup ? "new-password" : "current-password"}
                    style={styles.input}
                />

                <button type="submit" disabled={busy} style={styles.button}>
                    {busy ? "…" : isSignup ? "Create account" : "Sign in"}
                </button>

                {message && <p style={styles.message}>{message}</p>}

                <button
                    type="button"
                    onClick={() => { setMode(isSignup ? "signin" : "signup"); setMessage(null) }}
                    style={styles.link}
                >
                    {isSignup ? "Have an account? Sign in" : "No account? Create one"}
                </button>
            </form>
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
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: 320,
        padding: 32,
        borderRadius: 12,
        border: "1px solid rgba(128,128,128,0.25)",
        boxShadow: "0 8px 30px rgba(0,0,0,0.12)",
    },
    title: { margin: "0 0 4px", fontSize: 20 },
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
    message: { color: "#dc2626", fontSize: 13, margin: 0, lineHeight: 1.4 },
    link: {
        background: "none",
        border: "none",
        color: "#4f46e5",
        fontSize: 13,
        cursor: "pointer",
        padding: 0,
        textAlign: "center",
    },
}
