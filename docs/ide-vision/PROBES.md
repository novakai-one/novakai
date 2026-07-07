# K2 — IDE probes

Three feasibility experiments settling the load-bearing facts behind the IDE shell (Phase K,
`docs/ide-vision/IDE_MASTER_PLAN.md` §K2). Probe code is throwaway by design — it lives outside
this repo, in a scratch directory, and only this record merges here. If a probe needs to be
re-run, rebuild it from the reproduction notes below rather than looking for the original scratch
files.

## probe-terminal — PASS
Claim (K2 intent a): a Vite dev-server plugin can bridge node-pty over WebSocket to xterm.js and run real Claude Code (ruling R2: no separate backend).
Date: 2026-07-07.
Environment: macOS darwin arm64, node v24.13.0, vite 8.1.3 (scratch dir, not a repo dep), Playwright 1.61.1 bundled Chromium 1228 (headed), Claude Code CLI 2.1.200, scratch deps: node-pty, ws, @xterm/xterm, @xterm/addon-fit.
What ran: a scratch `vite.config.mjs` plugin intercepting ONLY `/pty` upgrade requests on the dev server's `httpServer` (Vite's own HMR websocket untouched — checked pathname and fell through otherwise), `pty.spawn('claude', [], {name:'xterm-256color', cols, rows, cwd})`, `pty.onData` piped to `ws.send`, ws messages piped to `pty.write` (a JSON `{type:'resize',cols,rows}` message routed to `pty.resize`), pty killed on ws close. Page: `@xterm/xterm` + fit addon connected over `ws://host/pty`.
Observed evidence — layer 1 (headless): a raw `ws` client connected to `/pty` and collected 1361 bytes in 12s matching `/claude/i` with ANSI escapes — Claude Code's real first-run trust-folder TUI.
Observed evidence — layer 2 (headed Chromium): `terminal.html` rendered the trust prompt in xterm.js; pressing Enter advanced to the full Claude Code UI (version banner v2.1.200, model/effort footer); typing "hello" echoed in the prompt — the full keystroke round-trip xterm.js to ws to node-pty to claude was proven end to end. Screenshots were reviewed by the session lead. No orphan claude process remained after ws close (the `term.kill()` handler ran).
Reproduction note:
```
npm i vite node-pty ws @xterm/xterm @xterm/addon-fit
# CRITICAL gotcha: npm's node-pty prebuild ships prebuilds/darwin-*/spawn-helper
# without its exec bit -> Error: posix_spawnp failed. Fix before spawning:
chmod +x node_modules/node-pty/prebuilds/darwin-*/spawn-helper

# vite.config.mjs plugin sketch (~20 lines)
import { WebSocketServer } from 'ws'
import pty from 'node-pty'
function ptyPlugin() {
  return {
    name: 'pty-bridge',
    configureServer(server) {
      const wss = new WebSocketServer({ noServer: true })
      server.httpServer.on('upgrade', (req, socket, head) => {
        if (!req.url.startsWith('/pty')) return // let Vite's own HMR ws handle it
        wss.handleUpgrade(req, socket, head, (ws) => {
          const term = pty.spawn('claude', [], { name: 'xterm-256color', cols: 80, rows: 24, cwd: process.cwd() })
          term.onData((d) => ws.send(d))
          ws.on('message', (m) => {
            const s = m.toString()
            try {
              const msg = JSON.parse(s)
              if (msg.type === 'resize') return term.resize(msg.cols, msg.rows)
            } catch { /* not JSON: raw keystrokes */ }
            term.write(s)
          })
          ws.on('close', () => term.kill())
        })
      })
    }
  }
}

# terminal page sketch
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
const term = new Terminal(); const fit = new FitAddon()
term.loadAddon(fit); term.open(document.getElementById('term')); fit.fit()
const ws = new WebSocket(`ws://${location.host}/pty`)
ws.onmessage = (e) => term.write(e.data)
term.onData((d) => ws.send(d))
```
Caveats/gotchas: port note — use a free port; 5199 was taken locally, 5299 was used instead. Vite 8
binds localhost as IPv6 `[::1]` — a raw headless ws client dialing `ws://127.0.0.1:<port>/pty` gets
ECONNREFUSED; dial `ws://localhost:<port>/pty` (or `[::1]`) instead. The in-page client is immune
(it uses `location.host`). Found by the independent 0-context re-run of this note.

