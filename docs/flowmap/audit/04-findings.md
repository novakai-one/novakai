# AUD4 — Findings register

Phase AUD4 (`docs/flowmap/audit/WORK_ORDER.md`). Consolidates every BROKEN / PARTIAL /
UNDETERMINED verdict from `02-attacks.md` (A1–A8) and every coverage finding from `03-tests.md`
(T1–T10, M1–M3) into one deduplicated register. **This is the source of truth for AUD5 fix plans —
one finding per plan.** No fixes here. Status: `npm run flowmap:audit`.

## Severity rubric

- **keystone-bypass** — a load-bearing claimed guarantee (a keystone or the contract spine) is
  defeatable or vacuous today; the thing the loop's trust rests on does not hold as claimed.
- **gap** — real enforcement exists, but a hole, divergence, or missing deny-proof narrows the
  guarantee below its claim.
- **hygiene** — coverage or wiring debt; no live guarantee is broken by it today.

Fix cost: **S** ≤ half a session · **M** ≈ one session · **L** = multi-session or design-first.

---

## Register

> **Most severe first in effect, not in id-order:** F-19 (no branch protection on `main`,
> human-attested) supersedes everything below it in impact — until it is fixed, every
> "CI blocks/enforces" mechanism in this register runs but does not gate. Its fix is one setting.

