# AUD0 — Guarantee inventory

Phase AUD0 of the tooling audit (`docs/flowmap/audit/WORK_ORDER.md`). This document ENUMERATES every
guarantee the tooling claims. It does not judge them (that is AUD1) or attack them (AUD2). Status is
computed: `npm run flowmap:audit`.

Every claim below is a *quote of the repo* with a stable id (`CLM-NNN`) so AUD1/AUD2/AUD4 reference
rows without re-quoting. Nothing here is a hand-written status marker.

## Method (this inventory is itself reproducible)

```
find tools -name '*.mjs' ! -name '*.test.mjs' ! -name '*.smoke.mjs' | sort   # 37 non-test modules
node -e "console.log(JSON.stringify(require('./.claude/settings.json').hooks))"  # 3 hook events
ls .github/workflows/                                                          # deploy.yml spec-gate.yml
node -e "console.log(Object.keys(require('./package.json').scripts).length)"    # script set
grep -riEn 'prove|proof|gate|enforce|0 drift|fails|cannot|never|guarantee|deterministic' \
  CLAUDE.md tools/**/*.mjs package.json .github/workflows/*.yml
```

---

## 1. Surface inventory

### 1a. `tools/**/*.mjs` — non-test modules (37) | purpose (from header) | sibling test

**`tools/` (root)**

| file | purpose | sibling test |
|---|---|---|
| `route-repro.mjs` | headless repro of the wire-routing failure (real libavoid, 3 obstacle strategies) | none |
| `route-repro2.mjs` | reproduce routing failure at higher density/scale (tiled 3× + synthetic column) | none |
| `route-repro3.mjs` | minimal tiled-×3 routing repro variant (no header) | none |

**`tools/buildspec/`**

| file | purpose | sibling test |
|---|---|---|
| `acceptance.mjs` | E2/Keystone-2: run behavioural acceptance cases against real code; done = gate green AND cases green | `acceptance.test.mjs` |
| `diff-core.mjs` | structural diff of two skeleton maps; pure, no IO; blocking-errors vs warnings | via `diff*.test.mjs` |
| `extract.mjs` | pipeline #2 (ground truth): walk TS with ts-morph, re-serialize real structure to `.mmd` | via `pipeline.test.mjs` |
| `gate.mjs` | pipeline #3 (the lock): committed spec vs extracted code, FAIL on drift; exit 0/1/2 | via `pipeline.test.mjs` |
| `mmd-parse.mjs` | shared zero-dep parser for the `.mmd` dialect; single source of truth | via `parser-conformance`, `pipeline` |
| `run-bundled-test.mjs` | bundle a test entry via rolldown then `node --test` (extensionless import resolution) | n/a (harness) |
| `scaffold.mjs` | scaffold tool: `--backfill` / `--init` / `--add-from-plan` | via `writeback.test.mjs` |
| `skeleton.mjs` | canonical deterministic contract skeleton of a node + type coercers; shared by #1/#2/#3 | via `normtype.test.mjs` |
| `slice-core.mjs` | pure zero-IO model slicer (`sliceModel`, `filterBodies`) | `slice-core.test.mjs` |
| `spec-to-stubs.mjs` | pipeline #1 (the engine): emit TS from spec, bodies `unimplemented`; interface drift → tsc error | via `pipeline.test.mjs` |

**`tools/flowmap/`**

