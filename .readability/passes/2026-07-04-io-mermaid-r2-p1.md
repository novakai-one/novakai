# io-mermaid-r2-p1

Files touched: `src/io/mermaid.ts`

Score: 51 -> 27 (target strictly lower; ratchet OK).

Complexity reductions:
- `fromMermaid` (cognitive complexity 16 -> gone from warning list): split the
  monolithic per-line dispatch and post-processing into module-private
  helpers — `parseMetaLine`, `parseShapeLine`, `parseEdgeLine` for the line
  scanner, and `placeAndAnnotateNodes`, `applyContainment`,
  `applyEdgeRouting`, `pruneHier` for the post-parse passes. `fromMermaid`
  now just wires these together in sequence.
- The `text.split('\n').forEach(...)` callback (cognitive complexity 31 ->
  gone): reduced from a 15-branch flat regex dispatch to 6 statements that
  delegate to the three extracted parse helpers above.
- Byproduct: replacing single-letter locals (`m`, `t`, `d`, `n`, `e`, `p`,
  `g`) with descriptive names in the new/rewritten code dropped `id-length`
  warnings 47 -> 27 without a dedicated renaming pass.

No exported signatures changed (verified via `.readability/api-surface.json`
hash comparison for all `src/io/*` entries — all identical). All test gates
(typecheck, spec:test:all, test:src, lint --quiet) green.
