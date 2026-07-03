# M6 readability pass — tools/buildspec/mmd-parse.mjs (p1)

Files touched: `tools/buildspec/mmd-parse.mjs` (+ `.readability/baseline-scores.json` ratchet update).

Score: 24 -> 2 (byRule before: id-length 21, max-lines-per-function 1,
sonarjs/cognitive-complexity 2; after: id-length 2 only). Remaining hot
functions (sonarjs/cognitive-complexity warnings): 0.

Complexity reductions:
- `parseMmd` (cognitive complexity 53, 66 lines) split into module-private
  helpers: `matchDirectiveLine` (header/`%%` directives), `matchStructuralLine`
  (subgraph/end/shape lines), `matchEdgeLine`, `finalizeHierarchy` (parent
  resolution + dangling-ref pruning), and the shared `ensure(state, id, shape)`
  mutator. `parseMmd` itself is now a short dispatch loop over these.
- `toMmd` (cognitive complexity 25) split into `serializeRootsAndFrontmatter`,
  `serializeFrontmatterEntry`, `serializeGroupsAndMembers`,
  `serializeKindsAndParents`, `serializeNodesAndEdges`; `toMmd` now just
  concatenates their output in the original deterministic order.
- Renamed unclear locals in the newly extracted helpers (`m`→`match`/
  `dirMatch`/`subgraphMatch`/`shapeMatch`, `f`→`frontmatter`, `n`→`node`/
  `nodeId`/`ifaceIndex`, `p`→`parentId`, `g`→`group`, `a`/`r`→`accept`/`ret`,
  `s`→`stateValue`, `gid`→`groupId`, `nid`→`nodeId`, `e`/`a`/`b`→`edge`/
  `edgeA`/`edgeB`). Kept `m`/`v` in the untouched `matchFrontmatterLine`/
  `applyFmLine` bodies to stay within the diff budget.
- Added one-line `//` comments above `parseMmd` and `toMmd` (previously
  undocumented at the function site).

No behavior change: exported names/signatures untouched (verified via
`git diff -U0` containing no added/removed `export` line); output ordering
of `toMmd` and parse semantics of `parseMmd` preserved exactly.
