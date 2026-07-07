# SPEC_AGENTS — the Agents tab (K6 design spec)

> Design spec for **K6 — Agents tab**: real Claude Code running in an in-page terminal.
> Substrate is fixed by the K2 probe (`PROBES.md` probe-terminal, PASS): **xterm.js in the page,
> node-pty behind the Vite dev server, bridged over a WebSocket the dev server itself upgrades**
> (vision ruling R2 — no separate backend). **Claude Code is the ONLY agent in scope** (ruling R6).
> No prototype design exists for this tab (manifest has no Agents rows) — the page design below
> came from the design track: three independent same-brief variants, judged (KEY_DECISIONS §2.1).
>
> **What is BINDING here and what is a design choice.** Binding, inherited: the two-actor color
> law (§3.2 — most-protected rule), the empty-state grammar (`PROTO_MANIFEST.md` §2, empty-state
> row), no-simulated-data (manifest §4), mono/sans + 9px radius + anti-capsule chips (§3.8/§8.2),
> no progress bars/spinners/toasts (§3.4/§3.9), idle = zero moving pixels (§3.5). Everything
> else — the page anatomy, the session strip, the bridge protocol, the session log — is a choice
> this spec makes, traced against the real app. `/novakai` fundamentals are king (R9).

---

## 0. What K6 is and is not

- **IS**: one new page module (`initAgents`) that renders a terminal workspace on the `#agents`
  route: a session strip + one xterm.js viewport per session, each connected over
  `ws://host/pty?...` to a PTY the Vite dev server spawns with the real `claude` binary at the
  repo root. Multiple concurrent sessions; sessions **keep running when the user switches tabs**
  and their terminals (scrollback included) survive returning. Plus: the PTY bridge itself (a
  plugin inside `vite.config.ts`) and a per-repo session-lifecycle log that Contracts (K4) and
  Analytics (K10) can consume.
