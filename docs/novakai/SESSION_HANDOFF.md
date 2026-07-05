# Session handoff — verifiable, not prose

> **New agent: do not trust this document. Run `npm run novakai:onboard` first.**
> Everything below is either a *runnable claim* (a command + expected result you
> can execute) or clearly-labelled *intent* (the remaining roadmap). The verified
> state of the app lives in the tools, not in this file.

## 0. Start here

```
npm run novakai:onboard
```

Proves the map is true + complete as of HEAD, prints the 3 invariants, hands you the
quiz. Prove your read before any design claim:

```
npm run novakai:quiz -- generate --n 12 --seed 1
# answer each from docs/novakai/_bundle.mmd only, write answers.json, then:
npm run novakai:quiz -- check --answers answers.json --seed 1   # 100% = handover trusted
```

## 0·now (2026-07-05, session 11) — `novakai:audit-run` gained a session BROWSER on branch `m10/audit-run-browse`; NEXT: Chris merges the PR

`novakai:audit-run` previously required an exact `--session <uuid>` and exited 2 without one —
no way to discover what sessions exist. This session added a browse-and-pick front-end to
`tools/novakai/audit/audit-run.mjs` (report back-end `buildReport`/`renderMarkdown` unchanged):
`--list` prints a numbered, most-recent-first table (index · date · branch · aiTitle) built from
the immutable `~/.claude` transcripts; `--session` now accepts a **row number, a sessionId
prefix, or a full uuid**; and with no `--session` on a real TTY it shows an interactive picker.
Plan was 0-context pressure-tested twice (2 rounds, second returned APPROVE), built by a Sonnet
subagent, and independently verified by a 0-context Opus agent from raw command output.

| What | Verify it yourself | Expect |
|---|---|---|
| built-in unit checks pass | `node tools/novakai/audit/audit-run.mjs --selftest` | 12 checks, all `PASS`, ends `ALL PASS` |
| browse the sessions | `npm run novakai:audit-run -- --list` | numbered table (`#`/date/branch/title), most-recent first, no stack trace |
| number ≡ prefix ≡ uuid (same session) | pick a stable row N + its 8-char prefix + full uuid; run `--session` on each; `diff` the report bodies | identical bodies; same `sessionId:` header line all three |
| all-digit prefix falls through (regression) | `npm run novakai:audit-run -- --session 30568351` | resolves to `30568351-ccf0-424e-adaa-8d36241a90ef` (a prefix match, **not** an out-of-range index error) |
| bad token fails clean | `npm run novakai:audit-run -- --session zzzzzzzzzzzz ; echo $?` | `no session matches "zzzzzzzzzzzz"`, exit `2` |
| non-TTY never hangs | `npm run novakai:audit-run < /dev/null ; echo $?` | usage text mentioning `--list`, exit `2` |
| I1 tooling self-map stays green | `npm run novakai:tooling:verify` | ends with the `DONE:` line (bundled + valid + architectural + complete & symbol-true + deterministic) |

**Files touched this session:** `tools/novakai/audit/audit-run.mjs` [added `listRootSessions`,
`sessionTitle`, `renderSessionList`, `resolveSession`, `pickSessionInteractive` + `main` dispatch
+ 6 selftest checks; back-end untouched]. `audit-run.mjs` is one file-level node in
`_tooling.mmd`, so no new map nodes — `tooling:verify` re-bundles unchanged.

**Next — Chris merges** the `m10/audit-run-browse` PR (it also carries the two prior
`novakai:audit-run` commits, which were never pushed — the tool ships together with its browser).

## 0·now (2026-07-05, session 10) — M10 protocol run EXECUTED on branch `m10/toggle-zoom`: toggle-zoom fix built through the full loop by subagents; run outcome recorded FAIL (one gate structurally unreachable, frictions captured); NEXT: Chris's Stage-8 in-app check + friction review

One real feature (group toggle must not move the camera) driven through
understand → plan → approve → build → verify → re-sync per
`docs/novakai/plans/m10-run-protocol.md`, lead-as-orchestrator (0 src/ reads), all reading /
design / building by 0-context subagents. The recorded run result is in
`docs/novakai/plans/m10-run.json` — outcome `FAIL` per the protocol's letter (Stage 5 requires
strict `PASS` per change; `uf-fit-wire` is capped at `PASS_UNPROVEN` because the acceptance
runner resolves cases via the map's `%% src` before the acceptance block's own path/symbol and
`unfold.ts` is unimportable by the runner — a tools/ limitation, not a feature defect). The
feature itself is fully built and behaviourally proven at the pure resolver. Human approval was
assumed per Chris's run instruction (see manifest `assumptions`).

