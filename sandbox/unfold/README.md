# flowmap · unfold — a folded map you open only where you look

A sandbox prototype for the **understanding** surface of flowmap: the view a person opens when
they arrive at a repo cold and need to grasp how it fits together — without being buried.

> Open it on the dev server: **`http://localhost:5173/sandbox/unfold/`**
> (`npm run dev`, then that path). It reads the **live** maps at runtime; nothing is baked in.

---

## The one idea

The whole codebase is **one folded organism**. You arrive to exactly two things — a
**spatial editor** and its **tooling** — and *nothing else*. 95% is folded away. You **unfold**,
in place, only the parts you want to understand. Everything else stays quiet.

This inverts the usual architecture diagram (which shows you everything and dares you to cope).
Here **detail is opt-in, never pushed**, and the default is stillness.

Three principles it holds to, on purpose:

1. **95% removed by default.** The entry canvas is two calm cards. That is the whole picture until
   you ask for more.
2. **You cannot get lost.** There is no infinite void to pan into. The canvas *reframes to fit*
   whatever is unfolded after every change, panning is bounded so content can never leave the
   screen, and one **fit** button always brings you home.
3. **Unfold in place, never navigate away.** Opening the spatial editor doesn't replace the screen —
   it expands where it sits, and the tooling stays visible beside it. You keep your bearings.

## How you reveal things (all opt-in)

- **Unfold a card** — double-click it, or use the ⤢ affordance on hover. Its children appear;
  the canvas reframes. Unfold as deep as you like: region → subsystem → module → symbol.
- **Layers** (right panel) — turn detail on globally, one axis at a time:
  Wires · Descriptions · Interfaces (accepts/returns) · Metrics · Colour. All **off** by default.
- **Browse** (right panel) — the full tree as a checklist. Check *any* node to place it on the
  canvas (its ancestors unfold automatically); uncheck to remove just that one. Search to jump.
- **Inspector** (right panel) — click any card for its interface, connections, and — for app
  symbols — the **real source body** from `public/bodies.json`.
- **fold all** (header) — collapse everything back to the two regions.

Wires behave like the main app: orthogonal elbows, aggregated to whatever is currently visible
(an edge into a folded region shows as an edge into that region), and they highlight the selection.

## Aesthetic

Warm paper, graphite ink, one muted slate accent. Hairlines and whitespace. No neon, no grid, no
decoration that isn't information. Light by default; a soft dark on tap (persisted).

---

## What's real vs. what's sandbox

- **The maps are the source of truth.** It parses the four live files at runtime:
  `docs/flowmap/root.mmd` + `_bundle.mmd` (the app, down to symbols + bodies) and
  `root-tools.mmd` + `_tooling.mmd` (the tooling). Nothing about the code is written here by hand.
- **`hierarchy.json`** is the only sandbox artifact: it declares the **two top-level regions** and
  the app's responsibility grouping — the kind of minor "grouping" overlay that could later become
  a first-class `.mmd` directive. The tooling side derives its own structure natively from the
  `_tooling.mmd` subgraphs. Leaves are real module ids.

## Self-check (headless, no browser)

```
node sandbox/unfold/verify.mjs
```

Re-derives coverage straight from the live maps and asserts the folded model is complete and
well-formed — every app module is grouped, every grouping leaf is a real node, tooling members
attach, and every edge endpoint resolves. Exit 0 = no card is stranded.

## It's a sandbox

Self-contained: `index.html` + `hierarchy.json` + `verify.mjs`. Touches no other file, outside the
build and tsconfig, cannot break the app. **Delete `sandbox/unfold/` to remove everything.**

## Known edges / next steps (honest)

- Tooling drills to member functions with descriptions, but not to source bodies — `bodies.json`
  is app-only today. The app side is the deep one.
- Very deep + very wide unfolds get dense at fit-zoom; you zoom in to read (never lost, just small).
  A future pass could auto-zoom to the thing you just unfolded rather than fit-all.
- The nested-containment layout is DOM flex, not the app's real `ctx.state` positions. This is the
  *understanding* view, deliberately tidy; it is not the editor's canvas.
