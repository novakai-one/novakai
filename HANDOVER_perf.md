# Flowmap performance — handover

Supersedes `FLOWMAP_PERF_FIXES.md` (that file is the historical work order). All fixes applied. tsc clean, build clean. One browser smoke-test remains.

## Status: DONE

- Tidy / drag / resize freeze: fixed.
- Wire collisions on the NovaKai bundle: fixed (routing avoids node boxes, runs off the main thread).
- `.mmd` syntax unchanged; old files load.
- Remaining: confirm in the browser (one Tidy on the ~160-node file).

## The problem (was)

- Profiled one interaction at 12.7s. ~70% was libavoid throwing C++ exceptions and building a JS stack trace per throw. 1ms was rendering.
- The whole-graph libavoid route ran synchronously on the main thread, so it froze the tab.
- When libavoid failed, the catch fell back to elbows, so wires crossed nodes.

## Fixes (all applied)

1. `Error.stackTraceLimit = 0` (save/restore) around the `routeEdges` call. Killed the ~7.3s trace cost. No routing-output change. `avoidRouter.ts`.
2A. `sanitizeRect` — every obstacle forced finite, integer, min 1×1. Zero-area rects made libavoid throw. `avoidRouter.ts`.
2B. `SHAPE_BUFFER` 14 → 4. Card-inflated footprints overlapped and drove the exception storm. Confirmed headless against the real graph: cause is cards, not snap. 1651ms → 112ms at 75 nodes. `avoidRouter.ts`.
3. Scoped reroute. Drag / resize route only edges incident to the moved node; all nodes stay obstacles. New `rerouteEdges` hook. `context.ts`, `main.ts`, `pointer.ts`.
4 (render). No full DOM rebuild during drag. Dragged divs move by style; only wires redraw. New `redrawWires` hook. Selection no longer rebuilds all nodes. `context.ts`, `main.ts`, `pointer.ts`.
   - Also: in the no-avoided-route fallback, spine edges now draw as orthogonal elbows instead of straight diagonals. `wires.ts`.
5 (worker). Routing moved off the main thread.
   - `avoidWorker.ts` (new): module Worker, inits libavoid + runs `routeEdges`, posts routes back. Self-contained — bundles as its own ~54KB chunk, stays out of the main bundle.
   - `routeReferences` posts the graph and returns immediately. Caller renders elbows for moved edges; the worker reply fills the cache and re-renders the avoided routes.
   - Safety: generation counter drops stale full-reroute replies; per-request basis snapshot drops a route if its node moved again; if the worker can't init it reports `fatal`, the main thread tears it down, re-routes that request on the main thread, and stays on the main thread thereafter; `onerror` flushes in-flight requests to the main thread. Avoidance can't be lost whether or not the worker loads.
   - Removed the `MAX_DENSE_NODES` stopgap (it drew permanent elbows above 120 nodes; no longer needed now that 2B made dense routing fast and the worker makes it non-blocking).

## How routing works now

- Tidy / drag → `routeReferences` posts the graph to the worker, returns at once. No main-thread block.
- Render shows orthogonal elbows immediately; the canvas stays interactive.
- Worker replies → cache filled → re-render shows routes that go around node boxes.
- `routeFor` drops a route whose endpoint moved (stale guard).
- Worker fails to init → permanent fallback to main-thread routing (slower, still correct).

## Constraints honored

- `.mmd` syntax unchanged. `mermaid.ts` untouched.
- Obstacle-avoiding wires preserved — the whole point of the tool.

## Known limits / next

- A ~160-node flat view is busy even fully avoided. Avoidance stops wires crossing nodes, not wires crossing each other. Use drill-in (`enterContainer`) to inspect one subgraph; the flat bundle is the overview.
- The NovaKai bundle repeats `%% fm:meta` lines (e.g. `workspace name=` five times). Bundler artifact, harmless for speed — fix in the re-bundler.
- Tuning knob: `SHAPE_BUFFER` (wire-to-node gap) in `avoidRouter.ts`. Do not raise past ~6 (timing cliff).

## Verify in the browser (last step)

- Tidy the ~160-node file. The canvas should stay interactive while routes resolve, then wires should route around boxes.
- DevTools console: a `[avoidRouter] routing failed` warning appears only if the worker can't init, in which case it silently falls back to the main thread.

## Files touched

- `src/render/avoidRouter.ts`, `src/render/avoidWorker.ts` (new), `src/render/wires.ts`, `src/core/context.ts`, `src/main.ts`, `src/interaction/pointer.ts`.
- Docs: `FLOWMAP_PERF_FIXES.md` (historical work order), this file.

## Cleanup note

- The environment auto-committed mid-session. Two things were reverted: temp profiling scripts (`__probe.mjs`, `__sweep.mjs`, deleted) and a bad `@rolldown/binding-darwin-arm64` entry added to `package.json` during a sandbox build-fix (restored — deps are back to just `@mr_mint/elkjs-libavoid`). Both survive only in commit `855a319`; history was not rewritten. Working tree is clean.
