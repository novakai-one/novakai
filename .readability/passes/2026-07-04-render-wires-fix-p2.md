# M6 readability pass: src/render/wires.ts (fix-p2)

**Files touched:** `src/render/wires.ts`

**Score:** 33 -> 32 (`max-lines-per-function` 2 -> 1; `id-length` unchanged at 31,
those 31 are pre-existing warnings on non-target params, 4 of which are
unfixable exported-signature params per the pass orders).

**Complexity reduction:**
- `initWires` was flagged at 154 lines (max allowed 60), the largest
  remaining oversized function on this file. Extracted its nested
  `drawWires` closure body verbatim into a new top-level module-private
  function `drawWiresImpl(ctx, wires, world)`, and hoisted the also-nested
  `edgePath` helper (pure, no closure dependencies) to top-level scope so
  both `drawWiresImpl` and `updateWiresFor` can still call it.
  `initWires` is now a thin composition wrapper (~35 lines) that just
  destructures `ctx.dom`, defines `drawWires`/`updateWiresFor`, and returns
  them — no longer flagged.
- `drawWiresImpl` itself remains oversized (127 lines) — left for the next
  pass per scope instructions (fix exactly one function per pass).

No exported names, signatures, or types changed. `edgePath` and
`drawWiresImpl` are new module-private helpers, not exported.
