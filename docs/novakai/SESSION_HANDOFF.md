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

## 0·now (2026-07-07, session 16) — J1 APP REGRESSION NET built, mutation-drilled and 0-context-verified; PR open from `j1/app-regression-net`; NEXT: Chris merges

**Why this exists (Chris's ask, plain):** nothing guarded the app (`src/`) against silent feature
regressions — e.g. a wiring change breaking how the stage view looks. Tooling had ~390 CI tests;
the app had 27 orphaned ones not even in CI, and NO PR-time typecheck (deploy.yml's tsc is
post-merge, main-only). This session built the 4-tier net (roadmap item **J1**, plan approved by
Chris with an explicit no-more-stops green light after agent review).

**Process state (all recorded, do not redo):** full onboard clean; quiz 12/12 in-session (session-
bound — a NEW session must re-take it); plan pressure-tested by an opus challenger (fatal find:
missing PR typecheck — incorporated); TWO consecutive 0-context audits PASS; blast-radius check
CLEAR (its 3 handling notes are all addressed in the tree: package-lock.json updated, tooling-map
entry landed, J1 CLAUDE.md line is intent-only). The approved plan with full detail:
`~/.claude/plans/onboard-i-dont-know-async-hippo.md` — READ IT before touching anything.

**What was built (branch `j1/app-regression-net`):**
- **Tier 0 — typecheck on PRs**: `npm run typecheck` wired into `spec-gate.yml` `buildspec-tests` + `novakai:verify:full`.
- **Tier 1 — characterization units**: 10 new files in `tests/characterization/` (121 new tests; expected values = observed behavior; oracle tests use `semanticDiff`). `test:src` wired into CI + verify:full. Known deliberate drops: `edgePath` (not exported), `buildFmCard` (function body IS DOM — needs a browser, not a stub). `stub-avoid-router-loader.mjs` extended (3 no-op exports + broadened specifier match — do not narrow it back, `wires.ts` imports `./avoidRouter`).
- **Tier 2 — acceptance corpus (Keystone-2 proofs kept forever)**: `tools/buildspec/acceptance/harvest-corpus.mjs` (append-only, map-first resolution, red-refusal; ponytail: no own test suite — CI's corpus run is its check) + committed `docs/novakai/acceptance-corpus.plan.json` (62 cases / 8 changes; 3 expected SKIPs: `viewspec__normalizeSurface`, `viewspec__resolveBootSurface`, `state__m9Probe`). Runs in CI + verify:full via the UNMODIFIED acceptance engine. Tooling-map node `acceptanceHarvest` added (`_tooling.mmd` regenerated). Deliberate feature change later = edit/delete the corpus case in the same PR; harvest never deletes.
- **Tier 3 — Playwright** (`@playwright/test@1.61.1`): `playwright.config.ts` + `tests/e2e/{helpers,journeys.spec,screenshots.spec}.ts`; journeys run everywhere, screenshots are LINUX-ONLY (skip elsewhere), 6 goldens generated via `docker run … mcr.microsoft.com/playwright:v1.61.1-jammy` (exact command in the plan; container-local install, copy only the snapshots dir back). New CI job `app-e2e`. Playwright is deliberately NOT in verify:full (browser install; linux goldens).
- **Tier 3b — structural wire-geometry guard** (added after a 0-context drill PROVED the pixel goldens miss wire breaks: a +40px shift of every wire stayed under the 1% pixel gate): `journeys.spec.ts` extracts every settled `#wires path` d-attribute (after `waitForStableWires` — two consecutive identical geometry reads; count-only waiting captures mid-reroute frames), rounds to ints, compares to committed `tests/e2e/wire-geometry.expected.json`. Runs on ALL platforms; darwin↔linux deterministic (proven). Deliberate wiring change → regenerate with `UPDATE_WIRE_GEOMETRY=1 npm run test:e2e`. `orthoPath` is NOT covered here (settled paths are router output) — it's covered by the unit tier.
- Roadmap item **J1** in `docs/novakai/roadmap.json` + one intent line in CLAUDE.md.

**Coverage boundary (tell Chris the truth, never oversell):** the net = typecheck + pure-core
characterization + a SAMPLING of 3 journeys/~6 goldens + harvested acceptance cases. Inspector
edits, minimap drag, group collapse, keyboard shortcuts, file import/export, drag/marquee/resize
are NOT journeyed. Green CI = "the guarded surfaces didn't change", not "no feature can break".
A red test after a deliberate change is the net WORKING — update the expected value in that PR.

| What (already proven in-tree) | Verify it yourself | Expect |
|---|---|---|
| typecheck clean | `npm run typecheck` | exit 0 |
| unit tier green | `npm run test:src` | 148 pass / 0 fail |
| corpus green | `npm run novakai:acceptance -- --plan docs/novakai/acceptance-corpus.plan.json` | 62/62 pass |
| harvest idempotent | `npm run novakai:acceptance:harvest` twice | 2nd run: no file diff |
| tooling suite + map | `npm run spec:test:all && npm run novakai:tooling:verify` | 377/377 · PASS |
| roadmap J1 present | `npm run novakai:roadmap` (and `roadmap:audit` exit 0) | J1 listed (partial until e2e files/goldens all land) |
| CI shape | `grep -c 'test:src\|typecheck\|acceptance-corpus\|app-e2e' .github/workflows/spec-gate.yml` | ≥4 (3 jobs total incl. `app-e2e`) |
| e2e journeys + wire-geometry | `npm run test:e2e` | 4 passed (3 journeys + wire-geometry) / 6 skipped (screenshots, non-linux) |
| goldens committed | `ls tests/e2e/screenshots.spec.ts-snapshots/` | 6 PNGs `*-chromium-linux.png`, each >5KB |
| lockfile linux-clean | `npm ci --dry-run` (and in any linux container) | exit 0 (deploy.yml runs `npm ci` on ubuntu) |

**Mutation drills — all run by a 0-context opus verifier, all reverted, tree left byte-identical:**
`orthoPath` coordinate flip → `test:src` red naming render-wires.test.ts ✓ · `polyPath` +40px shift → wire-geometry e2e test red with exact +40 deltas ✓ (this drill FAILED against pixel goldens alone — that finding produced Tier 3b) · `ufLiftWires` condition invert → corpus 53/62 red + harvest refuses with exit 1 ✓ · hand-edited corpus `equals` → red naming the case, restore → green ✓ · harvest idempotent (2× byte-identical) ✓.

**PR**: open from `j1/app-regression-net` → main; verify yourself:
`curl -s "https://api.github.com/repos/novakai-one/novakai/pulls?head=novakai-one:j1/app-regression-net" | grep -m1 html_url`
Done = all 3 CI jobs green on the PR (`app-e2e` renders the goldens on the real ubuntu runner). Chris merges.

Gotchas for the next agent:
- NEVER remove the `--plan public/plan.json` acceptance step from CI (gate-parity hard-asserts the literal string).
- **Lockfile trap**: darwin's npm 11.6.2 silently REVERTS the `@emnapi/core`/`runtime` top-level lock entries (linux-only optional-peer resolution) if you run `npm install` — sync deps locally with `npm ci` only, and regenerate the lock only inside a linux container (npm ≥11.13).
- Goldens were generated on linux-**arm64** (Apple-silicon docker); CI is x64. If `app-e2e` diffs on the PR, regenerate with `docker run --platform linux/amd64 …` (same command).
- Corpus runtime is `--experimental-strip-types` (no TS enum/namespace acceptance targets).
- Known pre-existing app bugs FOUND by this work (out of scope, worth follow-up): zoombar buttons (`#zFit`/`#zIn`/`#zOut`) don't respond to real pointer clicks — `startMarquee`'s `stage.setPointerCapture` (src/interaction/pointer.ts) retargets the click; e2e uses `dispatchEvent('click')` as a workaround. Boot always opens the unfold overlay with no Escape exit (tests dismiss via `#ufCompare`).
- Builders were sonnet / verifiers opus per Chris's standing rule; Docker Desktop must be running for golden work (`open -a Docker`).

## 0·now (2026-07-06, session 15) — contract-slice arc MERGED to main (PR 63); this session HARDENED the CI loop so gh can't go red on a gitignored artifact; NEXT: Chris merges PR 64 (m12/contract-test-self-provision)

Session 14's contract-slice PR (`m12/contract-slice-build`, #63) is merged to `main`. Its
buildspec-tests CI job was going red on a fresh checkout: the contract-slice tests
(`tools/novakai/contract/contract.test.mjs`, `tools/novakai/contract/orchestrate.test.mjs`,
`tools/novakai/gates/contract-gate.test.mjs`) reach the default `public/bodies.json` through a
`contract.mjs` subprocess, but that file is gitignored (`.gitignore`) so it was absent in CI. Two
fixes landed on `m12/contract-test-self-provision` (PR 64), each cleared by an independent 0-context
audit that first *falsified* the initial "one file" blast-radius claim (it was three): (1)
provisioning is now canonical — `spec:test:all` regenerates `public/bodies.json` once, serially,
before any concurrent `node --test` process (`package.json`), and the now-redundant per-job step was
removed from `.github/workflows/spec-gate.yml`, so CI consumes the one canonical list (F-06); (2)
`novakai:verify:full` — the command CLAUDE.md points agents at before a push — now actually runs
`spec:test:all`, so the "CI-equivalent" it advertises is honest and a diligent agent catches a red
suite locally instead of on gh. Rejected the per-file `before()` guard: three concurrent generators
would race on `public/bodies.json` AND the tracked `docs/novakai/derived-fn-edges.json`. Known
non-goal (documented in the commit): a bare single-file `node --test <file>` on a fresh checkout still
needs `npm run novakai:bodies` first. No `src/` changed, so the map is untouched.

| What | Verify it yourself | Expect |
|---|---|---|
| suite self-provisions | `node -e "console.log(require('./package.json').scripts['spec:test:all'].startsWith('npm run novakai:bodies &&'))"` | `true` |
| full suite green | `npm run spec:test:all` | 390/390, 0 fail (regenerates bodies.json first) |
| verify:full == CI suite | `node -e "console.log(require('./package.json').scripts['novakai:verify:full'].includes('spec:test:all'))"` | `true` |
| gate-parity intact | `node --test tools/novakai/verify/gate-parity.test.mjs` | 7 pass 0 fail |
| buildspec-tests has no bodies step | `grep -c 'npm run novakai:bodies' .github/workflows/spec-gate.yml` | `1` (only the novakai-drift job keeps its own) |

**Next — Chris merges** PR 64 (`m12/contract-test-self-provision` → main). No open follow-ups from this session.

## 0·now (2026-07-06, session 14) — contract-slice arc BUILT end-to-end (WI-1→WI-8), walking skeleton EXECUTED with a packet-only builder, 0-context audit 10/10 PASS; NEXT: Chris merges the m12/contract-slice-build PR

All six plan changes landed via subagent waves. `contract.mjs` emits a SLICED packet (`subMap` +
dependency-cone `slicedBodies` via `sliceModel {down:true}` + `filterBodies`) with a fail-closed
slice-completeness gate (exit 4, missing symbol named; `outOfScope` on the change entry = declared
escape). `extract.mjs` derives `calls[]` per node + `docs/novakai/derived-fn-edges.json` (386
edges). `edge-verify --fn-edges` triages hand-authored vs derived function edges (45 phantom / 255
missing, report-only by design). `acceptance.mjs` now honors `acc.path`/`acc.symbol` over `%% src`
(pure-lens hatch alive). `orchestrate.mjs` provisions worktrees WITH deps (`node_modules` symlink +
`bodies.json` copy) and runs `verify-change` INSIDE them — two real bugs found and fixed en route
(tsconfig include-path scoping; macOS tmpdir realpath mismatch that silently mis-verdicted every
in-worktree change). The WI-7 walking skeleton ran for real: a packet-only Sonnet builder
implemented `cli-door` (`tools/novakai/cli.mjs`, 7-verb dispatcher) in an isolated worktree from
the CONTRACT packet alone and declared the packet sufficient; run record
`docs/novakai/plans/contract-slice-run.json`. A 0-context Opus auditor re-proved 10/10 claims from
raw command output; its two honest caveats: the `.mjs` walking-skeleton verdict is
`PASS_UNPROVEN` by design (the standing G4 dogfooding hole — `.mjs` targets carry no behavioural
contract) and worktree provenance is packet-hash-chain, not git-provable. `plan-check` gained an
explicit `preLanded` declaration (REAL-IDS escape for deliberately pre-landed add nodes, used by
`cli-door`). `fit-clamp` declares `outOfScope` `state__levelFitBounds` (the bundler rejects private
cross-fragment ids — proven; reason quoted in `public/plan.json`). CI (`spec-gate.yml`,
`novakai-drift`) regenerates `bodies.json` then runs the G1 slice gate over every
`public/plan.json` change, fail-closed. Deviation log: `npm run novakai:writeback --add-from-plan`
would DUPLICATE a pre-landed node (dedupes by generated id only, not `%% src` path) — reverted,
recorded in the run artifact; run artifact `humanCheck`: pending (Chris).

| What | Verify it yourself | Expect |
|---|---|---|
| plan fully landed | `npm run novakai:status -- --plan docs/novakai/plans/contract-slice.plan.json --map docs/novakai/_tooling.mmd` | `6 built` · `All changes built. Plan fully landed.` |
| sliced packet is real | `node tools/novakai/contract/contract.mjs --change frame-transform --json` | exit 0; `subMap.nodes` = 2 nodes incl. target; `slicedBodies` 2 keys (full corpus 356) |
| gate fails closed | copy public/bodies.json to a temp file, inject a fake id into `state__frameTransform.calls`, run `node tools/novakai/contract/contract.mjs --change frame-transform --bodies <temp> --json` | exit 4; stderr names the fake symbol |
| derived call graph | `node -e "console.log(JSON.parse(require('fs').readFileSync('docs/novakai/derived-fn-edges.json','utf8')).length)"` | `386` |
| fn-edge triage | `node tools/novakai/verify/edge-verify.mjs --fn-edges --json` | exit 0; `phantom` 45, `missing` 255 |
| lens precedence | `node --test tools/buildspec/acceptance/acceptance.test.mjs` | 11 pass 0 fail (incl. acc.path-beats-%% src test) |
| in-worktree verify | `node --test tools/novakai/contract/orchestrate.test.mjs` | 9 pass (identical hash unchanged / divergent hash edited / no-symlink negative) |
| walking-skeleton record | `cat docs/novakai/plans/contract-slice-run.json` | `"outcome": "PASS"`, packet b2e277cb…, verdictHash ec36e980… |
| skeleton verdict reproducible | `node tools/novakai/contract/verify-change.mjs --change cli-door --plan docs/novakai/plans/contract-slice.plan.json --map docs/novakai/_tooling.mmd --strict --json` | `PASS_UNPROVEN`, verdictHash `ec36e98038d17d85cd9969e7250ef7b23fb6d5a239180d0640e03da966cbcbea`, exit 1 (expected — G4) |
| the CLI door | `node tools/novakai/cli.mjs help` | exit 0; 7 verbs + the 6 loop stages |
| full suite | `npm run spec:test:all` | main suite 377/377 + bundled runners, 0 fail |
| plan coherent (incl. preLanded) | `npm run novakai:plan-check -- --plan docs/novakai/plans/contract-slice.plan.json --map docs/novakai/_tooling.mmd` | coherent + `✓ REAL-IDS: "cli-door" add pre-landed` |
| onboarding unbroken | `npm run novakai:onboard` | ends `Onboarding ready.`, 32 roadmap items built |

**Next 1 — Chris merges** the m12/contract-slice-build PR (link).
**Next 2 — fn-edge triage cleanup:** 45 phantom / 255 missing hand-authored function edges; triage
to clean, then consider flipping the report to a gate.
**Next 3 — G4 dogfooding hole (standing, named):** `.mjs` tooling targets still verify at
`PASS_UNPROVEN` through the contract; wiring an `acc.path`/`node --test` lens for tooling changes
is the plausible follow-on.

## 0·now (2026-07-06, session 13) — contract-slice arc REFINED to buildable + phase-4 plumbing PROVEN by probe; NEXT: build the 6 changes per `docs/novakai/plans/contract-slice.build.md`

The session-12 idea-stage plan was refined into a buildable end-to-end plan through the review
discipline: a 0-context **challenger** (course + gaps) then a 0-context **approver** (iterated to a
clean, buildable verdict). Audit-driven changes: `verify-strict-lens` **dropped** (`verify-change`
is already lens-agnostic — m10 was `PASS_UNPROVEN` because the case couldn't *run*, not because a
lens was distrusted, so `acceptance-path` alone fixes it); `onboard-slice` **deferred** (a
continue-session token optimization, not the subagent contract); a **slice-completeness gate**
added to `contract-slice` (every symbol the target *calls* must be in the slice or explicitly
out-of-scope — the keystone the draft lacked); the real-builder spawn **moved out** of the
replay-deterministic `orchestrate.mjs` into an agent-protocol walking skeleton; **writeback+re-sync**
added so implement→re-sync actually closes. Phase 4's one genuine unknown — can `verify-change` run
*inside* a worktree — was **PROVEN** on a throwaway `probe/orchestrate-spike` worktree (torn down;
main untouched), collapsing `orchestrate-exec` from high risk to wiring. Full buildable detail
(per-change edit loci, runnable acceptance, probe evidence) is `contract-slice.build.md`. The
comprehension quiz was passed 12/12 this session (design gate cleared).

| What | Verify it yourself | Expect |
|---|---|---|
| plan parses | `node -e "JSON.parse(require('fs').readFileSync('docs/novakai/plans/contract-slice.plan.json','utf8'));console.log('JSON OK')"` | `JSON OK` |
| plan is coherent | `npm run novakai:plan-check -- --plan docs/novakai/plans/contract-slice.plan.json --map docs/novakai/_tooling.mmd` | `✓ plan is coherent (6 changes, 4 deps checked)`, exit 0 |
| status is pullable | `npm run novakai:status -- --plan docs/novakai/plans/contract-slice.plan.json --map docs/novakai/_tooling.mmd` | `5 built · 1 pending`, exit 0 — NOTE: `BUILT` = map-node present, structure-only, **nothing in this plan is implemented**; real verification is `node --test` + `novakai:replay` (`.mjs` targets) |
| build detail exists | `test -f docs/novakai/plans/contract-slice.build.md && head -1 docs/novakai/plans/contract-slice.build.md` | title `# contract-slice arc — end-to-end build plan (phases 1→5) — REV 2` |
| phase-4 probe evidence recorded | `grep -c 27fdb27224a3e3 docs/novakai/plans/contract-slice.plan.json` | `1` (the byte-identical in-worktree verdictHash) |
| wasm bug still captured | `grep -c libavoid docs/novakai/plans/contract-slice.plan.json` | `3` (WASM-BUG verifiedFact + probe/deps context + `acceptance-path` intent) |
| onboarding unbroken | `npm run novakai:onboard` | ends `Onboarding ready.`, 32 roadmap items built, `HANDOFF TRUSTWORTHY` |

**Next** — a fresh session onboards, passes the quiz, reads `contract-slice.build.md`, and builds
in order: `acceptance-path → fn-edges-derive → fn-edges-verify → contract-slice` (incl. the
completeness gate) `→ orchestrate-exec` (deterministic parts) `→` the builder-spawn walking
skeleton (which *builds* `cli-door` from its packet) `→` writeback. Every change is verified by
`node --test <file>.test.mjs` + `npm run novakai:replay` — **not** gate/status (the `.mjs`
dogfooding hole, named in the plan `note`). Register each new `*.test.mjs` in `spec:test:all`.

## 0·now (2026-07-05, session 11) — `novakai:audit-run` gained a session BROWSER on branch `m10/audit-run-browse`; NEXT (done — merged at `5fba6c9`): Chris merges the PR

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
