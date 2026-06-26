# HANDOVER — buildspec pipeline (spec-as-contract, steps 1–3)

Deterministic enforcement that code matches its `.mmd` spec. The spec's `fm:meta`
is the contract; tooling enforces it; an LLM is used only to author specs and fill
bodies, never in the enforcement loop. Implements steps 1–3 of
`DIRECTION_ai_build_workflow.md`.

Status: built and tested. `npm run spec:test` = 7/7 green, including a strict
`tsc` compile of generated output and a hand-verified extractor graph.

---

## 1. What is here

```
tools/buildspec/
  mmd-parse.mjs        shared zero-dep .mmd parser + canonical serializer
  skeleton.mjs         the contract-skeleton model + type-coercion helpers
  diff-core.mjs        pure structural diff (spec skeleton vs code skeleton)
  spec-to-stubs.mjs    #1 generator: spec.mmd -> TS stubs + contract stubs
  extract.mjs          #2 extractor: TS project -> ground-truth .mmd (ts-morph)
  gate.mjs             #3 gate: diff spec vs extracted, non-zero exit on drift
  pipeline.test.mjs    node --test suite (parser, extractor, gate, round-trip)
  __fixtures__/        hand-verified sample spec + matching hand-written src
.github/workflows/spec-gate.yml   CI: runs the suite; commented drift-gate job
package.json           + ts-morph devDep, + spec:stubs/extract/gate/test scripts
```

The three tools are independent CLIs and importable functions. `#1` and `#3` are
zero-dependency. `#2` needs `ts-morph`.

---

## 2. First step — install (REQUIRED, do this once)

```
npm install
```

This pulls `ts-morph` (added to devDependencies) and regenerates
`package-lock.json`. Commit the updated lock. Until this runs, `#2` and the
`tsc` part of the test suite cannot run. Node 20+ required (ts-morph 28).

Verify:

```
npm run spec:test
```

Expect `# pass 7 / # fail 0`.

---

## 3. Running the pipeline

Three commands. `<spec>` is a `.mmd` file with `fm:meta`. `<dir>` is an output
folder for generated TS.

```
# 1) spec -> TS stubs (signatures frozen, bodies throw 'unimplemented')
node tools/buildspec/spec-to-stubs.mjs <spec>.mmd --out <dir> --clean

# 2) code -> ground-truth graph (read the real signatures back out)
node tools/buildspec/extract.mjs --tsconfig <tsconfig>.json --out extracted.mmd
#   or, no tsconfig:  --src <srcDir>

# 3) gate: fail if code drifted from spec
node tools/buildspec/gate.mjs --spec <spec>.mmd --code extracted.mmd
```

npm-script equivalents (append args after `--`):

```
npm run spec:stubs   -- <spec>.mmd --out <dir> --clean
npm run spec:extract -- --tsconfig <tsconfig>.json --out extracted.mmd
npm run spec:gate    -- --spec <spec>.mmd --code extracted.mmd
```

Gate exit codes: `0` in sync, `1` drift, `2` bad invocation. Flags:
`--show-edges` (print import-vs-spec edge diffs, hidden by default because they
are advisory), `--warn-as-error` (fail on warnings too).

---

## 4. Applying this to the Novakai repo (the real target)

`novakai.mmd` (currently at
`flowmap/.claude/worktrees/vigilant-pike-7136af/novakai.mmd`) is the architecture
spec for Novakai. To make Novakai drift-proof:

1. Copy `tools/buildspec/` into the Novakai repo. It is repo-agnostic and
   zero-config. Add `ts-morph` to Novakai's devDependencies and the four
   `spec:*` scripts to its `package.json` (same as here). Run `npm install`.
2. Place the spec in Novakai, e.g. `novakai.mmd` at the repo root. This file is
   now the contract; edit it through the Flowmap app or by hand.
3. Generate the skeletons into the source tree:
   ```
   node tools/buildspec/spec-to-stubs.mjs novakai.mmd --out src/contracts --clean
   ```
   You get one `.ts` per node with exact signatures, plus `__types.generated.ts`
   (a barrel of placeholder/real types) and one `.contract.ts` per gated node.
   Ensure `src/contracts` is inside Novakai's `tsconfig` `include`.
4. Implement. For each generated file: fill method/function BODIES, never touch
   the signatures. Replace placeholder types in `__types.generated.ts` with real
   ones as you define them (or model them as `type`-kind nodes in the spec).
   Keep the `// @flowmap-node …` banner on each file — the extractor reads it.
   These generated files ARE your starting modules; move/rename as your layout
   needs, the banner travels with the symbol.
