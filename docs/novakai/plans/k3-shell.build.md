# k3-shell.build — build plan for the IDE shell

> Implementation plan for **K3 — IDE shell**. Design spec: `docs/ide-vision/SPEC_SHELL.md`.
> House architecture: `initShell(ctx)` factory wired in `main.ts`, cross-module calls through
> `ctx.hooks`, `ctx.state` the source of truth (invariants from `npm run novakai:onboard`). Vanilla
> TS + hand-built DOM, CSS in `css/styles.css`, **zero new dependencies**. Every claim in this plan
> is a runnable command in §7.

---

## 1. Strategy (the one load-bearing decision)

The Codebase page **is the existing app, as-is** — boot's `unfold.open()`, `#main`, and the
`#ufCompare` legacy path all untouched (SPEC_SHELL §0/§5). K3 does not redefine boot and does not
choose between the unfold overlay and `#main`; it frames whatever the app is today.

**The app is inset 68px, and the rail floats above the boot overlay.** Two CSS lines: `body {
padding-left:68px }` shifts header + main into the gutter's right; `#rail { position:fixed; left:0;
width:68px; z-index: 80 }` floats the rail over the gutter, **above** the unfold overlay's
`z-index:70` (`src/panel/unfold/unfold.ts:83`) so it is never buried at boot. Inset (not overlay) is
forced by the real code: an overlay rail would bury the legacy editor's zoombar (`.zoombar { left:14px
}`, `css/styles.css:288`) on the durable Codebase surface; inset shifts it clear. The boot overlay
itself is `inset:0` fixed (immune to body padding), so one more K3 CSS line — `#unfoldOverlay {
left:68px }` (the element's id, `unfold.ts:427`) — tiles it beside the rail, keeping its dock
(`#ufZin` would otherwise be fully buried at x≈14–48) visible and clickable. Full trace: SPEC_SHELL §3.

Ponytail: no editor edits, no reparenting, no new deps, no framework, one CSS block, two source
files, instant page swap (no transition choreography).

---

## 2. New files

| file | exports | contents |
|---|---|---|
| `src/ide/shell.ts` | `initShell` | the factory: build `#rail` (8 items + spacer + gate glyph) + the hash router + host show/hide. Default route `codebase`. Codebase route hides `#host` (reveals `#main`); the other 7 render `emptyPage(def)` into `#host`. Instant swap — no lifecycle. |
| `src/ide/pages.ts` | `EMPTY`, `emptyPage`, `RAIL_ICONS` | data-driven empty states: the `EMPTY` table (`{id,label,line1,cmd}`, SPEC_SHELL §7), the `emptyPage(def)` factory (one dim mono line + fainter command, `.empty`/`.empty-cmd`), and the 8 inline-SVG rail icons + the gate glyph (SPEC_SHELL §1). Kept out of `shell.ts` to hold both files under the K11 max-file-length rule. |

Two files, not nine. The 7 empty tabs are rows in `EMPTY`, not modules — YAGNI until a tab is built
(each real tab arrives as its own `initX` in K4–K10 and *replaces* its `EMPTY` row).

`initShell(ctx): void` — **no deps object, no return value.** The old `{ showTab }` dep had no K3
consumer (cut). There is no `ShellApi` at K3: nothing navigates programmatically yet; K5 adds a
`go(page)` return when the Design→Contracts hand-off needs it. Do not invent an interface with no
caller.

**The directory is not a free choice.** `src/ide/` is bound by K11's BLOCK-tier lint glob
(`src/ide/**/*.ts` at `error` — `docs/novakai/plans/k11-standards.build.md` §1). All new IDE code —
the K3 shell AND the future K4–K10 page modules — lands under `src/ide/` so it can never silently
escape enforcement; moving the directory means moving the glob and the `docs/CODING_STANDARDS.md`
tier table in the same PR.

