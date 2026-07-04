# Building a Flowmap (procedure for an AI or a human)

This is the entry point. Read it before building a flowmap of any repo, regardless of
how familiar you are with Flowmap. It exists because the common failure is producing a
**flat file-mirror** (one node per file, no sections, dotted wiring) that is grammar-valid
but useless for review. `flowmap-validate` does NOT catch that; `flowmap-lint` does.

## Definition of done (non-negotiable)

```
flowmap-lint <bundle>.mmd   # must exit 0, with NO FLAT and NO LOOSE-BAG errors
```

Done is not "it renders" or "validate passes". Done is **lint exit 0**. The `flowmap:ship`
and `flowmap:verify` scripts enforce this: they fail unless validate AND lint pass.

## What lint enforces (proven discriminators)

Measured on a human-validated map vs a human-rejected file-mirror, grounded in the app's
own `containerOf` (src/core/state.ts) and `isSpineEdge` (src/io/layout.ts):

- **FLAT** — many nodes, zero drilled units. Architecture altitude only; cannot carry a review.
- **LOOSE-BAG** — a unit is decomposed (>=2 children) but its children are not grouped into
  sections. The single most common file-mirror tell.
- warns: BARE-LEAF (a leaf parented straight onto a unit instead of into a section),
  SINGLE-CHILD, NO-ROOT, STUB.

## The loop

### Step 0 — Bootstrap (optional, for from-scratch adoption)

If you have an existing TS codebase with no `.mmd` files:

1. **`npm run flowmap:init`** — auto-generates draft fragments + root.mmd from your
   TypeScript source. Every exported symbol becomes a node with `%% src`, `%% kind`,
   `name=`, and real interface declarations (`i0.accepts`/`i0.returns` with actual
   types, not placeholders). Prose `desc=` is left empty. Sections and spine edges
   are NOT generated.

2. **The draft FAILS `flowmap-lint` by design** (it is a file-mirror: one node per
   export, no sections). You MUST do the architectural work in steps 1–7 below
   before it will pass.

3. Move the generated fragments from the bootstrap output dir into your source
   folders (so the bundler finds them with `--dir src`).

4. After authoring your fragments (steps 1–7), run **`npm run flowmap:backfill`**
   to fill in any interface declarations you didn't write by hand. This is
   idempotent — it only adds `i0` lines for gated nodes (function/class/hook/type)
   that lack them.

### The authoring loop

1. **If a flowmap already exists, lint it FIRST.** If it fails, distrust it — do not imitate
   it, rebuild. A failing existing flowmap is the trap that produces another bad one.
2. **Find the units.** Start at the entry point, follow the call graph, list the units a
   reviewer would actually review.
3. **Decompose each reviewable unit to FUNCTION altitude.** One level down from a unit is its
   real private functions / steps — NOT one node per file. A unit left as a single node is at
   architecture altitude (spec §6).
4. **Section the internals.** Group the functions into purpose-named subgraphs. **The section
   (the subgraph), not the leaf, carries `%% parent <section> <unit>`.** Leaves live inside the
   subgraph with no `%% parent` of their own. The container renders as the drilled-level anchor.
5. **Wire the call spine with SOLID edges** (`-->`); references/reads are dotted (`-.->`).
   Only solid/thick endpoints get layered; dotted-only children scatter as satellites.
6. **Declare `%% root`** — the single biggest layout lever (spec §1).
7. **Bundle -> validate -> lint. Fix what lint reports. Repeat until exit 0.**

## The honest ceiling (read this)

Lint catches **structural** poverty (flatness, missing sections, loose bags). It does **NOT**
detect file-vs-function altitude: a file-mirror that wraps each file in a section can pass.
Lint exit 0 is necessary, not sufficient. So also:

- **Follow the altitude rule** (step 3) and **imitate the reference** below.
- **When the repo is code-extractable, run the gate** (`flowmap-extract` + `flowmap-gate`) to
  cross-check the diagram against the real TypeScript — that is the only check that compares the
  map to reality.

## Worked examples (in tools/flowmap/verify/fixtures/)

- `good-reference.mmd` — a real, human-validated, lint-passing architecture map. **Imitate its
  shape**: leaf-in-subgraph, subgraph-parented-into-unit, solid call spine, function altitude.
- `loop-demo-v1-loose.mmd` — the first-draft mistake. `flowmap-lint` it: FAIL (LOOSE-BAG).
- `loop-demo-v2-fixed.mmd` — the same module fixed. `flowmap-lint` it: PASS.
- `bad-file-mirror.mmd` — a full flat file-mirror. FAIL. Do not produce this.

## Blind-test acceptance protocol

To verify this system works without trusting the author:

1. Point a fresh LLM at this repo. Tell it to build a flowmap of some target repo, ending at
   `flowmap-lint <bundle> ` exit 0.
2. Run `flowmap-lint --report` on its output yourself.
3. PASS only if: exit 0, no FLAT/LOOSE-BAG, the report shows drilled units with sections, and
   spot-checking a unit shows function altitude (not one node per file). If extractable, also
   run the gate.
