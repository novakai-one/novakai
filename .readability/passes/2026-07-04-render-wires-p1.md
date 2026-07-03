# M6 readability pass — src/render/wires.ts (p1)

**Files touched:** `src/render/wires.ts` (only target; `.readability/baseline-scores.json` regenerated as the ratchet update).

**Score:** 39 → 34 (strictly lower; only `src/render/wires.ts` changed in the baseline).

## Complexity reductions

- `drawWires` (cognitive complexity 20 → below 15, no longer flagged):
  extracted the obstacle-footprint loop into a nested `buildObstacles()`, and
  the per-edge dispatch loop (in-level draw vs. boundary-stub vs. skip) into a
  nested `renderEdges()`. Nested function declarations get their own cognitive
  score in this project's sonarjs config, so pulling branching out of
  `drawWires`'s own body (without changing behavior) resolved it.
- `drawEdge` (cognitive complexity 45 → below 15, no longer flagged):
  removed a literal duplicate of the bend/avoid-route/elbow path computation
  by reusing the already-existing `edgePath()` helper (also fixes a real
  duplication, not just complexity); split the stroke/width/marker ternary
  chains into nested `strokeColor()/strokeWidth()/markerUrl()`; and moved the
  halo, main-path, bend-handle, and label-placement/DOM blocks into nested
  functions (`drawHalo`, `drawMainPath`, `drawBendHandle`, `placeLabel`,
  `labelPosition`, `labelClassName`).
- `sonarjs/no-duplicate-string`: hoisted the 4x-repeated `'stroke-width'`
  literal to a file-local `ATTR_STROKE_WIDTH` constant.

`max-lines-per-function` still flags `initWires`/`drawWires`/`drawEdge` (same
3 functions as baseline, now containing the new nested helpers) — left for a
future pass per the diff budget. `id-length` warnings (mostly geometry
params: `p`, `q`, `d`, `a`, `b`) are unchanged from baseline; not touched to
keep the diff within budget.

Diff: 88+54 = 142 changed lines (budget 300). API surface for `src/render`
unchanged (hash-identical). All gates green: typecheck, lint --quiet,
spec:test:all, test:src.
