# Flowmap

A spatial diagram tool for reviewing a codebase's architecture. Drag-and-drop
flowcharts with two-way Mermaid sync, per-node frontmatter cards (the public
interface), semantic **kind** badges with colour tinting, type tracing across
the canvas, click-a-node-to-light-its-connections, purpose **sections**,
obstacle-avoiding wires, drill-in containment, a **source viewer** that shows
each node's real TypeScript body, themes, minimap, undo/redo, autosave, and
SVG/PNG export. Runs entirely in the browser; no backend.

Flowmap is format-agnostic: it loads any `.mmd` file written to the spec in
[`SYNTAX_README.md`](SYNTAX_README.md). The rest of this README is the practical
guide: how to wire it to *your own* repo, generate a diagram from your code, and
see your source inside the app.

---

## Table of contents

1. [Run Flowmap](#1-run-flowmap)
2. [The two ways to get a diagram](#2-the-two-ways-to-get-a-diagram)
3. [Connect Flowmap to your repo](#3-connect-flowmap-to-your-repo)
4. [Required folder structure](#4-required-folder-structure)
5. [The `@flowmap-node` banner (your repo's source tags)](#5-the-flowmap-node-banner)
6. [Generate your bundle + source](#6-generate-your-bundle--source)
7. [Authoring syntax cheat-sheet](#7-authoring-syntax-cheat-sheet)
8. [Using the app](#8-using-the-app)
9. [Current features](#9-current-features)
10. [Planned features](#10-planned-features)

---

## 1. Run Flowmap

```bash
npm install
npm run dev        # Vite dev server with hot reload — open the URL it prints
npm run build      # type-check + production bundle to dist/
npm run preview    # serve the built bundle
```

The app autosaves to `localStorage`, so a refresh keeps your diagram.

> A dev server is required — ES modules can't load over `file://` (browser
> CORS). The built `dist/` is fully static and deploys to GitHub Pages as-is.

---

## 2. The two ways to get a diagram

There are two independent ways to produce the `.mmd` file Flowmap loads. They
solve different problems; pick based on what you're doing.

| | **A. Hand-authored bundle** | **B. Extracted from code** |
|---|---|---|
| Tool | `bundle.mjs` (per-folder fragments → one `.mmd`) | `extract.mjs` (ts-morph walks your TS) |
| Layout | Laid out (you author `subgraph` grouping) | Flat (no grouping → one tall column) |
| Frontmatter | Your hand-written intent (`desc`, `accepts`, …) | Auto from real signatures |
| Drifts from code? | Yes — it's a spec; a **gate** catches drift | No — it *is* the code |
| Use it for | Review surface, architecture, the diagram you load | Bodies + signatures, drift-checking |

In practice you use **both together**: author the bundle for the diagram and
its layout, and run the extractor to produce `bodies.json` (the source viewer's
data) plus a drift gate. The `flowmap:ship` script (below) runs both in one go.

> Why not auto-generate everything from code? Because an auto-extracted diagram
> is just a mirror of reality — there's nothing to check it against. The
> hand-authored bundle is the *intent*; the extractor is the *reality*; the gate
> fails when they disagree. That separation is the whole point.

---

## 3. Connect Flowmap to your repo

Flowmap and your project are **two separate repos**, expected as siblings:

```
Programming/
  flowmap/                 # this repo
  your-project/            # your TypeScript repo
```

Flowmap reads from your repo in two ways:

1. **Diagram** — you hand it a `.mmd` file via the **Load** button. That file
   lives in *your* repo (e.g. `your-project/docs/flowmap/_bundle.mmd`).
2. **Source viewer** — Flowmap fetches `bodies.json` from its own
   `public/bodies.json`. You generate that file *from your repo's TypeScript*
   and copy it into `flowmap/public/`.

Nothing is symlinked or configured globally. The connection is: your repo
produces two files (`_bundle.mmd`, `bodies.json`); Flowmap consumes them.

### One-time setup in your repo

Copy the two tool folders from this repo into yours, and add the scripts:

```bash
# from your project root
mkdir -p tools docs/flowmap
cp -R ../flowmap/tools/buildspec tools/buildspec     # extractor + gate
cp -R ../flowmap/tools/flowmap   tools/flowmap        # bundler + validator
```

Add to your `package.json` (`scripts`):

```jsonc
{
  "scripts": {
    // build the laid-out diagram from per-folder fragments
    "flowmap:bundle":   "node tools/flowmap/bundle.mjs --root docs/flowmap/root.mmd --dir src > docs/flowmap/_bundle.mmd",
    // generate bodies.json from your TS and drop it into flowmap/public/
    "flowmap:bodies":   "node ../flowmap/tools/buildspec/extract.mjs --tsconfig tsconfig.json --out /tmp/flowmap.mmd && cp /tmp/flowmap.bodies.json ../flowmap/public/bodies.json",
    // both in one command
    "flowmap:ship":     "npm run flowmap:bundle && npm run flowmap:bodies",
    // lint a single .mmd
    "flowmap:validate": "node tools/flowmap/validate.mjs docs/flowmap/_bundle.mmd",
    // fail the build if the spec drifts from the code
    "flowmap:gate":     "node tools/buildspec/extract.mjs --tsconfig tsconfig.json --out /tmp/extracted.mmd && node tools/buildspec/gate.mjs --spec docs/flowmap/_bundle.mmd --code /tmp/extracted.mmd --unplanned-as-warning"
  }
}
```

Adjust the relative path (`../flowmap`) if your repos aren't siblings, and
`--tsconfig` to whichever tsconfig actually `include`s your `src` (a root
tsconfig that only lists `references` resolves zero files — point at the one
with `"include": ["src"]`).

The extractor needs `ts-morph`:

```bash
npm install -D ts-morph
```

---

## 4. Required folder structure

The **bundler** merges one root file plus one fragment per folder. The convention:

```
your-project/
  docs/flowmap/
    root.mmd                 # the GLOBAL namespace (see below)
    _bundle.mmd              # OUTPUT — the file you Load into Flowmap (generated)
  src/
    managers/
      blockManager/
        blockManager.ts
        flowmap.mmd          # fragment: this folder's nodes, self-rooted
      selection/
        flowmap.mmd
    components/
      workspace/
        flowmap.mmd
    ...
  tools/
    flowmap/   buildspec/    # copied from this repo
```

Rules:

- **`docs/flowmap/root.mmd`** declares the *global* namespace: container nodes
  (one per folder/unit), shared nodes (stores, types, services, registries),
  and cross-folder edges. Every id defined in `root.mmd` is **global**.
- **One `flowmap.mmd` per folder**, self-rooted with `%% root <containerId>`
  where `<containerId>` is a node defined in `root.mmd` (the join key). Inside a
  fragment, any id **not** global is **private** and gets namespaced
  `<containerId>__<id>` at merge time — so two folders can both define
  `createBlock` without colliding (`blockManager__createBlock`,
  `dragManager__createBlock`).
- A fragment lists its cross-folder references as local **stub** nodes (ids that
  are global); the bundler drops the stubs and points the edge at the single
  global node. Group stubs in a `Dependencies` subgraph (do **not** `%% parent`
  it).
- `--dir src` tells the bundler to find every `flowmap.mmd` under `src/`.

Ownership on merge (so nothing is defined twice):

| Thing | Lives in |
|---|---|
| node line + `%% kind` for a global id | `root.mmd` |
| `%% fm:meta` for a **container** id | its fragment (canonical) |
| `%% fm:meta` for any other global id | `root.mmd` |
| private ids (nodes, fm, kind) | their fragment (namespaced) |
| `%% fm` / `%% edge` geometry | dropped — Tidy re-lays the bundle |

> You don't *have* to use the fragment system. If you'd rather, author one
> `.mmd` by hand (or have an LLM emit it) per [`SYNTAX_README.md`](SYNTAX_README.md)
> and Load that. The fragment system exists so a large codebase can keep its
> diagram next to the code, folder by folder, and bundle deterministically.

---

## 5. The `@flowmap-node` banner

This is the only thing you add to your **TypeScript source**. It's a comment
that tags a symbol so the extractor can (a) build the extracted graph and
(b) capture that symbol's real body + signature for the source viewer.

```ts
// @flowmap-node <id> kind=<kind> [parent=<parentId>]
```

Place it on the line directly above the declaration. It works on anything:

```ts
// @flowmap-node blockManager__createBlock kind=function
private _createBlock(draft: DocDraft, kind: "text" | "database"): DocDraft {
  ...
}

// @flowmap-node store__setActiveFile kind=function
setActiveFile: (file) => set({ activeFile: file }),     // object-literal arrow — fine

// @flowmap-node draft kind=module
export function buildDraft(file: FileData | null, content: ContentDataSet): DocDraft {
  ...
}
```

- `<id>` should match the node id you use in the diagram, so the source viewer
  can resolve a clicked node to its body. With the fragment system, that's the
  namespaced id (`blockManager__createBlock`).
- `kind` ∈ `component | hook | class | store | module | function | type | service | event`.
- `parent=` is optional; it records containment for the extracted graph.
- The extractor captures the body of whatever declaration follows the banner —
  class methods (incl. private), top-level functions, const-arrows,
  object-literal arrows, and even a bare expression statement.

Files with **no** banners fall back to structural inference (exported
class/interface/function, id = the symbol name), so an untagged repo still
produces *something* — but tagging is what makes ids line up with your diagram.

> The extractor reads the **real** parameter types and return type off each
> tagged symbol and ships them in `bodies.json`. The source viewer shows that
> signature as a contract header above the body. These real types are kept out
> of the diagram's frontmatter cards on purpose — the cards are your
> hand-authored intent, and the **gate** checks them against reality. Auto-filling
> the cards with real types would make the gate a no-op.

---

## 6. Generate your bundle + source

Once setup (§3) and structure (§4) are in place:

```bash
# from your project root
npm run flowmap:ship
```

That runs two steps:

1. `flowmap:bundle` → writes `docs/flowmap/_bundle.mmd` (your laid-out diagram).
2. `flowmap:bodies` → runs the extractor over your TS, writes
   `bodies.json`, and copies it to `flowmap/public/bodies.json`.

Then, in Flowmap:

1. **Load** → pick `docs/flowmap/_bundle.mmd`.
2. Click **Tidy** to lay it out.
3. Click any leaf node → open the **source** tab → its real TS body +
   signature.

Container nodes (a whole module/folder) have no single body, so their source
tab is empty by design — drill into them to reach the leaf functions, which do.

Optional, recommended in CI:

```bash
npm run flowmap:gate        # fail if the diagram spec drifts from the code
npm run flowmap:validate    # structural lint of the .mmd
```

---

## 7. Authoring syntax cheat-sheet

Full spec: [`SYNTAX_README.md`](SYNTAX_README.md). The essentials:

```
flowchart LR                              # TD|BT|LR|RL — use LR for any node with 3+ children
%% root <id>                              # layer-0 entry; biggest readability lever
%% kind <id> <kind>                       # REQUIRED, one per node
%% parent <child> <parent>                # containment — child shows only on drill-in
%% fm:meta <id> name=<value>              # the declared symbol name
%% fm:meta <id> desc=<value>              # one-line purpose
%% fm:meta <id> state=<value>             # an owned field (repeatable)
%% fm:meta <id> i0.name=<value>           # an entry point / public method
%% fm:meta <id> i0.accepts=<value>        # its params (repeatable)
%% fm:meta <id> i0.returns=<value>        # its return (repeatable)
  id["Label"]                             # shapes ↓
  id --> b      # solid = spine (call/flow tree)
  id -.-> b     # dotted = every other relation (reads, writes, type use, returns-up)
  subgraph grp ["Caption"] … end          # group / section on one level
```

| Shape | Syntax | Role |
|---|---|---|
| rect `id["L"]` | module / class / file | spine |
| round `id("L")` | function / process | spine |
| stadium `id(["L"])` | entry / exit | spine |
| diamond `id{"L"}` | decision | spine |
| cylinder `id[("L")]` | store / db | satellite |
| hex `id{{"L"}}` | service / external | satellite |
| circle `id(("L"))` | state / event | satellite |
| note `id>"L"]` | type / annotation | satellite |

Two rules that fix most bad layouts:

- **Solid = spine only.** A DTO/value threaded through functions is a *dotted*
  satellite, not a spine step. An orchestrator draws a solid edge to *each*
  helper (labelled `1`, `2`, `3`), never helper→helper.
- **Drill-in is required for any unit you'll review.** Author its private
  functions as child nodes (`%% parent`) with their private call order wired —
  a unit left as one node is at architecture altitude and can't carry a review.

---

## 8. Using the app

**Toolbar (left → right):** shape tools (box, rounded, stadium, store, decision,
state/event, service, note, group) · **Link** mode (`L`) to draw edges · undo /
redo · **Tidy** (auto-layout) · **Snap** (grid) · **PNG** / **SVG** export ·
**Save** / **Load** `.mmd` · panel toggle (`Tab`) · shortcuts (`?`).

**Side panel** (drag its left edge to resize):

- **inspector** — selected node/edge: id, kind, frontmatter; edit label, line
  style, routing; reset/reverse/delete an edge.
- **style** — base theme, accent colour, page width.
- **mermaid** — the live `.mmd` text; edit and **Apply text → canvas**, or copy.
- **source** — the selected node's real TS signature + body (from `bodies.json`).

**Canvas:** drag nodes; click a node to light up all its connections; click a
type name in a frontmatter card to trace every node using that type; double-click
a container (or right-click → Open internals) to **drill in**, `Esc` to step up;
the breadcrumb shows depth. Minimap (bottom-right) for navigation. Everything
autosaves to `localStorage`.

---

## 9. Current features

- **Two-way Mermaid sync** — canvas and the `.mmd` text edit the same model.
- **Load / Save `.mmd`** — round-trips the full spec format.
- **Auto-layout (Tidy)** — layered tree from the solid spine; satellites parked
  beside their reference; dotted edges routed around boxes.
- **Obstacle-avoiding wires** — libavoid (WASM) orthogonal routing; draggable
  bends and labels; per-edge solid/dotted/thick and straight/orthogonal.
- **Kind system** — required `%% kind` per node; corner badge + automatic fill
  tint so one construct = one visual family.
- **Frontmatter cards** — per-node public interface (name, desc, state,
  interfaces with accepts/returns), toggleable.
- **Type tracing** — click a type name on a card to highlight every node that
  accepts/returns/holds that type.
- **Connection highlight** — select a node to light its incident edges.
- **Drill-in containment** — `%% parent` hides internals behind a node; open to
  reveal the private call graph; cross-level edges draw as labelled boundary
  stubs.
- **Sections / groups** — `subgraph` clusters and purpose captions on a level.
- **Source viewer** — click a node, see its real TypeScript body + a signature
  header (real param types + return), fetched from `bodies.json`.
- **Resizable side panel** — drag the panel edge; width persists.
- **Themes** — base palettes + accent recolour, live `:root` repaint.
- **Minimap**, **undo/redo**, **autosave**, **zoom-to-fit**, **snap-to-grid**.
- **PNG / SVG export.**
- **Tooling (in `tools/`):**
  - `bundle.mjs` — merge per-folder fragments → one laid-out `.mmd`.
  - `extract.mjs` — ts-morph → extracted `.mmd` + `bodies.json` (bodies +
    real signatures).
  - `gate.mjs` — diff spec vs extracted, fail on node/kind/member/return drift.
  - `validate.mjs` — structural lint of any single `.mmd`.
  - `spec-to-stubs.mjs` — generate TS stubs from `fm:meta` (signatures only).

---

## 10. Planned features

From the build-workflow direction (`DIRECTION_ai_build_workflow.md`). The thesis:
the `.mmd` is a **build contract**; all *enforcement* is deterministic tooling;
an LLM sits only at the edges (planning, authoring), never in the enforcement
loop.

**Core pipeline (deterministic, no LLM at run time):**

1. **Spec → TS stubs + test scaffolds** — generate `interface` / `abstract
   class` / function signatures from `fm:meta` with the exact accepts/returns
   and `throw new Error('unimplemented')` bodies. Claude Code fills bodies, never
   signatures, so interface drift becomes a `tsc` error for free. (Partially
   present: `spec-to-stubs.mjs`.)
2. **Extract from TS** — re-serialize real code (nodes, kind, parent, import
   edges, registry membership, hook bindings) into an `.mmd` that *cannot*
   drift. (Present: `extract.mjs`; registry/hook-binding extraction is the
   planned extension.)
3. **Gate: diff extracted vs spec** — fail a PR on any structural drift. (Present:
   `gate.mjs`.)
4. **Search** — paste an `.mmd`, find a class/module/type by navigating the
   extracted graph.
5. **In-app diff** — paste two `.mmd` files, see the delta visually (the same
   diff the gate enforces).

**LLM at the edges (authoring/planning only):**

- **A. Behavioural test bodies from prose** — an LLM turns each node's
  behavioural `desc` ("never mutates `currentReadOnly`") into a real assertion
  you review once; CI then enforces it deterministically. Closes the one gap
  types and structure can't: *behaviour*.
- **B. Intent → spec delta** — describe a change in English ("add a cache
  between `store` and `storage`"); the LLM proposes the `fm:meta` diff; you
  approve; the deterministic pipeline enforces it.
- **C. Advisory PR reviewer** — an LLM checks a PR against prose claims that
  can't be a type or test (e.g. "siblings, no cross-talk") and **warns**, never
  blocks.

**Smaller source-viewer follow-ups:**

- Spec-forward authoring: declare contracts as `@flowmap-node` banners with
  typed signatures *before* implementation, so the same diagram serves
  spec-out (to Claude Code) and review-in (the body check) on one surface.

---

## Architecture (this repo)

The model is the single source of truth; the canvas and the Mermaid textarea
both read and write it. Modules are wired through a shared `AppContext`
(`src/core/context.ts`) rather than importing each other's runtime functions,
keeping the dependency graph acyclic. `main.ts` constructs each module and wires
the cross-module hooks.

```
src/
  core/        types, frontmatter, config, context, state, history, persistence, seed, camera
  render/      render (nodes + cards), wires, avoidRouter (libavoid WASM), minimap
  interaction/ selection, nodes, pointer, keyboard, clipboard, view (drill-in), inline-edit
  io/          mermaid (parse/serialize), layout (Tidy), export, files
  panel/       tabs, inspector (+ source viewer), style-controls, theming
  main.ts      composition root — constructs and wires everything
tools/
  flowmap/     bundle.mjs, validate.mjs
  buildspec/   extract.mjs, gate.mjs, spec-to-stubs.mjs, diff-core.mjs, skeleton.mjs, mmd-parse.mjs
```