| file | purpose | sibling test |
|---|---|---|
| `approve-export.mjs` | E1: APPROVED plan → one artifact bundle (approved.mmd, contracts/, plan.json, CHECKLIST.md) | `approve-export.test.mjs` |
| `bundle.mjs` | merge per-folder fragments into one spec-valid `.mmd`; global/private namespace contract | none |
| `contract-gate.mjs` | PreToolUse spawn-gate: "subagents go through the contract"; DENY (exit 2) if sentinel unresolvable; else FAILS OPEN | `contract-gate.test.mjs` |
| `contract.mjs` | emit self-contained byte-deterministic EXECUTION PACKET for one change; routes, doesn't recompute | `contract.test.mjs` |
| `coverage.mjs` | file-level completeness: any src `.ts` not referenced by `%% src` → exit 1 | none |
| `edge-verify.mjs` | A5: map edges code-backed-or-audited (import / intra / advisory); exit 1 on unaccounted | `edge-verify.test.mjs` |
| `exports-coverage.mjs` | symbol-level completeness: every exported symbol is a node or allowlisted exclusion, else FAIL | none |
| `flowmap-lint.mjs` | semantic quality gate; rejects flat file-mirror maps; exit 1 on FAIL, warnings never fail | `flowmap-lint.test.mjs`, `.discriminate.test.mjs` |
| `frag-check.mjs` | per-fragment CONTRACT instrument; a subagent must make it exit 0 (ROOT/MEMBERS/META/SRC/SECTIONED) | none |
| `handoff-fresh.mjs` | F3: Stop-hook staleness nudge (always exit 0); `--check` = the F4 CI gate (exit 1 stale) | `handoff-fresh.test.mjs` |
| `lib/canonical.mjs` | the one determinism primitive (canonicalize/canonicalJSON/sha256hex/hashOf) | `canonical.test.mjs` |
| `onboard.mjs` | B1: single door for 0-context agent; proves map true+complete as of HEAD; exit 0/1 | none |
| `orchestrate.mjs` | H4: autonomous driver (waves → isolated worktree + contract → verdict → summary) | `orchestrate.test.mjs` |
| `plan-cert.mjs` | C2: certify a plan round-trips (apply → stubs → tsc → gate) before review | `plan-cert.test.mjs` |
| `plan-check.mjs` | C3: authoring-time coherence (REAL-IDS/DANGLING-DEP/ACYCLIC/PARENT/ACCEPTED); exit 0/1/2 | `plan-check.test.mjs` |
| `quiz.mjs` | Keystone-1/B2: testable understanding; answer key never on disk, recomputed at scoring | none |
| `replay.mjs` | determinism harness: run task N times, assert byte-identical stdout+exit; exit 0/1/2 | `replay.test.mjs` |
| `roadmap.mjs` | computed roadmap; `--audit-doc` fails if a markdown doc reintroduces hand-written status | none |
| `status.mjs` | C1: verified work-state of a plan (built/pending/drifted/missing) recomputed from source | none |
| `tooling-coverage.mjs` | completeness + symbol-truth for the tooling map; one unmapped module/dangling ptr → exit 1 | via `tooling-map.test.mjs` |
| `trust-report.mjs` | classify claims into trust tiers (VERIFIED/PARTIAL/ADVISORY/UNVERIFIED); exit 0 always, never a gate | none |
| `validate.mjs` | structural validation for any single `.mmd`; exit 1 if any ERROR | none |
| `verify-change.mjs` | closed-form data-only VERDICT for one change; PASS iff structural==built AND acceptance green | `verify-change.test.mjs` |
| `waves.mjs` | deterministic topological execution waves of a plan; exit 0/2 | `waves.test.mjs` |

Modules with **no exact-name test AND no covering suite**: `bundle.mjs`, `coverage.mjs`,
`exports-coverage.mjs`, `frag-check.mjs`, `onboard.mjs`, `quiz.mjs`, `roadmap.mjs`, `status.mjs`,
`trust-report.mjs`, `validate.mjs`, and the 3 `route-repro*`. (Flagged for AUD3 deny-path coverage.)

### 1b. Hooks — `.claude/settings.json`

| event | matcher | command |
|---|---|---|
| PreToolUse | `Agent\|Task` | `node tools/flowmap/contract-gate.mjs` |
| SessionStart | `startup\|resume` | `npm run --silent flowmap:onboard` |
| Stop | *(none)* | `node tools/flowmap/handoff-fresh.mjs` (bare nudge — NOT `--check`) |

`settings.local.json` adds only Bash allow-permissions (no hooks).

### 1c. Workflows — `.github/workflows/`

| workflow | job | steps (commands) |
|---|---|---|
| `spec-gate.yml` | `buildspec-tests` | `spec:test`, `spec:conformance`, then hard-coded `node --test` of: normtype, plan-layout, plan-from-diff, acceptance, writeback, plan-cert, edge-verify, plan-check, approve-export, loop-e2e, canonical, contract, verify-change, replay, **contract-gate**, waves, handoff-fresh, orchestrate; plus `flowmap:acceptance -- --plan public/plan.json` |
| `spec-gate.yml` | `flowmap-drift` | `flowmap:bundle`, `git diff --exit-code _bundle.mmd`, validate, lint, coverage, exports, gate, edges, `roadmap:audit`, `cert --plan public/plan.json`, `plan-check --plan public/plan.json`, `handoff:check` |
| `deploy.yml` | `build` / `deploy` | `npm ci`, `npm run build` (`tsc --noEmit && vite build`), Pages deploy — **no flowmap gates** |

