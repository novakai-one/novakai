# SPEC_SHELL — the IDE shell (K3 design spec)

> Design spec for **K3 — IDE shell**: a left icon rail + a hash router + a page host that swaps 8
> pages. The **Codebase page IS the existing app, as-is** — the unfold-overlay boot included, the
> `#main` editor and its `#ufCompare` legacy path untouched. K3 does not redefine boot and does not
> choose between the unfold overlay and `#main`; it **frames whatever the app is today**. The other
> 7 tabs render designed empty states carrying their command. Build plan (files, edits, verify
> table) is the sibling `docs/novakai/plans/k3-shell.build.md`.
>
> **What is BINDING here and what is a design choice.** Only two things bind: the empty-state
> grammar (`PROTO_MANIFEST.md:94` — "designed empty state: one dim mono line") and the build-document
> rows. The prototype's `#rail`/`.rail-item`/`RAIL_ICONS`/`Router` values are **DIRECTION (R9)**, not
> law — the manifest has no BINDING row for them. The rail geometry, z-index, layout mode and
> transition below are **choices this spec makes**, traced against the real app — not manifest quotes.
> `/novakai` fundamentals are king; the prototype is direction only.

---

## 0. What K3 is and is not

- **IS**: a left icon rail (always visible on every tab, Codebase included), a hash router, and a
  page host that swaps 8 pages. The current app becomes the **Codebase** page, **byte-identical in
  behaviour** — same boot (`unfold.open()`), same `#main`, same `#ufCompare` path. The other 7 tabs
  are honest empty states that name what they will be. New `src/ide/` module(s) + one `main.ts`
  wiring line + a few `index.html` elements + one CSS block. No framework, vanilla TS + hand-built
  DOM, CSS in `css/styles.css` (repo convention), zero new dependencies.
- **IS NOT**: any tab's actual functionality (K4–K10 build those), any editor behaviour change, any
  new colour, any reparenting of the editor DOM. The app is **inset 68px to the right** to give the
  rail its own gutter (§3) — a deliberate, sanctioned shift, not a reflow of the editor's internals.

**Where the code lives (bound to K11).**
All new IDE shell/page modules live under `src/ide/**` — this path is bound by K11's BLOCK glob (`eslint.config.js`); moving it requires moving the glob and the `docs/CODING_STANDARDS.md` tier table in the same PR.
The K4–K10 page modules (`initContracts`, `initDesign`, `initAgents`, `initFilesPage`, `initHome`,
`initRules`, `initAnalytics`) land under `src/ide/` as they are built, so no IDE code ever escapes
BLOCK-tier enforcement.

---

## 1. Tab order, icons, labels

Eight pages, in this fixed left-to-right (top-to-bottom on the rail) order. Order is the vision
record's table order (`260707_IDE_VISION_RECORD.md` §"The 8 tabs"), read top-down on a vertical rail:

| # | id (route) | rail label | state at K3 |
|---|------------|-----------|-------------|
| 1 | `home` | `home` | empty state (K8) |
| 2 | `design` | `design` | empty state (K5) |
| 3 | `codebase` | `codebase` | **the existing editor, unchanged** |
| 4 | `contracts` | `contracts` | empty state (K4 — keystone, built next) |
| 5 | `agents` | `agents` | empty state (K6) |
| 6 | `files` | `files` | empty state (K7) |
| 7 | `analytics` | `analytics` | empty state (K10) |
| 8 | `rules` | `rules` | empty state (K9) |

Labels are **permanent** mono text under each icon — a cold user can tell the pages apart at rest.
Titles are literal descriptive words, never marketing copy (KEY_DECISIONS §1.9).

**Icons**: reuse the prototype's three where they map (as DIRECTION) — prototype `canvas`→our
`codebase`, prototype `builds`→our `contracts`, prototype `prototypes`→our `design`. The five new
tabs (home, agents, files, analytics, rules) each get one 20×20 inline `<svg>` in the same house
grammar: `viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.4"
stroke-linecap="round" stroke-linejoin="round"`, rendered at `width:19px;height:19px`. Simple line
glyphs — home = house outline, agents = terminal chevron, files = folder, analytics = two bars,
rules = checklist. Drawing them is the only new asset K3 authors; keep each ≤3 paths.

Below the 8 items: a `rail-spacer` (`flex:1 1 auto`) then the muted **map-gate glyph** at the bottom
(port of the prototype's `RAIL_ICONS.gate`) — a non-interactive shield whose hover title is the real
proving command `npm run novakai:onboard`. This is the smallest always-on trust signal on the rail;
it is the shell's only persistent chrome besides the rail itself (there is no separate top header —
see §3).