| id | severity | claim broken | repro | proposed fix | fix cost |
|---|---|---|---|---|---|
| F-01 | keystone-bypass | CLM-037 "makes 'subagents go through the contract' a **100% GATE**, not a convention" — the gate is narrow: sentinel typo (`FLOWMAP_CONTRACT`), absent sentinel, malformed stdin, non-Agent tools all ALLOW; only exact-cased sentinel + unresolvable id DENIES. CLM-038 (fail-open) is accurate; the "100%" is not | `printf '{"tool_name":"Agent","tool_input":{"prompt":"FLOWMAP_CONTRACT: x"}}' \| node tools/flowmap/contract-gate.mjs; echo $?` → 0 (A1) | Detect near-miss sentinels (case/underscore variants) and DENY or warn loudly; deny (not allow) an Agent/Task payload that fails to parse; fix the header to state the true scope. **Must ship with test changes: `contract-gate.test.mjs` currently asserts fail-open as required behavior (T3), and the primary deny branch is masked by the downstream unparseable-output deny (M2a) — test both paths explicitly** | M |
| F-02 | keystone-bypass | CLM-014 F4 "the handoff must be at least as fresh as the last code commit; **CI blocks a merge** that leaves it behind" — freshness is committer-`%ct`-of-touch, never content; dirty-handoff early-exit and same-commit tie both pass (A3); and the `--check` deny path has **zero tests** — disabling it leaves the suite 166/166 (M1 SURVIVED) | `02-attacks.md` A3 (detached-worktree repro) · M1: `03-tests.md` §2 | Content-anchored freshness (extend H5 `checkContentClaims` toward claim-vs-HEAD comparison); drop the dirty early-exit when running in CI; make the tie inclusive; add CLI deny tests that spawn `--check` in a fixture repo and assert exit 1 | M |
| F-03 | keystone-bypass | CLM-011 B2 "understanding becomes **pass/fail**" + CLM-051 "answer key … cannot lie" — the quiz runs in no hook and no CI (`onboard` only prints instructions); answers derive from the same on-disk map the agent is tested on; a committed answers file replays while the map is unchanged. `.quiz-answers.json` is tracked at HEAD and stale (33%) — deleted in Chris's working tree, deletion not yet committed | `grep -rnE 'quiz' .github/ .claude/` → empty (A4) | Emit a quiz-pass artifact bound to the map (seed + score + `_bundle.mmd` hash), verified by a roadmap `cmd` predicate or CI step; untrack + gitignore `.quiz-answers.json` (finish the working-tree deletion deliberately) | M |
| F-04 | keystone-bypass | CLM-006/053 "Roadmap status is computed … recomputed every run, so it **cannot lie**" — a 0-byte file satisfies a `file` predicate, a lone grep token satisfies a `grep` predicate, status never exits non-zero (A5); and `roadmap.mjs` — the status computer, the `roadmap:audit` CI gate, and this audit's own predicate runner — has **no test**: hard-wiring `file`→true leaves the suite 166/166 (M3 SURVIVED, T2) | `03-tests.md` §2 M3 (ghost roadmap reads BUILT) · `grep -rn "roadmap.mjs" tools/flowmap/*.test.mjs tools/buildspec/*.test.mjs` → empty | Author `roadmap.test.mjs` with deny fixtures (missing file, hollow file, failing cmd, audit-doc corpus); strengthen predicates where hollowness matters (min-content grep counts, `cmd` checks) — the audit phases' own predicates first | S–M |
| F-05 | gap | CLM-005/007 the status-marker ban — false-negative on any phrasing beyond the two literal regexes (`\| done ✅ \|`, "Status — shipped", inline `state: built` all pass), false-positive on a doc that *quotes* the pattern, and scoped to `CLAUDE.md` only | `02-attacks.md` A6 | Broaden the banned-phrasing set; exempt quoted/code-fenced context; scope the CI step to `docs/**` with an allowlist; cover with the F-04 test file | S |
| F-06 | gap | CLM-012/070 "CI enforces the whole loop" / ship's DONE banner — the CI and local gate chains diverge both directions: `handoff:check`, `cert`, `plan-check`, `roadmap:audit`, `acceptance` run in CI only (a dev running `flowmap:ship` never exercises them); `slice-core`, both `flowmap-lint` tests run locally only | `02-attacks.md` A7 (per-script grep loop) | Define one canonical gate list consumed by both `flowmap:verify` and `spec-gate.yml` (or minimally: append the five CI-only steps to a `flowmap:verify:full` and add the local-only tests to CI) | S |
| F-07 | gap | CLM-012 — `spec-gate.yml` path triggers exclude `.claude/**` (the hooks!), `public/plan.json` (the exact file cert/plan-check/acceptance target!), `.quiz-answers.json`, root configs: commits touching only those never run the gate | `sed -n '/on:/,/jobs:/p' .github/workflows/spec-gate.yml` (A7) | Add the missing paths to the trigger filter (or drop the filter and pay the CI minutes) | S |
| F-08 | gap | CLM-016/055/071 Phase I "proven by flowmap:tooling:verify … One unmapped module = exit 1" — the whole tooling-map chain runs in **no CI job**, and its deny path is never exercised even locally: `tooling-map.test.mjs` is ALLOW-only (T5), so a mutation disabling `tooling-coverage`'s failure would pass everything | `grep -c tooling .github/workflows/spec-gate.yml` → 0 · `03-tests.md` matrix row | Add `flowmap:tooling:verify` (or `tooling-map.test.mjs`) to `spec-gate.yml`; add an unmapped-module/dangling-`%% src` fixture asserting exit 1 | S |
| F-09 | gap | CLM-045/013 the Stop-hook nudge fires only on clean Stop — sessions that crash mid-operation (two zero-byte `.git/index.lock.*` artifacts prove it happens here) never get the freshness nudge (A8) | `ls -la .git/index.lock.bak .git/index.lock.old2` | Surface staleness at the *next* SessionStart instead of only at Stop: have `onboard` also run the handoff-fresh nudge (start-of-session is crash-proof; F4 CI remains the hard backstop) | S |
| F-10 | gap | CLM-033/043/050 + F4 — five gate CLIs are mutation-blind: their tests import internals and never spawn the binary (`gate.mjs` — spawned by zero tests, `plan-check`, `plan-cert`, `flowmap-lint`, `handoff-fresh`), so each script's argv/exit wiring is unverified (T4) | `grep -L spawnSync tools/flowmap/plan-check.test.mjs tools/flowmap/plan-cert.test.mjs tools/flowmap/flowmap-lint.test.mjs tools/flowmap/handoff-fresh.test.mjs` → all four listed | One thin spawn-test per gate: bad input → assert documented non-zero exit; good input → 0 | S |
| F-11 | gap | CLM-040/042/057 the A1 completeness pair + validate — `coverage.mjs`, `exports-coverage.mjs`, `validate.mjs`, `bundle.mjs` have **no test**; their "exit 1" deny claims are proven only by running on good data in CI (T6) | `grep -rn "coverage.mjs\|exports-coverage\|validate.mjs" tools/**/*.test.mjs` → only tooling-map happy-path | Deny fixtures: an uncovered file → 1; a hidden export → 1; a grammar error → 1 | S |
| F-12 | gap | CLM E1 (approve-export) — the approval-artifact emitter is ALLOW-only: no test asserts any rejection or non-zero exit; rejected-change filtering is asserted only as positive output shape (T7) | `03-tests.md` matrix row (test L132, L168) | Add rejection-path tests: unreadable plan / missing verdicts / all-rejected → asserted non-zero or explicit empty artifact | S |
| F-13 | gap | CLM-015 F5 "proving the loop executes" — `loop-e2e` is a pure happy-path spine; no stage is ever fed bad input, so it proves the loop *runs*, never that it *stops* (T8) | `03-tests.md` matrix row | Add one red chain: an incoherent fixture plan must fail at plan-check and the chain must not proceed | S |
| F-14 | gap | CLM-048 H4 — `orchestrate.test.mjs`'s only blocking check (exit 1 iff FAIL) is data-dependent on the live `public/plan.json` state, not a controlled fixture | `03-tests.md` matrix row (test L50–53) | Add a fixture plan with a guaranteed-FAIL change; assert exit 1 unconditionally | S |
| F-15 | gap | CLM-009 A3 "parsers **provably** agree" — the app-parser half of conformance silently `test.skip`s when the strip-types subprocess is unavailable, so conformance can vacuously pass green | `grep -n "test.skip\|APP_AVAILABLE" tools/buildspec/parser-conformance.test.mjs` | In CI, treat unavailable-app-parser as FAIL, not skip (env flag: strict in CI, lenient locally) | S |
| F-16 | hygiene | (suite intent) — `diff.test.mjs`, `diff-views.test.mjs`, `diff-roundtrip.test.mjs` exist but are wired into neither `spec:test:all` nor CI: they never run (T9) | `grep -c "diff.test\|diff-views.test\|diff-roundtrip.test" package.json .github/workflows/spec-gate.yml` → 0 for all | Wire them into `spec:test:all` + CI (they passed when authored), or delete deliberately | S |
| F-17 | hygiene | CLM-047/054 — `onboard.mjs` (the B1 door, "exit 0 = trustworthy, 1 = NOT") has no test; `status.mjs` (C1) has only the thin happy-path check in loop-e2e (T10) | `grep -rn "onboard" tools/**/*.test.mjs` → empty | Smoke tests: onboard exit 1 on a doctored-stale fixture map; status verdict classes (built/pending/drifted) on a fixture plan | S–M |
| F-18 | hygiene | CLM-059 — `waves.mjs` reports dependency cycles as data but always exits 0; a caller reading only the exit code proceeds on a cyclic plan | `03-tests.md` matrix row (test L80–85) | Document exit-0-by-design prominently, or add `--strict` (non-zero on any cycle) to match the verify-change precedent | S |
| F-19 | **keystone-bypass** (CONFIRMED by human attestation) | CLM-012 "E4 — CI enforces the whole loop" and with it the entire CI-triggered gate family (the ~32 A7-family GATE ids in `01-claims.md`): **`main` has no branch protection**, so no CI job is a required check — every "CI blocks" claim in this register is today advisory-only, and a red `spec-gate` does not stop a merge. Attested verbatim by Chris (2026-07-02): *"A7 = no branch protection"* | attestation above; machine re-verify post-fix: `gh api repos/novakai-one/flowmap/branches/main/protection` → must list `buildspec-tests` + `flowmap-drift` as required status checks | One setting (per Chris): protect `main`, require **`buildspec-tests` + `flowmap-drift`** as required status checks. Owner: Chris (repo admin). Post-fix, re-run the A7 repro and record the JSON in the fix log | S (one setting) |