Naming guard: the K7 Files page factory is `initFilesPage` — do **not** name anything here
`initFiles` (that is the editor's existing save/load module, `src/io/files.ts`). K3 introduces no
`initFiles*` symbol; the Codebase route is handled inside `initShell`.

---

## 3. index.html + CSS edits

**`index.html`** — add the shell layers as siblings (not wrappers) of the existing `<header>`/`<main>`,
so `#main` keeps its box:
- `<nav id="rail" aria-label="pages"></nav>` (rail items built by `initShell`).
- `<div id="host"></div>` for the 7 non-editor pages (hidden until a non-codebase route).
Keep the existing `<header>` toolbar and `<main id="main">` exactly as they are. No `#shellHeader` —
the shell has no top header (SPEC_SHELL §3).

**`css/styles.css`** — one appended block:
- `body { padding-left: 68px; }` — the 68px inset (comment: `/* IDE rail gutter — see docs/ide-vision/SPEC_SHELL.md §3 */`).
- `#rail` — `position:fixed; left:0; top:0; bottom:0; width:68px; z-index: 80;` (the spaced form
  `z-index: 80` is load-bearing — the hardened K3 predicate greps for it verbatim) with the durable
  comment `/* > unfold overlay (70, unfold.ts:83) — rail must sit above boot's overlay */`, plus
  `.rail-item` (+`:hover`/`.active`/`.active::before`), `.rail-icon`, `.rail-label`, `.rail-spacer`,
  `.rail-gate`.
- `#host` — `position:fixed; left:68px; top:0; right:0; bottom:0; z-index:72; display:none;
  background: var(--bg);` (above overlay 70, below rail 80). The `background` is load-bearing:
  the router never closes the boot overlay (it stays `display:flex` at z-70 beneath), and z-index
  orders paint without making a transparent element opaque — without `var(--bg)` the empty state
  renders see-through over the overlay. `.empty` (+`.empty-cmd`).
- `#unfoldOverlay { left: 68px; }` — with the durable comment `/* tile the boot overlay beside the
  rail — its inset:0 (unfold.ts:83) ignores body padding; ID out-specifies .uf-overlay — SPEC_SHELL §3 */`.
  This keeps the overlay's dock (`#ufZin` first, `unfold.ts:432`) fully visible right of the rail
  without editing `src/panel/unfold/**`.

All values from existing CSS vars — **no new hex, no new easing** (§color law, §7 verify). No
`.rail-dot` (count dot cut), no `#shellHeader`/`.wordmark`/`.page-name`, no `.page`/`.pre-enter`/
`.leave`/`.scroll-page` (instant swap, no transition machinery).

---

## 4. main.ts edit (the K3 predicate hook)

One line, after the existing module inits and hook wiring, before or after boot (order-independent —
the shell only reads the hash and paints the rail):

```ts
import { initShell } from './ide/shell';
// …
initShell(ctx);
```

`initShell` self-registers its `hashchange` listener, paints the rail, and shows the initial route
(default `codebase` → `#host` stays hidden, the editor is what the user sees). Boot flow
(`unfold.open()`, first render, `#ufCompare`) is unchanged. The grep predicate `initShell` in
`src/main.ts` is satisfied by the import + call.

---

## 5. Map obligations (A1 exports gate)

Every new `src/` module must enter `docs/novakai/_bundle.mmd` or the exports-completeness gate
(`novakai:exports`) and coverage gate fail. Add two sibling fragments (`*.novakai.mmd`, the format in
`src/panel/chrome/tabs.novakai.mmd`), then re-bundle:

| fragment | documents |
|---|---|
| `src/ide/shell.novakai.mmd` | `initShell` (function, `i0.accepts=ctx: AppContext`, returns `void`). One `desc`. |
| `src/ide/pages.novakai.mmd` | `EMPTY` (const), `emptyPage` (function → HTMLElement), `RAIL_ICONS` (const). `%% src` lines back to `src/ide/pages.ts#<symbol>`. |

Then `npm run novakai:ship` (bundle → validate → lint → coverage → exports → gate → edges → bodies).
The lint (`novakai-lint`) rejects a flat file-mirror, so the two fragments must be architectural
(group the factory vs the page-data), matching the tabs fragment's `subgraph` grammar. `main.ts`'s
own fragment documents boot phases, not every symbol, so the `initShell` call needs no new node
there — but confirm coverage stays green after the edit (§7).

---

## 6. The golden story — HONEST: the 6 linux goldens are regenerated in this PR

The pixel goldens are **viewport** screenshots (`expect(page).toHaveScreenshot(...)`,
`tests/e2e/screenshots.spec.ts:29` etc.; the inspector test states it outright — "Viewport (not
fullPage)", `screenshots.spec.ts:66–70`) at 1280×800 (`playwright.config.ts:11`). A permanently
visible left rail **plus** the 68px content inset changes viewport pixels, so **all 6 goldens are
expected to change**. Regenerating them here is the J1 net **working as designed** — "a red test after
a deliberate change is the net WORKING; update the expected value in that PR" (SESSION_HANDOFF
session-16).

