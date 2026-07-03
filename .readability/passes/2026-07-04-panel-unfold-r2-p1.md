# M6 readability pass — src/panel/unfold.ts (r2-p1)

Files touched: `src/panel/unfold.ts` (+ `.readability/baseline-scores.json` ratchet update).

Score: 290 -> 285 (byRule before: id-length 284, max-lines-per-function 3,
max-params 2, sonarjs/cognitive-complexity 1; after: id-length 282,
max-lines-per-function 1, max-params 2). Remaining hot functions
(sonarjs/cognitive-complexity warnings): 0.

Complexity reductions:
- `renderNodeInspector` (cognitive complexity 25, the last hot function) split
  into module-private helpers: `buildInspectorHeaderHtml` (kind/name/
  breadcrumbs/role), `buildInspectorActionsHtml` (unfold/hide/edit/menu button
  row, extracted out of the header when it alone pushed the header to
  complexity 16), `buildInspectorFactsHtml` (accepts/returns/state + blast
  radius), and `buildInspectorSourceHtml` (loaded function body). Also added
  a shared `ancestorCrumbs(node)` helper (the breadcrumb-walk loop was
  duplicated verbatim in `renderStageGroup`); `renderNodeInspector` itself is
  now a 10-line straight-line dispatch.
- `drawStageWires` (72 lines, over the 60-line cap) split: the proxy-pill wire
  loop extracted to `drawStageProxyWires(wc: StageWireCtx)` (one bundled
  context param, keeping `max-params` at 2 total for the file).
- `invokeVerb` (62 lines) trimmed under 60 by extracting the `addNode` case
  body into `verbAddNode()`.
- Renamed local params in the new helpers away from single-letter `u`/`l`/`a`
  (`node`, `label`, `vals`) to avoid adding new id-length warnings.

No behavior change: exported `UnfoldApi`/`initUnfold` signature untouched
(api-surface hashes for src/panel identical old vs new); innerHTML output is
unchanged content, only reassembled from helpers (verified via typecheck,
lint --quiet, spec:test:all, test:src all green).
