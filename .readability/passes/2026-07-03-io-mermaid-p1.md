# M6 readability pass — src/io/mermaid.ts (m6/io-mermaid-p1)

**Files touched:** `src/io/mermaid.ts` (only target; bookkeeping files also updated).

**Score:** 54 -> 51 warnings (ratchet satisfied, strictly lower).

**Complexity reductions:**
- `toMermaid` (sonarjs/cognitive-complexity 87 -> resolved to 0 warnings; was
  also flagged max-lines-per-function at 85 lines, now resolved). Split into
  10 module-private helpers, each a plain `(state, inc) => string` (or
  `Record`) function with no shared closures: `emitLayoutMeta`,
  `emitFrontmatterAndKindMeta`, `emitContainmentMeta`, `emitEdgeMeta`,
  `emitRootAndGroupMeta`, `computeStructuralGroups`,
  `assignNodeToGroupByGeometry`, `addGeometryFallbackGroups`,
  `computeInGroup`, `emitGroupedNodes`, `emitEdges`. `toMermaid` itself is now
  a 10-line dispatcher that concatenates each helper's output in the same
  order as the original code, so the emitted Mermaid text is byte-identical.
  `initMermaid`'s own max-lines-per-function warning (100 lines) also
  resolved as a side effect.
- Added `type IncludeFn = (id: string) => boolean` and imported `StateStore`
  to type the new helpers; no exported name, signature, or type changed.

**Not fixed (budget-exhausted, left as documented leftover):**
`fromMermaid` (complexity 16, 94 lines) and its `text.split('\n').forEach`
callback (complexity 31) — the 300-line diff budget was consumed entirely by
the `toMermaid` split, which was the single worst offender (87 vs 15
allowed). Extraction shape + next steps recorded in `.readability/notes.md`
for a future pass. 47 id-length warnings (mostly single-letter locals) also
left untouched for the same reason — cheapest to fix during that future
extraction, since those lines will be rewritten anyway.

**Gates:** typecheck 0, lint --quiet 0 errors, spec:test:all 0, test:src 0,
API surface for `src/io` byte-identical, ratchet 54->51 with target strictly
lower.