**Regeneration command** (goldens are linux-only; render in the exact CI image or system fonts diff —
`screenshots.spec.ts:5–8`, CI `app-e2e` uses `mcr.microsoft.com/playwright:v1.61.1-jammy`,
`.github/workflows/spec-gate.yml:133`). Goldens were first cut on linux-**arm64** and CI is x64, so
pin the platform (SESSION_HANDOFF session-16, handoff line 135):

```
open -a Docker    # Docker Desktop must be running
docker run --rm --platform linux/amd64 --ipc=host \
  -v "$PWD":/work -w /work \
  mcr.microsoft.com/playwright:v1.61.1-jammy \
  sh -c "npm ci && npx playwright test tests/e2e/screenshots.spec.ts --update-snapshots"
# then commit ONLY tests/e2e/screenshots.spec.ts-snapshots/*
```

(Use `npm ci`, never `npm install` — the darwin lockfile trap, SESSION_HANDOFF session-16 line 134.)

**What is NOT regenerated — the editor-identical proof.** With the goldens legitimately changing, the
"editor behaves identically inside the Codebase page" claim rests on three things that MUST hold:

1. **DOM journeys unchanged** (`test:e2e -- journeys`) — `#main`, `#ufCompare`, all selectors
   untouched; the boot overlay is tiled beside the rail (`#unfoldOverlay { left:68px }`, §3), and
   Playwright clicks by selector, not coordinate, so the dock's 68px shift breaks nothing
   (SPEC_SHELL §3).
2. **`wire-geometry.expected.json` unchanged** — proven inset-safe: node positions come from
   `ORIGIN_X`/`ORIGIN_Y` + graph only (`src/io/layout.ts:343–482`), the layout module reads no
   viewport/stage dimension (grep `clientWidth|getBoundingClientRect|window|stage` in `layout.ts` →
   empty), camera is used only for `zoomToFit()` (`layout.ts:543`, transforms `#world` not node
   coords), and `#wires` is inside `#world` (`index.html:59–60`) so every `path d` is world-space,
   independent of stage width. Narrowing the stage 68px moves nothing. **No `UPDATE_WIRE_GEOMETRY`.**
3. **The diff touches zero files under `src/` except `src/ide/**` + `src/main.ts`**, plus
   `index.html` and `css/styles.css`. `git diff --stat` proves it (§7 row).

**Scope of these computed checks — be precise about what they certify.** Rows 1–3 certify **DOM
behaviour, world-space geometry, and diff scope** — they do NOT certify visual appearance. The
visual half of editor-identity rests on the regenerated goldens being **human-looked** in this PR
(§7 row 21): a person opens the 6 new baselines and confirms the editor renders as before, inset
beside the rail. Computed rows + human-looked goldens together are the honest editor-identity
certificate; neither alone is.

---

## 7. Verify table (every claim = a command)

