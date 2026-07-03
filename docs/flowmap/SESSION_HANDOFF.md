# Session handoff — verifiable, not prose

> **New agent: do not trust this document. Run `npm run flowmap:onboard` first.**
> Everything below is either a *runnable claim* (a command + expected result you
> can execute) or clearly-labelled *intent* (the remaining roadmap). The verified
> state of the app lives in the tools, not in this file.

## 0. Start here

```
npm run flowmap:onboard
```

Proves the map is true + complete as of HEAD, prints the 3 invariants, hands you the
quiz. Prove your read before any design claim:

```
npm run flowmap:quiz -- generate --n 12 --seed 1
# answer each from docs/flowmap/_bundle.mmd only, write answers.json, then:
npm run flowmap:quiz -- check --answers answers.json --seed 1   # 100% = handover trusted
```
## 0·now (2026-07-03, this session) — M5 P-boot LANDED: boot → unfold unconditionally; surface decision removed; acceptance 0/6 → 6/6; 0-context verified

The approved boot-flip plan (`docs/flowmap/plans/m5-boot-flip.plan.json`, PR #33 review)
is implemented: `resolveBootSurface`/`normalizeSurface`/`AppSurface`/`SURFACE_KEY` are
**removed** (not inverted) from `src/`, `main.ts` opens unfold unconditionally after first
paint, the dock ✕ is replaced by an explicit `legacy` compare affordance, and the Esc
chain's decision is the pure `ufEscAction` (in `src/panel/unfold-esc.ts`) whose bottom is
`'none'` — Escape never exits unfold. A 0-context agent verified all 12 criteria (5
command, 7 runtime in a fresh-profile browser) independently. Branch `m5-boot-flip`.
Never commit on `main` — standing verdict in KNOWN_EDGES.md.

| What | Verify it yourself | Expect |
|---|---|---|
| Plan fully landed (all 8 changes) | `npm run flowmap:status -- --plan docs/flowmap/plans/m5-boot-flip.plan.json` | 8 built · "Plan fully landed" |
| Behavioural contract green (was 0/6 red) | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-boot-flip.plan.json` | 6/6 green, exit 0 |
| M4 (corrected) predicates | `npm run flowmap:mvp` | `M4 — Unfold-primary boot (corrected)` [BUILT] 6/6 |
| Surface decision gone from src | `grep -rn "SURFACE_KEY\|resolveBootSurface\|normalizeSurface\|AppSurface" src/` | no matches (exit 1) |
| Map re-synced, gate + edges green | `npm run flowmap:ship` | DONE line; 0 unaccounted edges |
| Map-accuracy fixes from last session | `grep -c "29 diff workspace" docs/flowmap/_bundle.mmd` · `grep -c "routeGraph| avoidRouter" docs/flowmap/root.mmd` | 0 · 1 |
| Surface unit tests removed with the code | `node tools/buildspec/run-bundled-test.mjs tools/buildspec/viewspec.test.mjs` | 5/5 pass (M4 surface cases deleted) |
| Full CI-equivalent chain | `npm run flowmap:verify:full` | DONE line |
| Ban holds on all docs | `npm run flowmap:roadmap:audit` | both scans ✓ |

**Honest boundaries (do not oversell):**
- `flowmap:plan-check` on m5-boot-flip now fails REAL-IDS on the 3 landed `remove` changes
  (their nodes are gone from the base map). This is the remove-flavoured plan-lifecycle
  gap — recorded in KNOWN_EDGES.md; the superseded `m4-read-primary.plan.json` shows the
  same post-landing behaviour. CI is unaffected (its plan-check targets `public/plan.json`).
- `ufEscAction` lives in `src/panel/unfold-esc.ts`, not `unfold.ts`: unfold's static import
  chain reaches `libavoid.wasm`, which the acceptance runner cannot import — the E2/H1
  factor-to-pure rule in practice. The node stays in the unfold module fragment
  (multi-file modules are precedented: diffWorkspace spans diff-views/*).
- The only console error through boot → compare → return → reload is a pre-existing
  `favicon.ico` 404 (cosmetic, unrelated; verify: no favicon asset in `public/`).
- The 0-context runtime verify drove headless system Chrome against `npm run dev`
  (the claude-in-chrome extension was not connected); observations were real-browser.
- Drag-geometry ownership (design doc §4) remains options-only — Chris decides at the
  P-drag plan review.

**Next (Scenario 1):** per design-doc §3 order the next migration is **P-io** (save/load/
bodies affordances in unfold) — author its plan with acceptance red before code, per the
loop. Resume: `npm run flowmap:onboard`, then `npm run flowmap:mvp` for the computed M5
state; the parity checklist rows are the feature enumeration. `npm run flowmap:mvp`
computes it all — never this file.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
