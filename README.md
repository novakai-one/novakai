# Flowmap

Flowmap is a spatial diagram tool for software architecture — and a bridge between you, your codebase, and an AI coding agent. You draw (or generate) a diagram in Mermaid syntax; that same diagram becomes three things at once: a build spec you hand to an AI, a contract that fails the build if the code drifts from it, and a map of an existing codebase you can read and inspect. It runs entirely in the browser, with no backend.

## Two things live in this repo — do not conflate them

This is the single most important thing to understand:

- **The app — `src/`.** A client-side canvas diagram editor. Vanilla TypeScript + Vite, no framework. It reads and creates `.mmd` files, renders them as an interactive canvas, and can load a `bodies.json` for source inspection. It is what you run with `npm run dev`.
- **The flowmap-spec tooling — `tools/`.** A separate dev-time system (plain `.mjs` scripts, no build step) that turns a TypeScript repo into a reviewable `.mmd` architecture map, generates stubs + contracts from a spec, and lints/gates code against that spec. It documents other repos — and this one. It is not part of the app runtime.

These two sides share one thing: the `.mmd` file format (and the `bodies.json` format). The app reads them; the tooling generates them. Everything else is independent.

## What the app does (`src/`)

A canvas-based diagram editor with two-way Mermaid text sync. You drag nodes, draw edges, edit frontmatter, and the model stays in sync with a live `.mmd` text panel. It can Load any `.mmd` file and Save back to one. It can also load a `bodies.json` (via the Bodies button) to show real source code in a source pane — read in-browser via FileReader, never uploaded.

Key app modules (the full architecture map is `docs/flowmap/_bundle.mmd` — load it in the app):

- **`core/`** — model (state), wiring seam (context), config, types, frontmatter, validate, camera, history, persistence, runtime, seed.
- **`interaction/`** — input → model verbs: pointer, nodes, selection, clipboard, keyboard, inline-edit, context-menu, view (drill-in).
- **`io/`** — text + layout + files: mermaid (state↔text), layout (Tidy auto-layout), export (SVG/PNG), files (save/load).
- **`panel/`** — side-panel UI: inspector (+ source pane), inspector-frontmatter, tabs, style-controls, theming.
- **`render/`** — drawing: render (DOM), wires (edges), avoidRouter (+ avoidWorker for off-thread routing), minimap.
- **`main.ts`** — composition root: the only module that imports every other; builds AppContext, wires hooks, boots.

## What the tooling does (`tools/`)

A set of independent `.mjs` CLIs that form a deterministic pipeline. It ships as the `flowmap-spec-tools` npm package (from `tools/package.json`). The six CLIs:

| CLI | Script | What it does |
|---|---|---|
| `flowmap-bundle` | `tools/flowmap/bundle.mjs` | Merge per-folder `.mmd` fragments into one laid-out bundle |
| `flowmap-validate` | `tools/flowmap/validate.mjs` | Structural lint of any single `.mmd` (grammar legality) |
| `flowmap-lint` | `tools/flowmap/flowmap-lint.mjs` | Semantic quality gate — rejects flat file-mirrors and loose-bag decomposition |
| `flowmap-stubs` | `tools/buildspec/spec-to-stubs.mjs` | Generate TS stubs + compile-time contract tests from a spec's `fm:meta` |
| `flowmap-extract` | `tools/buildspec/extract.mjs` | Walk TS with ts-morph → ground-truth `.mmd` + `bodies.json` |
| `flowmap-gate` | `tools/buildspec/gate.mjs` | Diff committed spec vs extracted code; exit 1 on drift |

## The three capabilities

Flowmap exists to solve three problems, all using the same `.mmd` diagram:

### 1. Plan & communicate with an AI agent

Instead of prose build plans, you compose the architecture as a diagram and hand it over. The diagram is the spec — structure, public interfaces, and intended call order, in a format an AI already reads (Mermaid). To request a change, you edit the diagram and re-send.

### 2. Make AI code drift impossible (deterministic enforcement)