| # | claim | command | expected |
|---|---|---|---|
| 1 | shell module exists + exports the factory | `grep -n 'export function initShell' src/ide/shell.ts` | one match |
| 2 | `initShell(ctx)` takes ctx only, no deps | `grep -nE 'initShell\s*\(\s*ctx\s*[:)]' src/ide/shell.ts` | one match, single param |
| 3 | main.ts wires it (K3 predicate) | `grep -n 'initShell' src/main.ts` | import + call |
| 4 | pages module exports the empty-state kit | `grep -nE 'export (const EMPTY\|function emptyPage\|const RAIL_ICONS)' src/ide/pages.ts` | three matches |
| 5 | no `initFiles*` name collision | `grep -rn 'initFiles' src/ide/` | no matches |
| 6 | 8 tabs, correct order | `grep -n "home\|design\|codebase\|contracts\|agents\|files\|analytics\|rules" src/ide/pages.ts` | the 8 ids in order |
| 7 | shell DOM present (rail + host, no shellHeader) | `grep -nE 'id="rail"\|id="host"' index.html` | two matches; `grep -c 'shellHeader' index.html` → 0 |
| 8 | **rail layered above the boot overlay** (computed) | `grep -c 'z-index: 80' css/styles.css` | `1` — only the `#rail` rule carries it (rail 80 > overlay 70); line-wrap-independent, same string the §9 predicate greps |
| 8b | **boot overlay tiled beside the rail** (computed) | `grep -n '#unfoldOverlay' css/styles.css` | one match: `left: 68px` (out-specifies `.uf-overlay` inset:0, unfold.ts:83,427) |
| 9 | count dot cut, no fake data | `grep -c 'rail-dot' css/styles.css src/ide/*.ts` | 0 |
| 10 | color law: no new hue in the shell CSS | `grep -oiE '#[0-9a-f]{6}' css/styles.css \| sort -u` reviewed for shell block | only law hues + existing slate/line vars; **no green** on the shell |
| 11 | typecheck clean | `npm run typecheck` | exit 0 |
| 12 | K11 lint clean on new files | `npx eslint src/ide` | zero BLOCK-tier violations (complexity ≤15, function ≤60 lines, depth ≤4, params ≤4, file ≤max) |
| 13 | map fresh + complete (new modules represented) | `npm run novakai:ship` | `DONE:` line, coverage + exports + gate green |
| 14 | J1 DOM journeys unchanged | `npm run test:e2e -- journeys` | all pass |
| 15 | **rail visible + clickable at boot** (computed, J1 addition) | `npm run test:e2e -- journeys` (new assertion: after `page.goto('/')`, before `#ufCompare`, `#rail` is visible and a `.rail-item` is clickable) | pass |
| 16 | J1 wire-geometry unchanged | `npm run test:e2e -- journeys` (wire-geometry test) | pass, no `UPDATE_WIRE_GEOMETRY` |
| 17 | **goldens regenerated + committed, then match** | after `--update-snapshots` in the jammy `--platform linux/amd64` container (§6), rerun goldens with no update flag | 6/6 match the newly committed baselines; git shows the snapshot dir changed |
| 18 | product diff confined to shell files | `git diff --name-only -- src ':!src/ide' index.html css/styles.css \| grep -vE '^(src/main.ts\|index.html\|css/styles.css)$'` | empty (nothing under `src/` except `src/ide/**` + `main.ts`) |
| 19 | full gate | `npm run novakai:verify:full` | exit 0 |
| 20 | K3 status computed built | `npm run novakai:ide` | K3 no longer MISSING |
| 21 | boot defaults to editor; a rail tab swaps the host; overlay dock clear of the rail; goldens human-looked | load `/`, no hash → rail visible, Codebase shown, **the unfold zoom buttons (`#ufZin` first) fully visible and clickable right of the rail**; click a rail tab → `#host` shows the empty state; click `codebase` → editor back, `#ufCompare` still reveals legacy; **open the 6 regenerated goldens and confirm the editor renders as before, inset beside the rail** | manual, real Chromium, zero console errors |

Rows 8/8b and 15 are the honest computed proofs that the rail is present-and-usable at boot and the
boot overlay is tiled beside it (static CSS greps + a behavioural journeys assertion); row 21 stays
manual for the full click-through and the visual half of editor-identity (§6).

