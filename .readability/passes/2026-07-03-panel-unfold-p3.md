# M6 readability pass — src/panel/unfold.ts (p3)

**File touched:** `src/panel/unfold.ts` only.

**Score:** 293 → 290 (byRule before: id-length 283, max-lines-per-function 4,
max-params 2, no-duplicate-string 3, cognitive-complexity 1 / after: id-length
284, max-lines-per-function 3, no-duplicate-string 0, cognitive-complexity 1;
max-params unchanged at 2).

**Complexity reduction (the one sonarjs/cognitive-complexity >=15 hit from
baseline):**
- `renderInspector` (57, also 155 lines / max-lines-per-function): split into
  `renderTypeFocusInspector`, `computeWireUnderlying` + `renderWireInspector`,
  `buildContainerRoleHtml`, `buildInspectorConnectionsHtml`,
  `wireNodeInspectorControls` + `renderNodeInspector`, plus two shared helpers
  (`wireGotoLinks`, `wireActionsMenu`) that de-duplicated the repeated
  `[data-goto]` anchor wiring and `#ufIMenu` toggle logic. `renderInspector`
  itself is now a 9-line dispatcher; the largest extracted function
  (`renderNodeInspector`) still carries complexity 25 — improved from 57 but
  above 15, left for a future pass (300-line diff budget reached).

Also removed all 3 `sonarjs/no-duplicate-string` hits: consolidated the
triplicated `[data-goto]` forEach into `wireGotoLinks`, and hoisted
`'stroke-width'` / `'stroke-linecap'` into `ATTR_STROKE_WIDTH` /
`ATTR_STROKE_LINECAP` constants. Zero behavior change; api-surface hashes for
src/panel identical (verified against m6/integration).
