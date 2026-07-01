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

## 0a. This session — a design SANDBOX (outside `src/`; does NOT touch the app or the loop)

A read-only architecture-auditor prototype was added under `sandbox/`. It **reuses** real repo
modules (parser, theme, wire geometry) but changes no app code, exports nothing, writes no
`.mmd`, and is invisible to the flowmap tooling — so it is orthogonal to the understand→…→re-sync
loop documented below. The full, command-anchored handoff lives in `sandbox/README.md`. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Full sandbox handoff (run it, reuse, 6 views, next step) | `cat sandbox/README.md` | command-anchored doc |
| Run it | `npm run dev` → open `http://localhost:5173/sandbox/` | header: `live _bundle.mmd · … · parsed by the repo's own fromMermaid()` |
| It touched NO app code | `git status --short -- src tools` | empty |
| It reuses real modules, one-way | `grep -nE "^import .* from '\.\./src" sandbox/main.ts` | `fromMermaid` · `config` (THEMES/KIND_TINT/esc) · `wires` (orthoPath) · `state` (portPos/bestSides) |
| Tooling still green (sandbox is outside `src/`) | `npm run flowmap:gate` · `npm run flowmap:exports` · `npm run flowmap:coverage` | in sync · PASS · PASS |
| Next increment (design intent) | `sed -n '/Known limit/,$p' sandbox/README.md` | drive the real `render`/`wires` via a minimal `AppContext` → audits as overlays on the actual canvas |

## 1·now. Phase H — the two-contract gap closure (purpose review → built)

