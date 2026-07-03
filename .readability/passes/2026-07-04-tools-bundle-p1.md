# M6 readability pass — tools/flowmap/bundle.mjs (p1)

Files touched: `tools/flowmap/bundle.mjs` (+ `.readability/baseline-scores.json` ratchet update).

Score: 62 -> 17 (byRule before: sonarjs/cognitive-complexity 3, id-length 57,
max-params 1, max-lines-per-function 1; after: id-length 17 only). Remaining
hot functions (sonarjs/cognitive-complexity warnings): 0.

Complexity reductions:
- `classify` (cognitive complexity 16) rewritten from a long if/else regex
  chain into a `LINE_CLASSIFIERS` table of `[pattern, builder]` pairs plus a
  single dispatch loop, with the blank/other fallback kept as-is.
- `buildBody` (cognitive complexity 22) split into module-private helpers
  `closeFrame` (subgraph-frame emission, shared by the in-loop `end` case and
  the trailing unclosed-frame flush, preserving the exact `chainMember`
  asymmetry between the two call sites) and `emitNode` (fragment-stub
  skipping + node emission), plus a `BODY_SKIP_KINDS` set replacing a
  4-way `||` chain.
- `bundle` (cognitive complexity 30, 77 lines) split into
  `parseFragments`, `createIngestState`, `addFmMeta`/`addKind`/`addEdge`,
  `ingest`, `resolveParents`, `renderBundleLines`, `collapseBlankRuns`;
  `bundle` itself now just sequences these in the original order.
- Fixed `max-params` and several `id-length` warnings in `renameInLine` by
  destructuring the edge-case regex groups from a single rest param, and
  renaming other unclear locals (`f`→`_`/`frag`/`arg`/`entry`/`fragPath`,
  `p`/`m`→`parentLine`/`match`/`childId`/`parentId`, `l`/`v`/`g`/`s`/`w`→
  `line`/`kindEntry`/`groupLine`/`srcLine`/`warning`, etc.) across the CLI
  argv-parsing and fragment-discovery code. Left the `t` discriminant key in
  `LINE_CLASSIFIERS` (17 remaining id-length warnings) unrenamed — fixing it
  requires touching ~32 lines across every consumer, over the diff budget.

No behavior change: exported names/signatures untouched (verified via
`git diff -U0` containing no added/removed `export` line); warning message
text, bundle line ordering, and blank-line collapsing preserved exactly.
