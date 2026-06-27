# Flowmap

Flowmap is a spatial diagram tool for working with software architecture — and a
bridge between you, your codebase, and an AI coding agent. You draw (or generate)
a diagram in standard Mermaid syntax; that same diagram becomes three things at
once: a **build spec** you hand to an AI, a **contract** that fails the build if
the code drifts from it, and a **map** of an existing codebase you can read and
inspect. It runs entirely in the browser, with no backend.

It exists to solve three problems:

### 1. Plan & communicate with an AI agent for each build plan

Instead of writing long prose build plans, you compose the architecture as a
diagram and hand it over. The diagram *is* the spec. To request a change, you
drag and drop — add a node, redraw an edge — and export the `.mmd`. No essays,
no ambiguity; the structure, the public interfaces, and the intended call order
are all on the canvas in a format an AI already understands.

### 2. Make AI code drift impossible

A diagram's frontmatter declares every node's interface — its accepts and
returns. Flowmap's tooling turns that into TypeScript stubs the agent fills in
(it writes bodies, never signatures), then extracts the real code back into a
diagram and **diffs it against the spec on every build**. If a signature drifts,
an argument type changes, or scope creeps, the build fails. The enforcement is
deterministic — no AI in the loop — so nothing slips through.

### 3. Inspect & understand any codebase on one canvas

Point the extractor at a TypeScript project and it auto-generates a diagram from
the real code. Click any node to read its actual source body and true signature,
trace a type across the whole canvas, light up a node's connections, or drill
into a module to see its internal call graph. You understand a system by
navigating it, not by reading a wall of text.

The same diagram serves all three. Flowmap is format-agnostic: it loads any
`.mmd` file written to the spec in [`SYNTAX_README.md`](SYNTAX_README.md). The
rest of this README is the practical guide: how to wire it to *your own* repo,
generate a diagram from your code, and use each of the three capabilities.

---

## Table of contents

