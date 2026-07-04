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
## 0·now (2026-07-04 ~21:40, session 7) — M9 end-to-end loop-test DESIGNED: plan approved + 0-context pressure-tested, committed as docs/flowmap/plans/m9-design.md; NOT yet built; NEXT: build per the design's Build checklist

Design-only session. The M9 design (end-to-end loop test: one chained run of the real spine on
a real plan) was drafted, pressure-tested by a 0-context agent (verbatim verdicts in the doc's
"Pressure-test results" table — 2 claims REFUTED and corrected before approval), approved by
Chris, and committed verbatim. No src/ or tools/ code changed. The design carries its own
machine-checkable exit criteria (mvp-roadmap.json-style predicate block) to be applied when
M9 is built — the live roadmap still shows M9 at its current manual-only check, which is the
honest state.

| What | Verify it yourself | Expect |
|---|---|---|
| M9 design approved + committed | `test -f docs/flowmap/plans/m9-design.md && head -3 docs/flowmap/plans/m9-design.md` | title `# M9 — End-to-end flowmap testing: design plan` + `Last updated: 2026-07-04 ~21:40` |
| 0-context pressure-tested, corrections folded in | `grep -c 'REFUTED' docs/flowmap/plans/m9-design.md` | 2 (findings table, both marked fixed) |
| M9 not yet built (honest state) | `npm run --silent flowmap:mvp` | M9 shows `? [UNVERIFIED]` with its current manual-only check; the new predicate set lives in the design doc's "Exit criteria" section, applied when building |
| existing loop still green | `npm run --silent flowmap:loop` | 2 tests, 2 pass, 0 fail — on a clean checkout of this branch's commit |
| status-prose ban still holds | `npm run flowmap:roadmap:audit` | green, no allowlist change needed |

**Next — build M9:** read `docs/flowmap/plans/m9-design.md` "Build checklist" section (ordered:
one new fixture, one extended file). The fixture is `docs/flowmap/plans/m9-loop.plan.json`
[NEW, not yet created]. Flip M9's roadmap check to the design's "Exit criteria" predicate set
as part of the build.

**Carried from session 6:** M9 recorded demo per docs/flowmap/demo/prep/recording-protocol.md
(the loop-test build above is its prerequisite). Phase C effectiveness A/B stays postponed
(Chris, 2026-07-04) — recipe in handoff-archive.md session-5 entry. Session-6 entry archived
verbatim in handoff-archive.md.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
