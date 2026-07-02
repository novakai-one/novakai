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
## 0·now (2026-07-03, this session) — onboarding-cost: the quiz pass is session-bound and module-scoped; the handoff is rotated

Built from Chris's approval of the onboarding-cost design (design doc committed first:
`docs/flowmap/onboard-cost-design.md`; plan `docs/flowmap/plans/onboard-cost.plan.json`;
tests red before code per item). Branch `onboarding-cost`, commits `db168ac` (handoff
rotation) → `f0cb1cd` (session binding) → `86ae1e7` (per-module staleness) →
`876c8d2` (two-track onboarding) → `8bcc85e` (session-aware onboard display). Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Plan coherent against the tooling map | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/onboard-cost.plan.json --map docs/flowmap/_tooling.mmd` | coherent (3 changes, 2 deps) |
| Pass artifact is session-bound + per-fragment + scope-aware | `node --test tools/flowmap/quiz.test.mjs` | 15/15 |
| Gate checks the edit's blast radius, fails closed, honours sessions | `node --test tools/flowmap/edit-gate.test.mjs` | 16/16 |
| Continue track prints scoped pointers + the verbatim out-of-scope rule | `node --test tools/flowmap/onboard.test.mjs` | 5/5 |
| Try it | `npm run flowmap:onboard -- --continue --plan docs/flowmap/plans/m4-read-primary.plan.json` | scoped fragments for main/unfold/viewspec + scoped quiz commands + the RULE line |
| The displayed quiz state matches what the gate enforces | `npm run flowmap:onboard` (inside a session) | STEP 4 "Current state" is session-bound |
| Whole suite green | `npm run spec:test:all` | 318 pass 0 fail (303+6+2+7) |
| Src map untouched (tools/docs-only session) | `npm run flowmap:ship` → `git diff --stat docs/flowmap/_bundle.mmd` | DONE line · empty |
| Tooling self-map still true | `npm run flowmap:tooling:verify` | DONE line |
| Handoff rotated; edges promoted, not archived | `wc -l docs/flowmap/SESSION_HANDOFF.md docs/flowmap/handoff-archive.md docs/flowmap/KNOWN_EDGES.md` | handoff small; archive + KNOWN_EDGES carry the rest |
| Ban holds on all docs | `npm run flowmap:roadmap:audit` | both scans ✓ |
| Protocol carries the two-track rule | `grep -n '2b\.' CLAUDE.md` | session protocol rule 2b present |

**Honest boundaries (do not oversell):**
- The scoped flow is machine-tested end to end but has not yet been driven by a real
  0-context session (protocol rule 3): the first continue-track session should confirm
  from command output alone that scoped onboard → scoped quiz → gated edit works live.
- Session binding deliberately ends cross-session pass inheritance: every new session
  re-proves its read (now cheaply, via `--scope`). Pre-v2 artifacts keep the old
  any-change-invalidates guarantee until first re-quiz.
- `verify --file`'s module resolution trusts `%% src` (46/47 files) with a
  colocated-basename fallback (covers `src/main.ts`); an unmappable src file denies.
- Neighbour staleness uses direct edges only (both directions, fragment-bearing owners) —
  transitive blast radius is deliberately not chased; the full track covers it.

**Next (Scenario 1):** Chris reviews/merges the `onboarding-cost` PR. First continue-track
session after merge doubles as the live 0-context proof. Then **M5** remains the open P2
item; the two CI partials (E4, F5 steps in `spec-gate.yml`) remain the small open gaps;
`npm run flowmap:roadmap` / `npm run flowmap:mvp` compute all of it — never this file.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
