# AUD1 — Claim classification

Phase AUD1 (`docs/novakai/audit/WORK_ORDER.md`). Classify every `CLM-*` from `00-inventory.md` as
**GATE**, **CONVENTION**, or **PROSE**. Per GATE: exact trigger + bypass surface. No fixes. Status:
`npm run novakai:audit`.

## Classification rules

- **GATE** — machine-blocked on a path something actually runs: a hook denies, a CI step exits
  non-zero, or a required command fails the build. Recorded with its trigger and its bypass surface.
- **CONVENTION** — a working script exists and can exit non-zero, but *nothing forces it to run*
  (not in CI, not in a hook). Protocol may say "run it"; only discipline backstops it.
- **PROSE** — words with no executable mechanism.

Trigger evidence (verified this phase, commands in Method):
- CI = `.github/workflows/spec-gate.yml` jobs `buildspec-tests` + `novakai-drift`.
- Hooks = `.claude/settings.json`: PreToolUse(`Agent|Task`)→contract-gate; SessionStart(`startup|resume`)→onboard; Stop→handoff-fresh(bare).
- **Not in CI or any hook:** the quiz, `frag-check`, `status`, `trust-report`, and the entire
  tooling-map chain (`novakai:tooling:*`, `tooling-coverage`, `tooling-map.test`). `deploy.yml` runs
  no novakai gates.

## Method (reproducible)

```
grep -nE "node --test|npm run" .github/workflows/spec-gate.yml     # the exact CI step list
grep -rnE "quiz|frag-check|tooling|novakai:status|novakai:trust|novakai:onboard" .github/ .claude/
node -e "console.log(require('./package.json').scripts['spec:test'])"   # = pipeline.test only
# cross-check: every CLM id classified exactly once
for n in $(grep -oE 'CLM-[0-9]+' docs/novakai/audit/00-inventory.md | sort -u); do \
  c=$(grep -c "\b$n\b" docs/novakai/audit/01-claims.md); echo "$n $c"; done
```

---

## Register