| What | Verify it yourself | Expect |
|---|---|---|
| plan coherent + certified | `npm run novakai:plan-check -- --plan docs/novakai/plans/m10.plan.json && npm run novakai:cert -- --plan docs/novakai/plans/m10.plan.json` | both exit 0; `coherent` then `CERTIFIED` |
| both changes landed | `npm run novakai:status -- --plan docs/novakai/plans/m10.plan.json` | `2 built`, `Plan fully landed`, exit 0 |
| behavioural proof (the fix itself) | `npm run novakai:acceptance -- --plan docs/novakai/plans/m10.plan.json` | 4/4 green incl. "toggling a group open or closed moves neither zoom nor focus", exit 0 |
| pure resolver verdict | `npm run novakai:verify-change -- --change uf-fit-xform --plan docs/novakai/plans/m10.plan.json --strict --json` | `"verdict":"PASS"`, exit 0 |
| wiring verdict (the recorded failure) | `npm run novakai:verify-change -- --change uf-fit-wire --plan docs/novakai/plans/m10.plan.json --strict --json` | `"verdict":"PASS_UNPROVEN"`, exit 1 — expected; see manifest frictions[4] |
| map re-synced from code | `npm run novakai:ship && git status --porcelain` | `DONE:` line; porcelain empty |
| the recorded run result | `cat docs/novakai/plans/m10-run.json` | `"outcome":"FAIL"`, 5 frictions, 0 violations, `"humanCheck":"pending"` |

**Next 1 — Stage 8 (Chris):** in the running app, zoom into a node, close the parent group,
reopen it — the camera must not move. Record the verdict in `m10-run.json` `humanCheck`.
**Next 2 — friction review:** manifest frictions[0..4], especially [4] (tools/ change needed
before any strict-PASS run of a closure-target modify) and [0] (writeback-before-verify stage
order for adds in the protocol doc).

 — PR3: `tools/novakai/` reorganised into 6 sub-folders (onboard/verify/plan/contract/status/gates + lib/, tests colocated), stacked on `reorg/buildspec`; NEXT: merge PR2 then this PR3 (retarget to main)

Pure `git mv` reorg — no logic or formatting changes, only path strings. Every file under
`tools/novakai/` moved into `onboard/ verify/ plan/ contract/ status/ gates/` (tests
colocated with their source); `lib/` is unchanged except `canonical.test.mjs` moved in
beside `canonical.mjs`. Every authored edit is a path string: intra-novakai relative
imports (`./lib/…` → `../lib/…`), novakai→buildspec imports (one extra `../` for the new
depth), CLI-spawn args in both forms — string-literal (`'tools/novakai/x.mjs'`) and
multi-arg (`join('tools','novakai',...)`, which a plain string grep does not catch and
needed a second pass), `HERE`-relative `ROOT` computations (`join(HERE,'..','..')` →
one more `'..'` for every file now one folder deeper — caught a handful of cross-folder
CLI refs this way, e.g. `edit-gate.mjs` spawning `quiz.mjs`, now `../onboard/quiz.mjs`),
`%% src` pointers in the moved `*.novakai.mmd` fragments plus `docs/novakai/_tooling.mmd`
(regenerated via `novakai:tooling:bundle`, never hand-edited — hand-editing it first did
not byte-match the real bundler and had to be redone), `docs/novakai/roadmap.json`
predicates (including one bracket-escaped regex a plain-string pass missed — F5's
`tools/novakai/loop-e2e[.]test[.]mjs` check), `docs/novakai/tooling-curation-allowlist.txt`,
root `package.json` (~40 `novakai:*` scripts + `spec:test:all`), and every
`tools/novakai/*` hook `command` in `.claude/settings.json`.

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
| map trustworthy | `npm run novakai:onboard` | reaches "Onboarding ready. The map is trustworthy" |
| tooling self-map, freshly regenerated | `npm run novakai:tooling:verify` | DETERMINISTIC + FRESH + VALID + ARCHITECTURAL + COMPLETE |
| roadmap predicates all resolve | `npm run novakai:roadmap` | all items BUILT (post-commit; A4/F4/F5/H5 show PARTIAL pre-commit only, for the reason above) |
| no stale hook paths | `grep -n "tools/novakai/" .claude/settings.json` | every command carries a sub-folder (`gates/`, `verify/`, `status/`) |
| no stale script paths | `grep -n "tools/novakai/" package.json \| grep -vE "novakai/(onboard\|verify\|plan\|contract\|status\|gates\|lib)/"` | empty |