## probe-files — PASS
Claim (K2 intent b): the File System Access API can open/read/edit/create real files from the app origin (and switching directories doubles as repo switching).
Date: 2026-07-07.
Environment: macOS darwin arm64, node v24.13.0, vite 8.1.3 (scratch dir, not a repo dep), Playwright 1.61.1 bundled Chromium 1228 (headed).
What ran: a static `fsprobe.html` served from the same localhost origin; `showDirectoryPicker({mode:'readwrite'})` on dir A, listing its entries, reading `seed.txt` ("alpha-original\n"), rewriting it via `createWritable` ("edited-by-probe\n"), creating `created.txt` ("created-by-probe\n"), then picking dir B (a directory switch) and reading `beta.txt` ("beta-original\n"). Feature detection recorded `'showDirectoryPicker' in window` = true, `isSecureContext` = true (localhost).
Observed evidence: all ten page-log lines read OK. Bytes on disk were verified independently with `od -c` by the session lead: `fsroot-a/seed.txt` read exactly "edited-by-probe\n", `fsroot-a/created.txt` read "created-by-probe\n", `fsroot-b/beta.txt` was untouched.
Reproduction note:
```
# fsprobe.html — served over http from a scratch vite/static server
const dirA = await window.showDirectoryPicker({ mode: 'readwrite' })
for await (const [name, handle] of dirA.entries()) log(name, handle.kind)
const seedHandle = await dirA.getFileHandle('seed.txt')
log(await (await seedHandle.getFile()).text())
const w = await seedHandle.createWritable()
await w.write('edited-by-probe\n'); await w.close()
const created = await dirA.getFileHandle('created.txt', { create: true })
const w2 = await created.createWritable(); await w2.write('created-by-probe\n'); await w2.close()
const dirB = await window.showDirectoryPicker({ mode: 'readwrite' }) // pick a different folder
const betaHandle = await dirB.getFileHandle('beta.txt')
log(await (await betaHandle.getFile()).text())

# verify on disk
od -c fsroot-a/seed.txt fsroot-a/created.txt fsroot-b/beta.txt
```
Caveats/gotchas: the picker REQUIRES a user gesture and native OS chrome — in the K7 Files tab this is a human click, fine as is. For automation the probe drove the native macOS panel via `osascript` System Events (needs Accessibility permission): activate the browser process (Playwright's bundled build is named "Google Chrome for Testing" in System Events, NOT "Chromium"), then Cmd+Shift+G, keystroke the absolute path, Return (navigate), Return (choose). No Chrome permission bubble appeared for readwrite mode in this build. macOS `screencapture` can fail transiently at the instant a native panel spawns — tolerate and retry.

## probe-contracts-render — PASS
Claim (K2 intent c): one real contract/plan artifact renders into the prototype's certificate-document layout (data to document mapping with zero fake data).
Date: 2026-07-07.
Environment: macOS darwin arm64, node v24.13.0, vite 8.1.3 (scratch dir, not a repo dep), Playwright 1.61.1 bundled Chromium 1228 (headed).
What ran: a real contract packet for plan change `frame-transform` (the only change in `public/plan.json` carrying acceptance cases — 3 — plus an fm signature), generated in the worktree with:
```
npm run novakai:bodies
node tools/novakai/contract/contract.mjs --change frame-transform --plan public/plan.json --json > packet.json
```
Gotcha for the fence: `npm run novakai:contract -- ... --json` prepends npm's banner to stdout, corrupting the JSON — invoke the script via `node` directly (identical invocation) or use `npm run --silent`.
Render: certificate CSS extracted verbatim from the sha-pinned prototype (`docs/ide-vision/novakai_vision_prototype.html` lines 1297-1329 `.bl-card`, 1361-1940 build-document/`.bd-rail` tide rail/`.trust-seal`, plus the `:root` variable block lines 31-49 so it styles standalone); a 760px single-column page fetching `packet.json`, every rendered VALUE traceable to a JSON path (`change.id`/`target`/`phase`/`risk`/`status`, `intent.problem`/`approach`/`rationale`, `signature.name`+`interfaces`, `source.path::symbol`, `acceptance.cases[].name` x3, `blastRadius.affected.length` = 0 + `maxDepth` = 0 + `entryPoints` = (none), `deps` = (none), `contractVersion` + a truncated `contractHash` 2c95a27a1a7a...c8bed1). The trust seal rendered UNSEALED with the keystone line dim — the packet carries no gate verdict field, and rendering it sealed would be fake data. The empty blast radius is the real current value (nothing calls the extracted function yet) and is displayed as such with an honest caption.
Observed evidence: headed Chromium, 9/9 programmatic DOM assertions cross-checking rendered text against the fetched packet (one methodology note: assert on `textContent`, not `innerText` — the eyebrow's CSS `text-transform` uppercases `innerText`); zero console errors beyond the favicon 404; full-page screenshot reviewed by the session lead.

---

A FAIL on any probe would have routed the affected tab's plan back to Chris with fallback options
(vision record D3) — none needed, all three claims settled PASS.

The only console error observed in every browser run across all three probes was a favicon.ico 404
from the scratch dev server — benign, no page errors anywhere.
