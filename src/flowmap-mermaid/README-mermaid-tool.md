# Flowmap

A spatial diagram tool for dev work — drag-and-drop flowcharts with two-way
Mermaid sync, per-node frontmatter (public-interface cards), semantic **kind**
badges with per-construct colour tinting, type tracing across the canvas,
selecting a node to light up all its connections, purpose **sections** (grouped,
click-through zones), obstacle-avoiding wires with draggable labels and bends,
themes, an overview minimap, undo/redo, autosave, and SVG/PNG export. Runs
entirely in the browser; no backend.

The authoring format for generating a diagram from a codebase (e.g. with an LLM)
is specified in [`SYNTAX_README.md`](SYNTAX_README.md).

## Develop

```bash
npm install
npm run dev        # Vite dev server with hot reload
npm run typecheck  # strict tsc, no emit
npm run build      # type-check + production bundle to dist/
npm run preview    # serve the built bundle
```

Open the dev server URL it prints. The app autosaves to `localStorage`, so a
refresh keeps your diagram.

> Why a dev server rather than opening `index.html`? ES modules can't load over
> `file://` (browser CORS). `npm run dev` (or any static server) is required.
> The built `dist/` is fully static and deploys to GitHub Pages as-is.

## Architecture

The model is the single source of truth; the canvas and the Mermaid textarea
both read and write it. Modules are wired through a shared `AppContext` (see
`src/core/context.ts`) rather than importing each other's runtime functions,
which keeps the dependency graph acyclic. `main.ts` is the only module that
knows about all the others — it constructs each one and wires the cross-module
hooks.

```
src/
  core/
    types.ts         shared data shapes (Node, Edge, Prefs, ...)
    frontmatter.ts   per-node frontmatter value type + type-ref parsing/collectors
    config.ts        static tables: shapes, palette, themes, fonts, defaults
    context.ts       AppContext: DOM refs, runtime singletons, hook seam
    state.ts         the model + pure geometry/snap helpers
    runtime.ts       transient flags render reads (editingId, linkSrc, tracedType)
    camera.ts        pan/zoom transform, screen<->world, zoom-to-fit
    history.ts       undo/redo via model snapshots
    persistence.ts   autosave + prefs in localStorage
    seed.ts          first-run sample diagram
  render/
    render.ts        model -> node DOM, shape markup, frontmatter cards, status
    wires.ts         edge paths, hit areas, labels, bend handles, trace highlight
    avoidRouter.ts   libavoid WASM: obstacle-avoiding orthogonal wire routes
    minimap.ts       overview canvas + click/drag navigation
  interaction/
    selection.ts     select / toggle / clear / all
    nodes.ts         add / link / delete / align / group
    clipboard.ts     copy / paste / duplicate
    pointer.ts       drag / marquee / pan / resize / port-link / label+bend drag / type-trace
    inline-edit.ts   double-click label editing
    keyboard.ts      shortcuts + wheel pan/zoom
    context-menu.ts  right-click menu
  panel/
    theming.ts       apply theme / font / canvas prefs
    style-controls.ts build + wire the Style tab
    inspector.ts     single / multi / edge property editors
    inspector-frontmatter.ts  the per-node frontmatter editor inside the inspector
    tabs.ts          panel tabs, collapse, toast
  io/
    mermaid.ts       two-way Mermaid <-> model
    layout.ts        auto-layout (layered tree)
    export.ts        standalone SVG + PNG export
    files.ts         save / load .mmd
  main.ts            composition root: construct, wire hooks, boot
```

### The hook seam

`AppContext.hooks` holds cross-cutting callbacks (`render`, `sync`,
`renderInspector`, `pushHistory`, `toast`, ...). Each module defines its own
behaviour and calls *other* modules' behaviour only through these hooks.
`main.ts` assigns the real implementations after every module is constructed.
This is what lets, say, `nodes.addNode()` trigger a re-render and a history push
without `nodes.ts` importing `render.ts` or `history.ts` directly.

### Frontmatter, type tracing & wires

Each node can carry **frontmatter** (`node.fm`): a `name`, `description`, a list
of `state` vars, and a list of `interfaces`, each with its own `accepts` /
`returns`. List items are stored as raw `"varName: Type"` strings — the part
after the colon is the **type**, which is the cross-reference identity. The value
type plus its helpers (`parseTypeRef`, `nodeUsesType`, `allTypeNames`) live in
`core/frontmatter.ts`; the on-canvas card is built by `buildFmCard` in
`render/render.ts`, and the side-panel editor is `panel/inspector-frontmatter.ts`.

**Type tracing** — single-clicking a type chip on a card sets
`runtime.tracedType`. The next render highlights every node, chip, and wire that
uses that type and dims the rest. Cleared by Esc, an empty-canvas click, or
clicking the same chip again. The wire half (highlight when both endpoints match)
lives in `render/wires.ts`.

**Wires** — `wires.ts` draws each edge; `avoidRouter.ts` routes the non-bent ones
around node footprints (including their frontmatter cards) via the libavoid WASM
router, recomputed on Tidy and after any manual node move/resize/nudge (the
`reroute` hook). An edge may override routing with a manual `bend` point (drag the
midpoint handle on a selected edge) and a manual `labelPos` (drag the label).
Both persist; “Reset route & label” in the edge inspector clears them. See
`SYNTAX_README.md` for the `%% edge … bend/labelpos` metadata lines.

## Persistence keys

- `flowmap.autosave.v1` — the current diagram + camera
- `flowmap.prefs.v1` — theme, font, grid/snap/minimap toggles, default routing
