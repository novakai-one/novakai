# M6 readability pass — tools/buildspec/diff-core.mjs (pass #1)

Files touched: `tools/buildspec/diff-core.mjs` only.

Score: **11 -> 0** (eslint warning count).
- `sonarjs/cognitive-complexity`: 1 -> 0. `diffSkeletons` (complexity 91) split into module-private
  helpers: `diffSpecNode` (per-spec-id presence/kind/parent), `diffMembers` (member-set diff for
  gated kinds), `diffMember` (arity/returnsValue per member), `diffMemberTypes` (param/return type
  gate, prose-skip counting), `collectUnplanned` (code-only symbols), `diffEdges` (import-edge
  drift). `diffSkeletons` itself is now a thin orchestrator.
- `max-depth`: 4 -> 0. Nesting flattened by extraction; no block now exceeds depth 4.
- `id-length`: 6 -> 0. Renamed unclear locals: `m`->`map`, `s`/`c`->`specNode`/`codeNode` (and
  `sMember`/`cMember` inside member helpers), `e`->`edge`. Introduced `{ spec, code }`-keyed
  parameter objects to keep helper arity <= 4 (avoids new `max-params` warnings from the split).

No behavior change: pure extraction + renames, same error/warn message strings and push order.
Verified by tsc (0), eslint --quiet (0 errors), spec:test:all (303+6+2+5 pass, 0 fail, matches
pre-flight), test:src (17 pass). Exported signature `diffSkeletons(specMap, codeMap, opts = {})`
byte-identical; no changed `export` line in the diff.
