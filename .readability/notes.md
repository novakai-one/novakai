## src/panel/unfold.ts (m6/panel-unfold-p2)
- `renderInspector` (sonarjs/cognitive-complexity 57, ~155 lines) still exceeds
  the threshold — the 300-line diff budget was exhausted by requestRoutes/
  drawWires/invokeVerb extractions first. It has three clean early-return
  branches (focusType / selected-wire / selected-node) plus a large node-detail
  branch (crumbs, role summary, `conns`/`blk`/`aggBlk` closures, event wiring)
  that are good candidates for a future extraction pass, same pattern used
  here (hoist inline closures to module-private sibling functions so sonarjs
  stops counting their nesting against the parent). The repeated
  `el.querySelectorAll('[data-goto]')...` wiring (3x, one no-duplicate-string
  warning) should become one `wireGotoLinks(el)` helper as part of that pass.
- `initUnfold` itself is flagged max-lines-per-function (the whole module body
  is effectively one closure) — structural to the file, out of scope for a
  line-budgeted pass; would need an architectural decision, not a mechanical
  extraction.
- `drawStageWires` (72 lines, no complexity flag) and `wireHit`/`wireOpacity`
  (max-params, 5) are minor leftover lint warnings, not gate-blocking.

## src/io/mermaid.ts (m6/io-mermaid-p1)
- `toMermaid` (sonarjs/cognitive-complexity 87, 96 lines) was the worst
  offender by far and consumed the whole 300-line diff budget: split into
  8 module-private emit/compute helpers (`emitLayoutMeta`,
  `emitFrontmatterAndKindMeta`, `emitContainmentMeta`, `emitEdgeMeta`,
  `emitRootAndGroupMeta`, `computeStructuralGroups`,
  `assignNodeToGroupByGeometry`/`addGeometryFallbackGroups`,
  `computeInGroup`, `emitGroupedNodes`, `emitEdges`), each a plain
  `(state, inc) => string`/`Record` function with no closures, so none carry
  sonarjs nesting penalties from each other. `toMermaid` itself is now a
  10-line dispatcher; no complexity or max-lines-per-function warning remains
  on it or on `initMermaid`.
- `fromMermaid` (complexity 16, 94 lines) and its `text.split('\n').forEach`
  callback (complexity 31, the per-line grammar switch) are **not yet fixed**
  — budget was exhausted by `toMermaid`. The extraction shape is already
  proven by this pass: pull the forEach body into a module-private
  `parseLine(raw, ctx)` (plus `parseMetaLine`/`parseDirLine`/`parseShapeLine`/
  `parseEdgeLine` sub-helpers, mirroring the emit-helper split above) driven
  by a `ParseCtx` bag of the accumulators + `bumpN`/`ensure`/`setDir`/
  `nextEdgeId` closures; then split the post-`forEach` metadata/containment/
  edge-routing/hier-pruning block (lines ~139-171) into 2 helpers so
  `fromMermaid`'s own complexity (currently from that block, not the forEach)
  drops under 15. Left as a future pass per the id-length warnings too (47 of
  them, mostly single-letter `m`/`n`/`e`/`p`/`t` locals) — cheapest to fix
  while doing that extraction, since the lines are rewritten anyway.