The tooling turns the diagram's frontmatter into TypeScript stubs the agent fills in (it writes bodies, never signatures), then extracts the real code back into a diagram and diffs it against the spec on every build. If a signature drifts, an argument type changes, or scope creeps, the build fails. The enforcement is deterministic — no AI in the loop.

### 3. Inspect & understand any codebase on one canvas

Point the extractor at a TypeScript project and it auto-generates a diagram from the real code. Click any node to read its actual source body and true signature, trace a type across the whole canvas, light up a node's connections, or drill into a module to see its internal call graph.

## The `.mmd` format

A Flowmap `.mmd` file is valid Mermaid flowchart syntax plus `%%` comment lines that Mermaid ignores and Flowmap reads. The full authoring spec is `tools/SYNTAX_README.md`. The essentials:

```
flowchart LR
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
| rect | `id["L"]` — module / class / file | spine |
| round | `id("L")` — function / process | spine |
| stadium | `id(["L"])` — entry / exit | spine |
| diamond | `id{"L"}` — decision | spine |
| cylinder | `id[("L")]` — store / db | satellite |
| hex | `id{{"L"}}` — service / external | satellite |
| circle | `id(("L"))` — state / event | satellite |
| note | `id>"L"]` — type / annotation | satellite |

`Kind` (`%% kind <id> <kind>`) is required on every node. Kind ∈ `component | hook | class | store | module | function | type | service | event`. It tags the language construct (shape alone can't distinguish component/hook/class/module — they all collapse to rect). Rendered as a corner badge + automatic fill tint.

## Accept and return types are mandatory for the gate to work

The `i<N>.accepts` and `i<N>.returns` frontmatter fields are what make drift enforcement possible. The gate checks member signatures (name, arity, return value-ness) for `class`, `function`, `hook`, and `type` nodes — but only if those members are declared in the `fm:meta`. A node with no interfaces has nothing to gate: the gate can only verify its existence, kind, and parent. Without `accepts`/`returns`, the whole enforcement pipeline is a no-op for that node.

```
%% fm:meta store name=Store
%% fm:meta store desc=single source of truth for the model
%% fm:meta store state=nodes: Record<string, Node>
%% fm:meta store i0.name=patch
%% fm:meta store i0.accepts=p: Partial<State>
%% fm:meta store i0.returns=void
%% fm:meta store i1.name=snapshot
%% fm:meta store i1.returns=State
```

## The diagram is an ARCHITECTURE map, NOT a folder structure

This is the most common failure mode. If an AI (or human) produces a diagram that is one node per file, no decomposition, dotted wiring — that is a flat file-mirror. It is grammar-valid but useless for review. `flowmap-validate` does NOT catch this; `flowmap-lint` does.

### What flowmap-lint enforces

The linter checks structural properties that separate a real architecture map from a file-mirror, derived from measured data on a human-validated GOOD bundle vs a human-rejected BAD one:

- **FLAT (FAIL)** — 8+ nodes, zero drilled units. Architecture altitude only; cannot carry a review.
- **LOOSE-BAG (FAIL)** — a unit is decomposed (2+ children) but its children are not grouped into purpose sections. The single most common file-mirror tell.
- **Warnings:** BARE-LEAF (a leaf parented straight onto a unit instead of into a section), SINGLE-CHILD, NO-ROOT, STUB (top-level node with no children, no interface, thin desc).

Definition of done is `flowmap-lint` exit 0 — not "it renders" or "validate passes".

### How to produce a good diagram

- **Units** — one node per meaningful unit (module, class, service, store, major function). ~5–40 at the top level. Not one per file.
- **Decompose** reviewable units to function altitude: one child node per internal function / private step, not just external modules it calls. A unit left as a single node is at architecture altitude and cannot carry a review.
- **Section the internals** — group the child functions into purpose-named subgraphs by flow phase. The section (the subgraph), not the leaf, carries `%% parent <section> <unit>`. Leaves live inside the subgraph with no `%% parent` of their own.
- **Wire the call spine** with solid edges (`-->`); references/reads are dotted (`-.->`).
- **Declare `%% root`** — the single biggest layout lever.

Worked examples are in `tools/flowmap/fixtures/`: `good-reference.mmd` (human-validated, lint-passing), `loop-demo-v1-loose.mmd` (FAIL: LOOSE-BAG), `loop-demo-v2-fixed.mmd` (PASS), `bad-file-mirror.mmd` (FAIL).

## The `@flowmap-node` banner (source tags)

This is the tag you add to your TypeScript source so the extractor can build a ground-truth graph and capture each symbol's real body + signature:

```ts
// @flowmap-node <id> kind=<kind> [parent=<parentId>]
```

Place it on the line directly above the declaration. The `id` should match the node id in your diagram. With the fragment system (below), that's the namespaced id (`blockManager__createBlock`). Kind ∈ `component | hook | class | store | module | function | type | service | event`. `parent=` records containment for the extracted graph.

```ts
// @flowmap-node frontmatter__normalizeFrontmatter kind=function parent=frontmatter
export function normalizeFrontmatter(fm: Frontmatter): Frontmatter {
  ...
}
```

The extractor reads `id`/`kind`/`parent` from the banner, but reads the interface skeleton (method names, arity, return-ness) from the real TS signatures — so the tag labels a symbol, but the code governs what is gated. The extractor also captures each tagged symbol's body for `bodies.json` (the source viewer's data). Files with no banner fall back to structural inference (exported class/interface/function).

## Generating the bundle (`_bundle.mmd`)

The bundle is the laid-out `.mmd` you Load into the app. It is auto-generated by an npm script — you do not write it by hand.

### The fragment system

For large codebases, the bundle is assembled from a root file plus one fragment per module (a folder may hold several):

- **`docs/flowmap/root.mmd`** — the global namespace: container nodes (one per module/unit), shared nodes (stores, types, services), and cross-folder edges. Every id defined in `root.mmd` is global.
- **One `<module>.flowmap.mmd` per module**, self-rooted with `%% root <containerId>` where `<containerId>` is a node defined in `root.mmd` (the join key). A single folder can hold many such fragments. Any id not global is private and gets namespaced `<containerId>__<id>` at merge time.
- `--dir src` tells the bundler to find every `*.flowmap.mmd` under `src/` recursively (legacy bare `flowmap.mmd` is still matched).

The bundler merges them, drops geometry (`%% fm` / `%% edge` lines — Tidy re-lays), and emits one valid `.mmd`.

You don't have to use fragments. You can author one `.mmd` by hand (or have an LLM emit it) per `SYNTAX_README.md` and Load that. This repo itself uses the fragment system: `root.mmd` plus one `<module>.flowmap.mmd` per module under `src/core/`.

### The npm scripts (this repo)

From the root `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "flowmap:bundle": "node tools/flowmap/bundle.mjs --root docs/flowmap/root.mmd --dir src > docs/flowmap/_bundle.mmd",
    "flowmap:validate": "node tools/flowmap/validate.mjs docs/flowmap/_bundle.mmd",
    "flowmap:lint": "node tools/flowmap/flowmap-lint.mjs docs/flowmap/_bundle.mmd",
    "flowmap:bodies": "node tools/buildspec/bodies-from-map.mjs",
    "flowmap:ship": "npm run flowmap:bundle && node tools/flowmap/validate.mjs docs/flowmap/_bundle.mmd && node tools/flowmap/flowmap-lint.mjs docs/flowmap/_bundle.mmd && npm run flowmap:bodies && echo 'DONE: map is grammar-valid + structurally sound (lint pass) and bodies.json regenerated from real source.'",
    "flowmap:verify": "npm run flowmap:bundle && node tools/flowmap/validate.mjs docs/flowmap/_bundle.mmd && node tools/flowmap/flowmap-lint.mjs docs/flowmap/_bundle.mmd",
    "spec:stubs": "node tools/buildspec/spec-to-stubs.mjs",
    "spec:extract": "node tools/buildspec/extract.mjs",
    "spec:gate": "node tools/buildspec/gate.mjs",
    "spec:test": "node --test tools/buildspec/pipeline.test.mjs"
  }
}
```

`flowmap:ship` is the one-command generate. It runs four steps in sequence:

1. **bundle** — merges fragments → `docs/flowmap/_bundle.mmd`
2. **validate** — grammar check (one header, no dup ids, every reference resolves)
3. **lint** — semantic quality gate (no FLAT, no LOOSE-BAG) — fails the build if the map is a file-mirror
4. **bodies** — generates `public/bodies.json` from real source

Then in the app: Load `_bundle.mmd`, Bodies-load `public/bodies.json`, click Tidy.

### Two paths to bodies.json

- This repo uses `bodies-from-map.mjs` — an explicit id→symbol map (`MAP` object) because this repo's diagram node ids were chosen for readability and don't always match the TS symbol names (e.g., node `renderPass` → symbol `initRender`). It writes `public/bodies.json`, keyed by the same node ids used in `docs/flowmap/root.mmd` so the in-app source pane resolves. This is flowmap-specific; do not copy it into a consumer repo.
- Consumer repos use `flowmap-extract` (`extract.mjs`) — which reads `@flowmap-node` banners, captures real signatures + bodies, and writes both `.mmd` and `.bodies.json`. The node ids come from the banners, so they match the diagram by construction.

## The build-spec pipeline (stubs → extract → gate)

This is the deterministic enforcement machine. Three steps, no AI in the loop:

### Step 1 — Spec → TS stubs + contracts (`spec-to-stubs.mjs`)

Reads a `.mmd` spec and emits TypeScript: one file per node with the exact signatures the `fm:meta` declares, bodies thrown as `throw new Error('unimplemented')`. The AI fills bodies, never signatures. Interface drift becomes a `tsc` error, continuously, for free.

Each generated file carries the `// @flowmap-node <id> kind=<kind> [parent=<p>]` banner — the authoritative identity tag the extractor reads back.

