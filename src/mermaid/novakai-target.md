# Novakai — Gold-Standard Target Architecture (companion notes)

These notes accompany `novakai-target.mmd`. The `.mmd` is the structural map;
this file records the assumptions, the proposed changes, and the few things a
flow map cannot show. The map describes the target — a fully working,
bug-free, shippable app — **not** the repo as it stands today.

---

## 1. What is FROZEN and unchanged

The WorkspaceArea router is law and is reproduced verbatim from the current
code:

- `route(channel, data, trigger)` seeds a `DocDraft`, then threads it through
  the managers in the fixed order **BlockManager → SelectionManager →
  DragManager → LayoutManager**, then calls `commit(draft)` exactly once.
- Each manager exposes the uniform interface
  `receiveMouseEvent / receiveKeyEvent / receiveLifecycleEvent: (DocDraft) → DocDraft`.
- Internally every manager does `draftToFlat → decide on DocShape →
  foldIntoDraft`. `currentReadOnly` is never mutated; only `proposed` is
  written. If nothing is proposed, `commit` returns early and React never
  re-renders.

No node, edge, or interface in this map changes that contract.

---

## 2. The two hard rules, and where the map enforces them

**Rule A — helpers receive the draft `DocShape` from WorkspaceArea.**
Every helper node (`blockHelpers`, `selectionHelpers`, `layoutHelpers`,
`clipboardHelpers`) takes `shape: DocShape` (or a slice of it / a
`SelectionState`) and returns a new `DocShape` / `SelectionState`. The draft is
built once by WorkspaceArea (`WorkspaceArea -.->|builds + threads| docDraft`)
and flattened to the `DocShape` every helper reads
(`docDraft -.->|flattened to| docShape`).

**Rule B — helpers never reach into stores or trigger state changes.**
There is **no** dotted edge from any helper node to any store. The only nodes
wired to stores are containers and panels (`App`, `WorkspaceArea`, `LeftPanel`,
`RightPanel`, `Toolbar`, `Header`, `Footer`) plus the persistence layer. Two
helpers touch the *outside world* but not state:
- `highlightRenderer` and `domHelpers` read/paint the **DOM** only (CSS Custom
  Highlight API, hit-testing). That is browser paint, not React state and not a
  store.
- `clipboardBuffer` is a module-scoped slice owned by the clipboard. It is the
  clipboard's own buffer, **not** a Zustand store and **not** document state, so
  `copy`/`cut`/`paste` writing to it does not violate Rule B.

---

## 3. Proposed changes (new or modified vs. today)

| Item | Status | Why |
|---|---|---|
| `styleApplier` (BlockManager helper) | **NEW** | Pure `(DocShape, StyleIntent) → DocShape`. Applies `Tag` / `styles` / `classNames` to the selected `TextElement`s. Lives inside BlockManager because styling is CRUD on `TextElement`, so the **router stays frozen** — no new manager. |
| `Toolbar`, `TextStyleControls`, `BlockStyleControls`, `DatabaseStyleControls` | **NEW** | The contextual toolbar requirement. See §4. |
| `RightPanel` rebuilt on the shared panel kit | **CHANGED** | Today it is bespoke HTML. Target: two tiles (`Style`, `Appearance`) via `Panel`, so left and right panels share one composable kit. |
| `AppearanceControls` | **NEW (extracted)** | The current theme/accent/page-width UI, lifted out of `RightPanel` into a tile. |
| Caret ownership moves entirely to `SelectionManager` | **CHANGED** | Today `BlockManager` reaches into `useWorkspaceStore.getState().setPendingFocus()` to steer the caret after creating a block. Target: `BlockManager` has **zero opinion** on caret/selection — it only records the ids it created on `draft.created.newBlockIds`. `SelectionManager`, which runs next, observes those ids on the draft and **independently decides** the caret belongs in the new block. The handoff is the draft, not a `BlockManager → SelectionManager` message. This deletes the `setPendingFocus` store call (no manager touches a store) and removes one store variable. |
| `DatabaseArea` receives its `DatabaseConfiguration` as a prop | **CHANGED** | Today it reads `useWorkspaceStore` directly. Target passes `config` down from WorkspaceArea so every renderer is a pure conduit. |
| `activeFile` → `activeFileId` in `useWorkspaceStore` | **CHANGED** | The full `FileData` was a duplicate of `files[id]`. Storing the id and deriving the file removes a stale-copy bug class. |
| Dead code removed | **REMOVED** | `managers/selection/clipboardmanager/` (duplicate) and `managers/selection/z - legacy-selectionManager/` are not in the target and should be deleted. The canonical clipboard is `managers/selection/clipboard/`. |

---

## 4. The contextual toolbar (multi-level styling)

`Toolbar` is the right panel's **Style** tile. It is a dumb renderer:

1. It reads `selection: SelectionSnapshot` (panels may read stores; helpers may
   not).
2. It **derives** one styling *level* — it stores no level state:
   - a text run selected → `TextStyleControls` (bold/italic, font, size, colour)
   - whole block(s) selected → `BlockStyleControls` (Tag h1..p, alignment,
     background, width)
   - a database / row / cell selected → `DatabaseStyleControls` (columns, sort,
     filters, row styling)
