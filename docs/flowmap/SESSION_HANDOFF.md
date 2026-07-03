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
## 0·now (2026-07-03, this session) — E4 + F5 predicates repaired to follow the AUD5/F-06 canonical-suite indirection; roadmap computes 32 built, 0 partial

E4/F5's unmet rows grepped `spec-gate.yml` for literal test filenames
(`acceptance.test`, `plan-layout.test`, `loop-e2e.test`), but AUD5/F-06 deliberately
replaced CI test enumeration with one canonical list: CI runs `npm run spec:test:all`
and `gate-parity.test.mjs` fails the build if a CI-only enumeration reappears. All
three suites already ran in CI on every push/PR — the predicates tested the pre-F-06
mechanism, not the intent. Fix: `roadmap.json` E4/F5 checks now verify the two-link
chain (spec-gate.yml runs the canonical suite AND package.json's suite contains the
file), which stays fail-closed: breaking either link re-opens the item. No app code,
no CI change, no test change. Plan, with the rejected-alternative rationale:
`docs/flowmap/plans/e4-f5-ci-predicates.plan.md`. Branch `e4-f5-ci-predicates` —
Chris reviews and merges.

| What | Verify it yourself | Expect |
|---|---|---|
| Roadmap fully green | `npm run flowmap:roadmap` | 32 built, 0 partial (E4 5/5, F5 4/4) |
| The three suites are in the canonical list | the `node -e` one-liner in the plan doc | prints `true` for all three files |
| CI consumes the canonical list | `grep -n "spec:test:all" .github/workflows/spec-gate.yml` | the buildspec-tests job runs it |
| Predicate + parity semantics still tested | `node --test tools/flowmap/roadmap.test.mjs tools/flowmap/gate-parity.test.mjs` | all pass |
| Ban intact | `npm run flowmap:roadmap:audit` | both scans clean |
| Map true + complete at HEAD | `npm run flowmap:ship` | DONE line |
| Quiz pass bound to a live session | `npm run flowmap:onboard` (STEP 4) | re-take in YOUR session |

**Next (unchanged from the previous session, now in `handoff-archive.md`):** Chris
reviews branch `m5-p-tabs2-a-verbs-build` (the PR #37 execution); then the §C drag
plan (design-first), select-all with multi-select, and the theme-chips ruling.
`npm run flowmap:mvp` computes it all — never this file.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
