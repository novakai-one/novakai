# Planner (build-plan review surface) — HANDOVER

> For the next contributor (human or AI). Read this top-to-bottom before touching the
> planner. It captures the goal, what exists, the **mistaken assumptions already made
> (do not repeat them)**, and exactly what to read. The original vision artifacts in
> `prototypes/` have been deleted — they are superseded by the real implementation in
> `src/`. This doc replaces the old `prototypes/HANDOFF.md`.

---

## 0. The goal (the one idea)

Turn Novakai into the medium an AI agent uses to **show a build plan** instead of writing
prose, so a human reviews an **architectural diff with intent** and understands a change's
**code impact before implementation**.

The model, settled over a long design discussion:
- A build plan **is a small patch** (~8–14 changes), authored by an agent, that **references
  real node ids** in the current map. It is NOT a rewrite of the map and NOT a pile of new
  boxes. Most changes **modify** existing nodes/edges; only genuinely-new capabilities are new.
- **Status / intent / phase / dependencies are a metadata OVERLAY on real nodes/edges**, not
  new nodes. If you ever add a node per change, you've reverted the core insight.
- The plan is a **sidecar `.plan.json`**, keyed by node id or edge identity (`from->to:style`,
  the same `edgeKey` `core/diff` uses). It **never** touches the Mermaid serialisation — the
  user's `.mmd` carries zero plan syntax. (Verified: `io/mermaid.ts` `toMermaid` emits edges
  as plain `a-->b`; there is no content-keyed edge block to pollute.)
- End-to-end loop: **load base map (`.mmd`) → load the agent's JSON patch → review it overlaid
  on the full map → accept/reject (with coherence) → export to buildspec.**

---

## 1. What exists today (working, verified in Chrome)

A real, self-contained feature in the live app — not a prototype:

- **`src/core/plan/plan.ts`** — pure model: `Plan`, `PlanChange`, `ChangeStatus`, intent
  (problem/approach/alternative/tradeoff), `ChangeTarget` (node **or edge**), `dependsOn`, plus
  pure helpers: `normalizePlan`, `indexByRef`/`indexById`, `blastRadius`, `coherenceWarnings`,
  `synthNode`. No DOM, no model writes.
- **`src/panel/planner.ts`** — the full-screen review overlay. Builds its OWN DOM + CSS, owns
  its OWN SVG canvas, reads `ctx.state` + `ctx.plan`, writes nothing to the model (verdicts live
  in module closure). Loaders inside the overlay: Load/Paste base `.mmd`, Load/Paste plan
  `.json`, Sample; guided empty state.
- **`ctx.plan`** field on `AppContext` (sidecar; null until loaded).
- **`public/plan.json`** — a real demo patch against this repo's own map (16 changes incl.
  node + edge changes + dependency chains).
- Map fragments + `root.mmd` registration for the two new modules (so `novakai:ship` passes).

Wiring (the whole footprint — deletable in 3 edits): one `ctx.plan` field, one **Plan** button
in `index.html`, two lines in `src/main.ts` (`initPlanner(ctx, { mermaid })` + the onclick).

**Verified working:** status overlay (modify/add/remove), drill into real functions, synthesised
new nodes at the right altitude, **tri-pane bidirectional sync** (canvas ring ↔ intent panel ↔
diff hunk), real-`fm.desc` quote, **dependency coherence** (accept a change while its dependency
is rejected → ⚠ + export blocked), phase filter, gated export, all loaders + error states.
`tsc` clean · `npm run build` passes · `npm run novakai:ship` all-green.

---

## 2. MISTAKEN ASSUMPTIONS I MADE — do not repeat

These are the real flaws in the current version, in priority order. The honest assessment is:
**this is a credible review surface for the *structure and intent* of a plan, but it is NOT yet
a sufficient *impact-analysis* tool — and on core nodes it actively misleads.** Fix these.

1. **1-hop blast radius is misleading — make it TRANSITIVE.**
   `blastRadius` (in `plan.ts`) returns only *direct* callers (edges `to === ref`). The panel
   then says e.g. *"1 consumer at risk"* for a change to `state`/`types`/`render` — nodes that
   ripple through dozens of modules transitively. This makes the highest-stakes changes look
   shallow → **false confidence**, the opposite of what an impact tool should do. Compute the
   full **downstream cone** (with depth), and ideally "reaches these public entry points." The
   edge data is already in `ctx.state.edges`; this is computable now.

2. **The overlay invents its own force layout — render on the FAMILIAR map instead.**
   `planner.ts` `forceLayout()` runs a sin/cos force sim and overrides the real coordinates.
   Result: a "ball of nodes" with none of the Tidy layered spine / orthogonal elbows the user
   knows. This destroys spatial memory exactly when the reviewer needs it to reason about
   neighbourhoods. **The nodes already carry Tidy x/y in `ctx.state`** — render at those, and
   reuse the real wire routing. (I carried force-layout over from the deleted standalone
   prototype, whose data file had no coordinates. In-app that was wrong.) See `io/layout.ts`
   (Tidy), `render/wires.ts` + `render/avoidRouter.ts` (orthogonal routing).

