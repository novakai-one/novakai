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
| `BlockManager` no longer calls `setPendingFocus` | **CHANGED** | Today `BlockManager` reaches into `useWorkspaceStore.getState().setPendingFocus()`. Target folds post-edit focus into `selection.caret` (carried on the draft and committed by WSA), so **no manager touches a store** and one store variable disappears. |
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

Removed: `pendingFocus` (folded into `selection.caret`), `activeFile` object
(now derived from `activeFileId`), `user` (derived from `session`). The
Toolbar's active level and the Panel's selected tile are **component-local**
(`useState`), not store state — state is a last resort. `clipboardBuffer` is a
module buffer, deliberately not counted as reactive app state.

---

## 6. Things the map cannot show

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