It also emits one `.contract.ts` per member-gated node (class / function / hook / type) — a compile-time pass/fail test that references the symbol's signature using TypeScript's type system:

```ts
// @flowmap-contract store kind=class
// Compile-time contract. Drift in a member name / arity / return breaks typecheck.
import { Store } from './store';
export type _ctor_Store = Store;
export type _p_patch = Parameters<Store['patch']>;
export type _r_patch = ReturnType<Store['patch']>;
```

If the AI renames a method, changes its arity, or removes it, `tsc` fails — the contract literally is the types. These are pass/fail tests: they either compile or they don't. The spec's `accepts` and `returns` are what make them work — without them, there are no signatures to freeze.

### Step 2 — Extract from TS (`extract.mjs`)

Walks the TypeScript project with ts-morph and re-serializes the real code structure into a `.mmd` graph: one node per `@flowmap-node`-tagged symbol, kind/parent from the tag, interface skeleton read from actual signatures. Import relations are emitted as dotted edges (informational). Also writes `bodies.json` with real bodies + signatures for the source viewer.

This extracted graph cannot drift — it is the code.

### Step 3 — Gate: diff spec vs code (`gate.mjs`)

Diffs the committed spec (`.mmd`) against the extracted code (`.mmd`) and fails on drift. Exit 0 = in sync, exit 1 = drift.

