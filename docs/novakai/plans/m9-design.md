# M9 — End-to-end novakai testing: design plan

**Last updated: 2026-07-04 ~21:40** · Repo HEAD at design time: `660a35b` · Format: .md (the deliverable is two review tables + evidence-quoting findings — JSON would flatten them into strings and lose the audit readability; the machine-checkable part is already JSON inside: the exit-criteria predicate block).

## Context

Every roadmap phase (A–I) is BUILT, but each link of the loop is only proven **alone**. The existing F5 test (`tools/novakai/loop-e2e.test.mjs`, `npm run novakai:loop`) chains plan-check → cert → approve-export → status → writeback `--dry` → edge-verify on `public/plan.json`, plus one red-chain test. It never proves the loop's reason to exist: **a change going from provably-not-built to provably-built through the full spine** — understanding gate, human verdict path, contract dispatch, a real implementation landing, acceptance flipping red→green, the closed-form verdict flipping FAIL→PASS, and the verdict replaying byte-identically. M9 closes exactly that gap.

Facts the design turns on (verified by exploration agents against the repo):
- `verify-change.mjs` folds `status.mjs` (structural, real ts-morph) + `runAcceptance` (behavioural, real code via `%% src`) into PASS / PASS_UNPROVEN / FAIL — a FAIL→PASS flip **requires real code landing**; no mock can flip it.
- `public/plan.json` cannot drive the flip: its acceptance-bearing change (`frame-transform`) is already built (green from the start), and its unbuilt changes are real product features.
- `orchestrate.mjs`'s own header documents the gap: worktrees lack `node_modules`, so verdicts route via the main repo — **no existing path executes an implementation inside the isolated workspace and re-verifies it there**.
- Running the **worktree's copies of the tools** (cwd = worktree, `node_modules` symlinked in) keeps all `%% src` resolution inside the sandbox — the test can implement code and go green without ever mutating the real repo.

## Core decisions

**Fixture:** [NEW] `docs/novakai/plans/m9-loop.plan.json` — one `add` change `m9-probe`: a tiny pure function in `src/core/state/state.ts` (colocated fragment `src/core/state/state.novakai.mmd`, already carrying 21 `%% src` directives in the exact format the probe needs). The change carries a committed `fm` signature, 3 pure `acceptance.cases`, `verdicts: {"m9-probe": "accept"}` (exercising the `--accepted-only`/F-12 human-decision path), **`newNode: {kind: "function", label, parent}`** — mandatory: `scaffold --add-from-plan` filters out add-changes without `newNode` (silent exit-0 no-op), and omitting `newNode.kind` makes plan-cert (defaults `module`) and status (defaults `function`) disagree about the node's kind — and no deps (wave 0 of 1). `public/plan.json` stays untouched as F5's substrate.

**Sandbox:** throwaway `git worktree add --detach <tmp> HEAD` + symlink `../node_modules` — the exact mechanism `orchestrate.mjs` already provisions, promoted from "provision only" to "the build happens here". Deterministic, idempotent, CI-safe; the real repo never gains dead probe code.

**Vehicle:** extend `tools/novakai/loop-e2e.test.mjs` (new test blocks) — already wired into `novakai:loop`, `spec:test:all`, and CI spec-gate; no new npm script, no tooling-map churn. Split out to `m9-e2e.test.mjs` later only if CI runtime forces it (reversible).

## TABLE 1 — The M9 workflow (execution order)