**Next 1 — merge order:** PR2 (`reorg/buildspec`) lands first; this PR3 (`reorg/novakai`,
stacked on it) is retargeted to `main` and merged second.

**Next 2 — M9 demo (carried from session 6, still open):** recorded demo per
docs/novakai/demo/prep/recording-protocol.md.

**Postponed (Chris, 2026-07-04): Phase C effectiveness A/B** — non-blocking for MVP;
unchanged by this reorg. Recipe in handoff-archive.md session-5 entry + turn-baseline.json
`reassessment`.
## 0·now (2026-07-04 ~21:40, session 7) — M9 end-to-end loop-test DESIGNED: plan approved + 0-context pressure-tested, committed as docs/novakai/plans/m9-design.md; NOT yet built; NEXT: build per the design's Build checklist

Design-only session. The M9 design (end-to-end loop test: one chained run of the real spine on
a real plan) was drafted, pressure-tested by a 0-context agent (verbatim verdicts in the doc's
"Pressure-test results" table — 2 claims REFUTED and corrected before approval), approved by
Chris, and committed verbatim. No src/ or tools/ code changed. The design carries its own
machine-checkable exit criteria (mvp-roadmap.json-style predicate block) to be applied when
M9 is built — the live roadmap still shows M9 at its current manual-only check, which is the
honest state.

| What | Verify it yourself | Expect |
|---|---|---|
| M9 design approved + committed | `test -f docs/novakai/plans/m9-design.md && head -3 docs/novakai/plans/m9-design.md` | title `# M9 — End-to-end novakai testing: design plan` + `Last updated: 2026-07-04 ~21:40` |
| 0-context pressure-tested, corrections folded in | `grep -c 'REFUTED' docs/novakai/plans/m9-design.md` | 2 (findings table, both marked fixed) |
| M9 not yet built (honest state) | `npm run --silent novakai:mvp` | M9 shows `? [UNVERIFIED]` with its current manual-only check; the new predicate set lives in the design doc's "Exit criteria" section, applied when building |
| existing loop still green | `npm run --silent novakai:loop` | 2 tests, 2 pass, 0 fail — on a clean checkout of this branch's commit |
| status-prose ban still holds | `npm run novakai:roadmap:audit` | green, no allowlist change needed |

**Next — build M9:** read `docs/novakai/plans/m9-design.md` "Build checklist" section (ordered:
one new fixture, one extended file). The fixture is `docs/novakai/plans/m9-loop.plan.json`
[NEW, not yet created]. Flip M9's roadmap check to the design's "Exit criteria" predicate set
as part of the build.

**Carried from session 6:** M9 recorded demo per docs/novakai/demo/prep/recording-protocol.md
(the loop-test build above is its prerequisite). Phase C effectiveness A/B stays postponed
(Chris, 2026-07-04) — recipe in handoff-archive.md session-5 entry. Session-6 entry archived
verbatim in handoff-archive.md.

## 0·now (2026-07-05, session 9) — M9 chain made independently auditable: one named test per step + M9-AUDIT log lines; NEXT: the one remaining manual predicate (recorded agent-protocol demo)

Session 8 (below) built the M9 chain as a single test; this session restructures it into
one `test()` per Table-1 step (0, 2, 4-17) inside a `describe`/`before`/`after` block
sharing one sandbox worktree, per the hard auditability requirement: the TAP output of
`npm run novakai:loop` must itself be the per-step audit record, with red steps (2, 6,
11, 12, 16-red) named so a met RED expectation reads as a PASSING test. Each step also
prints one grep-able `M9-AUDIT {"step":...,"cmd":...,"expected":...,"observedExit":...,
"verdict":...,"hash":...}` line (canonical JSON, no timestamps) during setup. No command
chain, fixture, or tool logic changed — same validated steps, same shim-copy approach
session 8's commit `d69ec02` explains; this is presentation-only.

| What | Verify it yourself | Expect |
|---|---|---|
| per-step tests exist | `grep -c "^  test('M9 step" tools/novakai/contract/loop-e2e.test.mjs` | `16` (steps 0,2,4,5,6,8,9,10,11,12,13,14,15,16-red,16-green,17) |
| the whole M9 chain, per-step | `npm run novakai:loop` | 18 tests, 18 pass, 0 fail; 16 lines of output match `M9-AUDIT` |
| audit trail greppable from a fresh run | `npm run --silent novakai:loop 2>&1 \| grep M9-AUDIT \| wc -l` | `16` |
| verdictHash flips FAIL->PASS (visible in the audit log) | `npm run --silent novakai:loop 2>&1 \| grep 'M9-AUDIT.*"step":"11"'` and the `"step":"15"` line | the two `"hash"` values differ |
| no regressions | `npm run spec:test:all` | 0 fail |
| M9 auto-predicates still green | `npm run novakai:mvp` | M9 shows `[PARTIAL]` — all auto checks (file/grep×3/cmd) green, the one `manual` line (recorded demo) is the only thing left |

