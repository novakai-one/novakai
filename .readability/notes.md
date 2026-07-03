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
