# SPEC_FILES — the Files tab (K7 design spec)

> Design spec for **K7 — Files**: open a real folder from disk, browse it, create and edit files
> that land on the user's disk, switch between repos — and, most importantly, define the
> **repo-scope contract** (§1): the loaded repo scopes every other tab (vision record **R4**).
> The substrate is **fixed**: the Chromium **File System Access API**, feasibility settled by
> `PROBES.md` probe-files (PASS — open, read, edit, create, and directory-switch all proven on
> real disk from the app origin).
>
> **What is BINDING here and what is a design choice.** K7 has **zero prototype coverage** —
> `PROTO_MANIFEST.md` carries no Files surface, so nothing is ported. The binding law that still
> applies to any new surface: the **two-actor color law** (manifest §2 first row — the single
> most-protected rule), the **motion law** (one easing, quantized durations, keyboard instant,
> idle = zero moving pixels), **typography/radius** (mono+sans, 9px, anti-capsule, literal
> descriptive titles — never marketing copy), **plain-language-first**, and the **empty-state
> grammar** (one dim mono line + a fainter command). Everything else below — layout, tree
> behaviour, recents, the scope semantics — is a **choice this spec makes**, traced against the
> real app. `/novakai` fundamentals are king (R9): the page is a house module —
> `initFilesPage(ctx)` factory, wired in `main.ts`, cross-module behaviour through `ctx`,
> pure renders — exactly the shape K5's `initDesign` proved (`src/ide/design.ts`).
>
> **Naming**: the factory is **`initFilesPage`** — the app already has an `initFiles`
> (`src/io/files.ts`, the editor's save/load module). Never collide with it
> (`docs/novakai/ide-roadmap.json` K7 intent pins this; the K7 grep predicate is
> `initFilesPage` in `src/main.ts`).

---

## 0. What K7 is and is not

- **IS**: the Files page (`src/ide/files-*.ts`, rendered into `#host` by the shell like every
  non-codebase page), backed by the File System Access API — `showDirectoryPicker`, directory
  handles, `createWritable` — plus IndexedDB for remembering repo handles across sessions. And
  the **repo-scope contract**: one `ctx.repo` field with the semantics in §1, consumed by every
  other tab as it is built. No framework, vanilla TS + hand-built DOM, **zero new dependencies**
  (the API and IndexedDB are platform natives).
- **IS NOT**: a real code editor (no syntax highlighting, no multi-tab buffers, no search — the
  Codebase tab and real editors own deep code work; this pane is utility read/edit), a file
  *manager* (no delete, no rename, no move, no drag — destructive/rearranging operations are
  deliberately out until something needs them), a cross-repo view (R4: per-repo everything;
  cross-repo is out of scope), or any change to how the **Codebase** tab sources its map today
  (adoption of the scope by other tabs is *their* build work — §1.6).

**Where the code lives (bound to K11).** All K7 modules live under `src/ide/**` (the K11 BLOCK
glob): `files-page.ts` (factory + actions), `files-model.ts` (pure state transitions + the
`LoadedRepo` type), `files-fs.ts` (File System Access + IndexedDB wrappers — the only module
that touches disk APIs), `files-render.ts` (pure DOM builders), and `src/ide/files.css`
(imported by `files-page.ts` — per-tab CSS file; `css/styles.css` is never edited by K7).

---

## 1. THE REPO-SCOPE CONTRACT (R4 — "the loaded repo scopes every other tab")

> This section is the part other lanes consume. The seam PR ships the interface stub; this
> section is its semantics; K7's build implements it. Everything here is designed so a consumer
> tab needs **no subscription, no event, no lifecycle** — the shell already rebuilds every
> non-codebase page on route entry (`src/ide/shell.ts` `renderHost`), so *reading a field at
> render time* is the whole integration.

### 1.1 The shape

```ts
/** src/core/types/types.ts — a core type, so core/context.ts stays self-contained
    (ide/ is a higher layer than core; importing an ide type into context.ts would
    invert the layering — the Clipboard precedent is interaction/, a peer, not ide/) */
export interface LoadedRepo {
  key: string;                        // stable identity — the recents-store id (§1.4), NOT the name
  name: string;                       // handle.name — display only, never identity
  handle: FileSystemDirectoryHandle;  // readwrite permission was 'granted' when assigned
}
```

`AppContext` gains one field (the seam stub):

```ts
/** The loaded repo scoping every tab (vision R4). Null until the human picks
    or re-grants one on the Files page. Written ONLY by the files module. */
repo: LoadedRepo | null;
```

Data, not a hook — the house rule (`context.ts` header): *shared data lives on ctx; shared
behaviour is wired as hooks*. The scope is data. There is deliberately **no
`onRepoChange` hook**: see §1.3.

### 1.2 The invariants (the contract proper)

1. **Single writer.** Only the files module ever assigns `ctx.repo`. Every other module treats
   it as read-only. (Enforceable by grep: assignment is `ctx\.repo\s*=[^=]` — the `[^=]` guard
   keeps readers' `ctx.repo ===` comparisons out — any match outside `src/ide/files-*.ts` is a
   violation.)
2. **Granted-at-assignment.** `ctx.repo !== null` implies `requestPermission({mode:'readwrite'})`
   returned `'granted'` at the moment of assignment. It is NOT a liveness guarantee — access can
   be revoked mid-session (browser UI, folder deleted). Consumers that hit a permission/NotFound
   error render an honest one-line failure (§1.5 grammar) and never re-prompt themselves.
3. **Read at render, no events — a guarantee scoped to the 7 `#host` pages.** Pages are pure
   renders of (their own state × `ctx.repo`) (KEY_DECISIONS §4.1 parity). A scope change can
   only happen on the Files page — the picker and the re-grant both require a user gesture,
   which the human can only perform there — and the shell rebuilds every non-codebase page on
   route entry (`shell.ts` `renderHost`: `innerHTML = ''` + re-append), so a `#host` page
   always picks up the current value on its next entry. **The Codebase page is the exception**:
   the shell display-toggles the persistent editor (`route()` only flips `#host` visibility),
   it never rebuilds it — so read-at-render does NOT reach Codebase for free. Its future scope
   adoption must bring its own refresh-on-entry (§1.6). For the 7 rebuilt pages the no-event
   design is not an optimisation; it is what makes mid-session scope changes safe without
   lifecycle code.
4. **Boot is null, always.** No auto-restore at startup: `requestPermission` requires a user
   gesture, so a session begins with `ctx.repo === null` and the Files page offering one-click
   re-grant of the recent repos (§4). No consumer may assume a repo is loaded.
5. **One door to disk.** A consumer that reads repo files does it through `ctx.repo.handle` —
   never its own `showDirectoryPicker` (one repo, one grant; a second picker would fork the
   scope). E.g. K4 Contracts, when it reads plan/packet artifacts from the loaded repo, walks
   `ctx.repo.handle` to `docs/novakai/...`; a future Codebase adoption reads
   `docs/novakai/_bundle.mmd` the same way.
6. **Adoption is the consumer's build.** K7 delivers the scope and the Files page. It does NOT
   retrofit other tabs: today's Codebase page keeps rendering the dev-served repo's map; Design
   keeps its current storage. Each tab wires to the scope in its own phase — this contract is
   what they wire to. (Nothing is faked in the meantime: a tab that has not adopted the scope
   simply does not claim to be repo-scoped.)
7. **Per-repo persistence law.** Any tab that persists per-repo data keys it by
   `ctx.repo.key`, grammar `novakai.ide.<tab>.<repo.key>` (localStorage) or an equal-keyed
   IndexedDB record. `key` — not `name` — because two folders named `novakai` must never share
   state (§1.4).
8. **The path limit — an OPEN collision, not a delegated solve.** A
   `FileSystemDirectoryHandle` exposes **no OS path** (browser security), only its leaf `name`.
   The K6 Agents PTY runs **server-side in the Vite dev-server process** (R2; probe-terminal
   spawns with the server's cwd), and no channel exists that turns a browser handle into a
   server cwd — so R2 and R4 genuinely collide for Agents, and this contract **cannot**
   deliver "terminal in the loaded repo". K6 must settle it as an explicit design decision —
   a user-typed/confirmed path, a dev-server-cwd convention, or the D3 companion-process
   fallback (which goes back to Chris per the vision record) — and must not pretend the handle
   provides a path. The scope offers `key` + `name` + in-browser file access, nothing more.

### 1.3 Why no event/hook (decision, traced)

The prototype's pure-state-machine law (KEY_DECISIONS §4.1) and the shell's rebuild-on-entry
contract (`SPEC_SHELL` §5: "a non-codebase page is just an HTMLElement rebuilt on every route
change") make a subscription dead weight: the only page mounted during a scope change is Files
itself, the writer. A hook would be an interface with exactly zero callers at K7 — YAGNI. If a
later phase ever renders two scope-consuming surfaces at once, it adds the hook then, next to
real callers.

### 1.4 Repo identity (`key`)

- Generated once, when a handle first enters the recents store: `crypto.randomUUID()`.
- Deduplication: before storing a picked handle, compare it against every stored handle with
  `isSameEntry()` — the platform's only identity oracle. Same entry → reuse the existing record
  (and its `key`), refresh `lastOpened`. Different entries with the same `name` coexist —
  identity is the key, the name is paint.
- The key never changes for the life of the stored record; removing a repo from recents (§4)
  retires its key. Re-picking the same folder later mints a fresh key.
- **The cost, stated for consumers (the trade-off is theirs too):** a key is only as stable as
  its recents bookmark. Forget + re-pick severs durable per-repo state keyed by the old key —
  a repo's contract history (K4) or analytics (K10) would be orphaned, and K7 does **not**
  garbage-collect orphaned `novakai.ide.<tab>.<key>` records (they persist unreferenced). A
  consuming lane for which that loss is unacceptable must say so before building on `key` —
  the alternative (content-derived identity) does not exist in this substrate, so the answer
  would be "don't offer remove" or a tab-owned remap UX, both of which change this contract.

### 1.5 The no-repo grammar for consumers

A scope-adopted tab with `ctx.repo === null` renders the BINDING empty-state grammar (one dim
mono line + a fainter command), with the command pointing at the one place a repo can be loaded:

```
<tab's one-line reason it needs a repo>
open a folder in files · #files
```

### 1.6 What "scopes every tab" concretely means (adoption map, per phase)

| tab | what the scope means there | when |
|---|---|---|
| files | owns the scope: picker, recents, re-grant, tree, editor | K7 (this spec) |
| contracts | reads contract/plan/verdict artifacts from `ctx.repo.handle`; per-repo contract list | K4 adoption slice |
| rules | reads/edits the ruleset files of the loaded repo | K9 |
| analytics | per-repo metrics, keyed `repo.key` | K10 |
| agents | scope gives `key`+`name` only — the PTY `cwd` CANNOT come from the handle; open R2×R4 collision, K6 decides (§1.2.8) | K6 |
| design | persisted outcomes keyed per repo (§1.2.7) | K5 follow-up |
| home | chat grounded in the loaded repo | K8 |
| codebase | reads the loaded repo's `docs/novakai/_bundle.mmd` + `bodies.json` through the handle — and must add its own refresh-on-entry: the shell display-toggles the persistent editor, never rebuilds it (§1.2.3) | future phase, explicitly not K7 |

---

## 2. Page anatomy + states

The page renders into `#host` exactly like Design: the seam threads `renderFiles` into
`ShellDeps` and `renderHost` gains a `files` branch; `initFilesPage(ctx)` returns
`{ render(): HTMLElement }` (the `DesignApi` shape). Rebuilt on every route entry; in-page
repaints reuse the same root element (paint-from-state, as `design.ts` does).

Two top-level states, a pure function of `ctx.repo`:

**REST (no repo loaded)** — the honest landing:
- Eyebrow `NOVAKAI · FILES` (sans 11px/500, 1.5px tracking) over display title `Files`
  (sans, large/500) — the 8.1 display grammar, adopted as a choice (the manifest's page-title
  scope rows predate this tab; Canvas-gets-no-heading is untouched).
- One dim mono line: `open a folder from disk — the repo scopes every tab`, and beneath it the
  action: a plain bordered button **`open folder…`** (mono 12px, 5px radius — anti-capsule,
  `--panel` fill, 1px `--line` border; periwinkle border+ink on hover/focus: the human is about
  to act). Clicking it is the user gesture that calls
  `showDirectoryPicker({ mode: 'readwrite', id: 'novakai-repo' })` (the `id` gives the picker
  stable per-purpose starting directory memory — free UX, zero storage).
- The **recent repos** list beneath (§4). Absent when the store is empty — a cold user sees
  one line + one button, nothing else.
- Unsupported browser (no `'showDirectoryPicker' in window`): the button is not rendered;
  the dim line is joined by `files needs Chromium — File System Access API`. Shown honestly,
  never a dead button.

**LOADED (`ctx.repo` set)** — two panes under a persistent page header:
- Header: eyebrow `NOVAKAI · FILES`, display title = **the repo name verbatim** (literal
  descriptive title law), and right-aligned, mono/dim: **`switch repo`** — a text affordance
  returning to REST (it does NOT clear `ctx.repo`; it shows the picker surface over the loaded
  state so an aborted switch changes nothing — picking/re-granting a different repo is what
  reassigns the scope and repaints).
- Left pane, fixed 280px: the **directory tree** (§3).
- Right pane, fluid: the **file pane** (§5) — empty until a file is opened; its rest state is
  the dim mono line `select a file · or create one` (empty-state grammar inside the pane).
- Panes are separated by a 1px `--line` hairline; depth by tone steps only, no shadows
  (depth law).

---

## 3. The directory tree (design choices, traced)

- **Lazy, honest enumeration.** A directory's children are enumerated (`for await` over
  `handle.entries()`) the first time it expands, cached on its row for the life of the render
  root. Lazy is what makes `node_modules` a non-event: unexpanded costs nothing. A directory
  that fails to enumerate (revoked mid-session) renders one dim `access lost — re-grant in
  files` row (§1.2.2 grammar, applied to ourselves).
- **Order**: directories first, then files, each `localeCompare` alphabetical. **Dotfiles are
  shown** — this is a dev tool; `.novakai/`, `.claude/`, `.github/` are exactly what the user
  came to see.
- **Row grammar**: mono 12px; indent 14px per depth; directories carry a disclosure triangle
  (`▸`/`▾` — text glyph, `--ink-faint`) and the folder name in `--ink-dim`, files plain
  `--ink-dim`. Hover: `--ink` + the rail's hover wash (`color-mix(in srgb, var(--panel-2) 60%,
  transparent)`). The **open file's row** is the human's current focus: `--accent` ink + a 2px
  periwinkle left bar — the exact active grammar the rail uses (`SPEC_SHELL` §2).
- **Expand/collapse is instant.** No animation on tree toggles: rows are keyboard-reachable
  (`<button>` rows), and the motion law makes keyboard actions instant — one grammar for both
  input methods beats a mouse-only 120ms flourish. Idle = zero moving pixels holds trivially.
- **No file-type icons, no git status, no watchers.** The File System Access API has no change
  events; the tree is a snapshot per enumeration. A per-directory re-enumeration happens on
  re-expand (collapse → expand re-reads); that is the refresh story at K7 — no polling, ever.

---

## 4. Recent repos + permission re-grant (the return-visit UX)

- **Store**: IndexedDB, database `novakai-ide`, object store `repos`, records
  `{ key, name, handle, lastOpened }`. IndexedDB is not a preference — directory handles are
  structured-cloneable and **cannot** live in localStorage; IndexedDB is the only substrate
  that persists them across sessions. This is the one persistence K7 introduces.
- **List** (REST state, under the open button): newest `lastOpened` first, no cap — the list
  only grows by explicit human picks and shrinks by explicit removal; it stays human-scale.
  Each row, mono 12px: the repo **name** (`--ink-dim`), and right-aligned its permission state,
  annotated at render via `queryPermission({ mode: 'readwrite' })`:
  - `'granted'` → no annotation (quiet; ready is the default, not a celebration — and not
    teal: a permission bit is browser state, not a machine-proven claim).
  - `'prompt'` → `re-grant` in `--ink-faint` — dim/hollow = not-currently-usable, shown
    honestly.
  - `'denied'` → `denied` in `--ink-faint`.
- **Row click = the gesture.** Clicking a row calls `requestPermission({ mode: 'readwrite' })`
  (Chromium re-shows its grant bubble for `'prompt'` handles); `'granted'` → assign `ctx.repo`
  (via §1.4 dedup/refresh), repaint to LOADED. Not granted → the row stays, annotation
  refreshed, no retry loop, no modal — the row itself is the retry affordance. A handle whose
  directory no longer exists (enumeration throws `NotFoundError` on first use) gets annotation
  `missing` and is left for the human to remove.
- **Remove**: a small `×` per row (`--ink-faint`, periwinkle on hover) deletes the record —
  forgetting the handle only; **never** touches the disk. No confirm dialog: the blast radius
  is one bookmark.

---

## 5. Open, edit, create (the disk-touching flows)

**Write law (trust boundary):** K7 writes to disk from exactly **two gestures** — the file
pane's `save` click and the create-flow's Enter. The platform write APIs (`createWritable`,
`getFileHandle(..., { create: true })`) appear only inside `files-fs.ts` wrappers, and the
enforcement check is on **call sites**: the only callers of those two wrappers are the two
gesture handlers in `files-page.ts` — a glob-presence grep proves nothing (the wrappers'
definitions always match); the reviewer greps for the wrappers' names and reads each caller.

- **Open**: clicking a file row reads `await handle.getFile()`. Between click and content the
  pane simply keeps its previous content (no spinner — motion law; local-disk reads bounded by
  the 1 MiB guard are effectively instant, and the open-file row's periwinkle bar moves at
  once, so the click is acknowledged). Text files render in the file pane as a native
  `<textarea>` (mono 12px, `--bg` ground, no gutter, no highlighting —
  ponytail: the platform's editor, not a port of one). Pane header: the file's repo-relative
  path (mono, dim) + right-aligned actions.
- **Binary/oversize guard**: file > 1 MiB, or a NUL byte in the first 4 KiB → the pane shows
  one dim line `<name> — <size> · not opened as text` instead of a textarea. Honest, no
  hex-viewer ambition.
- **Edit + save**: the textarea sets a dirty flag on input; `save` (same button grammar as
  `open folder…`) enables only when dirty. Save writes the full content through
  `createWritable()` → `write` → `close` (the probe-proven path — atomic-on-close semantics
  come free from the API). Confirmation is **in place**: the button text becomes `saved` and
  disables until the next edit (KEY_DECISIONS §3.9 — no toasts). Save failure (revoked,
  NotFound): the button re-enables and the pane header gains one dim error line — the content
  is still in the textarea; nothing is lost silently.
- **Dirty navigation guard, minimal**: switching file / route with a dirty textarea asks once
  via native `confirm('discard unsaved changes?')` — the same native-dialog choice `design.ts`
  already made for discards. No autosave, no drafts store.
- **Create**: a `new file` affordance in the tree pane header targets the **selected directory**
  (the last directory row clicked; default: the repo root — the tree highlights the target
  directory row while the input is open, so the landing spot is visible before commit). It
  opens an **inline name input** as a tree row at that spot (mono, `--panel` fill) — not a
  modal. Enter → validation (non-empty; no `/`; and no collision, checked by a probing
  `getFileHandle(name)` first — `create: true` silently opens existing files, so the probe is
  what makes "create" mean create) → `getFileHandle(name, { create: true })` → the row appears
  in the tree, the file opens in the pane, empty and ready. Escape or blur cancels — instant,
  keyboard law. Validation failure: the input's border goes `--ink-faint`→ stays, with one dim
  reason line under it; no dialog.
- **Directories are not created at K7** (files only — the vision line is "create new files
  that land on the user's disk"; folder creation is one `getDirectoryHandle` call away when
  something needs it).

---

## 6. Two-actor colour law compliance (§3.2 — the most-protected rule)

| surface | hue | var | why it's lawful |
|---|---|---|---|
| open file row (bar + ink), focused inline input, hovered `×`/button borders | periwinkle | `--accent` | the human's current focus/selection/action — exactly the human actor |
| tree rows, pane text, recents at rest | dim/faint inks | `--ink-dim` / `--ink-faint` | quiet content |
| `re-grant` / `denied` / `missing` annotations, error lines | faint ink | `--ink-faint` | not-currently-usable, shown honestly (dim/hollow grammar) |
| textarea content | ink | `--ink` | code is ink — no syntax highlighting (colour is meaning) |

**No teal** — nothing on this page is a machine-proven claim; a directory listing or a granted
permission bit is browser state, not the novakai gate. **No green** — no verdicts here. **No
amber** — nothing is mid-machine-process; an un-granted handle is dormant (dim), not pending.
**No new hue** — the reviewer greps `src/ide/files.css` for hex literals outside the existing
variable set; nonzero = fail.

---

## 7. Seam expectations + module layout

**The seam PR ships (frozen files, not K7's to edit):**
- `src/core/types/types.ts`: the `LoadedRepo` interface (§1.1 — a core type, keeping the
  layering clean: `ide/` builds on `core`, never the reverse).
- `src/core/context/context.ts`: the `repo: LoadedRepo | null` field (§1.1), initialised
  `null`.
- `src/main.ts`: `const filesPage = initFilesPage(ctx);` + threading into the shell deps —
  the K7 grep predicate (`initFilesPage` in `main.ts`, `ide-roadmap.json`).
- `src/ide/shell.ts`: `renderFiles` in `ShellDeps` + the `files` branch in `renderHost`
  (exactly the K5 `renderDesign` shape).
- `src/ide/pages.ts`: the `files` row leaves `EMPTY` (a real page has no empty-state row);
  the `files` glyph stays in `RAIL_ICONS`.
- `src/ide/files-model.ts` + `src/ide/files-page.ts` **stubs**: the `LoadedRepo` type and an
  `initFilesPage(ctx)` returning the current one-line empty state — compiling, honest, inert.

**K7's build fills (K7-owned):**

| module | responsibility | purity |
|---|---|---|
| `src/ide/files-model.ts` | `LoadedRepo`, tree/pane/recents state shapes, pure transitions (expand, select, dirty, validate-name) | pure, unit-testable |
| `src/ide/files-fs.ts` | every File System Access + IndexedDB call (picker, permissions, enumerate, read, write, create, recents CRUD) | the only disk-touching module |
| `src/ide/files-render.ts` | pure DOM builders (rest, recents, tree, pane) | pure DOM, no I/O |
| `src/ide/files-page.ts` | `initFilesPage(ctx)` — closure state, actions, paint; assigns `ctx.repo` (the single writer); imports `./files.css` | composition |
| `src/ide/files.css` | all K7 styles (existing vars only) | — |

K11 standards apply (BLOCK glob covers `src/ide/**`): ≤500 lines/file, ≤60 lines/function,
cognitive complexity ≤15. Four small modules is headroom, not a target.

**Predicate hardening**: `docs/novakai/ide-roadmap.json` is orchestrator-owned (frozen for this
lane); the K7 checks stay `spec file + main.ts grep` until the orchestrator hardens them. The
verification bar below is carried by this spec + the PR evidence instead.

---

## 8. Acceptance (how K7 is proven)

Per the standing pattern (manifest §5) + the master plan §3, with one K7-specific twist: the
native directory picker cannot be driven by Playwright. The split:

1. **Automated journeys (CI-able, real Chromium, zero console/page-error bar)** run against a
   **real `FileSystemDirectoryHandle` from OPFS** (`navigator.storage.getDirectory()`) injected
   through a test-only seam in `files-page.ts` (a `window.__filesTestRoot` the page checks
   before rendering REST). OPFS handles implement the identical interface — enumeration, read,
   write, create are all real, only the picker gesture is bypassed. Journeys: seed OPFS tree →
   load → expand/collapse (lazy proof: child dir unread until expanded) → open file → edit →
   save → re-read proves bytes → create file (incl. collision + bad-name rejection) → dirty
   guard → per-repo key law (`repo.key` in storage keys). Idle screenshot byte-identical —
  taken on an **unfocused** surface (a focused textarea's blinking caret is a moving pixel;
  blur first, or shoot the REST/tree state).
2. **The picker/permission path** (the only part OPFS can't reach) is covered by probe-files
   (PASS, reproduction note in `PROBES.md`) + the **manual Chromium render check**: a human
   opens the real repo folder, sees the tree, re-grants from recents after a browser restart.
3. J1 net stays green (the editor is untouched); `npm run novakai:verify:full`;
   `npm run novakai:ship` re-syncs the map (the four modules appear as nodes).
4. Independent 0-context verifier re-proves from command output alone — builder self-reports
   are never accepted.

---

## 9. What K7 explicitly does NOT touch

- The editor and its modules — `src/io/files.ts` (`initFiles` — the name collision is real,
  the modules never meet), `#main`, `ctx.state`, the camera, the unfold overlay. Zero edits.
- The frozen shell surfaces: `src/main.ts`, `src/ide/shell.ts`, `src/ide/pages.ts`,
  `css/styles.css`, `docs/novakai/ide-roadmap.json` — the seam PR touches those, not K7.
- Other tabs' behaviour: adoption of the scope (§1.6) is each tab's own phase; K7 ships the
  contract and nothing that fakes adoption.
- Dependencies: none added. File System Access API + IndexedDB + `crypto.randomUUID` are
  platform natives.
- Colours, radius, easing: existing variables only; no new hue, no new motion constants.