---

## Coverage map (consolidation is complete, not sampled)

Every AUD2 verdict and AUD3 finding lands in exactly one register row:

| source | → finding |
|---|---|
| A1 (contract-gate fail-open) · T3 · M2a/M2b | F-01 |
| A2 (CI coverage) | HELD — no finding |
| A3 (handoff freshness) · T1 · M1 | F-02 |
| A4 (quiz) · T10-quiz | F-03 |
| A5 (hollow predicates) · T2 · M3 | F-04 |
| A6 (audit-doc ban) | F-05 |
| A7 (CI/local divergence · path triggers · tooling-CI · branch protection) | F-06 · F-07 · F-08 · F-19 |
| A8 (hook surface / crash-skip) | F-09 |
| T4 (mutation-blind CLIs) | F-10 |
| T6 (completeness pair untested) | F-11 |
| T7 (approve-export) | F-12 |
| T8 (loop-e2e) | F-13 |
| matrix row (orchestrate data-dependent) | F-14 |
| matrix row (conformance silent-skip) | F-15 |
| T9 (orphaned tests) | F-16 |
| T10-onboard/status | F-17 |
| matrix row (waves exit-0) | F-18 |

## AUD5 ordering (recommendation, per work order: one finding per plan)

1. **F-19 first** (Chris, one setting: protect `main`, require `buildspec-tests` + `flowmap-drift`) —
   it restores teeth to every CI-family mechanism at once; verify with the `gh api` repro after.
2. Keystone-bypass wave: **F-01, F-02, F-03, F-04** — each is one plan + one test that fails pre-fix.
   F-04 first among them: it repairs the instrument (`roadmap.mjs`) that every other phase's status —
   including AUD5's own — is measured with.
3. Gap wave, cheap-and-mechanical: F-05…F-15 (mostly S; several are pure test-authoring where the
   AUD3-missing deny test IS the fix's failing-pre-fix test).
4. Hygiene: F-16, F-17, F-18.

Per the work order: convert AUD5's `manual` check in `docs/flowmap/audit/audit-roadmap.json` to
`cmd` checks as each fix plan is authored, so AUD5's status is computed, not declared.
