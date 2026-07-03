# M6 readability pass — src/panel/unfold.ts (p2)

**File touched:** `src/panel/unfold.ts` only.

**Score:** 299 → 293 (byRule before: id-length 282, max-lines-per-function 5,
max-params 1, no-duplicate-string 5, cognitive-complexity 4 / after: id-length
283, max-lines-per-function 4, max-params 2, no-duplicate-string 3,
cognitive-complexity 1).

**Complexity reductions (all four >=15 sonarjs/cognitive-complexity hits from
baseline, now three resolved):**
- `requestRoutes` (48→ok): split into `buildRouteScopes`, `scopeMemberIds`,
  `fillScopeEdgeFallback`, `fillRouteScopeRects` — also cleared both
  `max-depth` warnings.
- `drawWires` (49→ok): extracted `buildArrowheadDefs`, `hitPairOf`,
  `wireStrokeColor`, `wireOpacity`, `markWireEntrance`, `paintWireItem`
  (per-item loop body); function now well under 60 lines too.
- `invokeVerb` (23→ok): extracted `invokeEdgeVerb` (shared edgeReverse/
  edgeDelete path) and `verbDelete`.
- `renderInspector` (57) **not fixed** — hit the 300-line diff budget first;
  left for a future pass (noted in notes.md).

Also hoisted duplicated string literals (`--uf-k-function`, `--uf-k-store`,
`'round'`) into module constants, and added the missing one-line comment on
the exported `initUnfold`. Zero behavior change; api-surface hashes for
src/panel identical.