---

## 2. Rail layout + states (design choices, traced — not manifest-bound)

Container `#rail`:

| property | value | why |
|---|---|---|
| position | `fixed; left:0; top:0; bottom:0` | the rail floats in the 68px gutter the app is inset into (§3); it is out of the body grid flow |
| width | `68px` | one icon + its label, comfortable target |
| z-index | **`80`** | **above the unfold overlay's `z-index:70` (`src/panel/unfold/unfold.ts:83`)** so the rail is never buried at boot. Durable comment required in the CSS: `/* > unfold overlay (70) — rail must sit above boot's overlay */` |
| background | `var(--panel)` | existing house var |
| border-right | `1px solid var(--line)` | existing house var |
| layout | `display:flex; flex-direction:column; align-items:stretch; padding:10px 0` | vertical rail |

Each `.rail-item`: column flex, `gap:3px`, `height:56px`, no border/bg, `color:var(--ink-dim)` at
rest, `cursor:pointer`, `transition: color 240ms, background 240ms` (house style: literal durations,
default easing — no `--ease` var exists in `css/styles.css` and none is added).

**States**:
- **rest**: icon at `--ink-dim`, label at `--ink-faint`.
- **hover**: `color:var(--ink); background:color-mix(in srgb, var(--panel-2) 60%, transparent)`.
- **active**: `color:var(--ink)` **plus** a 2px left bar in **periwinkle** — the human's current
  focus — drawn by `.rail-item.active::before { left:0; top:10px; bottom:10px; width:2px;
  border-radius:1px; background:var(--accent) }`. This is the ONE accent on the rail; see §6.

There is **no count dot** at K3 (cut — YAGNI). A contract-awaiting badge needs real awaiting-contract
data, which does not exist until K4; K4 adds the dot when it has a real number to show. K3 never
fakes one (manifest §4 — no simulated data).

**9px radius / anti-capsule** is a house invariant already in `css/styles.css` (`--radius:9px`); the
rail itself is square-edged, so nothing to add.

---

## 3. Layout: the 68px inset (the one load-bearing geometry decision)

**Decision: INSET, not overlay.** The whole app is shifted right by the rail width; the rail occupies
its own gutter and covers nothing on the Codebase surface. Implementation is two lines of CSS:

```
body { padding-left: 68px; }                 /* shift header + main into the gutter's right */
#rail { position: fixed; left: 0; width: 68px; z-index: 80; }   /* float over the gutter */
```

`body` is already `display:grid; overflow:hidden` (`css/styles.css:35`); `padding-left` shrinks its
content box, so the toolbar `<header>` and `<main>` both render 68px narrower and shifted right. The
`fixed` rail sits in the vacated gutter, above everything.

**Why inset and not an overlay rail (traced against the real code + the J1 tests):**

- An **overlay** rail (floating over the left 68px with no reflow) would sit on top of the legacy
  editor's own **zoombar** — `.zoombar { position:absolute; left:14px; bottom:14px }`
  (`css/styles.css:288`). A 68px rail covers `#zOut` (x≈18–48) and part of `#zLevel`, so a real
  human loses zoom-out on the **durable Codebase surface the app boots into**. That breaks something
  interactive → fails the decision criterion. Inset shifts the zoombar to viewport x≈82px, clear.
**The unfold overlay is inset too — one line, in K3's own CSS block, no unfold.ts edit.** The
overlay is `position:fixed; inset:0` (`.uf-overlay`, `unfold.ts:83`), so `body` padding does not
move it — left at 0, its dock's first zoom button (`#ufZin`, x≈14–48; `.uf-dock { left:14px }` +
34px buttons, `unfold.ts:117,432`) would be **fully buried and unclickable** under the 68px rail on
the surface every user boots into (`main.ts` calls `unfold.open()` unconditionally). K3's appended
CSS block therefore carries:

```
#unfoldOverlay { left: 68px; }  /* tile the boot overlay beside the rail — SPEC_SHELL §3 */
```

The overlay element carries that id (`overlay.id = 'unfoldOverlay'`, `unfold.ts:427`; class
`uf-overlay` at `:426`), and the ID selector (1,0,0) out-specifies the injected `.uf-overlay` class
rule (0,1,0) regardless of stylesheet order — so the overlay tiles beside the rail (rail 0–68,
overlay 68→right), every dock control fully visible and clickable, `src/panel/unfold/**` untouched.