---

## 8. K11 compliance (BLOCK tiers)

All new K3 code arrives under the coding standards (K11 lands before/alongside K3). Both new files
live under `src/ide/` — the exact glob K11's BLOCK tier binds to (`src/ide/**/*.ts` at `error`,
k11-standards.build.md §1) — and must satisfy the **BLOCK-tier** rules: cyclomatic/cognitive
complexity ≤15, max-lines-per-function ≤60, max-depth ≤4, max-params ≤4, and max file length. This is
why the shell is split into `shell.ts` + `pages.ts`. `initShell` delegates rail-building, route
resolution and host show/hide to small local helpers so no single function exceeds 60 lines. Verify:
row 12.

---

## 9. Hardened K3 predicates (apply in this PR, editing `docs/novakai/ide-roadmap.json`)

Re-derived from the reworked design. Editing `checks` is an explicit act (ide-roadmap header rule);
this PR hardens them to what it actually delivers:

```jsonc
"checks": [
  { "kind": "file",   "path": "docs/ide-vision/SPEC_SHELL.md" },
  { "kind": "grep",   "path": "src/main.ts", "pattern": "initShell" },
  { "kind": "grep",   "path": "src/ide/shell.ts", "pattern": "export function initShell" },
  { "kind": "grep",   "path": "src/ide/pages.ts", "pattern": "emptyPage" },
  { "kind": "file",   "path": "src/ide/shell.novakai.mmd" },
  { "kind": "grep",   "path": "index.html", "pattern": "id=\"host\"" },
  { "kind": "grep",   "path": "css/styles.css", "pattern": "z-index: 80" },
  { "kind": "grep",   "path": "css/styles.css", "pattern": "#unfoldOverlay" },
  { "kind": "manual", "note": "editor behaves identically inside the Codebase page — J1 journeys + wire-geometry green with no UPDATE_WIRE_GEOMETRY; goldens deliberately regenerated in this PR and human-looked (the visual half of editor-identity); a new journeys assertion proves the rail is visible + clickable at boot; the unfold dock is fully visible right of the rail" }
]
```

The `css/styles.css` `z-index: 80` grep is the **computed** "rail above the boot overlay" predicate
(the static half of "visible at boot"); the behavioural half (rail visible + clickable at boot) is
the new journeys assertion, carried in the manual note (CI's `app-e2e` runs it; a `cmd` predicate
would be skipped under `NOVAKAI_ROADMAP_SKIP_CMD` — note K3 computes `partial` either way while a
manual note exists, which verify row 20's "no longer MISSING" already accounts for). File + grep
predicates plus one manual note, all real.

---

## 10. Edit loci (exact file list)

- **new** `src/ide/shell.ts`
- **new** `src/ide/pages.ts`
- **new** `src/ide/shell.novakai.mmd`
- **new** `src/ide/pages.novakai.mmd`
- **edit** `src/main.ts` — import + one `initShell(ctx)` call (§4)
- **edit** `index.html` — `#rail`, `#host` siblings (§3); no `#shellHeader`
- **edit** `css/styles.css` — one appended shell block incl. `body { padding-left:68px }` and
  `#unfoldOverlay { left:68px }` (§3)
- **edit** `tests/e2e/journeys.spec.ts` — one new assertion: rail visible + clickable at boot (§7 row 15)
- **regenerate** `tests/e2e/screenshots.spec.ts-snapshots/*` — the 6 goldens, in the jammy
  `--platform linux/amd64` container (§6); this is the ONLY regenerated baseline
- **edit** `docs/novakai/ide-roadmap.json` — hardened K3 `checks` (§9)
- **regenerate** `docs/novakai/_bundle.mmd` + `public/bodies.json` via `npm run novakai:ship`
- **untouched** everything else under the editor (`src/panel/**`, `src/render/**`,
  `src/interaction/**`, `src/io/**`, and `tests/e2e/wire-geometry.expected.json`)
</content>
