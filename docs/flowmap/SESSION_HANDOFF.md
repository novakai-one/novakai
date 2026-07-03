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
## 0·now (2026-07-03, this session) — M4 correction: unfold IS the app; boot-flip plan authored, acceptance red, awaiting Chris's review

The shipped M4 misread the goal (sticky surface choice, overlay-on-editor). Corrected intent
from Chris: boot → unfold always; the legacy canvas is a temporary compare surface, deleted
at parity; no ✕ on unfold. This session recomputed the verify step, recorded Chris's rulings,
rewrote the M4 predicates, and authored the boot-flip plan — **code is deliberately not
written**: acceptance is red, the plan awaits Chris's review in the flowmap app.
Branch `m4-correction`, PR #33 (github.com/novakai-one/novakai/pull/33). Commits
`ef0f9dc` (parity checklist) → `ec8367d` (design doc + M4 predicates + plan) →
`0d7fa97` (handoff rotation). Never commit on `main` — standing verdict in KNOWN_EDGES.md.

| What | Verify it yourself | Expect |
|---|---|---|
| Parity inventory exists, rulings in header | `sed -n '1,40p' docs/flowmap/parity-checklist.md` | rulings dated 2026-07-03; status vocabulary defined |
| Design contract exists | `sed -n '1,30p' docs/flowmap/m5-unfold-primary-design.md` | state machine boot → UNFOLD, no other surfaces |
| M4 predicates assert the CORRECTED behaviour | `npm run flowmap:mvp` | M4 4/6 — unmet: no-SURFACE_KEY grep + boot-flip acceptance |
| Boot-flip plan coherent | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/m5-boot-flip.plan.json` | coherent (8 changes, 11 deps) |
| Acceptance red before code | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-boot-flip.plan.json` | 0/6 green, exit 1 (ufEscAction not implemented) |
| Ban holds on all docs | `npm run flowmap:roadmap:audit` | both scans ✓ |
| Src map untouched (docs-only session) | `npm run flowmap:ship` → `git diff --stat docs/flowmap/_bundle.mmd` | DONE line · empty |

**Honest boundaries (do not oversell):**
- Nothing behavioural changed in the app this session: `resolveBootSurface`/`SURFACE_KEY`
  still run at boot. M4's two unmet checks are the truthful record of that gap.
- Map-accuracy findings not yet fixed (fold into the boot-flip or a map-fix pass):
  `initDiffWorkspace` is never called from `src/` (dead since D2) yet the bundle carries
  `main -->|29 diff workspace|`; unfold's real `render/avoidRouter` import (unfold.ts:35)
  is missing from unfold's module-edge list.
- The drag-geometry-ownership question (design doc §4: flow vs offset-deltas vs pins vs
  mode-scoped; drag writes ctx.state vs ViewSpec) is presented as options — Chris decides
  at the P-drag plan review, not before.

**Next (Scenario 1):** Chris reviews `docs/flowmap/plans/m5-boot-flip.plan.json` in the
flowmap app (visual diff + blast radius) → approve → implement per the loop (acceptance
0/6 → 6/6, plus the browser criteria in the plan note, verified by a 0-context agent) →
re-sync + writeback. Resume: `npm run flowmap:onboard -- --continue --plan
docs/flowmap/plans/m5-boot-flip.plan.json` then `npm run flowmap:status -- --plan
docs/flowmap/plans/m5-boot-flip.plan.json`. After the boot flip: per-feature migration in
design-doc §3 order; `npm run flowmap:mvp` computes it all — never this file.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
