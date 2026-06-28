# flowmap — orientation for a new contributor (human or AI)

Read this first. It exists so you can work in this repo **without reading every file**.
It holds only the durable mental model — the things you cannot infer from any single file
and that, missed, cause wrong changes. The precise, always-current map of every
module/interface/source lives in the flowmap (see *Navigating* below) and is regenerated
from code, so this file stays short and rarely needs editing.

## Two things live in this repo — do not conflate them
1. **The app** — `src/`. A client-side canvas diagram editor. **Vanilla TypeScript + Vite,
   no framework** (no React/Vue/Svelte). The DOM is built by hand.
2. **The flowmap-spec tooling** — `tools/`. A *separate* dev-time system that turns a repo
   into a reviewable `.mmd` architecture map and lints it (it rejects flat "file-mirror"
   maps). It documents *other* repos — and this one. It is **not** part of the app runtime.
   Entry point: `tools/BUILD_FLOWMAP.md`. This app's own map is `docs/flowmap/_bundle.mmd`.
   How it is packaged, how other repos consume it (a local `file:` dependency, by
   design — not copy-paste, not on npm), and the exact publish recipe if that is ever
   needed: `tools/DISTRIBUTION.md`.

Everything below is about **the app**.

## The 3 invariants that explain everything
**1 — `src/main.ts` is the composition root: the ONLY module that imports every other.**
Every module is a factory: `initX(ctx, deps) => api`. `main.ts` (a) builds one `AppContext`,
(b) calls each `initX` in dependency order, (c) wires hooks, (d) binds top-level DOM, (e) boots.
No business logic lives in `main.ts`. **To see how anything connects, read `main.ts` — not the
feature files.**

**2 — Modules NEVER import each other's runtime code. They call `ctx.hooks.<fn>()`.**
`main.ts` assigns the real implementations onto `ctx.hooks` *after* every module is built
(`createHooks()` in `core/context.ts` seeds them with throwing placeholders, so a hook called
before boot throws a clear error). This deliberately breaks import cycles (render → inspector
→ render). So when `pointer.ts` calls `ctx.hooks.render()`, the implementation is in
`render.ts`, wired in `main.ts` step 4 — **there is no direct import to chase; stop looking
for one.** Rule of thumb (from `context.ts`): shared *data* lives on `ctx`; shared *behaviour*
is wired as a hook but defined in its owning module.

**3 — `ctx` (`AppContext`) is the single shared object, passed to every `init`.**
The entire app state is here and nowhere else:
- `ctx.state` — the diagram model (nodes, edges, selection, id counters). **Source of truth.**
- `ctx.cam` · `ctx.prefs` · `ctx.history` · `ctx.clipboard` · `ctx.runtime` — live singletons.
- `ctx.view.container` — current drill-in level (`null` = top level).
- `ctx.bodies` — optional `id → {kind, body}` source map for the inspector's source pane.
- `ctx.hooks` — the cross-module callbacks from invariant 2.

## The data model: state ↔ text
The diagram **is** `ctx.state`. `io/mermaid.ts` is the **only** serialiser: `toMermaid`
(state → text) and `fromMermaid` (text → state). The Mermaid `<textarea>` is a *view* of
state, refreshed by `hooks.sync`. `render/render.ts` reads state → DOM. `io/layout.ts`
("Tidy") rewrites node positions *in state*. User edits go through `interaction/nodes.ts` and
`interaction/selection.ts`, then trigger `hooks.render` + `hooks.sync` + `history.pushHistory`.

## The runtime loop
input (`pointer.ts` / `keyboard.ts`) → verbs mutate `ctx.state` (`nodes.ts` / `selection.ts`)
→ `hooks.render` → `render.ts` paints DOM → `wires.ts` draws edges → `avoidRouter.ts` routes
reference edges off the main thread (`avoidWorker.ts`). Undo = `history.ts` snapshots of state.
Autosave = `persistence.ts` → `localStorage`.

## Folder map (coarse — the precise map is the flowmap)
- `core/` — model + shared seam: `state`, `context` (ctx + hooks), `config` (static data
  tables), `types`, `frontmatter`, `validate`, `camera`, `history`, `persistence`, `runtime`, `seed`.
- `interaction/` — input → model verbs: `pointer`, `nodes`, `selection`, `clipboard`,
  `keyboard`, `inline-edit`, `context-menu`, `view` (drill-in navigation).
- `io/` — text + layout + files: `mermaid` (state↔text), `layout` (Tidy), `export` (SVG/PNG), `files`.
- `panel/` — right-hand UI: `inspector` (+ source pane), `inspector-frontmatter`, `tabs`,
  `style-controls`, `theming`.
- `render/` — drawing: `render` (DOM), `wires` (edges), `avoidRouter` (+ `avoidWorker`), `minimap`.

## Conventions
- Init-factory per module; one `AppContext`; hooks for every cross-module call.
- Theming is CSS variables set from `prefs` by `theming.ts` — don't hard-set colours on nodes.
- `%% ...` comment directives and `@flowmap-node` banners belong to the tooling, not the app.

## Navigating without reading every line
- **Whole architecture + interfaces + source**: open `docs/flowmap/_bundle.mmd` in the app,
  or read `docs/flowmap/root.mmd` — every module carries a one-line `desc` and its interface as
  frontmatter, and the 13 heaviest units are drilled to function level. `public/bodies.json`
  holds the real source per node (regenerate with `npm run flowmap:bodies`).
- **What module X exposes**: its `initX` return type, or its frontmatter in `root.mmd`.
- **How X reaches Y**: it doesn't directly — find the hook in `core/context.ts` and the
  wiring in `main.ts`.
- **Minimum useful read before a change**: `main.ts` (wiring) + `core/context.ts` (the
  `ctx`/`hooks` shape) + the one module you're touching. That is enough.

## Keeping this current (low-maintenance by design)
- This file = **durable patterns only**. Edit it only when an *invariant* changes (rare).
- The **precise** map regenerates from code: `npm run flowmap:ship` (bundle → validate → lint
  → bodies). `flowmap-lint` fails the build if the map ever degrades into a flat file-mirror,
  so the architecture doc cannot silently rot.

## Working rules (non-negotiable) 
- Before writing ANY documentation or making claims about how code works,  READ the actual source files. Never synthesize from narrative docs or memory.
- Batch your reads: read all relevant files in one turn before responding.
- After writing, VERIFY: run the commands you documented, cat the files you  cited. Correct discrepancies before showing the result.
- If you're about to describe a script's behavior, cat package.json and quote it.`