J1-safe: the net's only door to the legacy editor is `#ufCompare` in that dock, clicked first by
every journey and every golden (`gotoLegacy`, `tests/e2e/helpers.ts:108–111`) — Playwright clicks by
**selector**, not coordinate, so the dock shifting 68px right (to viewport x≈296 for `#ufCompare`)
breaks nothing, and every test exits the overlay via `#ufCompare` before asserting anything else.

**Non-codebase pages: the host layer.** `#host` (the 7 empty-state pages) is
`position:fixed; left:68px; top:0; right:0; bottom:0; z-index:72; background: var(--bg)` — above
the overlay's 70 and below the rail's 80 (the rail stays on top if they overlap). The opaque
`background: var(--bg)` is what actually hides the boot overlay on a non-codebase tab: the router
never closes the overlay (it stays open at z-70 beneath), and z-index alone orders paint without
making a transparent element opaque. It is `display:none` by default; the router shows it only for
a non-codebase route (§4).

**Wire-geometry is inset-safe — proven, not asserted.** The stage narrows 68px, but node positions
are computed from `ORIGIN_X`/`ORIGIN_Y` + graph structure only (`src/io/layout.ts:343–482`) — the
layout module reads **no** viewport/stage dimension (grep `clientWidth|getBoundingClientRect|window|
stage` in `layout.ts` → empty). Camera is used only for `zoomToFit()` (`layout.ts:543`), which
transforms `#world`, not node coords; and `#wires` is a child of `#world` (`index.html:59–60`), so
every `path` `d` is in world space, independent of stage width and of the camera transform. Therefore
narrowing the stage cannot move a node or change a wire — `tests/e2e/wire-geometry.expected.json` does
**not** regenerate (§build-plan verify rows). The pixel goldens, being viewport screenshots, *do*
change — see the build plan's honest golden story.

**There is no separate shell header.** The prototype's top wordmark/page-name bar is cut for K3
(YAGNI): a full-width header would add a second chrome edit and a vertical reflow of the editor, and
the Codebase surface already owns its full `<header>` toolbar. Page identity is carried by the rail
(permanent labels + the periwinkle active bar) and, on empty pages, by the empty-state command line
(§7). The always-on trust signal is the rail's bottom map-gate glyph (§1). A wordmark/trust-dot can
return in a later phase as a trivial `#host` addition when something consumes it.

---

## 4. Router behaviour (hash, instant swap)

A small hash router over `ctx`. `location.hash` is unused anywhere else in `src/` (grep is empty),
so a hash router is collision-free.

- **hash carries the page id only** (`#codebase`, `#contracts`, …), no deeper state — pages are pure
  renders of `ctx.state` (KEY_DECISIONS §4.1). `parse()` reads `location.hash`; an unknown/empty page
  falls back to the default.
- **default page = `codebase`.** Boot with an empty hash lands on the editor, so the app opens
  exactly where it does today — the boot `unfold.open()` fires unchanged and the user sees the app as
  it is now, with the rail added on the left.
- **transition = instant swap** (cut the 480ms crossfade + 12px drift — YAGNI, no choreography). On
  route change the router toggles `#host` visibility (`display`) and swaps its child. No timing
  constants, no enter/leave classes, no cleanup scheduling. (A one-line `transition:opacity 120ms` on
  `#host` is the maximum permitted flourish; instant is fine.)
- **URL persistence**: the hash reflects the current tab, so a reload returns to it and
  back/forward work — free with a hash router, no storage. Hash only, no localStorage (KEY_DECISIONS
  §4.1; per-repo scoping is K7's job, not K3's).
- `setActive(page)` toggles the periwinkle active bar on the rail, driven only by the router (single
  source).

---

## 5. Page-host contract (how a page shows / hides)

Instant swap means the contract is tiny — no `Page` object with `mounted`/`cleanup` lifecycle:

- **A non-codebase page** is just an `HTMLElement` returned by `emptyPage(def)` (§7). The router
  clears `#host`, appends the element, and sets `#host` visible. Leaving it hides `#host` (the next
  route rebuilds — the empty pages are trivially cheap).
- **The Codebase page** is not a page object at all: the router simply hides `#host`, revealing the
  untouched `#main` editor beneath (with its boot `unfold.open()` overlay behaviour intact). The
  editor is **never reparented and never cloned** — `#host` is a sibling layer over it, exactly as
  the unfold overlay is a sibling over `#main` today (`src/panel/unfold/unfold.ts`, confirmed by
  `tests/e2e/helpers.ts` `gotoLegacy`).