| # | Step (exact command or action) | Novakai part under test | Why this is the correct probe | Pass result | Fail result | Evidence artifact | Auto / agent |
|---|---|---|---|---|---|---|---|
| 0 | [NEW] Sandbox: `git worktree add --detach <tmp> HEAD` + symlink `node_modules`; steps 4–17 run the **worktree's** tool copies, cwd = worktree | orchestrate.mjs isolation mechanism (H4) | The one thing no test proves today: an implementation executing inside the isolated workspace and being re-verified there. Closes orchestrate's documented v1 gap. | worktree exists; `node tools/novakai/validate.mjs docs/novakai/_bundle.mmd` exits 0 inside it | worktree add fails / tools can't resolve ts-morph → the isolation story is fiction | test assertion in loop-e2e.test.mjs (CI spec-gate log) | Automated |
| 1 | `npm run novakai:onboard` (main repo, HEAD) | onboard.mjs (B1) | The loop's door: map proven true+complete at HEAD before anything downstream is trusted; sandbox is at the same HEAD, one run attests both. | exit 0, invariants printed | non-zero → map stale/incomplete; chain must abort | test assertion; onboard stdout | Automated |
| 2 | `node tools/novakai/quiz.mjs verify` with **no** pass artifact (sandbox) | quiz.mjs fail-closed (B2, Keystone 1) | The machine-checkable half of Keystone 1: an unattested session must be refused. | exit non-zero, re-take reason printed | exit 0 → fail-open; any agent could skip the quiz — Keystone 1 void | test assertion | Automated (red) |
| 3 | Fresh agent: `novakai:quiz` generate → answer from `_bundle.mmd` → check 100% → session pass artifact; `quiz.mjs verify --session <id>` exits 0 | quiz.mjs session-bound pass (B2) | The pass is session-bound **by design** — a node --test faking it would violate the design it tests. Only a real session can produce this evidence. NOTE: session binding is enforced **only** under an explicit `--session` flag (`quiz.mjs` header states this); flagless `verify` checks map-hash freshness only — every session-refusal assertion must pass the flag. | `verify --session <id>` exit 0 against current map | score <100, or a foreign/stale-session artifact refused under `--session` → understanding not proven | recorded demo session + gitignored quiz-pass artifact | Agent-protocol |
| 4 | `node tools/novakai/plan-check.mjs --plan docs/novakai/plans/m9-loop.plan.json` | plan-check.mjs (C3) | Authoring gate: fixture must be coherent or every later step tests garbage. | exit 0, `/coherent/` | exit 1 → fixture malformed; exit 2 → invocation bug | test assertion | Automated |
| 5 | `node tools/novakai/plan-cert.mjs --plan …/m9-loop.plan.json` | plan-cert.mjs (C2) | Proves the proposed contract is enforceable (apply→stubs→tsc→gate) **before** review, on a plan not yet built. | exit 0, `/CERTIFIED/` | exit 1 → proposed `fm` won't compile/gate — review would be wasted | test assertion | Automated |
| 6 | RED: `approve-export.mjs --plan <verdicts-stripped copy> --out X --accepted-only` | approve-export F-12 guard (E1/H2) | Approval must refuse when nothing is provably accepted — the loop must STOP at a missing human decision, not default it. | exit 2, no `X/` artifacts | exit 0 → approval fabricated a human verdict; review surface bypassable | test assertion + `!existsSync(X)` | Automated (red) |
| 7 | Human loads plan in the app (`src/panel/planner.ts`), reviews visual diff / blast radius, sets verdicts, exports | D1/D2 review surface + verdict authoring (H2) | The browser is the one surface node --test can't drive; the committed `verdicts` map in the fixture is the byte-format proxy the automated chain consumes (step 8 proves export honors that format). | exported plan carries `verdicts`; export gate unlocks at full review | export stays locked / incoherent-verdicts banner | recorded demo (M9 manual predicate) + fixture's committed verdicts map | Agent-protocol |
| 8 | `approve-export.mjs --plan …/m9-loop.plan.json --out <tmp>/export --accepted-only` | approve-export.mjs (E1) | The single approval artifact, on the **verdict path** (F5 only ran the verdict-less path). | exit 0; `approved.mmd`, `contracts/`, `plan.json`, `CHECKLIST.md` exist | missing artifact → handoff to implementer is prose again | tmp export dir asserted in-test | Automated |
| 9 | `status.mjs --plan <export>/plan.json --json` (sandbox map/tsconfig) | status.mjs (C1) | Derived work-state must say "not built yet" — the honest red baseline. | exit 3; `m9-probe: pending` | exit 0 (already built → no flip possible) or `drifted`/crash | test assertion on JSON | Automated |
| 10 | `waves.mjs --plan … --json` and `contract.mjs --change m9-probe --plan … --json` | waves.mjs (G5), contract.mjs (G1) | Dispatch schedule must contain the change in wave 0; contract packet coherent + hashed — the exact payload a subagent receives. | waves exit 0, wave 0 = `["m9-probe"]`; contract exit 0, `coherent:true`, `contractHash` present | change missing from wave 0 / contract incoherent → dispatch layer broken | test assertions on both JSON bodies | Automated |
| 11 | `verify-change.mjs --change m9-probe --plan … --json` (sandbox) | verify-change.mjs (G2/H3) — RED half | The verdict must be FAIL before implementation; without this row, step 15's PASS could be vacuously green. | exit 1, `"verdict":"FAIL"`, structural `pending` | PASS/PASS_UNPROVEN pre-implementation → verdict can't distinguish built from unbuilt — the contract spine is decorative | test assertion; red `verdictHash` captured | Automated (red) |
| 12 | `acceptance.mjs --plan … --map …` (sandbox) | acceptance.mjs (E2/H1) — Keystone 2 RED | Behavioural cases must be red pre-implementation: "done is provably not yet reached". | exit 1 (symbol missing → cases fail) | exit 0 → cases don't bind to the probe; exit 4 → fixture carries no cases (authoring bug) | test assertion | Automated (red) |
| 13 | IMPLEMENT [NEW, in-test]: write the probe function into sandbox `src/core/state/state.ts`; run **real** writeback `scaffold.mjs --add-from-plan …/m9-loop.plan.json --fragment <sandbox>/src/core/state/state.novakai.mmd` (no `--dry`); then append `%% src m9-probe src/core/state/state.ts#<fn>` to the fragment (scaffold provably does not emit `%% src`, and without it `extract.mjs` populates no signature → status can never read `built` → step 15 unreachable) | scaffold.mjs writeback (E3) — first-ever non-dry E2E run — plus the actual implement link | The loop's "implement" link executed for real: code lands, fragment updates, scaffold re-parses the fragment as its own proof. F5 only dry-ran this. | scaffold exit 0; fragment contains the node + `%% src` line; second scaffold invocation adds nothing (idempotent) | write fails / fragment unparseable after write → writeback corrupts the map's source of truth; change silently filtered ("no new nodes to add") → fixture lacks `newNode` | sandbox fragment diff asserted in-test | Automated |
| 14 | Re-sync (sandbox): `bundle.mjs --root docs/novakai/root.mmd --dir src > _bundle.mmd` + `validate.mjs` + `extract.mjs`/`gate.mjs` | bundle/validate/gate (A2 chain) | Implementation is invisible to every verdict tool until the map regenerates — the re-sync link run **mid-loop** (F5 only guarded edges). | all exit 0; bundle contains the probe node | gate red → implemented signature diverged from the certified `fm` (plan-cert and gate disagree — conformance bug) | test assertions | Automated |
| 15 | `acceptance.mjs --plan …` then `verify-change.mjs --change m9-probe --strict --json` (sandbox) | E2 GREEN + G2 verdict flip — **the row M9 exists for** | The red→green transition: same plan, same tools, only real code changed. Proves the verdict is a function of the code, end to end. | acceptance exit 0; verify-change exit 0, `"verdict":"PASS"`, `behavioural.proven:true`, verdictHash ≠ step-11 hash | still FAIL → implement path broken; PASS_UNPROVEN → acceptance didn't bind (Keystone 2 silently dropped) | test assertions; both verdictHashes | Automated |
| 16 | `orchestrate.mjs --plan … --strict --no-worktree --json` (sandbox) — run **twice**: RED run immediately after step 12 (pre-implementation), GREEN run here (post-implementation) | orchestrate.mjs (H4) | `waves.mjs` partitions built changes into `done`; wave 0 = unbuilt only — so orchestrate **never dispatches a built change**. The driver is therefore exercised on the RED side (it must dispatch the probe and report its FAIL), and on the GREEN side it must report nothing left to dispatch. Asserting `pass:1` post-green would be impossible by construction. | RED run: exit 1, `dispatched:["m9-probe"]`, verdict FAIL. GREEN run: exit 0, `dispatched:[]`, `summary.total:0`; plus `waves.mjs --json` shows `done` contains `m9-probe`. `orchestrateHash` present both runs | RED run exits 0 / doesn't dispatch → driver blind to unbuilt work; GREEN run dispatches or fails → driver disagrees with the verdict it routes to | test assertions on both canonical JSON bodies | Automated |
| 17 | `replay.mjs --task "node tools/novakai/verify-change.mjs --change m9-probe --plan … --json" --n 5` (sandbox, post-green) | replay.mjs (G3) — determinism of the verdict-bearing step | "100 subagents → 1 byte-identical verdict" is the spine's founding claim; replaying the PASS verdict proves it holds after a real build, not just on fixtures. | exit 0 — 1 stdout hash, 1 exit status across 5 runs | divergence → verdict leaks (timestamp/path/ordering); every upstream hash untrustworthy | test assertion | Automated |
| 18 | Existing red-chain test (incoherent plan → blocks at plan-check, nothing downstream runs) — retained unchanged | loop-e2e red chain (F-13) | Stop-at-first-gate already proven; M9 adds the *other* stops (steps 2, 6, 11, 12) rather than duplicating this one. | blocked at plan-check, exit 1, no export artifact | any downstream stage executed → gates advisory, not blocking | existing test assertion | Automated |
| 19 | Session close: `npm run novakai:ship`; update `SESSION_HANDOFF.md`; `npm run novakai:handoff:check` | ship chain + handoff-fresh.mjs (F4/H5) | Re-sync of the *real* repo + the meta-loop freshness gate. Deliberately not re-run inside the m9 test — already a CI predicate in spec-gate.yml; duplicating would double-fail every stale-handoff PR. | ship `DONE:` line; handoff:check exit 0 | handoff:check exit 1 → session ended with handover lagging code | CI spec-gate run + `docs/novakai/ship-stamp.json` | Agent-protocol (CI-enforced) |
| 20 | `npm run novakai:mvp` — M9 predicates computed | roadmap.mjs vs updated mvp-roadmap.json M9 entry | Status must be computed, never written: M9 "built" is itself a predicate set (exit criteria below). | M9 auto checks pass (`partial` until the demo recording exists, per statusRule — the honest verdict) | missing → predicates don't match shipped artifacts | roadmap output | Automated |

