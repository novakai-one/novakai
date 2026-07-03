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
## 0·now (2026-07-04, this session) — M6 readability batch 1 on `m6/integration` (PR #40): sonar-scale warnings 2279 → 1738 (−541), API surface hash-verified unchanged, io/layout + io/mermaid characterization tests added

28 line-budgeted passes over the worst offenders — panel/unfold −295, io −79
(`toMermaid`, complexity 87, split into module-private emit helpers),
interaction/pointer −54, render/wires −13, tools −100. Every pass re-ran
typecheck, lint, the full suite, the API hash and the score ratchet via an
independent verifier; exported signatures are additionally frozen by the drift
specs (`flowmap:gate`). Per-module delta table + full pass list:
`.readability/PR-BODY.md`. Deliberately left for the next batch, with extraction
shapes already proven (unfold `renderInspector`, mermaid `fromMermaid`, pointer
`pointerdown`/`pointerup`): `.readability/notes.md`; aborted passes:
`.readability/failures/`. Branch `m6/integration` — Chris reviews and merges
PR #40.

| What | Verify it yourself | Expect |
|---|---|---|
| Suite green | `npm run spec:test:all` | all pass |
| No exported-signature drift | `npm run flowmap:gate` | clean |
| API surface unchanged | `node .readability/scripts/api-surface.mjs && git diff --exit-code .readability/api-surface.json` | no diff |
| Warning total is real | `node .readability/scripts/score.mjs && node -e "const t=require('./.readability/baseline-scores.json').moduleTotals;console.log(Object.values(t).reduce((a,b)=>a+b,0))"` | 1738 |
| Characterization tests pass | `npm run test:src` | all pass |
| Map true + complete at HEAD | `npm run flowmap:ship` | DONE line |
| Quiz pass bound to a live session | `npm run flowmap:onboard` (STEP 4) | re-take in YOUR session |

**Next:** Chris reviews and merges PR #40; batch-2 candidates and their proven
extraction shapes are in `.readability/notes.md`. The prior queue (PR #37 review,
§C drag plan, select-all with multi-select, theme-chips ruling) is unchanged —
`npm run flowmap:mvp` computes it all, never this file.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
