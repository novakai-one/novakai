
## Stage B0 — diff-core (DONE, verified)

New: `src/core/diff/diff.ts` (`diffModels`, `edgeKey`, types `MmdDiff`/`NodeChange`/`DiffInput`).
Tests: `tools/buildspec/diff.test.mjs` (6 unit), `tools/buildspec/diff-roundtrip.test.mjs` (2 real-parser).
Helper: `tools/buildspec/run-bundled-test.mjs` (rolldown bundles Vite-extensionless imports so
node --test can run tests that import `src/io/mermaid.ts`).

Identity rules implemented: node=id; changed=label|shape|kind|fm (NOT position); edge="from->to:style"
(volatile .id excluded).

| Check | Result |
|---|---|
| `node --test diff.test.mjs` | 6/6 pass |
| round-trip: same mmd both slots → diff | 0 changes (proven, no false positives) |
| round-trip: real edit (label + edge) | detected correctly |
| `npm run typecheck` after add | exit 0 |

Quantified: diffModels is deterministic + position-insensitive + edge-id-insensitive, all asserted.

## Stage B1–B8 — workspace + 4 views + apply (DONE, verified)

New files:
- `src/panel/diff-workspace.ts` — overlay module: open (snapshot), compare, view-switch, apply.
- `src/panel/diff-views/{types,list,split,impact,overlay}.ts` — 4 view renderers + shared types.
- `tools/buildspec/run-bundled-test.mjs` — rolldown bundler so node --test can import Vite-style src.
- `tools/buildspec/{diff-views,diff-workspace.smoke}.mjs` — integration + wiring tests.

Edited: `index.html` (Diff button + overlay DOM), `src/main.ts` (init + bind), `css/styles.css` (+138 lines).

Decisions locked: overlay (no router) · re-parse snapshot · whole-proposal apply.

### Verification (all quantified)

| Gate | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run build` (tsc + vite) | built, 51 modules, 0 errors |
| `npm run novakai:verify` (bundle+validate+lint) | PASS, 0 warnings — architecture gates intact |
| diff.test.mjs (unit) | 6/6 |
| diff-roundtrip.test.mjs (real parser, no false positives) | 2/2 |
| diff-views.test.mjs (4 renderers vs real model) | 6/6 |
| diff-workspace.smoke.mjs (open→compare→4 views→apply) | 5/5 |
| **total** | **19/19 pass** |

Proven behaviours:
- open() snapshots current model into "before" (re-parse path).
- compare() parses both sides, diffs, renders correct counts (+1 node/+1 edge asserted).
- all 4 views render without throwing; produce correct status classes/rows.
- apply() writes proposal to mmd textarea + calls applyText (canonical path); guards empty input.
- identical models → empty-state in every view (no false diff).

### NOT verified (blocked)
- Live browser click-through: Chrome extension not connected this session. Compensated by the
  workspace smoke test driving the full module against a DOM shim. Recommend one manual pass:
  `npm run dev` → click Diff → paste a proposal → Compare → cycle tabs → Apply.

### Known minor follow-ups (non-architectural, deferred)
- Rename detection (currently add+remove).
- Split-text LCS is O(n·m) — fine for diagram-sized text, revisit only if huge.
- Apply currently replaces whole model; per-change cherry-pick is future scope.
