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
## 0·now (2026-07-03, this session) — third-pass rulings RECORDED + the next two builds PLANNED: `m5-p-tabs2` (slice + style tabs, two-row strip) and `m5-a-verbs` (§A model verbs) — both coherent, both acceptance-RED (no code written, by design)

Chris ruled (recorded in `parity-checklist.md`, third-pass block): **nav is closed** (browse
is the replacement — dropped-by-decision), **slice + style migrate** as new dock tabs, the
strip becomes **two stacked rows**, **§A model verbs migrate** with minimal hidden-by-default
affordances, **diff/plan review move out of the MVP** (post-MVP, stay in legacy),
**select-all deferred** with multi-select, and the **legacy surface is kept as reference** —
clashes get surfaced for a ruling, never worked around. First recorded clash: legacy `THEMES`
styles only canvas `--*` vars which unfold never consumes (it has its own `--uf-*` palette +
light/dark), so the style tab ports **font** (via a new `--uf-font`) + hosts unfold's
appearance control; **theme chips stay legacy-only pending a ruling**. Two plans were
authored per the loop (acceptance red BEFORE code): `m5-p-tabs2` — pure `ufSliceTargets` +
`SliceApi.sliceFor` one-path slice, `theming.applyFont` reaching unfold, five tabs on two
rows; `m5-a-verbs` — pure `ufVerbAllowed` gate, nodes module becomes single owner of the
still-inline mutations (edge label/reverse/delete · kind/desc · clear-all), unfold gains
overlay-scoped shortcuts + a selection-only '⋯' menu + connect mode. Execution order:
p-tabs2 THEN a-verbs (`initUnfold`'s signature is cumulative). No `src/` change in this
session — plans, rulings and predicates only. Branch `m5-p-tabs2-plans` — Chris reviews and
merges. Never commit on `main` — standing verdict in KNOWN_EDGES.md.

| What | Verify it yourself | Expect |
|---|---|---|
| P-tabs2 plan author-coherent | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/m5-p-tabs2.plan.json` | coherent (5 changes, 6 deps) |
| A-verbs plan author-coherent | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/m5-a-verbs.plan.json` | coherent (6 changes, 7 deps) |
| P-tabs2 contract red pre-build | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-p-tabs2.plan.json` | 0/6 green — every case "Cannot find module …unfold-slice.ts" |
| A-verbs contract red pre-build | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-a-verbs.plan.json` | 0/13 green — every case "Cannot find module …unfold-verbs.ts" |
| Verified build checklists | `npm run flowmap:status -- --plan docs/flowmap/plans/m5-p-tabs2.plan.json` (and the a-verbs plan) | adds pending, initUnfold modifies drifted-until-built |
| M5 predicates registered | `npm run flowmap:mvp` | M5 (9/11) — exactly the two plan-acceptance rows unmet |
| Rulings recorded, ban intact | `npm run flowmap:roadmap:audit` | both scans ✓ (rulings are decisions, not status) |
| Map still true + complete | `npm run flowmap:ship` | DONE line; 0 unaccounted edges |
| Quiz pass bound to a live session | `npm run flowmap:onboard` (STEP 4) | re-take in YOUR session — the 2026-07-03 pass never attests your read |

**Honest boundaries (do not oversell):**
- NOTHING in either plan is built: both acceptance contracts are red because the pure files
  do not exist yet — that is the designed pre-build state, not a regression.
- The style tab ports font + appearance only; the THEMES→unfold-palette mapping is an OPEN
  design ruling for Chris, recorded in the checklist rulings block and the p-tabs2 plan note.
- The two-row assignment (reveal · io · mermaid / slice · style) and the a-verbs assumptions
  (paste at default position, single-node wrap allowed, add-node without the 9-shape
  toolbar, connect as select-source→click-target) are recorded assumptions — amendable by a
  ruling before build, cheaply.
- `m5-a-verbs`'s `initUnfold` signature includes p-tabs2's deps — landing a-verbs FIRST
  would leave both plans drifted; the order is load-bearing.
- The M5 (9/11) count includes the two deliberately-red acceptance predicates; it will not
  read 11/11 until both builds land — that is the derived-state design working, not lag.

**Next (Scenario 1):** implement `m5-p-tabs2` (resume:
`npm run flowmap:onboard -- --continue --plan docs/flowmap/plans/m5-p-tabs2.plan.json`),
red→green its 6 acceptance cases, runtime-probe the five tabs, land it, THEN implement
`m5-a-verbs` the same way (13 cases). After both: the §C drag plan (largest item, ruled
standalone) and the remaining deferred decisions. `npm run flowmap:mvp` computes it all —
never this file.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
