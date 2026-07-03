# M6 readability pass — src/panel/planner.ts (m6/panel-planner-p1)

Files touched: `src/panel/planner.ts`.

Score: 110 -> 105 (byRule before: max-lines-per-function 2, id-length 104,
sonarjs/no-duplicate-string 2, sonarjs/cognitive-complexity 2. After:
max-lines-per-function 1, id-length 104).

Complexity reductions:
- `render` (cognitive complexity 33, line 323) split into `computeLitSet`,
  `drawRealEdges`, `drawPlanGhostEdges`, `drawDependencyArrows`, `drawNode`,
  `renderCrumb`, `renderCoherenceBanner`. `drawNode` was further split into
  `isNodeDimmed`, `nodeFillColor`, `nodeSubtitleText`, `appendStatusMark`,
  `appendSelectionOutline` to keep its own complexity down and avoid a
  max-params violation (bundled box size + layout + focus/warns into one
  `NodeRenderCtx` object rather than long positional param lists).
- `renderChangeInfo` (cognitive complexity 44, line 408) split into
  `quoteBlockHtml`, `blastRadiusBlockHtml`, `signatureBlockHtml`,
  `codeTodayBlockHtml`, `dependsOnBlockHtml`, `wireChangeInfoHandlers`,
  leaving the parent as a thin assemble-and-render orchestrator.
- Hoisted repeated `'stroke-dasharray'` (3x) / `'stroke-width'` (4x) SVG
  attribute-name literals to file-local `ATTR_DASHARRAY` / `ATTR_STROKE_WIDTH`
  constants (sonarjs/no-duplicate-string).
- Added a one-line `//` comment above the sole exported function
  (`initPlanner`), previously undocumented.

Both sonarjs/cognitive-complexity warnings on this file are gone (0
remaining). id-length count is unchanged net (104 -> 104): renaming `W`/`H`
to `boxWidth`/`boxHeight` removed 7 occurrences, offset by short params in
new small helpers — left as a future-pass item along with `initPlanner`
itself still being over the 60-line function cap (out of scope: it is the
module's composition root and closure-state holder).

Gates: typecheck 0, lint --quiet 0 errors, spec:test:all 0 (303+6+2+5 tests
pass, unchanged), test:src 0 (17 tests pass, unchanged), exported API
surface for src/panel byte-identical, diff 193+105=298 lines (within 300
budget).
