# M6 characterization pass — src/io/layout.ts

Exports covered (1 of 1, none skipped): `initLayout` (-> `{ autoLayout }`).

`autoLayout` is exercised with a fake `ctx`/`camera` (plain objects: `state`,
`prefs.showFrontmatter`, `snap`, four `hooks`) across 10 scenarios: empty node
set (no-op, zero side effects); a linear TD chain; an A<->B cycle plus a
declared root (back-edge cut, root forced to layer 0); a dotted reference
edge (satellite parked off-spine, routing forced `ortho`); an all-spine group
box growing to wrap its members; LR direction; the untagged-file fallback
(no spine edges -> every node treated as spine); a mixed group inlining a
satellite into the spine band; `showFrontmatter` + a measured card widening
the footprint; and `ctx.snap` rounding to the 16px grid.

`layout.ts` imports `routeReferences` from `render/avoidRouter.ts`, which
does a Vite-only `import wasmUrl from './libavoid.wasm?url'`. Under the
plain `node --import tsx` test runtime that import crashes at module-load
time (`Cannot find package 'env' imported from .../libavoid.wasm`), before
any layout code runs. A `node:module` loader hook
(`stub-avoid-router-loader.mjs`, test-only) intercepts only that specifier
with a no-op stand-in — the real, unmodified `layout.ts` executes for every
assertion; only the external WASM-router collaborator is faked, same as the
DOM is faked elsewhere.

Test count: 10 new (27 total in `tests/characterization/`), all green.