1. [Run Flowmap](#1-run-flowmap)
2. [The two ways to get a diagram](#2-the-two-ways-to-get-a-diagram)
3. [Connect Flowmap to your repo](#3-connect-flowmap-to-your-repo)
4. [Required folder structure](#4-required-folder-structure)
5. [The `@flowmap-node` banner (your repo's source tags)](#5-the-flowmap-node-banner)
6. [Generate your bundle + source](#6-generate-your-bundle--source)
7. [How to use it — the three workflows](#7-how-to-use-it--the-three-workflows)
8. [Authoring syntax cheat-sheet](#8-authoring-syntax-cheat-sheet)
9. [Using the app](#9-using-the-app)
10. [Current features](#10-current-features)
11. [Planned features](#11-planned-features)

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
  flowmap/                 # this repo (the app + the tooling package)
  your-project/            # your TypeScript repo
```

### What lives where (codebase vs Flowmap)

Nothing global is configured; the connection is just files. Here's exactly what
is stored on each side, so nothing is mysterious:

| Stored in **your repo** (committed) | Stored on the **Flowmap side** | Stored in the **browser** |
|---|---|---|
| `docs/flowmap/root.mmd` — the global namespace | The Flowmap app itself | The currently-loaded diagram + your prefs |
| `src/**/flowmap.mmd` — one fragment per folder | `public/bodies.json` — generated *from your code*, read by the source viewer | (autosaved to `localStorage`) |
| `@flowmap-node` banners inside your `.ts` files | | |
| `docs/flowmap/_bundle.mmd` — the generated diagram you Load | | |
| `flowmap-spec-tools` in `node_modules` + your `package.json` scripts | | |

In plain terms: **your repo owns the spec** (`root.mmd`, fragments, banners) and
**produces two artifacts** — `_bundle.mmd` (the diagram) and `bodies.json` (the
source data). `_bundle.mmd` you Load into the app; `bodies.json` is copied into
`flowmap/public/` for the source viewer to fetch. The diagram you're actively
editing lives only in the browser until you Save it back to your repo.

### Step 1 — install the tooling package

The bundler, extractor, gate, and validator ship as one versioned package
(`flowmap-spec-tools`), so you **install** it rather than copying scripts that go
stale. `ts-morph` comes with it.

```bash
# from your project root — sibling checkout of flowmap:
npm install -D file:../flowmap/tools

# or pin to a git tag instead:
npm install -D "git+https://github.com/<you>/flowmap.git#<tag>"
```

> If `NODE_ENV=production` is set in your shell, add `--include=dev` so npm
> actually installs it (production mode omits devDependencies).

This puts five CLIs on your `PATH` (via `node_modules/.bin`): `flowmap-bundle`,
`flowmap-extract`, `flowmap-gate`, `flowmap-validate`, `flowmap-stubs`. The
authoring spec ships with it at
`node_modules/flowmap-spec-tools/SYNTAX_README.md`, so it always matches the
validator — no more manual copy.

### Step 2 — add the scripts

Add to your `package.json` (`scripts`):

```jsonc
{
  "scripts": {
    // build the laid-out diagram from per-folder fragments
    "flowmap:bundle":   "flowmap-bundle --root docs/flowmap/root.mmd --dir src > docs/flowmap/_bundle.mmd",
    // generate bodies.json from your TS and drop it into flowmap/public/
    "flowmap:bodies":   "flowmap-extract --tsconfig tsconfig.json --out /tmp/flowmap.mmd && cp /tmp/flowmap.bodies.json ../flowmap/public/bodies.json",
    // both in one command
    "flowmap:ship":     "npm run flowmap:bundle && npm run flowmap:bodies",
    // lint a single .mmd
    "flowmap:validate": "flowmap-validate docs/flowmap/_bundle.mmd",
    // fail the build if the spec drifts from the code (run in CI)
    "flowmap:gate":     "flowmap-extract --tsconfig tsconfig.json --out /tmp/extracted.mmd && flowmap-gate --spec docs/flowmap/_bundle.mmd --code /tmp/extracted.mmd --unplanned-as-warning"
  }
}
```

Adjust two things for your repo: the `../flowmap` path in `flowmap:bodies` if your
repos aren't siblings, and `--tsconfig` to whichever tsconfig actually
`include`s your `src` (a root tsconfig that only lists `references` resolves zero
files — point at the one with `"include": ["src"]`).

### Step 3 — create the folder structure and tag your code

See [§4](#4-required-folder-structure) for the `root.mmd` + per-folder
`flowmap.mmd` layout, and [§5](#5-the-flowmap-node-banner) for the
`@flowmap-node` banners. Then [§6](#6-generate-your-bundle--source) is the
one-command generate + load.

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
  node_modules/
    flowmap-spec-tools/      # installed (Step 1), not copied
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

### Keeping the tooling and syntax in sync across repos

This used to be fragile — the tools and the syntax spec were copied into each
consuming repo and went stale. **That's now solved:** they ship as the
`flowmap-spec-tools` package (Step 1), so the bundler, extractor, gate,
validator, and `SYNTAX_README.md` are one versioned unit. `npm update` refreshes
all of them together — there's nothing to hand-copy.

Two things worth knowing:

- **The validator is the enforcement backstop.** `flowmap-validate` encodes the
  grammar and rejects malformed `.mmd`, so even if the prose spec were briefly
  behind, bad syntax still can't get through. Run it in CI.
- **Pin a version.** Install from a git tag (`#<tag>`) or a published version
  rather than a floating branch, so an upstream syntax change can't surprise a
  build — you adopt it on `npm update`, deliberately.

### Moving or reorganising folders

File reorganisation is safe by design — identity is decoupled from location:

- The bundler **discovers fragments by recursive glob** (`--dir src` finds every
  `flowmap.mmd` anywhere under `src/`), so moving a folder within `src/` doesn't
  break discovery.
- **`@flowmap-node` ids live in the source files**, so they move with the code
  and never change on a move.
- The **container id is the join key** (`%% root <id>` ↔ a node in `root.mmd`),
  matched by name, not path.
- `_bundle.mmd` has **no saved coordinates** (Tidy positions on load), so there's
  no stale geometry to disturb.

The one thing that needs a touch: **renaming** a container id — update its node in
`root.mmd`. The bundler warns if a fragment's `%% root` id has no node in
`root.mmd` ("container will not attach"). Moving is free; renaming is a one-line
edit with a guard-rail.

---

## 7. How to use it — the three workflows

Setup done, here's how to actually *use* Flowmap for each of its three jobs. Each
has more than one entry point — pick the option that fits where you're starting
from.

### 7.1 Plan & communicate with an AI agent for each build plan

You want to hand an AI a precise spec instead of a prose essay.

**Option A — author the diagram by hand, then hand it over.**
1. In the app, place nodes and draw edges to compose the architecture (shapes for
   role, `kind` for construct, solid edges for the call spine, dotted for
   everything else).
2. Fill each node's frontmatter (name, desc, accepts, returns) — that's the
   contract.
3. **Save** the `.mmd` and give it to the agent as the build plan.

**Option B — let the AI draft the diagram, then refine it visually.**
1. Give the agent [`SYNTAX_README.md`](SYNTAX_README.md) and ask it to emit a
   `.mmd` for the feature/architecture you're describing.
2. **Load** that `.mmd` into Flowmap, click **Tidy**.
3. Drag nodes, fix edges, adjust frontmatter where it got the contract wrong.
4. **Save** and hand the corrected spec back. To request a change later, edit the
   diagram and re-send — no re-writing prose.

> Either way the deliverable is one `.mmd` file: unambiguous structure, public
> interfaces, and intended call order, in a format the agent already reads.

### 7.2 Make AI code drift impossible

You want the agent's implementation to be locked to the spec, enforced by tooling.

**Option A — spec-first (greenfield).** The diagram exists before the code.
1. `flowmap-stubs` turns the diagram's frontmatter into TypeScript stubs —
   `interface` / `abstract class` / function signatures with the exact
   accepts/returns and `throw new Error('unimplemented')` bodies.
2. The agent fills the bodies, **never the signatures**. Any signature change is
   immediately a `tsc` error.
3. `npm run flowmap:gate` in CI re-extracts the real code and diffs it against the
   committed spec — a missing node, a changed type, or unplanned scope fails the
   build.

**Option B — code-first (brownfield).** The code already exists; you're guarding
it.
1. Author (or generate) the spec `.mmd` describing the intended structure.
2. `npm run flowmap:gate` on every PR diffs reality against that spec.
3. When the diff fails, either the code drifted (fix the code) or the change was
   intended (update the spec, deliberately and reviewably).

> The enforcement is deterministic — no AI in the loop — so a drifted build can't
> be produced. The diagram is a contract, not a suggestion.

### 7.3 Inspect & understand any codebase on one canvas

You want to read a system by navigating it, not by reading a wall of text.

**Option A — auto-generate from code (zero authoring).**
1. `flowmap-extract --tsconfig <tsconfig> --out extracted.mmd` walks the TypeScript
   and emits a diagram of the real structure, plus `extracted.bodies.json`.
2. Copy `extracted.bodies.json` to `flowmap/public/bodies.json`, **Load**
   `extracted.mmd`. It's flat (no hand-authored grouping) but accurate.

**Option B — the curated review surface (laid out + source).**
1. `npm run flowmap:ship` builds the laid-out `_bundle.mmd` (your fragments)
   **and** the matching `bodies.json`.
2. **Load** `_bundle.mmd`, **Tidy**.
3. Click any leaf node → **source** tab shows its real body + signature; click a
   type name to trace it across the canvas; double-click a container to drill into
   its private call graph.

> Use Option A to get oriented in an unfamiliar repo fast; Option B when you've
> invested in fragments and want the readable, drillable, source-backed map.

---

## 8. Authoring syntax cheat-sheet

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

## 9. Using the app

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

## 10. Current features

Grouped under the three things Flowmap is for. Everything here exists today.

### Pillar 1 — Plan & communicate with an AI agent for each build plan

- **Drag-and-drop authoring** — build the architecture by placing nodes and
  drawing edges; no file editing required.
- **Standard Mermaid syntax** — the diagram is plain `.mmd`, a format AI agents
  already read and write. Full spec in [`SYNTAX_README.md`](SYNTAX_README.md).
- **Two-way text ↔ canvas sync** — the canvas and the live Mermaid text edit the
  same model; change either, the other follows.
- **Export `.mmd` / Save / Load** — hand the file to an AI as the build spec, or
  load one back. No prose build plan needed.
- **Auto-layout (Tidy)** — a layered tree from the solid spine; satellites parked
  beside what references them; dotted edges routed around boxes.
- **Kind system** — `%% kind` per node drives a corner badge + automatic fill
  tint, so one construct type reads as one visual family.
- **Sections & drill-in containment** — `subgraph` groups cluster a level;
  `%% parent` hides a unit's internals behind it, opened on demand.
- **Obstacle-avoiding wires** — libavoid (WASM) orthogonal routing with draggable
  bends and labels; per-edge solid/dotted/thick and straight/orthogonal.
- **Themes, PNG/SVG export, resizable panel, minimap, undo/redo, autosave,
  zoom-to-fit, snap-to-grid.**

### Pillar 2 — Make AI code drift impossible (deterministic enforcement)

- **Spec → TS stubs** (`spec-to-stubs.mjs`) — generates `interface` /
  `abstract class` / function signatures from each node's `fm:meta` with the
  exact accepts/returns and `throw new Error('unimplemented')` bodies. The agent
  fills bodies, never signatures.
- **Extract real code → `.mmd`** (`extract.mjs`) — ts-morph walks your TypeScript
  and re-serializes the *actual* code (nodes, kind, parent, import edges) into a
  diagram that cannot drift, because it is the code.
- **Drift gate** (`gate.mjs`) — diffs the committed spec against the extracted
  code and **fails on drift**: a spec node with no symbol (unbuilt), a signature
  mismatch, a member/return-type change, or unplanned scope. Run it in CI.
- **Argument + return-type checking** — interface drift becomes a `tsc` error
  (from the stubs) and a gate failure (from the diff), continuously and for free.
- **No AI in the enforcement loop** — every check is deterministic tooling, so a
  drifted build can't be produced and nothing slips through.
- **Structural validation** (`validate.mjs`) — lints any single `.mmd` (one
  header, no duplicate ids, every reference resolves).

### Pillar 3 — Inspect & understand any codebase on one canvas

- **Auto-generate a diagram from code** (`extract.mjs`) — point it at a TS
  project and get an `.mmd` of the real structure, no manual authoring.
- **Source viewer** — click a node to read its real TypeScript body, with a
  **real signature header** (actual param types + return) above it, fetched from
  `bodies.json`.
- **Frontmatter cards** — each node's public interface (name, desc, owned state,
  one or more entry points with accepts/returns), toggleable.
- **Type tracing** — click a type name on a card to light up every node that
  accepts, returns, or holds that type across the whole canvas.
- **Connection highlight** — select a node to light all of its incident edges.
- **Drill-in** — double-click a container (or right-click → Open internals) to
  reveal its private call graph; cross-level edges draw as labelled boundary
  stubs; `Esc` steps up; a breadcrumb shows depth.

---

## 11. Planned features

The full direction is in `DIRECTION_ai_build_workflow.md`. The pieces above
(stubs → extract → gate) are the deterministic core and **already exist**. What's
still planned:

**Human surfaces in the app:**

- **Search** — paste an `.mmd`, find a class/module/type by navigating the
  extracted graph.
- **In-app visual diff** — paste two `.mmd` files and see the delta on the
  canvas (the same diff the gate enforces, made visual).

**Extraction depth:**

- Richer extracted edges — registry membership and hook bindings read from the
  composition root, beyond today's import edges.

**LLM at the edges (authoring/planning only — never in the enforcement loop):**

- **A. Behavioural test bodies from prose** — an LLM turns a node's behavioural
  `desc` ("never mutates `currentReadOnly`") into a real assertion you review
  once; CI then enforces it. Closes the one gap types and structure can't:
  *behaviour*.
- **B. Intent → spec delta** — describe a change in English ("add a cache between
  `store` and `storage`"); the LLM proposes the `fm:meta` diff; you approve; the
  deterministic pipeline enforces it.
- **C. Advisory PR reviewer** — an LLM checks a PR against prose claims that
  can't be a type or a test (e.g. "siblings, no cross-talk") and **warns**, never
  blocks.

**Source-viewer follow-up:**

- Spec-forward authoring — declare contracts as `@flowmap-node` banners with
  typed signatures *before* implementation, so the same diagram serves spec-out
  (to the agent) and review-in (the body check) on one surface.

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
