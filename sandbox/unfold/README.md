# flowmap · unfold — a folded map you open only where you look

A sandbox prototype for the **understanding** surface of flowmap: the view a person opens when
they arrive at a repo cold and need to grasp how it fits together — without being buried.

> Open it on the dev server: **`http://localhost:5173/sandbox/unfold/`**
> (`npm run dev`, then that path — the port may differ if 5173 is taken). It reads the **live**
> maps at runtime; nothing is baked in.

---

## The one idea

The whole codebase is **one folded organism**. You arrive to exactly two things — a
**spatial editor** and its **tooling** — and *nothing else*. 95% is folded away. You **unfold**,
in place, only the parts you want to understand. Everything else stays quiet.

This inverts the usual architecture diagram (which shows you everything and dares you to cope).
Here **detail is opt-in, never pushed**, and the default is stillness.

Four principles it holds to, on purpose:

1. **95% removed by default.** The entry canvas is two calm cards. That is the whole picture until
   you ask for more.
2. **Zero titles, zero narration.** No brand, no header, no explanatory copy anywhere on the
   surface. The app never summarises itself — the summary forms in the reader's head, which is
   the point. The only text on screen is the content itself (and a folded-percentage count).
3. **You cannot get lost.** There is no infinite void to pan into. The canvas *reframes to fit*
   whatever is unfolded after every change, panning is bounded so content can never leave the
   screen, and one **fit** button always brings you home.
4. **Unfold in place, never navigate away.** Opening the spatial editor doesn't replace the screen —
   it expands where it sits, and the tooling stays visible beside it. You keep your bearings.

## How you reveal things (all opt-in, all OFF by default)

- **Unfold a card** — plain click on regions/groups/clusters; ⤢ or double-click on modules and
  symbols. Unfold as deep as you like: region → group → module → **cluster** (the bundle's own
  intra-module subgraphs, e.g. "Viewport transform") → symbol.
- **The reveal panel** — eight independent layers:
  *calls* (solid call wires) · *dependencies* (dotted dep wires) · *descriptions* ·
  *interfaces* (accepts/returns/state) · *metrics* (symbol counts, fan-in, hubs) · *colour* ·
  *trust* (mark advisory claims and edges, per the A5/A4 tiers) ·
  *blast radius* (ripple everything that transitively depends on the selection, hop-numbered).
- **Browse** — the full tree as a checklist. Check any node to place it on the canvas (ancestors
  unfold automatically); uncheck to remove just that one. Search to filter.
- **Inspector** — empty until you select. Click any card for its interface, connections
  (advisory ones marked), blast count, and — for app symbols — the **real source body** from
  `public/bodies.json` plus its `%% src` path.
- **fold all** (dock) — collapse everything back to the two regions.

Wires are orthogonal elbows, aggregated to whatever is currently visible (an edge into a folded
region shows as an edge into that region), and they highlight the selection.

## Aesthetic

Warm paper, graphite ink, one muted slate accent. Hairlines and whitespace. No neon, no grid, no
decoration that isn't information. Light by default; a soft dark on tap (persisted).

---

## What's real vs. what's sandbox

- **The maps are the source of truth,** parsed by **the app's own parser** — `main.ts` imports
  `fromMermaid()` from `src/io/mermaid.ts`, the same grammar the editor and the A3 conformance
  test cover, so this surface cannot drift from the app's reading of the syntax. Verify the
  import: `grep -n "from '../../src" sandbox/unfold/main.ts`
- It parses the four live files at runtime: `docs/flowmap/root.mmd` + `_bundle.mmd` (the app,
  down to symbols + bodies) and `root-tools.mmd` + `_tooling.mmd` (the tooling), plus
  `docs/flowmap/edge-advisory-allowlist.txt` (A5) for the trust layer.
- The only supplementary scan is `%% src` — a tooling directive the app parser ignores by design
  (CLAUDE.md conventions); one regex, not a second grammar.
- **`hierarchy.json`** is the only sandbox artifact: it declares the **two top-level regions** and
  the app's responsibility grouping — a curated overlay that could later become a first-class
  `.mmd` directive (deliberately not done yet: it would touch the gated tooling pipeline). The
  tooling side derives its structure natively from the `_tooling.mmd` subgraphs. Leaves are real
  module ids, and `verify.mjs` fails if any drift.

## Self-check (headless, no browser)

```
node sandbox/unfold/verify.mjs
```

Re-derives coverage straight from the live maps and asserts: every app module is grouped, every
grouping leaf is a real node, tooling members attach, every edge endpoint resolves, **every edge
token is inside the app parser's grammar** (a token `fromMermaid` would drop = a relation the
surface would silently hide), every advisory-allowlist edge resolves to a live map edge, every
`bodies.json` key is a bundle node, and the blast-radius walk terminates with real dependents.
Exit 0 = no card is stranded and no claim is silently hidden.

## It's a sandbox

Self-contained: `index.html` + `main.ts` + `hierarchy.json` + `verify.mjs`. Outside the app
tsconfig and build; imports app modules one-way; exported to nothing. Verify:

```
grep -rn "sandbox" src tools        # no matches — nothing imports the sandbox
git status --short -- src tools     # empty — the app is untouched
```

**Delete `sandbox/unfold/` to remove everything.**

## Known edges / next steps (honest)

- Tooling drills to member functions with descriptions, but not to source bodies — `bodies.json`
  is app-only today.
- Wire routing is naive orthogonal (no obstacle avoidance); dense unfolds get crossings. The
  app's real `avoidRouter` exists if this ever graduates from sandbox.
- The nested-containment layout is DOM flex, not the app's real `ctx.state` positions. This is the
  *understanding* view, deliberately tidy; it is not the editor's canvas.
- `hierarchy.json` promotion to a first-class `.mmd` grouping directive is the natural next
  increment once this design settles.