| id | class | trigger (if GATE) | bypass surface (if GATE) |
|---|---|---|---|
| CLM-001 | PROSE | — | thesis; no mechanism |
| CLM-002 | PROSE | — | "100% confidence"; no mechanism |
| CLM-003 | GATE | CI `novakai:gate` (novakai-drift job) | ts-morph `allowJs:false` → `.mjs` tooling ungated; 1 known prose type hole; only fires on trigger paths |
| CLM-004 | GATE | CI `novakai:acceptance -- --plan public/plan.json` | acceptance only covers PURE exported fns; ctx/DOM code needs factor-to-pure (E2 gap); scoped to `public/plan.json` |
| CLM-005 | GATE | CI `novakai:roadmap:audit` | only lints `CLAUDE.md`; narrow 2-regex pattern (see CLM-007) |
| CLM-006 | CONVENTION | — | `roadmap.mjs` exits 0 for ALL status outcomes; missing/partial never fails CI. Computation runs but does not block |
| CLM-007 | GATE | CI `novakai:roadmap:audit` (exit 1) | matches only `**State:**` / `state: ❌⚠️✅…`; any other status phrasing (table cell, HTML, "shipped") evades; only `CLAUDE.md` |
| CLM-008 | GATE | CI `novakai:gate` | as CLM-003 |
| CLM-009 | GATE | CI `spec:conformance` (parser-conformance.test) | corpus-bounded — agreement only on cases in the corpus |
| CLM-010 | GATE | CI `novakai:edges` (`edge-verify --strict`) | 4 advisory `ctx.hooks` edges are audited, not proven; allowlist is the trust boundary |
| CLM-011 | CONVENTION | — | quiz in NO hook/CI; `onboard` only prints instructions; passage never enforced. Replayable (see AUD2) |
| CLM-012 | GATE | CI `spec-gate.yml` (both jobs) | `deploy.yml` runs 0 gates; path-trigger gaps (`.claude/**`, `public/plan.json`); branch-protection unknown |
| CLM-013 | GATE | SessionStart hook `novakai:onboard` | harness-dependent; matcher only `startup\|resume`; no headless/subagent scoping; exit-1 handling is the harness's |
| CLM-014 | GATE | CI `novakai:handoff:check` | dirty-handoff early exit 0; freshness = committer `%ct` (settable); strict `>` so same-commit tie passes; git error → exit 0 |
| CLM-015 | GATE | CI `loop-e2e.test` | tests the chain on a fixture/`public/plan.json`, not arbitrary plans |
| CLM-016 | CONVENTION | — | `novakai:tooling:verify` + `tooling-map.test` in NEITHER CI nor hooks — local-only |
| CLM-017 | CONVENTION | — | "every claim is a command" not machine-checked; H5 `checkContentClaims` covers one narrow direction only |
| CLM-018 | GATE | CI `novakai:lint` | warnings never fail; heuristic thresholds; scoped to `_bundle.mmd` |
| CLM-019 | CONVENTION | — | "0-context agent confirms" is a manual protocol step, not machine-enforced |
| CLM-020 | CONVENTION | — | `status.mjs` in no CI/hook; advisory |
| CLM-021 | PROSE | — | protocol rule; no mechanism |
| CLM-022 | PROSE | — | invariant printed by onboard; "modules never import each other" not directly gated |
| CLM-030 | GATE | CI `novakai:acceptance` / `acceptance.test` | pure-fn only (as CLM-004) |
| CLM-031 | GATE | CI `novakai:gate` (extract feeds gate) | as CLM-003 |
| CLM-032 | GATE | CI `spec:test` (`pipeline.test`) | test-bounded |
| CLM-033 | GATE | CI `novakai:gate` | as CLM-003 |
| CLM-034 | GATE | CI `novakai:cert` (apply→stubs→tsc→gate) + `build` tsc | cert scoped to `public/plan.json`; tsc-noEmit in `build` not in `spec-gate` |
| CLM-035 | GATE | CI `normtype.test` | normalizer-bounded; 1 prose type hole remains |
| CLM-036 | GATE | CI `novakai:lint` | as CLM-018 (claim is about `--init` output failing lint) |
| CLM-037 | GATE | PreToolUse hook (contract-gate, DENY exit 2) | ONLY denies sentinel-present-but-unresolvable; see CLM-038 |
| CLM-038 | GATE(scope-limit) | — (documents CLM-037's bypass) | fail-open: malformed stdin, sentinel typo `NOVAKAI_CONTRACT`, sentinel absent, non-Agent tools, main-agent Edit/Write — all ALLOW |
| CLM-039 | GATE | CI `contract.test` + `replay.test` | determinism proven for the packet emitter, not the change interior |
| CLM-040 | GATE | CI `novakai:coverage` | file-level; a symbol inside a covered file isn't file-gated (that's CLM-042) |
| CLM-041 | GATE | CI `novakai:edges` | as CLM-010 |
| CLM-042 | GATE | CI `novakai:exports` | top-level exports only; API-surface members not symbol-gated (known A1 gap) |
| CLM-043 | GATE | CI `novakai:lint` | as CLM-018 |
| CLM-044 | CONVENTION | — | `frag-check` in NO CI/hook; invoked manually by fragment-authoring subagents |
| CLM-045 | CONVENTION | — | bare `handoff-fresh` (Stop hook) always exits 0 — self-declared nudge, not a gate |
| CLM-046 | GATE | CI `canonical.test` + `replay.test` | replay proves determinism only for tasks it is pointed at |
| CLM-047 | GATE | SessionStart hook `novakai:onboard` (exit 1) | runs `novakai:verify`; harness decides whether exit 1 blocks; see CLM-013 |
| CLM-048 | CONVENTION | — | `orchestrate.test` IS in CI (tool behavior tested), but running the orchestrator is not forced |
| CLM-049 | GATE | CI `novakai:cert -- --plan public/plan.json` | scoped to that one plan; `PASS_UNPROVEN`-style shape passes cert |
| CLM-050 | GATE | CI `novakai:plan-check -- --plan public/plan.json` | scoped to that one plan |
| CLM-051 | CONVENTION | — | key-recompute is real, but quiz is unenforced (as CLM-011); `.quiz-answers.json` (the answers, not the key) persists and is replayable |
| CLM-052 | GATE | CI `replay.test` | leak-detector catches nondeterminism of the pointed task only |
| CLM-053 | GATE(audit)/CONVENTION(status) | CI `novakai:roadmap:audit` | audit half = CLM-007 bypass; status half = CLM-006 (never blocks) |
| CLM-054 | CONVENTION | — | `status.mjs` unenforced; advisory |
| CLM-055 | CONVENTION | — | `tooling-coverage` local-only (not in CI/hooks) |
| CLM-056 | CONVENTION | — | `trust-report` self-declared "never a gate"; exit 0 always |
| CLM-057 | GATE | CI `novakai:validate` | grammar/structure only |
| CLM-058 | GATE | CI `verify-change.test` | `PASS_UNPROVEN` exits 0 like PASS — strict caller must read JSON `verdict`, not exit code (CLM-078) |
| CLM-059 | GATE | CI `waves.test` | scheduler behavior tested; running waves not forced |
| CLM-070 | CONVENTION | — | `novakai:ship` local-only; its 7 constituent gates ARE separately GATE in CI (CLM-003/010/018/040/042/057 + bundle-freshness CLM-072). The banner is an echo |
| CLM-071 | CONVENTION | — | `novakai:tooling:verify` local-only |
| CLM-072 | GATE | CI `git diff --exit-code _bundle.mmd` (novakai-drift) | exists ONLY in CI; no local gate fails on a stale committed bundle |
| CLM-073 | GATE | CI `novakai:cert` | as CLM-049 |
| CLM-074 | GATE | CI `replay.test` | as CLM-052 |
| CLM-075 | GATE | PreToolUse hook | as CLM-037/038 |
| CLM-076 | CONVENTION | — | quiz-fail message only prints if the quiz is run; nothing runs it |
| CLM-077 | GATE | CI (each tool's `.test`) | input-validation exit 2 is tested per tool; not all bad-input shapes covered |
| CLM-078 | GATE | CI `verify-change.test` | non-strict default: `PASS_UNPROVEN` exits 0 — the over-trust surface `--strict` closes only when callers opt in |

---

## Roll-up

- **GATE:** 39 (CLM-003,004,005,007,008,009,010,012,013,014,015,018,030,031,032,033,034,035,036,037,038,039,040,041,042,043,046,047,049,050,052,057,058,059,072,073,074,075,077,078)
- **CONVENTION:** 16 (CLM-006,011,016,017,019,020,044,045,048,051,054,055,056,070,071,076) + the status-half of CLM-053
- **PROSE:** 5 (CLM-001,002,021,022) + thesis-level phrasing in others

(Counts include the dual-class CLM-053 in both GATE and CONVENTION.)

## Claims whose LANGUAGE overstates their class (→ AUD2 priority targets, not fixes here)

1. **CLM-037 "a 100% GATE, not a convention"** vs **CLM-038 "It FAILS OPEN"** — the same header
   both asserts totality and discloses that any fault, typo, or non-Agent path allows. The "100%"
   is the overstatement; the real gate is narrow.
2. **CLM-011 / CLM-051 "understanding becomes pass/fail" / "cannot lie"** — the quiz runs in
   nothing; a persisted `.quiz-answers.json` makes 100% replayable. Enforcement language, CONVENTION
   reality.
3. **CLM-016 / CLM-055 / CLM-071 tooling-map "proven … One unmapped module = exit 1"** — true of
   the script, but it runs in neither CI nor a hook; the "proof" is never forced.
4. **CLM-014 "CI blocks a merge that leaves it behind"** — real CI step, but the dirty-handoff
   early-exit and timestamp-only freshness make "blocks" defeatable; also depends on branch
   protection being enabled (unverified).
5. **CLM-006 / CLM-053 "recomputed every run, so it cannot lie" (status)** — status never fails
   CI; hollow file/grep predicates can read BUILT. The anti-drift *ban* (audit-doc) is a real gate,
   but the *status* computation is advisory.
6. **CLM-070 ship banner "in sync with code … edges code-backed"** — accurate about the gates it
   chains, but `novakai:ship` is local-only; the guarantee lives in CI's separate steps, not the
   banner.
