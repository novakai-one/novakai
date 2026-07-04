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
## 0·now (2026-07-04, session 7) — PR3: `tools/flowmap/` reorganised into 6 sub-folders (onboard/verify/plan/contract/status/gates + lib/, tests colocated), stacked on `reorg/buildspec`; NEXT: merge PR2 then this PR3 (retarget to main)

Pure `git mv` reorg — no logic or formatting changes, only path strings. Every file under
`tools/flowmap/` moved into `onboard/ verify/ plan/ contract/ status/ gates/` (tests
colocated with their source); `lib/` is unchanged except `canonical.test.mjs` moved in
beside `canonical.mjs`. Every authored edit is a path string: intra-flowmap relative
imports (`./lib/…` → `../lib/…`), flowmap→buildspec imports (one extra `../` for the new
depth), CLI-spawn args in both forms — string-literal (`'tools/flowmap/x.mjs'`) and
multi-arg (`join('tools','flowmap',...)`, which a plain string grep does not catch and
needed a second pass), `HERE`-relative `ROOT` computations (`join(HERE,'..','..')` →
one more `'..'` for every file now one folder deeper — caught a handful of cross-folder
CLI refs this way, e.g. `edit-gate.mjs` spawning `quiz.mjs`, now `../onboard/quiz.mjs`),
`%% src` pointers in the moved `*.flowmap.mmd` fragments plus `docs/flowmap/_tooling.mmd`
(regenerated via `flowmap:tooling:bundle`, never hand-edited — hand-editing it first did
not byte-match the real bundler and had to be redone), `docs/flowmap/roadmap.json`
predicates (including one bracket-escaped regex a plain-string pass missed — F5's
`tools/flowmap/loop-e2e[.]test[.]mjs` check), `docs/flowmap/tooling-curation-allowlist.txt`,
root `package.json` (~40 `flowmap:*` scripts + `spec:test:all`), and every
`tools/flowmap/*` hook `command` in `.claude/settings.json`.

Three tests are unavoidably red until this reorg is committed — they assert against
**committed** git state (`git log -1 -- <path>`, `git show HEAD:<path>`, a
`git worktree add … HEAD`), so a pre-commit HEAD (still holding the old paths) cannot
satisfy them: `handoff-fresh.test.mjs`'s "flags a real committed file" fixture,
`mutate.test.mjs`'s corpus-freshness check, and `onboard.test.mjs`'s F-17 doctored-worktree
test. This is the same documented pattern the session-6 entry's full-suite row already
carried ("red only while uncommitted") — not a new problem, just the same one hitting a
different set of tests this time. All three are expected to flip green on this branch's
first commit.

