# M6 readability pass — src/panel/planner.ts (pass #2)

Files touched: `src/panel/planner.ts` only.

Score: **105 -> 2** (eslint warning count).
- `id-length`: 104 -> 1 (renamed ~95 unclear local identifiers — `e`->`edge`/`ev`, `c`->`chg`,
  `n`->`nd`, `p`/`pt`->points, `g`->`grp`, `f`->`fm`/`file`, `r`->`rect`/`anchor`, `t`->`titleEl`/`txt`,
  `v`/`vd`->`vd`/`verdict`, `a`/`b`->`aff`/`ca`/`cb`, `d`->`depId`, `w`->`warn`, `k`->`kind` shadow fix,
  `W`/`H`->`wrapW`/`wrapH`, etc. — across ~30 helper functions and closures). Left the module-scope
  `$()` DOM-lookup alias unrenamed: it is referenced 60+ times file-wide, so fixing it alone would
  blow the diff budget; flagged as a future-pass leftover.
- `max-lines-per-function`: unchanged (1 warning, `initPlanner` at 590 lines). Splitting this
  single composition-root closure into free functions requires threading ~15 mutable session-state
  variables through explicit params — out of scope for the 300-line diff budget; left for a future
  pass.
- `sonarjs/cognitive-complexity`: 0 before and after — no offending functions.

No behavior change: pure identifier renames within existing scopes, verified by tsc, eslint
--quiet (0 errors), spec:test:all, test:src, and byte-identical `.d.ts`-derived API-surface hashes
for every `src/panel/*` file and the `src/panel` module bucket.
