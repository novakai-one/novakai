> **STALE FOR DESIGN DIRECTION (2026-07-02).** This surface is historical. The approved design
> contract is `prototypes/unfold-v3-stage.html` + `docs/flowmap/plans/unfold-v3-stage.plan.json`.
> Consult this folder for mechanism only, never design direction. See SESSION_HANDOFF.md §0a.

# sandbox/ — architecture-auditor prototype (read-only, outside the app)

> New agent: this is a **design prototype**, not app code. It changes nothing in
> `src/`, exports nothing, and is invisible to the flowmap tooling. Every claim
> below is a command you can run. Do not trust the prose — run it.

## What it is
A browser prototype that reads the **live** `docs/flowmap/_bundle.mmd` and renders
six architecture-audit views on it. Purpose: explore how a codebase auditor could
answer *what are the sections · what connects to what · what deliberately doesn't ·
blast radius of a change · how does a feature run · which type is the shared currency* —
without reading source.

## Run it
```
npm run dev            # the normal Vite dev server
# open http://localhost:5173/sandbox/
```
Header should read: `live _bundle.mmd · 465 units · 285 edges · 40 modules · parsed by the repo's own fromMermaid()`.

## It REUSES real repo modules (one-way import; verify)
```
grep -nE "^import .* from '\.\./src" sandbox/main.ts
```
Expect four imports:
- `io/mermaid` → `fromMermaid()` — the app's own parser parses the live map at runtime
- `core/config` → `THEMES`, `KIND_TINT`, `esc` — the app's real theme (slate) + escaping
- `render/wires` → `orthoPath()` — the canvas's orthogonal-elbow wire routing
- `core/state` → `portPos`, `bestSides` — the canvas's port-side geometry
The arrow `<marker>` defs in `main.ts` (`ARROW_DEFS`) are copied 1:1 from `render/wires.ts`.

## Constraints it honours (verify each)
| Claim | Command | Expect |
|---|---|---|
| Changes NO app code | `git status --short -- src tools` | empty |
| Writes NO `.mmd` | `git status --short && ls sandbox` | only `index.html sandbox.css main.ts README.md` |
| Invisible to flowmap tooling (outside `src/`) | `npm run flowmap:gate` · `npm run flowmap:exports` · `npm run flowmap:coverage` | in sync · PASS · PASS |
| Not in the prod build / tsconfig | `grep -n '"include"' tsconfig.json` | `["src"]` (sandbox excluded → not typechecked, not built) |
| Exports to nothing | `grep -rn "from '.*sandbox" src tools` | no matches |

Deleting `sandbox/` is a no-op for the app.

## The six views (all live-parsed data)
1. **Sections** — 9 functional sections (by role, not folders), **dependency-layered** (foundation→entry) with arrowed orthogonal wires. Click a section → members + what flows in/out + "siblings, no cross-talk" flag.
2. **System Map** — 40 modules by dependency depth; node size = blast radius; `state` = the hub. Click a module → directional blast cone ("what breaks" / "what it needs") with the real edge contracts + its direct wiring, and what it does **not** connect to.
3. **Type Flow** — pick a type → every module that ▲makes / ▼uses it lights up. `AppContext` (28 of 40 modules) is this app's shared currency (its "DocDraft").
4. **Behavior Flow** — pick a scenario (boot / drag / undo / save / review) → the ordered module firing, with why. Boot uses the real numbered call-order; interactions trace entry → `state` → re-derive.
5. **State Hub** — `state` centred, 16 reader spokes each labelled with the slice it reads; click a slice → field-level blast radius. Makes the "no module imports another; all read one shared `state`" architecture visible.
6. **Blast Simulator** — pick module(s) → union of transitively-impacted modules, rippled by hop distance; ranked risk ledger on the left.

The relationship layer (subsystems, dependency depth, blast-radius closures, type-flow,
sibling cross-talk) is computed **in-browser** from the parsed model — see
`computeRelations()` in `main.ts`. The one curated mapping is `ROLE` (module → functional
section); everything else is derived from the real edges.

## Design provenance (why these views, not a folder tree)
Prior iterations that organised by folder/containment were rejected: an architecture
auditor needs **connection, contract, and impact**, not an inventory. The design was
pressure-tested by independent cross-model agents (the recurring verdict: lead with
intent/behaviour, make edges and blast-radius the primary element, reuse the app's own
render/geometry). The real editor (`localhost:5173`) already does node cards + click-to-wire
+ inline contracts well; this sandbox's contribution is the **analytical overlay** on top
(blast radius, type propagation, auto-detected no-cross-talk, dependency depth).

## Known limit → the next increment
This reuses the app's *parser, theme, and wire geometry*, but still draws onto its own
`<svg>` rather than instantiating the real `render`/`wires` runtime (those are
`initX(ctx, …)` factories needing a live `AppContext`). The natural next step is to build a
minimal `AppContext`, drive the real `render`/`wires`, load `_bundle.mmd` into `ctx.state`,
and add these audits as **overlays on the actual canvas** — so the analysis lives *in* the
editor, not beside it. The geometry reuse here (`orthoPath`/`portPos`/`bestSides`) is the
first step of that path.