| What | Verify it yourself | Expect |
|---|---|---|
| moves are pure renames | `git diff -M --stat HEAD~1` (after this session's commit) | every moved file shows as a `{old => new}` rename |
| full suite (post-commit) | `npm run spec:test:all` | 0 fail |
| map trustworthy | `npm run flowmap:onboard` | reaches "Onboarding ready. The map is trustworthy" |
| tooling self-map, freshly regenerated | `npm run flowmap:tooling:verify` | DETERMINISTIC + FRESH + VALID + ARCHITECTURAL + COMPLETE |
| roadmap predicates all resolve | `npm run flowmap:roadmap` | all items BUILT (post-commit; A4/F4/F5/H5 show PARTIAL pre-commit only, for the reason above) |
| no stale hook paths | `grep -n "tools/flowmap/" .claude/settings.json` | every command carries a sub-folder (`gates/`, `verify/`, `status/`) |
| no stale script paths | `grep -n "tools/flowmap/" package.json \| grep -vE "flowmap/(onboard\|verify\|plan\|contract\|status\|gates\|lib)/"` | empty |

**Next 1 — merge order:** PR2 (`reorg/buildspec`) lands first; this PR3 (`reorg/flowmap`,
stacked on it) is retargeted to `main` and merged second.

**Next 2 — M9 demo (carried from session 6, still open):** recorded demo per
docs/flowmap/demo/prep/recording-protocol.md.

**Postponed (Chris, 2026-07-04): Phase C effectiveness A/B** — non-blocking for MVP;
unchanged by this reorg. Recipe in handoff-archive.md session-5 entry + turn-baseline.json
`reassessment`.
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

## 0·now (2026-07-05, session 8) — M9 end-to-end loop test BUILT (docs/flowmap/plans/m9-design.md's Build checklist, steps 1-6); NEXT: the one remaining manual predicate (recorded agent-protocol demo)

Built the fixture + extended the loop test per the approved M9 design; nothing else in
scope changed (open risk #1 — teaching scaffold to emit `%% src` — stayed explicitly
deferred, per the design). One real gap the design's 0-context pressure-test didn't catch:
`state.flowmap.mmd` is a non-global fragment, so `flowmap-bundle.mjs` namespaces the
probe's fragment-local id `m9Probe` to `state__m9Probe` at merge time — the fixture's
`target.ref` had to be the post-bundle id (matching every real fixture's own convention,
e.g. `unfold__ufVerbAllowed`), and the in-test implement step feeds `scaffold.mjs` a
bare-ref shim copy for the one fragment-write call, since scaffold itself is
namespace-unaware and writes `target.ref` verbatim. Full reasoning + the manual dry-run
transcript that surfaced it: this session's commit `d69ec02`.

| What | Verify it yourself | Expect |
|---|---|---|
| fixture is coherent + certified | `node tools/flowmap/plan/plan-check.mjs --plan docs/flowmap/plans/m9-loop.plan.json && node tools/flowmap/plan/plan-cert.mjs --plan docs/flowmap/plans/m9-loop.plan.json` | both exit 0; `coherent` then `CERTIFIED` |
| the whole M9 chain, incl. the FAIL->PASS flip | `npm run flowmap:loop` | 3 tests, 3 pass, 0 fail; the M9 test's own name says "flips a real change from FAIL to PASS inside an isolated sandbox worktree" |
| no regressions | `npm run spec:test:all` | 0 fail (343 tests at build time) |
| M9 auto-predicates green | `npm run flowmap:mvp` | M9 shows `[PARTIAL] (5/5)` — all 5 auto checks (file/grep×3/cmd) green, the one `manual` line (recorded demo) is the only thing left, which is the honest/expected verdict per statusRule |
| sandbox never touches the real repo | `git status --short` immediately after `npm run flowmap:loop` | empty — no `m9Probe`/`state__m9Probe` anywhere under `git grep` in `src/` or `docs/flowmap/_bundle.mmd` |
| reminder-hook now has suite coverage | `node --test tools/flowmap/gates/reminder-hook.test.mjs` | 9 pass, 0 fail (was previously untested by `spec:test:all`) |
| ship stays clean (probe never lands in real src) | `npm run flowmap:ship` | `DONE:` line, `git status --short` empty afterward |

**Files touched this session:** `docs/flowmap/plans/m9-loop.plan.json` [NEW — the fixture],
`tools/flowmap/contract/loop-e2e.test.mjs` [extended — sandbox helper + the M9 chain],
`package.json` [`spec:test:all` gains `tools/flowmap/gates/reminder-hook.test.mjs`],
`docs/flowmap/mvp-roadmap.json` [M9 `checks` flipped to the design's exit-criteria predicate set].

**Next — the one remaining M9 predicate:** record the agent-protocol demo (session-bound
quiz pass + browser verdict review) per `docs/flowmap/demo/prep/recording-protocol.md`,
carried forward unchanged from session 6/7 — everything else in the spine is now
automated and green.

**Carried, unchanged:** Phase C effectiveness A/B stays postponed (Chris, 2026-07-04) —
recipe in handoff-archive.md session-5 entry. PR merge order from session 7 (reorg/buildspec
then reorg/flowmap) is presumed resolved by the time this session started (this branch
`m9/review` was cut from `main` post-merge, per `git log --oneline -5`).

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
