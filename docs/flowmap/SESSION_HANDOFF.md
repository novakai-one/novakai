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
## 0·now (2026-07-04, this session) — MVP prep fixes on `mvp/m9-prep-fixes`: stage wires edge-anchored, dock spacing, plan review reachable from unfold-primary (plannerOpen hook), M0 predicate + M9-before-M7 ordering, plan-review ruling 2026-07-04/1

Five items. (1) `src/panel/unfold.ts` — stage wires are edge-anchored: `drawStageWires` now
builds a stage-space `sbox()` and routes through the shared `wirePath()` instead of
center-to-center Béziers that overlapped the cards; `drawStageProxyWires` anchors the
card end at its box edge via a local `edgeToward()`. (2) `src/panel/unfold.ts` injected
CSS — dock spacing: `.uf-tabrow` gap 2px→6px, new `.uf-conn .uf-cl+.uf-cl{margin-left:6px}`
so inspector chips don't rely solely on parent gap (user-reported "joined sub-menu items";
**visual browser check was unavailable this session — treat as an assumption**). (3) Plan
review reachable from unfold-primary boot: new `plannerOpen` hook
(`src/core/context/context.ts` + wired in `src/main.ts`), planner overlay z-index 60→80
(`src/panel/planner.ts`) so it stacks above unfold (70), new `review plan…` button
(`id ufReviewPlan`) in unfold's io tab. (4) `docs/flowmap/mvp-roadmap.json` — M0 manual
check replaced with a cmd predicate (origin remote = novakai-one/novakai) → M0 now BUILT;
spine reordered recorded-demo BEFORE foreign-repo; M9 intent now runs on novakai (ruling
2026-07-04), M7 (react-dev) deliberately last; M5 note updated. (5)
`docs/flowmap/parity-checklist.md` — plan review row → `unfold-reachable (io tab →
ctx.hooks.plannerOpen; ruling 2026-07-04/1)`; footnote ¹ rescoped to diff review only
(z-order correction recorded); new superseding ruling 2026-07-04/1 appended. Diff review
stays post-MVP. Branch `mvp/m9-prep-fixes` — Chris reviews and merges.

| What | Verify it yourself | Expect |
|---|---|---|
| Suite green | `npm run spec:test:all` | all pass |
| src characterization green | `npm run test:src` | all pass |
| Build clean | `npm run build` | tsc + vite build, exit 0 |
| No signature drift | `npm run flowmap:gate` | clean (spec and code in sync) |
| M0 built + new spine order | `npm run flowmap:mvp` | M0 BUILT; spine `rename -> tooling-enforceable -> interface -> readability -> recorded-demo -> foreign-repo`; M9 listed before M7 |
| Ban intact | `npm run flowmap:roadmap:audit` | both scans clean |
| Plan-review ruling recorded | `grep -n "2026-07-04/1" docs/flowmap/parity-checklist.md` | hits |
| Plan review reachable | `grep -n "ufReviewPlan" src/panel/unfold.ts` | button + click handler |
| plannerOpen hook wired | `grep -n "plannerOpen" src/core/context/context.ts src/main.ts` | hook type + default + real wiring |
| Map fresh | `npm run flowmap:ship` | DONE line |
| Quiz pass bound to a live session | `npm run flowmap:onboard` (STEP 4) | re-take in YOUR session — this session's pass never attests your read |
| PR #43 ship-stamp idempotent at HEAD | `npm run flowmap:ship && git status --porcelain` | DONE line; porcelain empty (stamp is content-only, write-if-different) |
| Handoff fresh at HEAD | `npm run flowmap:handoff:check` | exit 0 |

**Next:** Chris reviews/merges this PR; visually confirm the two UI fixes (stage wires
land on card edges; dock tab/chip spacing reads as separated, not joined) — in-session
browser check was unavailable this session. Then M9 (recorded end-to-end demo on novakai)
is ready to attempt per the corrected spine; M7 (react-dev foreign-repo run) stays last.
`npm run flowmap:mvp` computes it all — never this file. The ship-staleness map-neutral
false positive queued here is fixed on `m9/w3-ship-staleness` (separate branch, not yet
merged): the predicate is now a content hash, not commit timestamps. Verify:
`node --test tools/flowmap/ship-staleness.test.mjs`, `node tools/flowmap/ship-staleness.mjs`
after `npm run flowmap:ship`.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