- **IS NOT**: any parsing, narration or summarising of what Claude Code is doing (that would be
  manufactured data — the terminal stream itself is the honest record); any Claude Code
  configuration UI (model pickers, flags — the terminal already owns those); session persistence
  across page reloads (accepted limitation, §11); contract *creation* or hand-off flows (K4/K5
  own those — K6 only records an association it is handed); repo switching (K7 owns that; at K6
  every session spawns at the dev server's own repo root).

---

## 1. Page anatomy (design choice — the judged fan-out, KEY_DECISIONS §2.1)

Three independent same-brief design variants were sampled and judged. Where all three converged
the convergence is adopted; two minority gems were taken with recorded reasons; the rejected
ideas are recorded at the end of this section so they are settled, not re-litigated.

The page fills the area right of the 68px rail with a column: a slim **session strip** on top,
the **terminal area** beneath it filling the rest.

```
┌─────┬──────────────────────────────────────────────────────────┐
│     │ [claude 1] [claude 2 · exited 0]                     [+] │  ← strip, 36px
│rail │──────────────────────────────────────────────────────────│
│68px │                                                          │
│     │              terminal area  (var(--bg))                  │
│     │              one xterm pane per session,                 │
│     │              only the active one visible                 │
│     │                                                          │
└─────┴──────────────────────────────────────────────────────────┘
```

- **No header, no eyebrow, no page title** (3/3 variants converged). SPEC_SHELL grants the
  eyebrow + display title to *document* surfaces (Builds list, build-document, Prototypes list —
  §8.1) and withholds any heading from Canvas because it is a *work surface*. Agents is a work
  surface — a terminal — so it takes the Canvas precedent: the rail's permanent label carries
  page identity, and every vertical pixel goes to the thing the page is for. The strip IS the
  only chrome.
- **Strip (36px, `border-bottom: 1px solid var(--line)`, `background: var(--panel)`,
  `overflow-x: auto`)**: one **session chip** per session in creation order, then the
  **`+ new session`** control pinned trailing (`margin-left: auto`, `flex-shrink: 0`).
- **Session chip**: mono 11px, **5px radius (anti-capsule, §8.2)**, `padding: 4px 10px`,
  `color: var(--ink-dim)` at rest. Label = `claude <ordinal>` (literal — the thing in the pane
  is the `claude` binary, the only agent in scope, R6; never renamed, §1.9 applied to generated
  names). If the session carries a contract, a fainter suffix `· <contract-id>` in
  `var(--ink-faint)` — a fact, not a badge; omitted entirely when absent (no placeholder,
  manifest §4). The **active** chip is the human's focus: `color: var(--ink)` plus a **2px
  periwinkle bottom bar** (`.agents-chip.active::after { height:2px; background:var(--accent) }`)
  — the rail's own active idiom (`.rail-item.active::before`, SPEC_SHELL §2) rotated 90° for a
  horizontal strip: same hue, same meaning, reused not reinvented. A `×` sits inside each chip:
  visible on hover for running sessions, always visible on exited/disconnected ones;
  `color: var(--ink-faint)`, hover `var(--danger)` — the existing house close-hover recipe
  (`.fm-x:hover`, `css/styles.css:655`), not a new one.
- **Terminal area**: `background: var(--bg)` (3/3 convergence) — the terminal is the room, not
  a boxed console floating in one; it reads as continuous with the page, and no new surface var
  is invented. Each session owns one absolutely-stacked pane (`.agents-pane`, `inset: 8px` so
  glyphs never touch the strip or viewport edges), `display: none` unless active — panes are
  **never destroyed on switch**, so scrollback survives (xterm stays attached). Switching is
  instant, no animation (SPEC_SHELL §4's instant-swap grammar; keyboard-speed action, §3.5).

**Design-track record — rejected variant ideas, so they stay settled:** *reconnect / retry
loops and a `[reconnect]` control* (2 variants) — impossible under the probed bridge, which
kills the PTY on any socket close; a retry that cannot resurrect the process is theatre (§5).
*Amber for the disconnected state* (2 variants, arguing "attested, end unconfirmed") — amber is
the law's *pending* hue and nothing is pending: no future event resolves a disconnection at K6,
so it renders quiet/faint like every other finished thing. *A reserved second chip row for the
contract id* — contracts attach only at session creation (§3), so the mid-session-reflow
problem it solves cannot occur. *Status dots (`●`/`○`)* — a new glyph vocabulary duplicating
what the literal suffix words already state. *A `[restart]` control on exited sessions* — an
exited PTY cannot be resumed; `+ new session` already covers starting fresh, and a session is
a record, not a slot.

## 2. The persistent layer (the one load-bearing geometry decision)

The K3 shell **rebuilds** a non-codebase page on every route entry — `renderHost()` clears
`#host` and re-appends a fresh element (`src/ide/shell.ts:82–86`, per SPEC_SHELL §5's
"no lifecycle" contract). A terminal cannot live under that contract: a rebuilt page would
destroy the xterm DOM (scrollback, cursor state) on every tab switch. `shell.ts`, `pages.ts` and
`main.ts` are frozen for this lane, and SPEC_SHELL deliberately ships **no ShellApi** at K3
("nothing navigates programmatically yet"). So the Agents page does not mount inside `#host` at
all:

- `initAgents(ctx)` creates **one persistent sibling layer** `#agentsPage` on `document.body`:
  `position: fixed; left: 68px; top: 0; right: 0; bottom: 0; z-index: 74; background: var(--bg);
  display: none` — above `#host`'s 72 and the unfold overlay's 70, below the rail's 80
  (SPEC_SHELL §3's layer order). A durable comment in `agents.css` records the sandwich:
  `/* host(72) < agentsPage(74) < rail(80) — SPEC_AGENTS §2 */`.
- The module listens to `hashchange` itself (one comparison: `location.hash.slice(1) ===
  'agents'`) and toggles its own visibility. On show: `fit()` + focus the active terminal. On
  hide: nothing — sockets, PTYs and DOM all stay alive.
- The shell underneath still routes `agents` to its K3 empty state inside `#host`; the opaque
  `#agentsPage` covers it. That double-render is invisible, costs one hidden div, and keeps this
  lane **zero-coupled to the frozen shell**: the seam's only obligation is the one
  `initAgents(ctx)` call in `main.ts`. When a later phase adds a real ShellApi/page registry,
  `#agentsPage` collapses into it — documented upgrade path, not a K6 requirement.

Why not extend the shell with a page-lifecycle contract instead? It is the cleaner end-state,
but it edits two frozen files (`shell.ts`, `pages.ts`), forces a design round K5–K10 all have a
stake in, and K6 does not need it — a self-owned layer is the entire requirement. That contract
should be designed once, by the phase that owns the shell, informed by real pages (this one)
rather than speculation.

## 3. Session model — repo mapping, contract mapping, where state lives

```ts
interface AgentSession {
  id: string;              // crypto.randomUUID(), minted client-side at creation
  ordinal: number;         // 1-based, display label "claude <ordinal>"
  cwd: string;             // repo root — echoed back by the bridge on connect (§4)
  contract: string | null; // optional association, recorded verbatim — never invented
  startedAt: number;       // epoch ms, client clock (display only; the log's ts is authoritative)
  status: 'running' | 'exited' | 'disconnected';
  exitCode: number | null; // set only when status === 'exited'
}
```

- **Session ↔ repo**: at K6 the repo is **fixed server-side** — every PTY spawns with
  `cwd = the dev server's process.cwd()`, which IS the loaded repo (the dev server is the app).
  The client sends no cwd and the bridge would ignore one (§4 security). Per-repo scoping (R4)
  is therefore structural: a different repo means a different dev server, which means its own
  bridge, sessions and log. When K7 lands repo switching, cwd selection becomes K7's seam — the
  bridge grows an allowlist sourced from K7's repo registry, not from the client.
- **Session ↔ contract**: an optional `contract` string travels in the ws URL and into the log
  record. At K6 **nothing sets it in the UI** — the `+ new session` control creates plain
  sessions. The field exists so K4/K5's "run an agent on this contract" hand-off has a pinned,
  already-logged shape to call into (`startSession({ contract })` on the module's API), and so
  K10 can group spend by contract from day one. An empty association is shown as nothing —
  never a placeholder value (manifest §4).
- **Where session state lives: module-local, NOT `ctx.state`.** Invariant 3 makes `ctx.state`
  the source of truth *for the document* — it is what `io/mermaid.ts` serialises and the canvas
  renders. Terminal sessions are ephemeral runtime owned by one page, exactly like
  `unfold`'s internal view state; putting them in the serialised model would leak runtime into
  the document. The module keeps a private `AgentSession[]`; nothing else reads it at K6, so no
  hook is exposed yet (`ctx.hooks` grows one only when a consumer exists — YAGNI).

## 4. The bridge (vite.config.ts plugin — this lane's only non-`src/ide` code)

Lives **inline in `vite.config.ts`** as a Vite plugin (`configureServer`), exactly the probe's
shape (PROBES.md probe-terminal reproduction note). Rationale: the file is this lane's exclusive
ownership; a module under `tools/` would owe the I1 tooling map a node + fragment (the
`novakai:tooling:coverage` gate scans `--dir tools`, `package.json:48–50`) and a root-level
`.mjs` would sit outside the lint set (`"lint": "eslint src tools"`) — inline it is the honest
minimum. `// ponytail: inline bridge — extract to tools/ide/pty-bridge.mjs (+ tooling-map node)
when it outgrows ~150 lines or K10 needs to share it.`

**Protocol** (probe protocol, extended only where multi-session forces it):

- **URL**: `ws://<host>/pty?session=<id>&contract=<id>` — `session` required, must match
  `^[A-Za-z0-9-]{1,64}$`; `contract` optional, must match `^[A-Za-z0-9._-]{1,64}$`. A failed
  validation closes the socket before any spawn. Only `/pty` upgrades are intercepted; Vite's
  own HMR websocket falls through untouched (probe gotcha, preserved verbatim).
- **Spawn**: `pty.spawn(cmd, args, { name: 'xterm-256color', cols, rows, cwd: server cwd })`.
  Default `cmd = 'claude'`, no args. **`NOVAKAI_PTY_CMD` env override** (run as
  `/bin/sh -c "$NOVAKAI_PTY_CMD"`): the deterministic hook e2e tests need on CI, where no
  `claude` binary or subscription exists. It substitutes the process under test, never fakes
  its output — the terminal still shows exactly what the real spawned process wrote.
- **client → server**: raw keystroke bytes, passed to `pty.write`; the single JSON control frame
  `{"type":"resize","cols":n,"rows":n}` routes to `pty.resize` (probe protocol — a user typing
  that exact JSON line is swallowed; acknowledged probe-inherited edge, negligible).
- **server → client**: raw PTY bytes only. **No in-band JSON frames** — Claude Code's own output
  could collide with any framing. Out-of-band signalling uses the ws close handshake:
  - PTY exit → server sends `ws.close(4000 + min(exitCode, 999), 'exit')`. Client maps
    `code >= 4000` → `status: 'exited', exitCode: code - 4000`.
  - Any other close (dev-server restart, network) → `status: 'disconnected'`.
  - Client-initiated close (user closes the session) → server `term.kill()` on `ws.on('close')`
    — the probe's no-orphan guarantee, preserved.
- **On connect**: the bridge appends the `start` record to the session log (§6) and the client
  marks the session running. On `exit`/`close` it appends the `exit` record.
- **Failure isolation**: `node-pty` is imported lazily inside `configureServer` in a
  `try/catch`; if the native module fails to load, the bridge logs one server-side line and
  never intercepts `/pty` — the app still boots and the Agents page shows its honest
  bridge-absent state (§8). The dev server must never be killed by this feature.
- **Security posture**: the bridge is a localhost, single-user, dev-server surface — the same
  trust boundary as Vite itself, which already serves the whole repo and executes its config.
  It still validates every client-supplied string (above), fixes `cwd` server-side, and spawns
  nothing but the pinned command. It is dev-only by construction: `vite build` output contains
  no bridge, so no deployed surface exists.
- **darwin gotcha**, pinned from the probe: npm's node-pty prebuild ships
  `prebuilds/darwin-*/spawn-helper` without its exec bit → `posix_spawnp failed`. A
  `postinstall` script carries the probe's fix:
  `chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper 2>/dev/null || true`
  (no-op on linux CI).

## 5. Session lifecycle + multi-session handling

- **create** (`+ new session`, or a future `startSession({ contract })` call): mint id, append
  chip + pane, open the ws, `new Terminal({ scrollback: 5000, cursorBlink: false, theme: §7 })`
  + fit addon, wire data both ways, make it the active session. `cursorBlink: false` because a
  blinking cursor is a moving pixel at rest — idle must be genuinely still (§3.5) even
  mid-session. Chip count is unbounded — each session is a real process the user asked for; no
  artificial cap, no confirm on create.
- **switch** (chip click): swap pane visibility, `fit()` + focus the incoming terminal. Nothing
  else — background sessions keep streaming into their (hidden) terminals, so returning shows
  everything that happened while away.
- **resize**: one `ResizeObserver` on the terminal area drives `fit()` on the active pane +
  the `resize` control frame. Hidden panes re-fit on activation (fitting a `display:none` pane
  measures zero).
- **exit** (Claude Code exits / stub finishes): close code `>= 4000` → chip gains the mono
  suffix `· exited <code>` at `var(--ink-faint)`, and the client writes **one** bracketed line
  into the terminal's own flow: `[session exited · code <n>]` in faint ink. That line is the
  single client-authored write into the stream, carved out explicitly: it states a real fact at
  the moment it happened, visibly bracketed as chrome — without it a dead pane silently eats
  keystrokes. Everything else in the scrollback is untouched PTY output, which stays readable
  until the session is closed. No re-spawn button — a finished session is a record, not a slot;
  the human starts a new session (one distinct act, §1.7's spirit). No colour escalation on
  non-zero codes — the number is the honest signal; a red/amber tier for "bad" exits is a
  semantic the law does not define.
- **disconnect** (bridge vanished mid-session): suffix `· disconnected`, chip at
  `var(--ink-faint)`; scrollback stays; the same single bracketed line grammar applies
  (`[bridge connection lost]`). No auto-reconnect at K6 — the bridge killed the PTY when the
  socket died, so reconnecting cannot resurrect it; pretending otherwise would be a lie (§11
  upgrade path). Faint, not amber — nothing is pending (§1 design-track record).
- **close** (chip `×`): a **running** session confirms **in place**: the `×` flips to the
  literal word `end?` in the same element; a second click within it commits, and pointer-leave
  or a click anywhere else reverts to `×`. No modal, no toast — the house's confirm-in-place
  idiom (KEY_DECISIONS §3.9, copy→copied). Exited/disconnected sessions close on one click
  (nothing left to lose). Close tears down ws → bridge kills PTY → pane + chip removed.
  Ordinals are never reused within a page lifetime.
- **keyboard**: while a terminal is focused every keystroke belongs to Claude Code. This is
  already true by construction: xterm focuses its internal helper `<textarea>`, and the app's
  global shortcuts bail on textareas (`isEditing`, `src/interaction/keyboard.ts:40`). The build
  verifies it (§10 row 6) rather than trusting this trace.
- **page unload**: sockets close with the page; the bridge kills every PTY (probe's no-orphan
  behaviour) and logs `exit` records. Sessions do not survive reload (§11).

## 6. What K6 emits for the Contracts activity feed (and what it refuses to)

**Emits: session lifecycle facts, nothing more.** The bridge (the side with the real clock, the
real pid and the real exit code) appends one JSON line per event to
**`docs/novakai/metrics/agent-sessions.jsonl`**:

```jsonl
{"event":"start","session":"<uuid>","cwd":"/abs/repo/root","contract":"chg-frame-transform","pid":4242,"ts":"2026-07-07T12:00:00.000Z"}
{"event":"exit","session":"<uuid>","exitCode":0,"ts":"2026-07-07T12:41:03.412Z"}
```

- **Why this path**: `docs/novakai/metrics/` is already the repo's classified home for
  session/machine-local telemetry and is already gitignored with the rationale written down
  (append-only logs guarantee EOF merge conflicts; `.gitignore`, metrics block). Reusing it
  means zero new `.gitignore` entries, zero new storage concepts, and K10 finds agent data
  where the metrics summarizer already looks.
- **Who consumes it**: K4's activity feed MAY render these as plain-language lines ("a claude
  session started on this contract · 12:00"); K10 derives session count/duration per contract
  from start/exit pairs, joined with Claude Code's own immutable transcript JSONL under
  `~/.claude` (by cwd + time window) for spend — that join is K10's design, this file is its
  per-repo anchor.
- **Refuses**: any narration of agent *activity* ("claude is editing files…") — that would
  require parsing the ANSI stream, which is guessing dressed as data (manifest §4). The real
  activity record already exists twice without K6's help: the terminal scrollback (live) and
  the `~/.claude` transcripts (durable). K6 adds only the fact it uniquely owns: that a session
  ran, where, when, for what contract, and how it ended.

## 7. Two-actor colour law compliance (§3.2 — the most-protected rule)

| surface | hue | source | why it's lawful |
|---|---|---|---|
| active chip bottom bar | periwinkle | `var(--accent)` | the human's current focus — exactly the human actor (the rail's own active idiom, SPEC_SHELL §2, rotated 90°) |
| active chip text | ink | `var(--ink)` | focused = full ink, same as the rail |
| inactive running chip | dim | `var(--ink-dim)` | quiet, not a claim |
| exited / disconnected chip + suffix + bracketed line | faint | `var(--ink-faint)` | a finished/broken thing shown honestly, never hidden |
| chip `×` hover | `var(--danger)` | existing house hue | the pre-existing destructive-hover recipe (`.fm-x:hover`, `css/styles.css:655`) — reused, not new, and not a claim hue |
| empty-state lines | faint | `var(--ink-faint)` | quiet chrome (the K3 `.empty` grammar reused) |
| xterm `background` / `foreground` | `var(--bg)` / `var(--ink)` values | house | the terminal is the page, not a boxed pane — no new surface var |
| xterm `cursor` / `cursorAccent` | periwinkle `#7c8cff` / `var(--bg)` value | law value | the cursor is literally where the human acts — the human actor's mark; page-bg accent keeps the glyph under a block cursor legible |
| xterm `selectionBackground` | periwinkle @ ~25% alpha | law value | selection = human focus, same as everywhere else |

**No teal anywhere on this page** — the shell/chrome makes no machine-proven claim (the proof
seam belongs to nodes, cards and build documents). **No green** — a session exit code is a fact,
not a novakai verdict; it renders in faint ink, never `--proven` green. **No amber** — nothing
on this page is "pending"; a connecting session simply has no output yet, and inventing a
pending hue would be theatre. **No spinners/progress** during connect (§3.4): between `+ new
session` and the first PTY byte the pane is simply empty — Claude Code's own banner is
the loading indicator, and it is real.

**The ANSI exemption, bounded precisely**: *inside* the xterm viewport is the agent's real
output — Claude Code's own colours are its own honest voice and are never restyled, filtered or
re-themed (recolouring the evidence would be manufactured data). The law governs every pixel
*outside* the viewport: strip, chips, empty states, and the xterm *chrome* theme values above, and
the two bracketed lifecycle lines (§5) — client-authored, therefore chrome, therefore faint ink.
The reviewer's grep for unlawful hex literals (§10 row 7) therefore runs over `agents.css` and
the `src/ide/agents*` TS — the xterm ANSI palette defaults live inside the xterm dependency and
are exempt by this boundary.

## 8. Page states (all honest, all designed)

Empty-state copy uses the BINDING grammar (one dim mono line + one fainter command line —
`.empty` / `.empty-cmd` classes already shipped by K3, reused as-is):

| state | line 1 (dim mono) | line 2 (fainter) |
|---|---|---|
| **no sessions yet** | `run Claude Code in a real terminal, in the repo` | `+ new session — spawns claude at the repo root` |
| **bridge absent** (production build — no dev server) | `no PTY bridge in this build` | `npm run dev — the bridge lives in the dev server (SPEC_AGENTS §4)` |
| **bridge broken** (dev, but `/pty` refused the handshake) | `the PTY bridge did not answer` | `check the dev-server log — node-pty may have failed to load (SPEC_AGENTS §4)` |

- The **no-sessions** state fills the terminal area; the strip (with `+ new session`) is still
  present — the `+` control is the state's own line-2 made actionable.
- **bridge absent** is known statically, no network round-trip: `import.meta.env.DEV` is false
  in `vite build` output, where the bridge cannot exist by construction. The strip renders
  without the `+` control (an affordance that can never work is a lie), just the state above.
- **bridge broken** is the dev-mode fallback, detected honestly on the first `+ new session`
  attempt: the ws errors/closes before any PTY byte; the failed session's pane renders the
  state above and its chip is removed. No probing on page load — the page never speculates
  about a server it hasn't asked.
- **running / exited / disconnected** are §5's chip grammar; the pane content in every one of
  them is real scrollback, never a synthetic message painted over it.
- This finalizes the K3 placeholder line-2 for this tab (SPEC_SHELL §7 hands each owning phase
  that duty). `pages.ts` is frozen for this lane; its now-shadowed `agents` row (§2's covered
  empty state) is the seam owner's to update or drop with the seam PR — this spec's table is
  the pinned text either way.

## 9. Files, dependencies, standards

**Owned files (this lane, complete list):**

| file | role |
|---|---|
| `docs/ide-vision/SPEC_AGENTS.md` | this spec |
| `src/ide/agents.ts` | `initAgents(ctx)` — layer, routing visibility, strip, states (fills the seam's stub) |
| `src/ide/agents-session.ts` | per-session factory: xterm + fit + ws wiring + lifecycle (KEY_DECISIONS §4.6's factory idiom — it exists N times) |
| `src/ide/agents.css` | all page styles, imported by `agents.ts` (per-lane CSS; `css/styles.css` untouched) |
| `src/ide/agents.novakai.mmd`, `src/ide/agents-session.novakai.mmd` | map fragments — the new modules are nodes, gate-covered like `shell.novakai.mmd` |
| `vite.config.ts` | the PTY bridge plugin (§4) — this lane is the only one permitted to touch it |
| `tests/e2e/agents.spec.ts` | the K6 e2e net (§10) |
| `playwright.config.ts` | one additive key: `webServer.env.NOVAKAI_PTY_CMD` for deterministic CI terminals (§10) |
| `package.json` | deps below + the darwin `postinstall` chmod (§4) |

**Dependencies**: `@xterm/xterm` + `@xterm/addon-fit` → `dependencies` (imported by `src/`);
`node-pty` + `ws` → `devDependencies` (dev-server only; prebuilds cover darwin-arm64 and the
linux-jammy CI container — probe environment note). Versions pinned at build time to the
probe-proven majors.

**Standards**: everything under `src/ide/**` lands in the K11 BLOCK tier
(`eslint.config.js:77` glob — complexity 15, max 60-line functions, max 500-line files,
max-depth 4, max-params 4). The two-module split above is sized for that budget. The inline
bridge in `vite.config.ts` sits outside the lint set (`eslint src tools`) like the rest of that
file — noted honestly; it inherits the spec's protocol table as its review surface.

## 10. Acceptance (computed where possible, looked-at where not)

e2e rides the J1 harness unchanged: the Playwright `webServer` already boots the real Vite dev
server (`playwright.config.ts`), so **the real bridge is live in every e2e run**; only the
spawned command is substituted (`NOVAKAI_PTY_CMD='sh -c "echo ready; exec cat"'` — prints one
deterministic line, then echoes; a real process, not a mock). On CI the server always starts
fresh with the env; locally, run agents e2e without a reused dev server (or export the var) —
`reuseExistingServer` is the existing J1 trade-off, inherited not added.

| # | check | how |
|---|---|---|
| 1 | route renders: `#agents` shows strip + empty state, zero console/page errors | e2e |
| 2 | session round-trip: `+ new session` → `ready` appears → typed `hello` echoes | e2e |
| 3 | **survival**: route to `#codebase` and back → scrollback intact, session still live | e2e |
| 4 | exit: `Ctrl-D` → chip shows `· exited 0`; scrollback still readable | e2e |
| 5 | log: `agent-sessions.jsonl` gained a `start` and an `exit` record for that session id | e2e (fs read) |
| 6 | keyboard isolation: with terminal focused, `l` / `Tab` reach the PTY, not link-mode/panel | e2e |
| 7 | colour law: grep `agents.css` + `src/ide/agents*.ts` for hex literals outside the law set (law values + existing slate/line/ink/danger vars) → must be empty | build-plan verify row |
| 8 | J1 net green: journeys, wire-geometry, goldens — the editor is untouched | existing CI |
| 9 | gates green: `npm run novakai:verify:full`; map re-synced (`novakai:ship`) with the two new module nodes | existing CI |
| 10 | **manual Chromium render**: real `claude` in the terminal at the repo root, trust-prompt → full TUI → keystroke round-trip (the probe's layer-2 evidence, now in the shipped page), screenshots LOOKED at | human/0-context verifier |
| 11 | independent 0-context re-proof from command output alone | session protocol #3 |

**Predicate hardening** (master-plan rule: each phase hardens its own predicates in its build
PR): K6's roadmap checks should grow `grep src/ide/agents.ts → export function initAgents`,
`file src/ide/agents.novakai.mmd`, and `grep vite.config.ts → /pty`. `docs/novakai/ide-roadmap.json`
is **frozen for this lane** — the build PR will state these three rows for the orchestrator to
land; this spec records them so they are pinned, not remembered.

## 11. What K6 does not touch + accepted limitations

**Untouched**: `src/main.ts` (the seam call is the seam PR's), `src/ide/shell.ts`,
`src/ide/pages.ts`, `css/styles.css`, the editor and every other lane's files. No `ctx.hooks`
additions, no `ctx.state` fields (§3).

**Accepted limitations, each with its recorded upgrade path** (`// ponytail:` comments at the
implementation sites):

1. **Reload kills sessions.** Sockets die with the page; the bridge kills the PTYs (no orphans
   — the stronger failure would be invisible processes). Upgrade: bridge-side session registry
   keyed by session id with output buffering + client reconnect — server work only, protocol
   already carries the id.
2. **No reconnect after bridge loss** — an honest `disconnected` state instead (§5).
3. **No terminal goldens** — glyph rasterisation varies across platforms; the deterministic
   assertions are textual (row 2/3). The empty-state page gets a normal golden.
4. **Chips don't persist across reload** (follows 1) — the session *log* is the durable record.