**"Editor mounts unchanged as the Codebase page" — what proves it.** The surface the J1 harness
drives is the pre-existing legacy editor reached via `#ufCompare` (`gotoLegacy`, clicked first by
every journey and golden). K3 leaves that surface — its DOM, its `#ufCompare` path, its boot
`unfold.open()` — untouched. So the DOM journeys and the wire-geometry test pass with **zero baseline
changes**. The pixel goldens *do* change (the rail is now in-viewport and the app is inset 68px) — the
build plan carries the honest regeneration story; editor-identity now rests on **journeys unchanged +
wire-geometry unchanged + the diff touching zero `src/` files except `src/ide/**` + `main.ts` +
`index.html` + `css/styles.css`**. Those computed checks certify DOM behaviour, world-space geometry
and diff scope — **not visual appearance**; the visual half of editor-identity rests on a human
looking at the regenerated goldens in this PR (build plan §6/§7).

---

## 6. Two-actor colour law compliance (§3.2 — the most-protected rule)

Every shell surface uses ONLY existing law hues (all already CSS vars in `css/styles.css`):

| shell element | hue | var | why it's lawful |
|---|---|---|---|
| rail active bar | periwinkle | `--accent` `#7c8cff` | the human's current focus/selection — exactly the human actor |
| rail rest icon/label | dim / faint | `--ink-dim` / `--ink-faint` | unproven/quiet, shown honestly |
| map-gate glyph | faint | `--ink-faint` | quiet until hovered |

**No teal (`--edge-sel #4fe0cd`) anywhere on the shell** — teal is reserved for machine-proven claims
(the proof seam), which the shell has none of; the proof seam belongs to nodes, cards and build
documents (K4), never chrome. **No new hue is introduced, and no green** — there is no verdict on the
shell at K3 (the wordmark trust-dot is cut with the header, §3). Any reviewer greps the new CSS block
for a hex literal outside the existing law set and slate/line vars — a nonzero result fails the colour
law (build plan verify table).

---

## 7. The 7 empty states (each carries its command)

Empty-state grammar is **BINDING** (`PROTO_MANIFEST.md:94` — "designed empty state: one dim mono
line"): `font:var(--mono) 11px; color:var(--ink-faint); text-align:center; padding:64px 0`, and
beneath it, fainter (`.empty .empty-cmd`, `color:color-mix(in srgb, var(--ink-faint) 55%,
transparent)`), the command that will populate the view. One dim line + one fainter command. No
spinner, no illustration, no "coming soon."

Line 1 = the tab's **command** in the vision-record sense: the one-line statement of what the tab
*is*. Line 2 = the concrete driver, using **real** commands/gestures where they already exist (never
a faked one — manifest §4, R3):

| tab | line 1 (its command / mission) | line 2 (`.empty-cmd`) |
|---|---|---|
| home | ask novakai anything about this repo | `home — chat entry point · K8` |
| design | draft the outcome, then agree to what you see | `novakai design <outcome> · K5` |
| contracts | the work order — everything enforceable, in one document | `npm run novakai:contract · K4` |
| agents | run Claude Code in a real terminal, in the repo | `agents — xterm over the dev-server bridge · K6` |
| files | open a folder from disk; the repo scopes every tab | `files — File System Access · K7` |
| analytics | agent spend per contract, per project | `analytics — per-repo metrics · K10` |
| rules | the ruleset the contract gates enforce | `npm run novakai:contract reads these · K9` |

The line-2 strings are **placeholders each owning phase finalizes** — when K4 builds Contracts it
pins the exact real command; K6/K7/K8 pin their gesture. K3 only needs law-compliant honest empty
states, not final command text. The empty-state page is data-driven: one `EMPTY` table
`{id,label,line1,cmd}` and one `emptyPage(def)` factory — not 7 hand-written modules.

---

## 8. What K3 explicitly does NOT touch

- The editor internals: `#main`, `#stage`, `#world`, `#wires`, the toolbar `<header>`, the panel,
  the `#ufCompare` legacy path, `unfold.open()` at boot, `ctx.state`, the camera, the router-free
  editor internals. Zero edits. (The app is inset 68px via `body { padding-left }` — a container
  shift, not an edit to any editor module; §3.)
- The unfold overlay (`src/panel/unfold/**`) — the module is untouched; K3's one CSS line
  (`#unfoldOverlay { left:68px }`, §3) tiles it beside the rail from outside.
- Colours, radius, easing — reused from existing vars/constants; none added.
- Any dependency — the shell is DOM + CSS only.
</content>
</invoke>