**Files touched this session:** `tools/novakai/contract/loop-e2e.test.mjs` only (restructured;
no other file changed — the fixture, `package.json` and `mvp-roadmap.json` from session 8
are untouched and already correct).

**Next — the one remaining M9 predicate:** unchanged from session 8, below — record the
agent-protocol demo (session-bound quiz pass + browser verdict review) per
`docs/novakai/demo/prep/recording-protocol.md`.

## 0·now (2026-07-05, session 8) — M9 end-to-end loop test BUILT (docs/novakai/plans/m9-design.md's Build checklist, steps 1-6); NEXT: the one remaining manual predicate (recorded agent-protocol demo)

Built the fixture + extended the loop test per the approved M9 design; nothing else in
scope changed (open risk #1 — teaching scaffold to emit `%% src` — stayed explicitly
deferred, per the design). One real gap the design's 0-context pressure-test didn't catch:
`state.novakai.mmd` is a non-global fragment, so `novakai-bundle.mjs` namespaces the
probe's fragment-local id `m9Probe` to `state__m9Probe` at merge time — the fixture's
`target.ref` had to be the post-bundle id (matching every real fixture's own convention,
e.g. `unfold__ufVerbAllowed`), and the in-test implement step feeds `scaffold.mjs` a
bare-ref shim copy for the one fragment-write call, since scaffold itself is
namespace-unaware and writes `target.ref` verbatim. Full reasoning + the manual dry-run
transcript that surfaced it: this session's commit `d69ec02`.

| What | Verify it yourself | Expect |
|---|---|---|
| fixture is coherent + certified | `node tools/novakai/plan/plan-check.mjs --plan docs/novakai/plans/m9-loop.plan.json && node tools/novakai/plan/plan-cert.mjs --plan docs/novakai/plans/m9-loop.plan.json` | both exit 0; `coherent` then `CERTIFIED` |
| the whole M9 chain, incl. the FAIL->PASS flip | `npm run novakai:loop` | 3 tests, 3 pass, 0 fail; the M9 test's own name says "flips a real change from FAIL to PASS inside an isolated sandbox worktree" |
| no regressions | `npm run spec:test:all` | 0 fail (343 tests at build time) |
| M9 auto-predicates green | `npm run novakai:mvp` | M9 shows `[PARTIAL] (5/5)` — all 5 auto checks (file/grep×3/cmd) green, the one `manual` line (recorded demo) is the only thing left, which is the honest/expected verdict per statusRule |
| sandbox never touches the real repo | `git status --short` immediately after `npm run novakai:loop` | empty — no `m9Probe`/`state__m9Probe` anywhere under `git grep` in `src/` or `docs/novakai/_bundle.mmd` |
| reminder-hook now has suite coverage | `node --test tools/novakai/gates/reminder-hook.test.mjs` | 9 pass, 0 fail (was previously untested by `spec:test:all`) |
| ship stays clean (probe never lands in real src) | `npm run novakai:ship` | `DONE:` line, `git status --short` empty afterward |

**Files touched this session:** `docs/novakai/plans/m9-loop.plan.json` [NEW — the fixture],
`tools/novakai/contract/loop-e2e.test.mjs` [extended — sandbox helper + the M9 chain],
`package.json` [`spec:test:all` gains `tools/novakai/gates/reminder-hook.test.mjs`],
`docs/novakai/mvp-roadmap.json` [M9 `checks` flipped to the design's exit-criteria predicate set].

**Next — the one remaining M9 predicate:** record the agent-protocol demo (session-bound
quiz pass + browser verdict review) per `docs/novakai/demo/prep/recording-protocol.md`,
carried forward unchanged from session 6/7 — everything else in the spine is now
automated and green.

**Carried, unchanged:** Phase C effectiveness A/B stays postponed (Chris, 2026-07-04) —
recipe in handoff-archive.md session-5 entry. PR merge order from session 7 (reorg/buildspec
then reorg/novakai) is presumed resolved by the time this session started (this branch
`m9/review` was cut from `main` post-merge, per `git log --oneline -5`).

## Archive + durable edges

Superseded session entries live in `docs/novakai/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/novakai/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