Blocking (errors):

- `unbuilt` — spec node with no matching symbol in the code
- `unplanned` — symbol with no matching spec node (new scope)
- kind mismatch, parent mismatch
- missing member (declared interface absent in code)
- arity mismatch (only for class, function, hook)
- return mismatch (void vs value, for member-gated kinds)

Non-blocking (warnings):

- extra member on a gated node
- edge differences (spec edges are semantic call-order; extracted edges are imports — not 1:1)

Run it in CI: `npm run spec:gate -- --spec <spec.mmd> --code <extracted.mmd> [--unplanned-as-warning]`

### The round-trip test

`npm run spec:test` runs a zero-dependency `node --test` suite (7 tests) that covers: the parser, a hand-verified extractor graph (guards against silent undercount — the extractor's failure mode), every gate drift class, the full generate→extract→gate round-trip, and that generated stubs compile under strict `tsc`.

## Connecting Flowmap to your repo

Flowmap and your project are two separate repos, expected as siblings:

```
Programming/
  flowmap/                 # this repo (the app + the tooling package)
  your-project/            # your TypeScript repo
```

**Install the tooling package**

```bash
# from your project root — sibling checkout of flowmap:
npm install -D file:../flowmap/tools
```

This puts six CLIs on your PATH (via `node_modules/.bin`): `flowmap-bundle`, `flowmap-validate`, `flowmap-lint`, `flowmap-extract`, `flowmap-gate`, `flowmap-stubs`. ts-morph comes with it. The authoring spec ships at `node_modules/flowmap-spec-tools/SYNTAX_README.md`.

**Add the scripts**

```json
{
  "scripts": {
    "flowmap:bundle":   "flowmap-bundle --root docs/flowmap/root.mmd --dir src > docs/flowmap/_bundle.mmd",
    "flowmap:validate": "flowmap-validate docs/flowmap/_bundle.mmd",
    "flowmap:lint":     "flowmap-lint docs/flowmap/_bundle.mmd",
    "flowmap:bodies":   "flowmap-extract --tsconfig tsconfig.json --out /tmp/extracted.mmd && cp /tmp/extracted.bodies.json ./bodies.json",
    "flowmap:ship":     "npm run flowmap:bundle && flowmap-validate docs/flowmap/_bundle.mmd && flowmap-lint docs/flowmap/_bundle.mmd && npm run flowmap:bodies",
    "flowmap:gate":     "flowmap-extract --tsconfig tsconfig.json --out /tmp/extracted.mmd && flowmap-gate --spec docs/flowmap/_bundle.mmd --code /tmp/extracted.mmd --unplanned-as-warning",
    "spec:stubs":       "flowmap-stubs docs/flowmap/_bundle.mmd --out src/contracts --clean"
  }
}
```

Note: `flowmap:ship` runs bundle → validate → lint → bodies in that order. The lint step is not optional — it is the gate that rejects flat file-mirrors. If your diagram is a file-mirror, `flowmap:ship` fails. In a consumer repo, `flowmap:bodies` uses `flowmap-extract` (banners → real signatures + bodies), so it writes `./bodies.json` directly.

**What lives where**

| Stored in your repo (committed) | Stored on the Flowmap side | Stored in the browser |
|---|---|---|
| `docs/flowmap/root.mmd` — the global namespace | The Flowmap app itself | The currently-loaded diagram + your prefs |
| `src/**/*.flowmap.mmd` — one fragment per module | Nothing — your source is never copied into the Flowmap repo | The loaded diagram + prefs (autosaved to localStorage) |
| `@flowmap-node` banners inside your `.ts` files | | The `bodies.json` you load via Bodies (in memory only) |
| `docs/flowmap/_bundle.mmd` — the generated diagram you Load | | |
| `flowmap-spec-tools` in `node_modules` + your `package.json` scripts | | |

Your repo owns the spec (`root.mmd`, fragments, banners) and produces two artifacts: `_bundle.mmd` (the diagram) and `bodies.json` (the source data). You Load `_bundle.mmd` and Bodies-load `bodies.json` into the app; both are read in your browser and never uploaded.

## Using the app

**Toolbar (left → right):** shape tools (box, rounded, stadium, store, decision, state/event, service, note, group) · Link mode (`L`) to draw edges · undo / redo · Tidy (auto-layout) · Snap (grid) · PNG / SVG export · Save / Load `.mmd` · Bodies (load a `bodies.json` for the source viewer — read in your browser, never uploaded) · panel toggle (`Tab`) · shortcuts (`?`).

**Side panel** (drag its left edge to resize):

- **inspector** — selected node/edge: id, kind, frontmatter; edit label, line style, routing; reset/reverse/delete an edge.
- **style** — base theme, accent colour, page width.
- **mermaid** — the live `.mmd` text; edit and Apply text → canvas, or copy.
- **source** — the selected node's real TS signature + body, from the `bodies.json` you load via Bodies.

**Canvas:** drag nodes; click a node to light up all its connections; click a type name in a frontmatter card to trace every node using that type; double-click a container (or right-click → Open internals) to drill in, `Esc` to step up; the breadcrumb shows depth. Minimap (bottom-right) for navigation. Everything autosaves to localStorage.

## The three workflows

### A. Plan & communicate with an AI agent

1. In the app, place nodes and draw edges to compose the architecture (shapes for role, kind for construct, solid edges for the call spine, dotted for everything else).
2. Fill each node's frontmatter (name, desc, accepts, returns) — that's the contract.
3. Save the `.mmd` and give it to the agent as the build plan. Or give the agent `SYNTAX_README.md` and ask it to emit a `.mmd`, then Load + refine it visually.

### B. Make AI code drift impossible

**Spec-first (greenfield):**

1. `flowmap-stubs <spec.mmd> --out <dir> --clean` turns the spec into TS stubs (signatures frozen, bodies throw 'unimplemented') + `.contract.ts` pass/fail tests.
2. The agent fills bodies, never signatures. Any signature change is a `tsc` error (from the stubs + contracts).
3. `flowmap:gate` in CI re-extracts the real code and diffs it against the committed spec.

**Code-first (brownfield):**

1. `flowmap-extract` auto-generates a diagram from your existing TS (reads `@flowmap-node` banners).
2. Curate it into a spec: adjust grouping, add frontmatter, run `flowmap-lint` until it passes.
3. `flowmap:gate` on every PR diffs reality against that spec.

### C. Inspect & understand any codebase

1. `flowmap-extract --tsconfig <tsconfig> --out extracted.mmd` walks the TS and emits a diagram + `extracted.bodies.json`.
2. Load `extracted.mmd`, Bodies-load `extracted.bodies.json`, Tidy.
3. Click any leaf node → source tab shows its real body + signature; click a type name to trace it; double-click a container to drill into its private call graph.

## Architecture (this repo)

```
src/                        # THE APP (browser, Vite, vanilla TS)
  core/        types, frontmatter, config, context, state, history, persistence, seed, camera
  render/      render (nodes + cards), wires, avoidRouter (libavoid WASM), minimap
  interaction/ selection, nodes, pointer, keyboard, clipboard, view (drill-in), inline-edit, context-menu
  io/          mermaid (parse/serialize), layout (Tidy), export, files
  panel/       tabs, inspector (+ source viewer), inspector-frontmatter, style-controls, theming
  main.ts      composition root — constructs and wires everything

tools/                      # THE TOOLING (dev-time, .mjs, no build)
  flowmap/     bundle.mjs, validate.mjs, flowmap-lint.mjs (+ fixtures, tests)
  buildspec/   spec-to-stubs.mjs (#1), extract.mjs (#2), gate.mjs (#3),
               skeleton.mjs, diff-core.mjs, mmd-parse.mjs, bodies-from-map.mjs
  SYNTAX_README.md    the .mmd authoring spec (ships with the package)
  BUILD_FLOWMAP.md    procedure for building a flowmap (read before building)
  DISTRIBUTION.md     how the package is consumed
  package.json        the flowmap-spec-tools npm package
```

The app's model is the single source of truth; the canvas and the Mermaid textarea both read and write it. Modules are wired through a shared `AppContext` (`src/core/context.ts`) rather than importing each other's runtime functions, keeping the dependency graph acyclic. `main.ts` constructs each module and wires the cross-module hooks.

## Planned features

The full direction is in `DIRECTION_ai_build_workflow.md`. The deterministic core (stubs → extract → gate) already exists. What's still planned:

- **Search** — paste an `.mmd`, find a class/module/type by navigating the extracted graph.
- **In-app visual diff** — paste two `.mmd` files and see the delta on the canvas.
- **Behavioural test bodies from prose (Idea A)** — an LLM turns a node's behavioural `desc` into a real assertion you review once; CI then enforces it. Closes the one gap types and structure can't: behaviour.
- **Intent → spec delta (Idea B)** — describe a change in English; the LLM proposes the `fm:meta` diff; you approve; the deterministic pipeline enforces it.
- **Advisory PR reviewer (Idea C)** — an LLM checks a PR against prose claims that can't be a type or a test, and warns, never blocks.