3. **It shows a one-line `desc`, not the real code — surface `ctx.bodies`.**
   To judge a `modify`'s impact a reviewer needs the actual function body and the **signature
   before/after**, not the AI's prose. The app already loads real source into
   `ctx.bodies` (`Map<id, {kind, body, accepts, returns}>`, see `io/files.ts` `applyBodies`
   and `panel/inspector.ts` `updateSource`). The planner ignores it. Pull the target's body +
   a contract diff into the intent panel.

4. **Structural ≠ behavioural.** The overlay shows *that* a node changes and who points at it,
   but not *what contract changes* or what assumption in callers might break. Intent is prose,
   not a diff of the interface. A contract-level diff for `modify` changes would make
   behavioural ripple legible.

Lower-stakes but worth knowing: the demo `plan.json` fakes nothing now (it's a real patch), but
its phases/changes are **example content** — a real user sees their own patch, not this one.

---

## 3. What to build next (priority)

1. **Transitive blast radius** (#1 above) — highest value; current behaviour is misleading.
2. **Surface real code from `ctx.bodies`** + before/after signature (#3).
3. **Layout fidelity** — render at real Tidy positions / reuse routing (#2).
4. **Contract-level diff** for modifications (#4).

Do **not** start by polishing the force layout — replace it with the real positions.

---

## 4. What to read (minimum, in order)

1. **`CLAUDE.md`** — the 3 invariants. Non-negotiable mental model: `main.ts` is the only
   composition root; modules never import each other (they call `ctx.hooks.*`); `ctx` is the
   single shared object.
2. **The seam files** (so wiring assumptions are grounded, not guessed):
   - `src/main.ts` — how every module is built + wired (your one wiring point lives here).
   - `src/core/context/context.ts` — the `ctx`/`hooks` shape (+ `ctx.plan`, `ctx.bodies`).
   - `src/io/mermaid.ts` — the ONLY serialiser; confirms the `.mmd` carries no plan syntax.
   - `src/core/state/state.ts` — `childIdsOf`/`containerOf`/`levelFitBounds` (drill), node x/y.
   - `src/core/diff/diff.ts` — `edgeKey`, the existing structural differ (`NodeChange` is
     field/before/after only — the proof that intent needs a separate model).
3. **The feature itself:** `src/core/plan/plan.ts`, `src/panel/planner.ts`, `public/plan.json`.
4. **For the next-work items:** `src/render/render.ts` (render loop), `src/io/layout.ts` (Tidy),
   `src/render/wires.ts` + `src/render/avoidRouter.ts` (routing), `src/panel/inspector.ts`
   `updateSource` + `src/io/files.ts` `applyBodies` (how `ctx.bodies` source is surfaced today).
5. **`docs/novakai/_bundle.mmd`** opened in the app (or read `docs/novakai/root.mmd`) — the
   precise, regenerated architecture map, now including the `plan` + `planner` modules.

---

## 5. How to run / test / keep honest

- **Run:** `npm run dev` → open the app → click **Plan**. With no map loaded it opens to a
  guided empty state. To exercise it: **Paste base** the contents of `docs/novakai/_bundle.mmd`,
  then click **Sample** (loads `public/plan.json`). (In dev the bundle is also fetchable at
  `/docs/novakai/_bundle.mmd` — that path only works because Vite serves the repo root; it is
  not a user feature.)
- **Verify in the browser**, not just in prose (CLAUDE.md working rule): drill, select, accept/
  reject, coherence, export.
- **Checks:** `npm run typecheck`, `npm run build`, and **`npm run novakai:ship`** (must stay
  all-green: validate + lint + coverage + gate + bodies). If you change a public signature in
  `plan.ts`/`planner.ts`, update its `*.novakai.mmd` fragment or the **gate** fails on signature
  drift (use `npm run novakai:backfill` to pull real types).

## 6. Hard constraints (will bite if missed)

- **Keep the planner isolated:** it owns its overlay + canvas and reads `ctx`; it must not fork
  `render.ts` or bloat `ctx.state`. The plan is a **sibling** (`ctx.plan`), never baked into the
  base model.
- **The plan is JSON, never `.mmd`.** Intent/phase/deps can't live in Mermaid grammar without
  inventing `%%` directives the strict validator owns — don't. Never name a scratch artifact
  `*.mmd` (`tools/novakai/bundle.mjs` globs them and pollutes the real map).
- **Vanilla TS + Vite, no framework.** Init-factory per module; DOM by hand.
- **`novakai-lint` fails on a flat file-mirror map** — any map work keeps sections + decomposition.