3. Each control emits a `StyleIntent` through the **existing** conduit:
   `*StyleControls -.->|dispatch style| blockEventStore -.->|forwards to router|
   WorkspaceArea`, which routes a `*-style-*` trigger to `BlockManager`, which
   calls `styleApplier` on the draft. Styling therefore takes the identical path
   as every other edit and persists/undoes the same way.

"Multiple levels of styling options" = these three levels, chosen by what the
user has selected. New trigger words (`content-area-style-*`,
`drag-container-style-*`, `database-*-style-*`) follow the existing
`<source>-<channel>-<verb>` pattern in `types/trigger-words.ts`.

---

## 5. State minimisation (design goal)

Total **reactive** store variables in the target: **14** (down from ~18).

| Store | Variables |
|---|---|
| `useWorkspaceStore` | `activeFileId`, `files`, `content`, `layouts`, `databases`, `selection` (6) |
| `useAuthStore` | `status`, `session` (2 — `user` dropped, derived from `session`) |
| `useThemeStore` | `themeId`, `accentHex` (2) |
| `useLayoutStore` | `pageWidth`, `leftPanelOpen`, `rightPanelOpen` (3) |
| `useBlockEventStore` | `handler` (1) |

Removed: `pendingFocus` (caret is now decided by SelectionManager from
`draft.created.newBlockIds` and carried in `selection.caret`), `activeFile` object
(now derived from `activeFileId`), `user` (derived from `session`). The
Toolbar's active level and the Panel's selected tile are **component-local**
(`useState`), not store state — state is a last resort. `clipboardBuffer` is a
module buffer, deliberately not counted as reactive app state.

---

## 6. Drill-in structure (how to read the internals)

Each manager's helpers are nested **inside** the manager as a drill-in level,
via four `%% parent <helperGroup> <manager>` lines. In Flowmap, click a
manager's **"Open internals"** button (the chip on the node; the number is the
child count) to descend a level:

**BlockManager is the exemplar drilled to *operation* level** — so its design
can be reviewed and approved from the map without reading code. Inside it:

- A `dispatch` node (the three `receive*` entry points) routes each event to
  exactly one operation **by trigger word** (solid arrows, labelled with the
  trigger): `createBlock`, `deleteBlock`, `insertFromPanel`, `insertDatabase`,
  `addRow`, `toggleCell`, `commitText`, `applyStyle`.
- Each operation's card states its **trigger**, its `DocShape` in/out, and its
  **design decision** (e.g. `createBlock` records the id on `draft.created` and
  sets **no** caret; `deleteBlock` only fires on an *empty* block).
- Operations reference the pure helpers (`blockDefinitions`, `databaseFactory`,
  `styleApplier`) with **dotted** "uses" edges, so the internal spine stays a
  clean `dispatch → operations` tree.

The other managers are currently drilled to *helper-module* level. Say the word
and I'll take any of them to operation level the same way.

| Open internals on | You see |
|---|---|
| `BlockManager` | **operations**: `dispatch` → `createBlock`, `deleteBlock`, `insertFromPanel`, `insertDatabase`, `addRow`, `toggleCell`, `commitText`, `applyStyle`; **helpers**: `blockDefinitions`, `databaseFactory`, `styleApplier` |
| `SelectionManager` | `selectionRouter` → (`caretNavigation`, `selectionExtend`), `range`, `shapeBuilder`, `highlightRenderer`, `domHelpers` |
| `LayoutManager` | `workspaceLayout` → (`collisionManager`, `grid`) |
| `ClipboardManager` | `copy`, `cut`, `paste`, `clipboardBuffer` |
| `DragManager` | *nothing — it has no extracted helpers; its gesture state is internal* |

Why it reads well:

- **The top level stays at architecture altitude.** Helpers are hidden until
  you drill, so the canvas is not bloated — only the `.mmd` text is longer.
- **Groups are transparent for leveling.** A helper sits in its group box
  *inside* the manager's level, so the grouping is preserved one level down.
- **`manager → helper` edges render against the manager's header when you drill
  in** (labelled `catalog`, `apply style`, `1`/`2`/`3`, …), and collapse into
  compact labelled boundary stubs at the top level.
- **Design choices show on each node's frontmatter card** (Style tab →
  "Frontmatter cards"). The "no store reach" rule is visible as the *absence* of
  any edge from a helper to a store, plus each helper's `desc`.

## 7. Things the map cannot show

- **Reference equality is the render gate.** A manager that proposes nothing
  returns the same object reference; `commit` skips it. This is behaviour, not
  structure, so it is not an edge.
- **DragManager owns `style.top` during an active drag.** `DragContainer` reads
  `isDragging(id)` at render (the dotted `queries isDragging` edge) and omits
  the stored top while true, preventing a mid-gesture teleport.
- **Recursion.** `ContentArea` renders nested children by id; `TextCell` reuses
  `ContentArea`. Shown as a single dotted `reuses` edge, not unrolled.
- **Heights are measured live.** `workspaceLayout` reads real `.drag-container`
  heights from the DOM; stored `LayoutItem.h` is treated as a fallback only.
- **Single-column layout today.** `collisionManager` resolves on the y-axis
  only; when columns unlock, add an x-range overlap test (noted in code).
