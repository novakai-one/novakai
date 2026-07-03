# M6 readability pass — src/panel/unfold.ts (p1)

**Files touched:** `src/panel/unfold.ts` (plus `.readability/baseline-scores.json` ratchet update).

**Score:** 305 → 299 (sonarjs/cognitive-complexity warnings 8 → 4).

**Complexity reductions (extracted as module-private helpers, no behavior change):**
- `cardEl` (27 → resolved): split into `cardHighlight` (selection/blast/neighbour state),
  `cardClick` / `cardDblClick` (event handlers), `cardClassName`, `cardBodyHtml`.
- keydown listener (32 → resolved): split into `handleEnterKey`, `handleVerbShortcut`,
  `handleEscapeKey`.
- `stageProxies` (32 → resolved): split into `collectProxyLinks`, `deoverlapAngles`,
  `buildProxyEl`, with new `PLink`/`ProxyEntry` interfaces.
- `build` (47 → resolved): split into `populateNodesAndParents`, `applyHierGroups`,
  `computeEdgesAndAdjacency`.

**Remaining (>= 15, future pass):** `requestRoutes` (48, line 1170), `drawWires` (49, line
1284), `invokeVerb` (23, line 1872), `renderInspector` (57, line 2185) — left for a future
pass; the 300-line diff budget was reached after the above four.

**Gates:** typecheck 0, lint --quiet 0, spec:test:all 0 (no test:src script present),
API surface for `src/panel` byte-identical to `m6/integration`.
