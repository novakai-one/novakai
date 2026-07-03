# M6 readability pass — tools/buildspec/extract.mjs (m6/tools-extract-p1)

Files touched: `tools/buildspec/extract.mjs`.

Score: 44 -> 22 (byRule before: id-length 34, max-lines-per-function 2,
sonarjs/cognitive-complexity 2, max-depth 6. After: id-length 19, max-params 3).

Complexity reductions:
- `extract` (cognitive complexity 137, 95 lines) split into: `extractFileNodes`,
  `extractBannerFile`, `extractFallbackFile`, `linkBannerOwner`, `fillBannerBody`,
  `importEdgesFor`, `dedupeEdges`. All 6 max-depth warnings and both
  sonarjs/cognitive-complexity + max-lines-per-function warnings are gone.
- `extractFromMap` (cognitive complexity 53, 66 lines) split into:
  `parseSrcDirectives`, `resetFmInterfaces`, `resolveNodeParents`,
  `populateFromSrcEntry`, `addGatedMembers`.
- Duplicated method-scope-filter loop (class instance methods, gated on
  private/protected) and the frontmatter-interface-entry shape hoisted into
  shared helpers `addPublicMethods`, `addInterfaceMethods`, `memberEntry` —
  reused by both `extract` and `extractFromMap`, removing 3x duplication.
- Added one-line `//` comments to exported `extract` and `returnText` (the
  only two exported functions previously lacking one).

Leftover (future pass, diff budget exhausted): 19 id-length warnings on
single-letter locals in small unexported helpers (`bannersOf`, `memberTypes`,
`ownerBanner`, etc.) and 3 new max-params warnings on `populateFromSrcEntry`,
`linkBannerOwner`, `extractBannerFile` (5-6 params each) — would need a
shared context-object param to fix, out of scope for this budget.

Gates: typecheck 0, lint --quiet 0 errors, spec:test:all 0 (303+6+2+5 tests
pass, unchanged), no test:src script in package.json, exported API surface
(`export { ... }` line) byte-identical/untouched, diff 156+142=298 lines
(within 300 budget).