Hooks note: edit-gate / plan-gate / turn-gate / contract-gate / reminder-hook / ship-staleness fire live during the **recorded demo sessions** (steps 3, 7, 19) — that recording evidences their enforcement; their logic is already unit-tested (one suite gap fixed in build step 4 below).

## TABLE 2 — Tooling-file checklist (M9 role · used / unused / unrelated)

| file | role in M9 | status | note |
|---|---|---|---|
| tools/novakai/onboard.mjs | step 1 | used | the loop's door (B1) |
| tools/novakai/quiz.mjs | steps 2, 3 | used | Keystone 1; automated half = the refusal path |
| tools/novakai/plan-check.mjs | steps 4, 18 | used | first gate; also the red-chain blocker |
| tools/novakai/plan-cert.mjs | step 5 (+ `applyPlanToSpec` imported by approve-export) | used | pre-review certificate |
| tools/novakai/approve-export.mjs | steps 6 (red), 8 (green) | used | first E2E exercise of the `--accepted-only` verdict path |
| tools/novakai/status.mjs | step 9; routed by verify-change (11, 15) | used | structural half of every verdict |
| tools/novakai/waves.mjs | step 10; routed by orchestrate (16) | used | dispatch schedule |
| tools/novakai/contract.mjs | step 10; routed by orchestrate (16) | used | subagent packet |
| tools/novakai/verify-change.mjs | steps 11, 15, 17 | used | the FAIL→PASS flip — M9's centerpiece |
| tools/buildspec/acceptance.mjs | steps 12, 15; imported by verify-change | used | Keystone 2, red then green |
| tools/buildspec/scaffold.mjs | step 13 | used | first non-`--dry` E2E writeback |
| tools/novakai/bundle.mjs | step 14 | used | mid-loop re-sync in sandbox |
| tools/novakai/validate.mjs | steps 0, 14 | used | grammar gate on regenerated bundle |
| tools/buildspec/{extract,gate,skeleton,mmd-parse,diff-core,spec-to-stubs}.mjs | library spine under steps 5, 8, 9, 11, 14, 15 | used | never invoked directly; every verdict routes through them |
| tools/novakai/orchestrate.mjs | step 16; step 0 borrows its worktree mechanism | used | M9 closes its documented "verdict outside the worktree" gap |
| tools/novakai/replay.mjs | step 17 | used | determinism of the verdict-bearing step |
| tools/novakai/edge-verify.mjs | step 18 chain tail (existing F5 assertion) | used | re-sync guard |
| tools/novakai/handoff-fresh.mjs | step 19 | used (CI/agent-protocol) | F4 gate; deliberately not re-run in-test |
| tools/novakai/ship-stamp.mjs, ship-staleness.mjs | step 19 | used (agent-protocol) | re-sync stamp + Stop hook |
| tools/novakai/{novakai-lint,coverage,exports-coverage}.mjs | step 19 ship chain (+ step 1 via onboard) | used | map-quality gates, already CI-chained |
| tools/novakai/roadmap.mjs | step 20 | used | computes M9's own built-ness |
| tools/novakai/{edit-gate,plan-gate,turn-gate,contract-gate,reminder-hook}.mjs, turns.mjs | fire live in demo sessions (3, 7, 19) | used (agent-protocol) | .claude/settings.json hooks; logic unit-tested |
| tools/novakai/lib/{canonical,metrics-log,src-tree-hash,transcript}.mjs | hashing/metrics seams under steps 10–17 (NOVAKAI_ROOT sink pattern reused from F5) | used | infra |
| tools/novakai/metrics.mjs | wraps ship (19); sink-redirected in-test | used | M2b seam |
| tools/novakai/trust-report.mjs | not exercised | unrelated | A4 surface, orthogonal to the loop spine |
| tools/novakai/mutate.mjs + mutations.json | not exercised | unrelated | gate-mutation harness, own roadmap item |
| tools/novakai/tooling-coverage.mjs | not exercised | unrelated | I1; extending loop-e2e adds no new module → no tooling-map churn |
| tools/novakai/frag-check.mjs | not exercised | **unused in M9 — audited manual instrument** | no script/importer/hook, but it is a recorded curation-allowlist exclusion (tooling-curation-allowlist.txt: "build-time CONTRACT instrument for authoring THIS map", CLM-044). Not unaccounted; do not silently delete — either wire it or leave the audited verdict standing |
| tools/route-repro{,2,3}.mjs | not exercised | **unused — potentially redundant** | dead debug repros, allowlisted as "scratch" exclusions (tooling-curation-allowlist.txt:8-10) — safe to delete |
| tools/.DS_Store | — | **unused — junk** | delete + gitignore |
| tools/buildspec/slice-core.mjs | not exercised | **unused-in-pipeline — keep for now** | imported only by its own test, BUT it is a mapped node in the tooling self-map (`_tooling.mmd`) — deleting it forces the exact tooling-map churn M9 avoids; defer to a cleanup milestone |
| tools/novakai/reminder-hook.test.mjs | not in M9 steps — **and not in spec:test:all** | used (after fix) | live hook whose test never runs in the suite; one-line package.json fix (build step 4) |
| all other *.test.mjs under tools/ (~40, grouped) | suite context, not M9 rows | used | run by spec:test:all; loop-e2e.test.mjs is the M9 host |
| tools/buildspec/run-bundled-test.mjs | suite runner (3 bundled tests) | used | unrelated to M9 rows |
| tools/novakai/fixtures/*.mmd (4), tools/buildspec/__fixtures__/ (grouped) | lint/pipeline unit-test fixtures | used | unrelated to M9 |
| tools/novakai/*.novakai.mmd + tools/buildspec/buildspec.novakai.mmd (6 fragments) | tooling self-map (I1) | used | untouched by M9 (no new module) |
| tools/{BUILD_NOVAKAI,DISTRIBUTION,README,SYNTAX_README}.md, tools/package.json | docs/packaging | unrelated | no M9 role |

## Build checklist (ordered — one new fixture, one extended file)

1. **[NEW] `docs/novakai/plans/m9-loop.plan.json`** — one `add` change `m9-probe` (pure fn in `src/core/state/state.ts`), with `fm` + 3 acceptance cases + `verdicts:{"m9-probe":"accept"}` + **`newNode:{kind:"function",label,parent}`** (mandatory — see Core decisions). Sanity: `plan-check` and `plan-cert` green against HEAD.
2. **Extend `tools/novakai/loop-e2e.test.mjs`** — sandbox helper (worktree at HEAD + node_modules symlink; reuse the existing METRICS_SINK pattern) + the M9 chain (steps 0, 2, 4–17) as new test blocks. No new npm script; `novakai:loop` and `spec:test:all` already run it. Sandbox feasibility is verified: the verdict-bearing tools derive ROOT from `import.meta.url` (running the worktree's copies pins ROOT to the worktree); `quiz.mjs` and direct `extract` symbol resolution are cwd-relative, so **cwd = worktree is load-bearing, not optional**.
3. The implement step (13) **must append** `%% src m9-probe src/core/state/state.ts#<fn>` to the fragment — verified: `addFromPlan` emits only `%% kind`/`%% fm:meta`/`%% parent` + node-def, and `%% src` is required for the *structural* verdict (extract populates signatures only for srcMap ids), not just the behavioural one.
4. Add `tools/novakai/reminder-hook.test.mjs` to `spec:test:all` (fixes the live-hook-untested anomaly).
5. Update `docs/novakai/mvp-roadmap.json` M9 `checks` to the predicate set below.
6. `npm run novakai:loop` + `npm run spec:test:all` green → ship + handoff (step 19).
7. Separately: record the agent-protocol demo (steps 3, 7), link it command-anchored in `SESSION_HANDOFF.md` — satisfies the remaining manual predicate.

## Exit criteria — M9 "BUILT" predicate set (mvp-roadmap.json style)

```json
"checks": [
  { "kind": "file", "path": "docs/novakai/plans/m9-loop.plan.json" },
  { "kind": "grep", "path": "docs/novakai/plans/m9-loop.plan.json", "pattern": "\"verdicts\"" },
  { "kind": "grep", "path": "tools/novakai/loop-e2e.test.mjs", "pattern": "m9-loop" },
  { "kind": "grep", "path": "tools/novakai/loop-e2e.test.mjs", "pattern": "FAIL.*PASS|red.*green" },
  { "kind": "cmd",  "run": "npm run --silent novakai:loop" },
  { "kind": "manual", "note": "Recorded demo of the agent-protocol steps (session-bound quiz pass + browser verdict review); automated spine is novakai:loop." }
]
```
Per statusRule this reads `partial` (auto checks green, recording pending) until the demo exists — the honest verdict.

## Open risks / decisions for the human

1. **Should writeback learn to emit `%% src`?** The test appending it (build step 3) works, but it papers over a real E3 gap: `scaffold --add-from-plan` produces a node the verdict tools cannot see. A one-line `%% src` emission in `addFromPlan` (the plan change carries `target.ref` + the fragment knows its module path) would make writeback self-sufficient. Recommended as an in-scope mini-fix; decide.
2. **CI runtime** — the M9 chain adds ~2 tsc+ts-morph passes to loop-e2e (likely +1–2 min), and the proposed `cmd` predicate makes every `novakai:mvp` run re-execute the full loop-e2e suite. Accept, or split to `m9-e2e.test.mjs` later (reversible; grep predicates move with it).
3. **Nested worktrees (step 16)** — `--no-worktree` inside the sandbox recommended (verdict path identical); orchestrate's own worktree provisioning from within a worktree is untested git territory.
4. **Quiz boundary** — automation proves only fail-closed refusal; the 100% pass stays agent-protocol by design. A map-derived auto-answerer was rejected (it would test the quiz against itself).
5. **Dead files** — route-repro×3 and .DS_Store are safe deletes; frag-check.mjs is an audited allowlist exclusion with a documented manual role (deleting contradicts the recorded curation verdict); slice-core.mjs is a mapped tooling-map node (deleting forces tooling-map churn). Recommend: delete only route-repro×3 + .DS_Store in M9, defer the other two to a cleanup milestone.
6. **Step 1 caveat** — `novakai:onboard` attests the main *working tree*; the sandbox is at *HEAD*. Identical only on a clean checkout (always true in CI); locally a dirty tree makes "one run attests both" false. The test should assert a clean tree or scope the claim to CI.

## Verification

- Automated spine: `npm run novakai:loop` green (all M9 test blocks incl. red paths), then `npm run spec:test:all` (no regressions), then `npm run novakai:mvp` shows M9 auto-predicates green (`partial` overall until the demo recording exists — the honest verdict per statusRule).
- Determinism: step 17 replay inside the test run itself.
- 0-context confirmation (per session protocol §3): a fresh agent runs `npm run novakai:loop` + `npm run novakai:mvp` and confirms M9 from output alone — never from the builder's account.

## Design provenance (audit trail)

This plan was designed by a Plan agent from three parallel exploration reports (tools/ inventory · command surface + roadmap predicates · artifact-chain trace), then pressure-tested by a **0-context adversarial agent** that read only this document and verified every load-bearing claim against the repo at HEAD `660a35b`. Six corrections were found and are folded into the tables above. Full findings follow.

### Pressure-test results (0-context agent, verbatim verdicts)

| # | Claim tested | Verdict | Evidence (quoted from repo) |
|---|---|---|---|
| 1 | `quiz.mjs verify` fail-closed with no pass artifact | CONFIRMED | `quiz.mjs:305-308` — `if (!existsSync(PASS_FILE)) { … exit(1) }`; `.novakai-quiz-pass.json` gitignored (`.gitignore:26`), fresh worktree has none |
| 2 | verify is "session-bound" implicitly | **RISK → fixed** | `quiz.mjs:315` + header lines 37-41: session enforced ONLY under explicit `--session`, "never implicitly from env". Flagless verify passes a foreign artifact if map hash matches. Plan now passes `--session <id>` (step 3) |
| 3 | All cited flags exist (`--plan`, `--accepted-only`, `--strict`, `--no-worktree`, `--json`, `--task/--n`, `--add-from-plan/--fragment/--dry`) | CONFIRMED | argv parsing quoted per file: plan-cert.mjs:212; approve-export.mjs:128 (throw at 55-58 → exit 2 at 158, **before** `mkdirSync` at 71); verify-change.mjs:52; orchestrate.mjs:62; waves.mjs:43; replay.mjs:34-35 (N≥2); scaffold.mjs:555-562,529 |
| 4 | Exit codes (status 3=pending; acceptance 4=no-cases/1=red; verify-change 1 on FAIL and on PASS_UNPROVEN under --strict) | CONFIRMED | status.mjs:171 `exit(remaining.length ? 3 : 0)`; acceptance.mjs:202-219; verify-change.mjs:105,123 `pass = STRICT ? verdict==='PASS' : verdict!=='FAIL'`. Step-12 red is exit 1 (cases exist, `%% src` missing), not 4 — as planned |
| 5 | Worktree + node_modules-symlink sandbox works | CONFIRMED (cwd caveat) | Verdict tools derive ROOT from `import.meta.url` (verify-change.mjs:39-40, waves.mjs:32-33, orchestrate.mjs:50-51, acceptance.mjs:59-60, replay.mjs:26-27, approve-export.mjs:39-40); running the worktree's copies pins ROOT there. BUT quiz PASS_FILE + extract's `project.getSourceFile(resolve(ref.path))` are **cwd-relative** → cwd=worktree is load-bearing. Node resolver walks up to the symlinked `node_modules`. Existing loop-e2e pattern (`NOVAKAI_ROOT` sink + `spawnSync cwd`) fits |
| 6 | mvp-roadmap.json M9 entry + statusRule | CONFIRMED | M9 exists ("Recorded end-to-end demo (MVP exit)", phase P4, one `manual` check). roadmap.mjs:182-188: all auto checks green + manual present → `partial`. Proposed check kinds all match `runCheck` (roadmap.mjs:139-170). Caveat: a `cmd` predicate running `novakai:loop` makes every `novakai:mvp` re-run the suite |
| 7 | reminder-hook.test.mjs absent from spec:test:all | CONFIRMED | zero matches in package.json while reminder-hook.mjs is a live hook (`.claude/settings.json:45`) |
| 8 | scaffold `--add-from-plan` emits no `%% src`; acceptance resolves via `%% src` | CONFIRMED, **stronger**: `%% src` is required for the *structural* verdict too | addFromPlan (scaffold.mjs:481-497) emits only `%% kind`/`%% fm:meta`/`%% parent`+node-def. extract.mjs:214 populates signatures only `for (const id in srcMap)` — no `%% src` → empty interfaces → status `drifted`, never `built` → PASS unreachable |
| 9 | Probe host `src/core/state.ts` | **REFUTED on path → fixed** | Module is `src/core/state/state.ts` + colocated `src/core/state/state.novakai.mmd` (21 `%% src` lines in the needed format). Right host, wrong path — corrected |
| 10 | loop-e2e runs under `novakai:loop` + `spec:test:all` + CI | CONFIRMED | package.json both scripts; `.github/workflows/spec-gate.yml:31` runs `spec:test:all` |
| 11 | Step 16 post-green `summary:{pass:1,fail:0}` | **REFUTED → fixed** | waves.mjs:73-78 partitions built→`done`, waves over `notDone` only; orchestrate.mjs:122 `dispatched = waves[0] ?? []`. Post-green: `dispatched:[]`, `total:0`, exit 0 — `pass:1` impossible by construction. Now a two-sided red/green probe |
| 12 | Fixture shape | **RISK → fixed** | scaffold.mjs:452-453 filters add-changes to those with `c.newNode` → silent exit-0 no-op without it; plan-cert defaults kind `module` vs status.mjs:63 `function` → `newNode:{kind:"function",…}` now mandatory in the fixture |
| 13 | Table 2 dead-file verdicts | 2 nuances → fixed | frag-check.mjs is an audited allowlist exclusion with a documented manual role (CLM-044) — not unaccounted; slice-core.mjs is a mapped tooling-map node (`_tooling.mmd:190`) — deleting forces the churn M9 avoids. route-repro×3 confirmed dead (allowlist "scratch", lines 8-10) |
| 14 | Step 8→9 export plan.json shape accepted by status | CONFIRMED | approve-export.mjs:81-86 carries changes verbatim (fm/acceptance/newNode intact); status.mjs:52 reads `plan.changes`; verify-change defaults `--plan public/plan.json` (line 48) → fixture path must be explicit everywhere (tables do) |
| 15 | Context claims (public/plan.json can't drive the flip; orchestrate's documented gap; red-chain test) | CONFIRMED | only `frame-transform` carries acceptance+fm and no `verdicts` key exists; orchestrate.mjs:21-28 documents the gap; red-chain at loop-e2e.test.mjs:98-135 |
| 16 | Step 1 "one run attests both" | RISK (minor) → recorded | onboard attests the main *working tree*; sandbox is at *HEAD* — identical only when clean (always in CI). Now open-risk #6 |

## Post-approval deliverables (first implementation actions)

1. Materialize this document in the repo as `docs/novakai/plans/m9-design.md` (committed, so a 0-context session can read the design without this plan file), on a feature branch — never on main.
2. Execute the build checklist above.
3. Close the session per protocol §5: `npm run novakai:ship`, then update `docs/novakai/SESSION_HANDOFF.md` command-anchored (every claim = a command: `npm run novakai:loop`, `npm run novakai:mvp`, `node --test tools/novakai/loop-e2e.test.mjs`), then `npm run novakai:handoff:check` green — the clean handover for the next session.

## Critical files

- `tools/novakai/loop-e2e.test.mjs` — host of the M9 chain (the one file extended)
- `docs/novakai/plans/m9-loop.plan.json` — [NEW] fixture plan driving the red→green flip
- `tools/novakai/verify-change.mjs` — the verdict whose FAIL→PASS flip M9 exists to prove
- `tools/novakai/orchestrate.mjs` — worktree mechanism reused; its documented gap is what M9 closes
- `docs/novakai/mvp-roadmap.json` + `package.json` — M9 predicate set + reminder-hook suite fix