A purpose review found the AI↔human↔AI and AI↔subagent contracts were *demonstrable* but not yet
*load-bearing*; five seams. Phase H closes them. Tooling-track items are verified by their own
`node --test` + `flowmap:replay`; status is computed by the roadmap predicate. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **H1 — projection acceptance**: behavioural contracts now bind ctx/DOM-bound code, not only pure fns | `node --test tools/buildspec/acceptance.test.mjs` | 10/10 (slice GREEN · wrong-slice RED · no-lens RED · determinism) |
| **H2 — editor decision artifact**: the editor emits `approved-plan.json` = plan+verdicts; the CLI mints the bundle | `grep -n approved-plan.json src/panel/planner.ts` · `node --test tools/flowmap/approve-export.test.mjs` | present · 4/4 (incl. editor→CLI round-trip) |
| **H3 — verify-change `--strict`**: a shaped-but-unproven change no longer exits 0 | `node tools/flowmap/verify-change.mjs --change fit-clamp --json --strict; echo $?` · `… --change frame-transform --json --strict; echo $?` | `1` (unproven) · `0` (proven) |
| **H4 — orchestrator + worktree isolation**: waves → per-change worktree+contract → strict verdict → canonical summary | `node tools/flowmap/orchestrate.mjs --plan public/plan.json` · `node --test tools/flowmap/orchestrate.test.mjs` | wave-0 dispatch + summary (exit 1 = unbuilt, expected) · 6/6 |
| H4 determinism (worktree side-effects must not perturb stdout) | `node tools/flowmap/replay.mjs --task "node tools/flowmap/orchestrate.mjs --plan public/plan.json --json" --n 5` | `DETERMINISTIC` · one hash |
| **H5 — handoff content-falsifiability**: a handoff that misstates a file's git state fails the gate | `node --test tools/flowmap/handoff-fresh.test.mjs` | 5/5 (incl. the real two-bullet pattern + no false positive) |
| Phase H computes BUILT (status, not prose) | `npm run flowmap:roadmap` | H1–H5 `[BUILT]` · 31 built |
| Plan coherent + certified; whole suite green; map in sync | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/phase-h.plan.json` · `npm run spec:test:all` · `npm run flowmap:gate` | coherent · 153/153 · in sync |

**Plan + machine-checked intent** (coherence proven by `npm run flowmap:plan-check -- --plan
docs/flowmap/plans/phase-h.plan.json`): `docs/flowmap/plans/phase-h.plan.json`.

**Honest boundaries (do not oversell):**
- Like Phase G, four of five are `.mjs` TOOLING — deliberately NOT in `_bundle.mmd`, NOT gated by
  `flowmap:gate`; verified by `node --test` + `flowmap:replay`. The plan is checked by
  `flowmap:plan-check` only (it also passes `plan-cert` with zero delta). H2's editor change IS
  app-TS and rides `flowmap:gate`.
- **H4 is a v1 driver**: it provisions an isolated worktree per dispatched change and drops the
  contract packet in (the workspace a parallel build-agent would use), and routes the strict-aware
  verdict via the MAIN repo — a HEAD worktree lacks gitignored `node_modules` (ts-morph), so the
  gate cannot run inside it. Wiring an actual build agent INTO each worktree (then re-verifying from
  within) is the next increment; the schedule, the isolation and the routed verdict exist here.
- **H5 retains the dirty-handoff bypass**: while `SESSION_HANDOFF.md` is modified in the working
  tree, `flowmap:handoff:check` exits 0 without running the content check (the agent is editing it).
  The content check's correctness is proven by `node --test tools/flowmap/handoff-fresh.test.mjs`
  and by running `checkContentClaims` on this file's own HEAD revision (it flagged the prior
  false Phase-G claim, which is now removed). Commit state is derivable from `git status`.

## 1·recent. Phase G — the agent/subagent contract spine (route, not compute)

Built the tooling that makes subagent execution verifiable with **zero prose in the verdict or
handover**: a 0-context subagent receives a deterministic *contract packet*, returns a tool-computed
*verdict* (not a narration), and `replay` proves "100 runs → 1 result". Honest boundary (accepted):
100 identical **verdicts**, not 100 identical diffs; the code-writing interior stays creative, only
its verdict and handover are deterministic. Independently confirmed by a 0-context Opus verifier.
Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **G1 — contract packet**: self-contained + byte-deterministic, routes to real map/source/cone | `npm run flowmap:contract -- --change frame-transform --json` | canonical packet: `source`, `signature`, `acceptance.cases`, `blastRadius`, `deps`, `contractHash` |
| **G2 — verdict is data-only** (no prose/paths/time), PASS on a real green change | `npm run flowmap:verify-change -- --change frame-transform --json` | `"verdict":"PASS"` · behavioural 3/3 · `verdictHash` |
| G2 — verdict is **honest about strength** (3-valued) | `npm run flowmap:verify-change -- --change fit-clamp --json` · `… --change frame-node --json` | `PASS_UNPROVEN` (built, no contract) · `FAIL` (pending) |
| **G3 — the 100→100 proof**: one hash across N runs | `npm run flowmap:replay -- --task "node tools/flowmap/verify-change.mjs --change frame-transform --json" --n 20` | `DETERMINISTIC — all 20 runs identical` · exit 0 |
| G3 — leak detector is **not vacuous** (catches a real leak) | `npm run flowmap:replay -- --task "node -e \"process.stdout.write(String(Math.random()))\"" --n 8` | `NON-DETERMINISTIC` · exit 1 |
| **G4 — spawn-gate** enforces the contract, fails open | `node --test tools/flowmap/contract-gate.test.mjs` · `grep -n contract-gate .claude/settings.json` | 6/6 · `PreToolUse` hook wired |
| **G5 — parallel execution scheduler**: deterministic topological waves from deps + live status | `npm run flowmap:waves -- --plan public/plan.json` | `wave 0 (ready now): …` dispatchable set · later waves unlock as deps land |
| G5 — the waves output is deterministic (100→100) | `npm run flowmap:replay -- --task "node tools/flowmap/waves.mjs --plan public/plan.json --json" --n 12` | `DETERMINISTIC` · one hash · exit 0 |
| Phase G computes BUILT (status, not prose) | `npm run flowmap:roadmap` | G1–G5 `[BUILT]` · 26 built |
| **E4 gap fixed** — acceptance now runs on the REAL plan in CI (was engine-test only) | `grep -n "flowmap:acceptance -- --plan" .github/workflows/spec-gate.yml` | present in buildspec-tests |
| Map still true+complete (tooling lives outside src/) · whole suite green | `npm run flowmap:verify` · `npm run spec:test:all` | green · all pass |

**New files (all in `tools/flowmap/`):** `lib/canonical.mjs`, `contract.mjs`, `verify-change.mjs`,
`replay.mjs`, `contract-gate.mjs`, `waves.mjs`, and tests `canonical.test.mjs`, `contract.test.mjs`,
`verify-change.test.mjs`, `replay.test.mjs`, `contract-gate.test.mjs`, `waves.test.mjs`. Plus
`docs/flowmap/plans/subagent-contract.plan.json`. **Edited:** `package.json` (scripts + suite),
`docs/flowmap/roadmap.json` (Phase G), `.github/workflows/spec-gate.yml` (G tests + E4 fix),
`.claude/settings.json` (PreToolUse gate).

**Honest boundaries (do not oversell):**
- The spine is **.mjs tooling, not app TS symbols** — it is deliberately NOT in `_bundle.mmd` and NOT
  gated by `flowmap:gate` (the gate runs ts-morph `allowJs:false`; recon confirmed). Its verification
  is its own `node --test` suites + `flowmap:replay`. The meta plan
  (`docs/flowmap/plans/subagent-contract.plan.json`) is checked by `flowmap:plan-check` only.
- The contract packet carries an advisory free-text `intent` block (problem/approach/rationale). It is
  deterministic and hashed, but it is prose — it is *not* load-bearing for the verdict (`verify-change`
  ignores it), same status as `desc=`.
- **`PASS_UNPROVEN`** exits 0 like `PASS`; a strict caller that wants 100%-proven execution must check
  `verdict === "PASS"` in the JSON, not just the exit code.

**Remaining intent (Phase G follow-ons, none blocking):** the **wave-scheduler is now built**
(`flowmap:waves`, G5) — an orchestrator can fan out the wave-0 set to N parallel subagents, each
under its `flowmap:contract`, collect `flowmap:verify-change` verdicts, then advance. What remains is
per-change **work isolation** (a git worktree per contract so parallel subagents don't collide on the
tree) and the **orchestrator loop** that actually drives waves → dispatch → verify → next wave. The
per-task contract (packet + verdict + replay + gate) and the schedule (waves) exist; the autonomous
driver that chains them is the last piece.

## 1. This session (continuity) — a map-truth fault, found + fixed; plan NOT implemented

Resumed the in-flight plan (`public/plan.json`). Before implementing, found and fixed a
**map-completeness fault**, then stopped at the tooling's own human-review gate. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **Map was incomplete:** `camera.zoomToNode` existed in code + was called cross-module, but was absent from the map. Now documented. | `grep -n camera__zoomToNode docs/flowmap/_bundle.mmd` | node present (kind/sig/src + `--> applyCam` edge) |
| Fixed map is true + complete + in sync | `npm run flowmap:ship` | DONE line · gate in sync · 0 unaccounted edges (284) |
| `zoomToNode` is a real cross-module call, not dead code | `grep -n "camera.zoomToNode" src/panel/navigator.ts` | navigator.ts:124 |
| In-flight plan state (unchanged by the fix — `frameNode` still absent) | `npm run flowmap:status -- --plan public/plan.json` | 8 built · 8 pending |
| Plan is certified but **awaits human review** — 0 changes carry a signature | `node tools/flowmap/plan-cert.mjs --plan public/plan.json` | CERTIFIED · "Safe to send to human review" |

**Plan defect to reconcile before building `frame-node`:** the plan *adds* `camera__frameNode`
("centres but never zooms") — but `camera.zoomToNode` already exists, already does the centre-only
behaviour, and navigator already calls it (navigator.ts:124). `frame-node` is therefore an
**evolution of `zoomToNode`** (add zoom-to-readable), not a greenfield add. The plan was authored
against a map that hid `zoomToNode`. Decide evolve-vs-add at review before implementing.

**Open risk (the flowmap gap this fault exposed):** inner / API-surface functions are not
completeness-gated — only top-level exports are (A1). A cross-module-called API method hid in the
map for many commits. Candidate roadmap item: extend the completeness gate to API-surface members.

## 1a. Gap-1 CLOSED — first behavioural contract authored AND implemented

The design→contract→implement→test half of the loop now closes on a real change: `state.frameTransform`
(the pure, testable core of `frame-node`). Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Pure testable core implemented | `grep -n "export function frameTransform" src/core/state/state.ts` | present (6-line pure fn) |
| Behavioural contract GREEN (was red pre-impl) | `npm run flowmap:acceptance -- --plan public/plan.json` | 3/3 green · "the change is DONE (shaped AND correct)" |
| Map in sync (signature gate) | `npm run flowmap:gate` | `state__frameTransform` signature matches code |
| Change reads BUILT | `npm run flowmap:status -- --plan public/plan.json` | `frame-transform [BUILT]` (modify) · 9 built · 8 pending |
| Plan coherent + cert green + full suite green | `npm run flowmap:plan-check -- --plan public/plan.json` · `npm run spec:test:all` | coherent (17) · 101/101 |

**Lifecycle finding (new gap):** an `add` change, once implemented + shipped into the map, becomes
INCOHERENT against REAL-IDS ("adds a node that already exists"). The loop has no automatic
"change-landed" transition — `frame-transform` had to be hand-flipped `add`→`modify` to keep
plan-check / loop-e2e green. Candidate roadmap item: a built-add → modify/`done` transition so the
plan artifact doesn't self-drift the moment an add lands.

**Open gap (E2 surface):** the Keystone-2 harness (`acceptance.mjs`) only tests PURE, top-level
EXPORTED functions (`mod[symbol](...args)` + deepStrictEqual). DOM/ctx-bound methods and new UI
modules — most of the app, incl. every other pending change — must be factored to pure functions to
be behaviourally contractable (this is why `frame-node`'s core became `state.frameTransform`).
Candidate roadmap item: a ctx/DOM acceptance harness, or a documented "factor-to-pure" rule.

**Still held for your review (the camera applier):** `frame-node` (add `camera__frameNode`) remains
PENDING — it is the thin DOM applier over `frameTransform`, and its evolve-vs-add reconciliation
against the existing `camera.zoomToNode` (navigator.ts:124) is a design decision left to review.

## 1·prev. Prior session — each row is a runnable claim

This session closed the gaps the previous handoff left open (C3, E1) **and** the deeper
untracked gaps surfaced in review: unverified edges (the biggest), prose-typed signatures,
and the unenforced *agent* protocol. The loop is now closed at the meta level too.

| What | Verify it yourself | Expect |
|---|---|---|
| **A5 — edge verification.** The whole call graph was UNVERIFIED (283 edges, warnings only) — yet blast-radius / `downstreamCone` all walk it. Now every edge is code-backed or audited. | `npm run flowmap:edges` | 279 code-backed · 4 advisory · **0 unaccounted** |
| A5 fails closed | `node --test tools/flowmap/edge-verify.test.mjs` | 5/5 (strict exits 1 on an unaccounted edge) |
| A5 advisory edges are audited, not hidden | `cat docs/flowmap/edge-advisory-allowlist.txt` | 4 `ctx.hooks` edges, each with rationale |
| **A6 — type gate tightened.** Object-literal + function types now compared, not skipped as prose. | `npm run flowmap:gate` | ✓ in sync · **1** prose hole (was 32) |
| A6 locked + found real drift | `node --test tools/buildspec/normtype.test.mjs` | 25/25 (also fixed `showTab` `which` drift) |
| **C3 — authoring-time coherence.** | `npm run flowmap:plan-check -- --plan public/plan.json` | ✓ coherent (16 changes) |
| **E1 — single approval export.** | `npm run flowmap:approve -- --plan public/plan.json --out /tmp/x` | approved.mmd + contracts + CHECKLIST.md + plan.json |
| **F1–F3 — agent protocol made durable + bookended.** | `grep -n "Session protocol" CLAUDE.md` · `cat .claude/settings.json` | protocol section · SessionStart(onboard)+Stop(handoff) hooks |
| **F4 — meta-loop is verifiable.** Handoff must be ≥ as fresh as the last code commit. | `npm run flowmap:handoff:check` | ✓ (exits 1 when the handoff lags code) |
| **F5 — the loop runs end-to-end** (plan-check → cert → approve → status → writeback → edges) on the real plan, as one chain. | `npm run flowmap:loop` | 1/1 |
| **trust report reflects A5/A6** | `npm run flowmap:trust` | ~2526 verified · 32 partial · 0 unverified edges |
| Whole computed roadmap | `npm run flowmap:roadmap` | 21 built (Phase A–F) |
| Nothing regressed | `npm run spec:test:all` · `npm run typecheck` | 101/101 · clean |

New files: `tools/flowmap/{edge-verify,plan-check,approve-export,handoff-fresh,loop-e2e.test,edge-verify.test,plan-check.test,approve-export.test}.mjs`,
`tools/buildspec/normtype.test.mjs`, `docs/flowmap/edge-advisory-allowlist.txt`, `.claude/settings.json`.
Edited: `package.json` (scripts + suite), `spec-gate.yml` (CI), `roadmap.json` (A5 + Phase F + C2/C3 hardening),
`trust-report.mjs` (edge tiering), `skeleton.mjs` (A6 normalizers), `CLAUDE.md` (Session protocol + A5/F defs).

## 2. What "green" now means

`npm run flowmap:verify` green ⟺ the map is structurally true + complete (A1) **and its edges
are code-backed-or-audited (A5)**. The signature gate now compares object-literal/function types
too (A6) — 1 prose hole remains (a single-quoted dynamic-import type, genuinely non-normalizable).
`desc=` strings are still ADVISORY by design.

## 3. Remaining intent (run `npm run flowmap:roadmap` for live status)

The understand→…→re-sync loop and the **meta-loop** (agent protocol) are both built and CI-enforced.
Honest remaining edges, none blocking:
- 1 prose type hole (see above) — needs type-resolution to close, low value.
- 4 advisory edges are *audited*, not *proven* — they are real `ctx.hooks`/runtime relations with
  no import (invariant #2). Proving them would need call-graph extraction through `ctx.hooks`; the
  allowlist is the deliberate, reviewed boundary until then.
- The SessionStart/Stop hooks live in `.claude/settings.json`; they fire in *this* harness. They are
  the forcing half; F4 (CI) is the verifying half.