5. Gate, continuously and in CI:
   ```
   node tools/buildspec/extract.mjs --tsconfig tsconfig.json --out extracted.mmd
   node tools/buildspec/gate.mjs --spec novakai.mmd --code extracted.mmd
   ```
   Green = code and spec agree. Red = a node is unbuilt, a symbol is unplanned,
   or a kind/parent/method/arity/return drifted.

### Acceptance check before trusting the gate (do not skip)

The extractor's failure mode is silent undercount -> false green. On the FIRST
real extraction, open `extracted.mmd` and confirm node count and the manager
classes' methods match what you expect from the code. The fixture test
(`extractor produces the hand-verified graph`) guards the logic; this one-time
eyeball guards the wiring against your repo's conventions.

---

## 5. Locked design decisions — DO NOT "fix" these

These are deliberate. Changing them re-breaks the pipeline.

1. **`class` nodes generate a concrete class with throwing method bodies**, not an
   abstract class. "Fill bodies, never signatures" requires a body to fill, and
   `tsc` gates a concrete method. State fields are declared `name!: Type;`.
2. **fm types are interface PROSE, not TS.** Strings like `JSX (…)`,
   `loading | signed-in | signed-out`, `managers: ManagerSet (…)` are not valid
   TS. The generator emits a valid TS type only when the string is clean
   (`isCleanType`); otherwise it emits `unknown` and preserves the original in
   JSDoc. Do not try to paste fm types verbatim — output will not compile.
3. **Clean, recurring type names resolve through `__types.generated.ts`.** Real
   `type`-kind nodes are re-exported from their own file; everything else is a
   `unknown` placeholder. This is what lets 60+ generated files compile with zero
   hand-editing.
4. **Stub parameters are `_`-prefixed** (`_draft: DocDraft`) so the repo's
   `noUnusedParameters` passes with no config change. WHEN YOU IMPLEMENT A BODY,
   drop the underscore (or reference `_draft`); the gate checks arity, not names.
5. **Identity tag.** Every generated file carries
   `// @flowmap-node <id> kind=<kind> [parent=<parent>]`. The extractor reads
   id/kind/parent from this tag, but reads the interface SKELETON (method names,
   arity, return-ness) from the REAL signatures. So the tag labels a symbol; the
   code still governs what is gated. Keep the tag; do not hand-edit it to lie.
6. **What the gate blocks vs warns.**
   - Blocks (exit 1): unbuilt node, unplanned symbol, kind mismatch, parent
     mismatch, missing member, arity mismatch, return (void vs value) mismatch.
   - Warns only: extra public member; all edge differences. Spec edges are
     semantic call-order; extracted edges are imports — not a 1:1 relation, so
     blocking on them is a false-positive storm.
7. **Per-kind gate scope.** Member signatures are gated for `class`, `function`,
   `hook`, `type`. Arity is gated for `class`, `function`, `hook`. For
   `component`/`store`/`module`/`service`/`event` only existence + kind + parent
   are gated — their fm lists logical inputs / internal handlers, not exported
   call signatures, so signature-gating them is noise.
8. **Group membership is NOT a gated parent.** A node inside a `subgraph` has that
   group as its layout parent, but groups have no code counterpart. Only a
   drill-in parent (`%% parent child realNode`) is gated.

Type-TEXT drift (e.g. `DocDraft` vs `DocShape` on a param) is intentionally NOT
gated — it cannot be derived from prose specs. That residue is closed by Idea A
(below), not by this gate. Interface property drift (fields on a `type`) is also
not gated; only methods are members.

---

## 6. Next step for behavior (Idea A — out of scope for 1–3)

The gate proves structure (the right nodes, kinds, methods, arities exist). It
cannot prove behavior. The generator already emits a `.contract.ts` per gated
node as a compile-time stub. To close the behavior gap, turn these into
executable tests: add a test runner (e.g. vitest), and have an LLM author
behavioral assertion BODIES from each node's `desc`/`fm` prose. This is the one
place an LLM re-enters — authoring tests, which are then run deterministically.
Do this after 1–3 are in use; it is not required for the gate to be valuable.

---

## 7. CI

`.github/workflows/spec-gate.yml` runs `npm run spec:test` on changes to the
tooling. It contains a commented `drift-gate` job: uncomment it in the repo that
is built from a spec, set `SPEC` to the spec path, and CI will extract + gate on
every push — a red build means code and spec disagree.

---

## 8. Maintaining the tools

If you change `extract.mjs`, RE-RUN `npm run spec:test` before trusting any gate
result — the hand-verified fixture test is the guard against a silently
under-counting extractor. The parser, skeleton model, and diff are shared; a
change to `skeleton.mjs` affects all three tools and the round-trip test will
catch a break.
