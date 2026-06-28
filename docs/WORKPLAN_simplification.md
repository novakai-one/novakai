# WORKPLAN: Flowmap Simplification — COMPLETED

**Goal:** Reduce maintenance burden from 3 hand-authored surfaces to 2,
derive signatures from code, and fix the false gate failures —
without sacrificing any functionality.

**Requirements (no sacrifice) — ALL MET:**
- frontmatter cards (`%% fm:meta`) — remain ✅
- `bundle.mjs` — remains ✅
- stubs/gate/ts verifications — remain ✅
- function source code (`bodies.json`) — remains, now 98% coverage ✅

---

## What was done

### Phase 2: Fix gateParent (Idea 3) ✅
**Problem:** `gateParent` returned `null` for sectioned nodes (false parent-mismatch).
**Fix:** Walk through group parents to first non-group ancestor (mirrors lint's `containerOf`).
**Result:** 37 false parent-mismatch errors eliminated. Tests 7/7 pass.
**File:** `tools/buildspec/skeleton.mjs` — one function.

### Phase 3: Kill the MAP (Idea 1) ✅
**Problem:** `bodies-from-map.mjs` used stale id→symbol MAP → 2% bodies coverage.
**Fix:** Use `extract.mjs` instead (89% with banners, 98% with `--map` mode).
**Result:** `bodies-from-map.mjs` deleted. Coverage 2% → 98%.
**Files:** `package.json`, deleted `bodies-from-map.mjs`, updated `README.md`, `DISTRIBUTION.md`.

### Phase 4: Move banners to `%% src` in fragments (Idea 1b) ✅
**Problem:** `@flowmap-node` banners in `.ts` files were a second surface that drifted.
**Fix:** Added `%% src <id> <path>[#symbol]` directives to fragments. Bundle passes them
through. `extract.mjs --map` mode reads them and uses `findSymbol` to locate declarations.
**Result:** 97 banners removed from `.ts` files. 64 `%% src` directives in bundle.
`.ts` source files are now clean. Gate passes with zero errors. Bodies coverage 98%.
**Files:**
- `tools/flowmap/bundle.mjs` — added `%% src` pass-through (6 lines)
- `tools/buildspec/extract.mjs` — added `findSymbol`, `extractFromMap`, `--map` CLI mode
- `docs/flowmap/root.mmd` — 14 `%% src` directives for global nodes
- `src/core/*/[a-z]*.flowmap.mmd` — 50 `%% src` directives for local nodes
- All `src/**/*.ts` — 97 `@flowmap-node` banners removed
- `src/panel/inspector.ts` — updated user-facing message
- `package.json` — updated all scripts to use `--map` mode
- `README.md`, `CLAUDE.md`, `tools/DISTRIBUTION.md` — updated all docs

### Phase 5: Scaffold tool (Idea 2) — NOT STARTED
Future work: `tools/buildspec/scaffold.mjs` to auto-generate draft fragments from TS.

---

## Validation gates — ALL PASSING ✅
- `spec:test`: 7/7 pass ✅
- `spec:gate`: zero errors (49 non-blocking warnings) ✅
- `flowmap:ship`: PASS ✅
- `typecheck`: PASS ✅
- `bodies.json` coverage: 98% (64/65, only "types" missing — no single symbol) ✅

---

## Consumer workflow after changes

### Before (3 surfaces):
1. Author `root.mmd` from scratch
2. Author `*.flowmap.mmd` fragments from scratch
3. Add `@flowmap-node` banners to every `.ts` file
4. `npm run flowmap:ship`
5. `npm run flowmap:gate` → false-fails with 37 parent-mismatch errors

### After (2 surfaces):
1. Author `root.mmd` (same) + add `%% src` lines
2. Author `*.flowmap.mmd` fragments + add `%% src` lines
3. **No banners in `.ts` files** (eliminated)
4. `npm run flowmap:ship` (same)
5. `npm run flowmap:gate` → **passes** ✅