Trigger for `spec-gate.yml`: push/PR on paths `src/**`, `docs/flowmap/**`, `tools/**`, the workflow
file, `package.json`.

CORRECTION vs prior exploration note: `contract-gate.test.mjs` IS listed in `buildspec-tests` (step
present). The AUD2 CI-coverage attack re-verifies this from the file directly.

### 1d. Composite gate chains — `package.json`

| script | chain |
|---|---|
| `flowmap:verify` | bundle → validate → lint → coverage → exports → gate → edges (7 gates) |
| `flowmap:ship` | `flowmap:verify` chain + bodies + `echo 'DONE: …'` |
| `flowmap:drift` | identical to `flowmap:verify` |
| `flowmap:tooling:verify` | tooling:bundle → validate → lint → tooling-coverage → tooling-map.test → `echo 'DONE: …'` |
| `spec:test:all` | `node --test` over the full ~24-file suite |

---

## 2. The claim table (`| claim | claimed mechanism | file |`)

### 2a. CLAUDE.md — thesis + roadmap-definition claims

| id | claim | claimed mechanism | file |
|---|---|---|---|
| CLM-001 | "zero error in the handover, the change blast radius, and the human's understanding, and zero reliance on stale prose" | overall thesis (prose) | CLAUDE.md |
| CLM-002 | "enforceable, repeateable, provable contract … 100% degree of confidence in execution" | vision (prose) | CLAUDE.md |
| CLM-003 | "the patch and the map are provably in sync" | patch ships with updated `.mmd` | CLAUDE.md |
| CLM-004 | "execute with 0 drift, verified by tests" | approval → verified acceptance tests | CLAUDE.md |
| CLM-005 | "This file holds INTENT, never STATUS … banned here too" | `roadmap:audit` fails build | CLAUDE.md |
| CLM-006 | "Roadmap status is computed from the repo, not written down" | predicate command exits 0/nonzero | CLAUDE.md |
| CLM-007 | "flowmap:roadmap:audit — fails if any prose status marker creeps back into CLAUDE.md" | `roadmap.mjs --audit-doc` exit 1 | CLAUDE.md |
| CLM-008 | A2 "CI regenerates the node set + signatures from code and fails on divergence" | `flowmap:gate` in CI | CLAUDE.md |
| CLM-009 | A3 "App parser and pipeline parser provably agree" | `parser-conformance` test | CLAUDE.md |
| CLM-010 | A5 "Every edge is code-backed … cannot rest on an unaccounted dependency" | `edge-verify` exit 1 | CLAUDE.md |
| CLM-011 | B2 "understanding becomes pass/fail" | `quiz` check | CLAUDE.md |
| CLM-012 | E4 "CI enforces the whole loop … map fresh+complete AND plan gate-green AND acceptance pass" | `spec-gate.yml` | CLAUDE.md |
| CLM-013 | F2 "the harness runs flowmap:onboard at session start, so onboarding is forced, not remembered" | SessionStart hook | CLAUDE.md |
| CLM-014 | F4 "the handoff must be at least as fresh as the last code commit; CI blocks a merge that leaves it behind" | `handoff:check` exit 1 | CLAUDE.md |
| CLM-015 | F5 "proving the loop executes, not just that each link passes alone" | `loop-e2e` test | CLAUDE.md |
| CLM-016 | I1 "proven by flowmap:tooling:verify" | tooling:verify chain | CLAUDE.md |
| CLM-017 | "every claim is a command the next agent runs, not prose to trust" | command-anchored handoff | CLAUDE.md |
| CLM-018 | "flowmap-lint fails the build if the map degrades into a flat file-mirror" | `flowmap-lint` exit 1 | CLAUDE.md |
| CLM-019 | "A feature is delivered when the gate is green AND a 0-context agent independently confirms" | gate + 0-context verify (protocol) | CLAUDE.md |
| CLM-020 | "The work-state comes from the live gate, not from any written summary" | `status.mjs` | CLAUDE.md |
| CLM-021 | "A handoff that cannot be verified by a command is not a handoff" | protocol rule (prose) | CLAUDE.md |
| CLM-022 | "modules NEVER import each other — they call ctx.hooks" (invariant #2) | onboard prints; not gated | CLAUDE.md / onboard.mjs |

### 2b. Tool header comment blocks

| id | claim | claimed mechanism | file |
|---|---|---|---|
| CLM-030 | "before the change → every case FAILS (red) … after → cases PASS" | run acceptance cases red/green | buildspec/acceptance.mjs |
| CLM-031 | "the thing that matters for drift is always taken from the code, never from the tag" | members read from real TS | buildspec/extract.mjs |
| CLM-032 | "an extractor that silently undercounts produces a false green" (covered by a test) | self-test | buildspec/extract.mjs |
| CLM-033 | "a red gate means code and spec disagree. Exit: 0=in sync, 1=drift, 2=bad" | exit 1 on drift | buildspec/gate.mjs |
| CLM-034 | "Interface drift becomes a tsc error, for free, forever" | tsc compile error | buildspec/spec-to-stubs.mjs |
| CLM-035 | "the canonical, deterministic contract skeleton … apples-to-apples" | single skeleton definition | buildspec/skeleton.mjs |
| CLM-036 | "Output FAILS flowmap-lint by design" (`--init`) | lint exit 1 | buildspec/scaffold.mjs |
| CLM-037 | "makes 'subagents go through the contract' a 100% GATE, not a convention … DENY (exit 2)" | PreToolUse deny exit 2 | flowmap/contract-gate.mjs |
| CLM-038 | "It FAILS OPEN" | any fault → ALLOW | flowmap/contract-gate.mjs |
| CLM-039 | "byte-deterministic EXECUTION PACKET … ROUTES to existing computation — does not recompute" | canonical routing | flowmap/contract.mjs |
| CLM-040 | "One uncovered file = exit 1" | exit 1 | flowmap/coverage.mjs |
| CLM-041 | "the one layer the review's confidence rests on was the one layer nothing enforced" → edges accounted for | exit 1 on unaccounted edge | flowmap/edge-verify.mjs |
| CLM-042 | "it FAILS unless the symbol is node/alias/allowlisted … 'omitted' an auditable decision, never an accident" | exit 1 | flowmap/exports-coverage.mjs |
| CLM-043 | "Exit 1 on any FAIL; warnings never fail … separate a real architecture map from a flat file-mirror" | exit 1 | flowmap/flowmap-lint.mjs |
| CLM-044 | "pass/fail by machine, never by prose" | exit 0 required | flowmap/frag-check.mjs |
| CLM-045 | "Always exits 0 — non-blocking. It is a nudge, not a trap … verifiable half is the F4 roadmap predicate" | exit 0 nudge (NOT a gate) | flowmap/handoff-fresh.mjs |
| CLM-046 | "'100 subagents → 100 identical results' … enforced by replay.mjs … no Date.now/new Date/Math.random … no absolute paths" | determinism rules via replay | flowmap/lib/canonical.mjs |
| CLM-047 | "PROVES the map is true + complete as of HEAD … Exit 0 = trustworthy, 1 = NOT" | exit 1 | flowmap/onboard.mjs |
| CLM-048 | "NOTHING chained them. This routes them into one run" (H4) | chains waves→contract→verify | flowmap/orchestrate.mjs |
| CLM-049 | "proves the plan is enforceable … Green = internally consistent … a human should never have wasted a review" | apply→stubs→tsc→gate | flowmap/plan-cert.mjs |
| CLM-050 | "Exit: 0=coherent, 1=problems, 2=bad args" | exit 1 | flowmap/plan-check.mjs |
| CLM-051 | "answer key is NEVER written to disk … so it cannot lie … A 100% score proves two things" | recompute key at scoring | flowmap/quiz.mjs |
| CLM-052 | "replay is what PROVES [determinism] … leak detector run FIRST. Exit 0=deterministic, 1=divergence" | byte-identical assertion | flowmap/replay.mjs |
| CLM-053 | "don't WRITE state, COMPUTE it … recomputed every run, so it cannot lie" + "--audit-doc … so CLAUDE.md can never silently drift again" | predicate + audit exit 1 | flowmap/roadmap.mjs |
| CLM-054 | "must be a derived fact, never a prose note … recomputed from source every run, so it cannot go stale" | recompute vs current code | flowmap/status.mjs |
| CLM-055 | "the tooling's proof of TRUE + COMPLETE … One unmapped module = exit 1 … One dangling pointer = exit 1" | exit 1 | flowmap/tooling-coverage.mjs |
| CLM-056 | "VERIFIED — enforced by flowmap:gate; mismatch blocks CI" / "Exit: 0 always (never a gate)" | reporting only (NOT a gate) | flowmap/trust-report.mjs |
| CLM-057 | "Exit code 1 if any ERROR" | exit 1 | flowmap/validate.mjs |
| CLM-058 | "what escapes is not its prose but THIS verdict — computed, not narrated … 100 byte-identical verdicts. PASS iff structural=='built' AND (no cases OR all green)" | closed-form data verdict | flowmap/verify-change.mjs |
| CLM-059 | "Exit: 0=success, 2=bad … topological sort with cycle detection" | exit 2 on bad | flowmap/waves.mjs |

### 2c. Echo / CI-string claims

| id | claim | claimed mechanism | file |
|---|---|---|---|
| CLM-070 | "DONE: map is grammar-valid + structurally sound (lint) + file-complete (coverage) + symbol-complete (exports) + in sync (gate) + edges code-backed-or-audited … bodies regenerated" | success banner after 7-gate chain | package.json `flowmap:ship` |
| CLM-071 | "DONE: tooling map bundled + grammar-valid + architectural (lint) + complete & symbol-true + deterministic" | success banner after chain | package.json `flowmap:tooling:verify` |
| CLM-072 | "_bundle.mmd is stale. Run flowmap:ship and commit." (`::error::` + exit 1) | CI fails on stale bundle | spec-gate.yml |
| CLM-073 | "✓ CERTIFIED — no new compile errors or drift (apply→stubs→tsc→gate). Safe to send to human review." | printed on cert pass | flowmap/plan-cert.mjs |
| CLM-074 | "✓ DETERMINISTIC — all N runs identical … the 100→100 proof … ROUTES to a deterministic command" | printed on determinism pass | flowmap/replay.mjs |
| CLM-075 | "flowmap contract-gate DENIED spawn: <reason>" | stderr on DENY (exit 2) | flowmap/contract-gate.mjs |
| CLM-076 | "NOT verified — the map answers these deterministically; re-read _bundle.mmd" | printed on quiz fail (exit 1) | flowmap/quiz.mjs |
| CLM-077 | "cannot read plan: … exit(2)" | exit 2 on bad input (many tools) | plan-cert/waves/contract/plan-check/… |
| CLM-078 | verify-change `--strict`: "PASS_UNPROVEN (and any non-PASS) exits non-zero; JSON body byte-identical" | strict-mode exit | flowmap/verify-change.mjs |

---

## 3. Notable structural facts (enumerated, not judged — judgment is AUD1)

- **Self-declared non-gates:** `handoff-fresh.mjs` bare mode (CLM-045, "always exits 0 … a nudge")
  and `trust-report.mjs` (CLM-056, "Exit: 0 always … never a gate").
- **Self-declared fail-open:** `contract-gate.mjs` (CLM-038) — any fault ALLOWs; only a
  sentinel-present-but-unresolvable spawn is DENIED.
- **Split personality:** the `handoff-fresh` claim (CLM-014/CLM-045) has two triggers — the Stop
  hook runs the bare non-blocking nudge; only CI runs `--check` (the F4 gate).
- **`deploy.yml` runs zero flowmap gates** — any "CI enforces" claim (CLM-012) is scoped to
  `spec-gate.yml` only.
- **Quiz is not wired to any hook or CI** (relevant to CLM-011): `flowmap:onboard` prints the quiz
  instructions but never runs `check`. AUD2 verifies.
- **`--audit-doc` (CLM-007/CLM-053) runs in CI only against `CLAUDE.md`** — other docs can carry
  hand-written status freely; the ban is not repo-wide.
- **`file`/`grep` roadmap predicates read existence/pattern, not content depth** (relevant to
  CLM-006/CLM-053) — a hollow file can satisfy an item. AUD2 verifies.
- Several composite gates route intermediates through `/tmp` (`flowmap:gate`, `flowmap:bodies`).
