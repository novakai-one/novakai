# WORKPLAN — scaffold.mjs (Phase 5)

> Status: IMPLEMENTED. All steps complete. All gates pass.
> Result: gate warnings dropped from 49 to 1 (only "seed.seed" in root.mmd, which has no %% src).
> Backfill is idempotent. Init produces valid syntax that fails lint by design (file-mirror).

---

## 0. Corrected state assessment

### What the spec HAS (verified)

- **7 container nodes** (camera, context, frontmatter, history, persistence, state, validate) declare interfaces for their public entry points — 31 lines total (15 `accepts`, 16 `returns`).
- The gate IS partially signature-enforcing: it checks arity + return-ness for these 7 containers' declared members.

### What the spec is MISSING (verified)

- **48 leaf function nodes** have `%% src` + `%% kind` + `name=` + `desc=` but **NO `i0.name`/`i0.accepts`/`i0.returns`**. Their signatures are not gated.
- These 48 ungated nodes produce **49 of the 49 gate warnings** (all "extra member" — the code's real function appears as an undeclared member).
- root.mmd has **0 interface lines** — all 15 nodes are containers/shared types with no declared entry points. Some (types, config) legitimately need none; others (e.g. `seed`, `createRuntime`) are functions that could be gated.

### What extract.mjs already does (verified)

- `signatureAtBanner(decl)` reads **real** param names + types (`sx: number, sy: number`) and real return types (`Point`). Verified by direct ts-morph call.
- BUT the serialization path in `extractFromMap` uses `memberFromFunction` which only captures arity, then fills `argN: unknown` placeholders (line 212: `Array.from({ length: mem.arity }, (_, i) => \`arg${i}: unknown\`)`).
- So the extracted.mmd has `arg0: unknown` in fm:meta, while `bodies.json` has the real types. The real-type reader exists; the serializer just doesn't use it for fm:meta.
- `findSymbol(sf, name)` locates a declaration by name in a source file. Works for exported functions, classes, interfaces, and nested declarations.
- Neither `findSymbol` nor `signatureAtBanner` is exported from extract.mjs (only `extract` and `extractFromMap` are).

---

## 1. What to build

Three changes, smallest-first:

### Change A: `scaffold.mjs --backfill` (highest leverage, smallest)

Reads an existing fragment, finds leaf function nodes with `%% src` but no `i0` declarations, reads their real signatures via ts-morph, and injects `i0.name`/`i0.accepts`/`i0.returns` lines with **real types** into the fragment.

### Change B: Export shared functions from extract.mjs

Export `findSymbol` and `signatureAtBanner` (plus `fnInside` and `returnText` which they depend on) so scaffold.mjs can import them instead of duplicating.

### Change C: `scaffold.mjs --init` (bootstrap draft fragments)

Walks a TS project with no existing fragments, groups exported symbols by folder, emits draft fragments + draft root.mmd with all mechanical lines pre-filled (src, kind, name, accepts, returns with real types, dotted import edges). Output fails `novakai-lint` by design — it is a starting point.

---

## 2. Implementation steps

### Step 1: Export shared functions from extract.mjs

**File:** `tools/buildspec/extract.mjs`

**What to change:** Add `findSymbol`, `signatureAtBanner`, `fnInside`, and `returnText` to the exports.

**Current export line (line ~340):**
```js
export { extract, extractFromMap };
```

**After:**
```js
export { extract, extractFromMap, findSymbol, signatureAtBanner, fnInside, returnText };
```

**Also export the helpers `isVoid` if not already exported** — `signatureAtBanner` calls it. Check:
```bash
grep -n "function isVoid\|export.*isVoid" tools/buildspec/extract.mjs
```
If `isVoid` is defined but not exported, add it. If it's imported from another module, no change needed.

**Verification:**
```bash
node -e "import('('./tools/buildspec/extract.mjs').then(m => console.log(Object.keys(m)))"
```
Should print all exported names.

**Risk:** None. Adding exports is backward-compatible. No existing code breaks.

**Lines changed:** ~1 line (the export statement).

---

### Step 2: Create `tools/buildspec/scaffold.mjs` — backfill mode

**File:** `tools/buildspec/scaffold.mjs` (new)

**Imports:**
```js
import { Project, Node } from 'ts-morph';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { findSymbol, signatureAtBanner } from './extract.mjs';
```

**Structure:**

```
scaffold.mjs
├── parseFragment(text) → { srcDirectives, kindDirectives, fmMeta, lines }
│     Parse the fragment text line-by-line:
│     - %% src <id> <path>[#<symbol>]  → srcMap[id] = { path, symbol }
│     - %% kind <id> <kind>            → kindMap[id] = kind
│     - %% fm:meta <id> i<N>.name=     → ifaceNodes.add(id)  (already has interface)
│     - %% fm:meta <id> name=          → nameMap[id] = value
│     Keep all lines as an array for re-serialization.
│
├── backfill(fragmentPath, project) → { added, skipped, lines }
│     1. Parse fragment.
│     2. For each id in srcMap:
│        a. Skip if id already has i0.name (already gated).
│        b. Skip if kind is not in GATED set (function, class, hook, type).
│        c. Find source file: project.getSourceFile(resolve(path)).
│        d. Find symbol: findSymbol(sf, symbol).
│        e. Read signature: signatureAtBanner(decl) → { accepts: string[], returns: string|null }.
│        f. Generate lines:
│             %% fm:meta <id> i0.name=<symbol>
│             %% fm:meta <id> i0.accepts=<param>   (one per param, real name: type)
│             %% fm:meta <id> i0.returns=<return>   (or 'void')
│        g. Record the insertion point: right after the last existing
│           %% fm:meta <id> line for this node, or right after the
│           %% kind <id> line if no fm:meta exists for this node.
│     3. Return the list of { id, lines, insertAfterLine } entries.
│
├── injectLines(originalLines, additions) → string
│     1. Sort additions by insertAfterLine descending (insert from bottom
│        to top so line numbers don't shift).
│     2. For each addition, splice the new lines into the array.
│     3. Join with '\n' and return.
│
├── main()
│     Parse CLI args:
│       --backfill <fragment.mmd> --tsconfig <tsconfig.json>
│       --init --tsconfig <tsconfig.json> --src <srcDir> --out <outDir>
│     Create ts-morph Project.
│     Call backfill() or init().
│     Write output.
│
└── GATED = new Set(['function', 'class', 'hook', 'type'])
```

**Key implementation details for backfill:**

1. **Insertion point logic** — scan the fragment lines. For node `<id>`, find the last line that starts with `%% fm:meta <id>` or `%% kind <id>`. Insert after it. If the node has no fm:meta at all, insert after the `%% kind <id>` line. If no `%% kind` line either, skip (malformed fragment).

2. **Multi-param functions** — `signatureAtBanner` returns `accepts` as an array like `['state: StateStore', 'n: DiagramNode', 'showFrontmatter: boolean']`. Emit one `i0.accepts=` line per param:
   ```
   %% fm:meta nodeFootprint i0.accepts=state: StateStore
   %% fm:meta nodeFootprint i0.accepts=n: DiagramNode
   %% fm:meta nodeFootprint i0.accepts=showFrontmatter: boolean
   ```

3. **Return type** — `signatureAtBanner` returns `returns` as a string or null. If null, skip the returns line. If 'void', emit `i0.returns=void`. Otherwise emit the real type.

4. **Idempotent** — if a node already has `i0.name=`, skip it. Running backfill twice should be a no-op.

5. **Dry-run mode** — add `--dry` flag that prints what would be added without writing. Essential for verification before mutating fragments.

**Verification (against this repo):**

```bash
# Dry run on camera fragment — should show 6 nodes needing backfill
node tools/buildspec/scaffold.mjs --backfill src/core/camera/camera.novakai.mmd --tsconfig tsconfig.json --dry

# Apply to one fragment
node tools/buildspec/scaffold.mjs --backfill src/core/camera/camera.novakai.mmd --tsconfig tsconfig.json

# Verify: camera fragment now has i0 lines for applyCam, toWorld, etc.
grep "i0\." src/core/camera/camera.novakai.mmd

# Re-run backfill — should be a no-op
node tools/buildspec/scaffold.mjs --backfill src/core/camera/camera.novakai.mmd --tsconfig tsconfig.json --dry

# Run the gate — warnings for camera nodes should be gone
npm run novakai:ship && npm run spec:gate 2>&1 | grep "camera__" | wc -l
# Should be 0 (was 6)
```

**Apply to all fragments:**
```bash
for f in src/*/*/*.novakai.mmd; do
  node tools/buildspec/scaffold.mjs --backfill "$f" --tsconfig tsconfig.json
done
```

**Full verification after backfill:**
```bash
npm run novakai:ship          # must still PASS (lint, validate)
npm run spec:gate             # warnings should drop from 49 to ~1 (just root.mmd nodes)
npm run spec:test             # must still be 7/7
npx tsc --noEmit              # must still PASS
```

**Lines of code:** ~120 lines.

**Risk:** Medium. The insertion logic is the trickiest part. If lines are inserted in the wrong place, the fragment may become invalid. Mitigation: `--dry` flag, test on one fragment first, verify with `novakai:ship` after each.

---

### Step 3: Add `scaffold.mjs --init` mode

**File:** `tools/buildspec/scaffold.mjs` (extend the file from Step 2)

**Structure:**

```
init(srcDir, outDir, project) → { fragments, rootMmd }
│     1. Walk all .ts source files under srcDir (excluding .d.ts, .test.ts,
│        .contract.ts, __types.generated.ts, node_modules).
│     2. For each file, find exported:
│        - Classes (isExported + getName)    → kind=class
│        - Interfaces (isExported + getName) → kind=type
│        - Functions (isExported + getName)  → kind=function
│     3. Group symbols by their parent folder (relative to srcDir).
│     4. For each folder with symbols:
│        a. Generate a container id from the folder name (last segment).
│        b. Emit a draft fragment:
│           - %% root <containerId>
│           - For each symbol:
│             %% src <id> <relPath>#<symbol>
│             %% kind <id> <kind>
│             %% fm:meta <id> name=<symbol>
│             %% fm:meta <id> desc=              (empty — human fills)
│             %% fm:meta <id> i0.name=<symbol>   (for function/class only)
│             %% fm:meta <id> i0.accepts=<real>  (one per param)
│             %% fm:meta <id> i0.returns=<real>
│             <id>("<symbol>")                    (node definition)
│           - Dotted edges for imports between symbols in this folder.
│        c. Write to <outDir>/<folder>.novakai.mmd
│     5. Emit draft root.mmd:
│        - One container node per folder: <folder>["<FolderName>"]
│        - %% kind <folder> module  (or store/service depending on naming)
│        - %% src <folder> <firstFileInFolder>
│        - %% fm:meta <folder> name=<FolderName>
│        - %% fm:meta <folder> desc=
│        - Dotted edges for cross-folder imports.
│        - %% root main  (or the most central folder)
│     6. Return list of written files.
```

**Key implementation details for init:**

1. **Symbol id generation** — use the symbol name directly as the id (no namespacing; the bundler handles namespacing at merge time). If two folders export the same name, the bundler will namespace them.

2. **Real types for accepts/returns** — use `signatureAtBanner` for functions, and for classes, iterate `getInstanceMethods()` (filter out private/protected) and emit one `i<N>` member per method. This is the same logic as `extractFromMap`'s GATED block.

3. **Import edges** — for each source file, get `getImportDeclarations()`. For each import, resolve the source file and check if it's in the project. If yes, emit a dotted edge from the importer's symbol to the imported symbol. Keep it simple — raw imports, not curated.

4. **Skip files** — exclude: `*.d.ts`, `*.test.ts`, `*.contract.ts`, `__types.generated.ts`, `node_modules/**`, anything in `src/contracts/` (generated stubs).

5. **Output location** — fragments go in their respective source folders (e.g., `src/core/camera/camera.novakai.mmd`). root.mmd goes to `docs/novakai/root.mmd`. Use `--out` to override root.mmd location.

6. **Do not overwrite** — if a fragment already exists, skip with a warning. Use `--force` to overwrite.

**Verification (simulated from-scratch):**

```bash
# Back up existing fragments
mkdir -p /tmp/novakai-backup
cp docs/novakai/root.mmd /tmp/novakai-backup/
cp src/*/*/*.novakai.mmd /tmp/novakai-backup/ 2>/dev/null

# Delete all mmd files
rm docs/novakai/root.mmd src/*/*/*.novakai.mmd

# Run init
node tools/buildspec/scaffold.mjs --init --tsconfig tsconfig.json --src src --out docs/novakai

# Check output
ls -la docs/novakai/root.mmd src/*/*/*.novakai.mmd

# Verify draft has real types (not arg0: unknown)
grep "i0\.accepts=" src/core/camera/camera.novakai.mmd
# Should show: i0.accepts=ctx: AppContext (real type, not arg0: unknown)

# Verify draft FAILS lint (expected — it's a file-mirror)
npm run novakai:bundle 2>&1 | tail -5
node tools/novakai/novakai-lint.mjs docs/novakai/_bundle.mmd
# Should FAIL (FLAT or LOOSE-BAG) — this is expected

# Restore originals
cp /tmp/novakai-backup/root.mmd docs/novakai/root.mmd
cp /tmp/novakai-backup/*.novakai.mmd src/*/*/*.novakai.mmd 2>/dev/null
# (may need manual copy per folder)
```

**Lines of code:** ~200 lines (extends the ~120 from Step 2; total file ~320 lines).

**Risk:** Low-medium. The output is a draft that is expected to fail lint. The main risk is producing invalid fragment syntax that the bundler can't parse. Mitigation: verify with `novakai:bundle` after generation.

---

### Step 4: Add npm scripts

**File:** `package.json`

Add to `scripts`:

```json
"novakai:backfill": "for f in src/*/*/*.novakai.mmd; do node tools/buildspec/scaffold.mjs --backfill \"$f\" --tsconfig tsconfig.json; done",
"novakai:init": "node tools/buildspec/scaffold.mjs --init --tsconfig tsconfig.json --src src --out docs/novakai"
```

Note: `novakai:backfill` uses a shell loop because scaffold processes one fragment at a time. Alternatively, add a `--dir` flag to scaffold that processes all fragments in a directory.

**Lines changed:** ~2 lines in package.json.

---

### Step 5: Update docs

**Files:** `tools/BUILD_NOVAKAI.md`, `README.md`

Add a "Step 0: Bootstrap" section to `BUILD_NOVAKAI.md`:

```markdown
## Step 0 — Bootstrap (optional, for from-scratch adoption)

If you have an existing TS codebase with no `.mmd` files:

1. `npm run novakai:init` — auto-generates draft fragments + root.mmd from your
   TypeScript source. Every exported symbol becomes a node with real signatures
   (accepts/returns with actual types), %% src, %% kind, and name= pre-filled.
   Prose desc= is left empty. Sections and spine edges are NOT generated.

2. The draft FAILS `novakai-lint` by design (it is a file-mirror). You MUST do
   the architectural work from Step 1 onward before it will pass.

3. After authoring your fragments (Step 1–3), run `npm run novakai:backfill` to
   fill in any interface declarations you didn't write by hand. This is
   idempotent — it only adds i0 lines for nodes that lack them.
```

Update `README.md` scripts table to include the two new scripts.

**Lines changed:** ~30 lines of docs.

---

## 3. Verification checklist (run after all steps)

```bash
# 1. Existing gates still pass (no regressions)
npm run spec:test                              # 7/7 pass
npx tsc --noEmit                               # PASS
npm run novakai:ship                           # PASS (lint + validate + bodies)

# 2. Gate warnings reduced
npm run spec:gate 2>&1 | grep "^  !" | wc -l   # Was 49, should be ~1-7
                                                # (only root.mmd nodes without %% src)

# 3. Backfill is idempotent
npm run novakai:backfill                       # should report 0 added, 48 skipped

# 4. Init produces valid syntax
rm -rf /tmp/init-test && node tools/buildspec/scaffold.mjs --init --tsconfig tsconfig.json --src src --out /tmp/init-test
node tools/novakai/bundle.mjs --root /tmp/init-test/root.mmd --dir /tmp/init-test 2>&1 | head -5
# Should produce a parseable bundle (will fail lint, but should parse)

# 5. Init produces real types (not arg0: unknown)
grep "i0\.accepts=" /tmp/init-test/src/core/camera/camera.novakai.mmd
# Should show: i0.accepts=ctx: AppContext
```

---

## 4. What NOT to do

1. **Do NOT make --init output pass novakai-lint.** The draft is a file-mirror by construction. Making it pass lint would require architectural decisions (sections, spine, pruning) that defeat the purpose of automation.

2. **Do NOT add type-text checking to the gate in this phase.** The gate currently checks arity + void-ness only. Adding type-text comparison is a separate change (Phase 6) that depends on backfill being done first (so the spec has real types to compare).

3. **Do NOT modify extract.mjs's serialization path.** The `argN: unknown` placeholders in `extractFromMap` are there for a reason (the extracted graph is ground-truth structure, not a spec). The scaffold reads real types via `signatureAtBanner` directly — it does not go through the serialization path.

4. **Do NOT auto-run backfill in `novakai:ship`.** Backfill mutates source files (fragments). It should be an explicit step the user runs, not a side-effect of shipping.

---

## 5. Effort estimate

| Step | What | New lines | Changed lines | Effort |
|---|---|---|---|---|
| 1 | Export shared functions from extract.mjs | 0 | 1 | Trivial — 1 edit |
| 2 | scaffold.mjs --backfill | ~120 | 0 | Medium — 1 file, tested logic |
| 3 | scaffold.mjs --init | ~200 | 0 (extends step 2) | Medium — 1 file, ts-morph walking |
| 4 | npm scripts | 0 | 2 | Trivial |
| 5 | Docs | 0 | ~30 | Low — writing |
| **Total** | | **~320** | **~33** | **Single session** |

### Risk assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Backfill inserts lines at wrong position | Medium | High (corrupts fragment) | `--dry` flag, test on 1 fragment, verify with `novakai:ship` |
| `signatureAtBanner` fails on edge-case declarations | Low | Medium (skips node, logs warning) | Graceful fallback: skip + log, don't crash |
| Init produces unparseable fragment syntax | Low | Medium (draft is useless) | Verify with `novakai:bundle` after generation |
| Exporting functions from extract.mjs breaks existing imports | Very low | Low | Adding exports is backward-compatible |
| Backfill adds interfaces for nodes that shouldn't be gated | Low | Low (extra warnings, not errors) | Only backfill function/class/hook/type kinds (GATED set) |

### What makes this a single-session job

1. **No new dependencies.** ts-morph is already installed. mmd-parse.mjs already exists.
2. **No new algorithms.** `findSymbol` and `signatureAtBanner` already work — verified by direct ts-morph calls that returned real types.
3. **No changes to existing gate/lint/extract logic.** The scaffold is a new file that reads from existing tools but does not modify them (except the 1-line export change).
4. **Clear verification path.** Every step has a concrete test command with an expected result, all runnable against this repo.
5. **The hardest part (insertion logic) is well-scoped.** It's string manipulation on a line array — no parsing ambiguity, no edge cases in the fragment format (lines are either `%%` directives or Mermaid syntax, and we only insert after `%%` lines).

### What would make it a two-session job

If the `--init` mode's import-edge generation turns out to need curation logic (e.g., filtering type-only imports, resolving re-exports), that could add ~50-100 lines and push init to a second session. The backfill mode alone is a clean single-session deliverable.
