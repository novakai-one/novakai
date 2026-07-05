# AUD3 — Test-suite deny-path audit + mutation spot-check

Phase AUD3 (`docs/novakai/audit/WORK_ORDER.md`). Per gate script: does its test exercise the
**DENY path** (the gate blocking bad input) or only ALLOW? Then a 3-predicate mutation spot-check
against `npm run spec:test:all`. **No fixes** — findings feed AUD4/AUD5. Status: `npm run novakai:audit`.

## Method + safety

- Every test file in `tools/**/*.test.mjs` was read in full and classified per gate script:
  **DENY-covered** (a test asserts the blocking outcome — non-zero exit / deny JSON / FAIL result —
  cited by test name + line) / **ALLOW-only** / **NO-TEST**. Invocation mode recorded, because a
  test that imports internals instead of spawning the real CLI cannot catch a mutation in the
  script's argv/exit wiring.
- "in CI?" is read from `.github/workflows/spec-gate.yml` (jobs `buildspec-tests` + `novakai-drift`);
  "in suite?" from `package.json` `spec:test:all`. repro: `grep -n "node --test\|npm run" .github/workflows/spec-gate.yml` ·
  `node -e "console.log(require('./package.json').scripts['spec:test:all'])"`.
- Mutations ran in the MAIN tree, one at a time, each under the protocol: `git status --short`
  clean-baseline → single-file edit → `git diff` recorded → `npm run spec:test:all` → verdict
  recorded verbatim → `git checkout -- <file>` → baseline re-confirmed. No commits of mutated
  state, no pushes, no fixes. Post-revert: suite 166/166 green (see close-out).
- Session baseline note: the working tree carried one pre-existing entry throughout
  (` D .quiz-answers.json` — deleted in the working tree, still tracked at HEAD; not this
  session's doing, left untouched). Every mutation reverted back to exactly that baseline.

---

## 1. Deny-coverage matrix (every GATE mechanism from `01-claims.md`)

Legend — invocation: **CLI** = spawns the real script as a subprocess and asserts exit codes
(catches wiring mutations); **fn** = imports exported functions (blind to CLI/exit wiring);
suite = `spec:test:all`; CI = `spec-gate.yml`.

| gate script | test file | invocation | deny coverage | suite | CI |
|---|---|---|---|---|---|
| `contract-gate.mjs` (G4 hook) | `contract-gate.test.mjs` | CLI | **DENY-covered** — `DENY: sentinel with an unresolvable contract id (exit 2)` asserts `r.status===2` + `/"decision":"deny"/` (test L32–35). **AND fail-open is locked in as intended behavior**: malformed stdin→0 (L38–40), missing prompt→0 (L48–50), no sentinel→0 (L22–24) are asserted as *required* outcomes — tightening the gate turns these tests red | ✓ | ✓ |
| `handoff-fresh.mjs` (F4) | `handoff-fresh.test.mjs` | fn only (`checkContentClaims`) | **freshness deny UNTESTED** — no test spawns `--check` or asserts exit 1 on a stale handoff; only the H5 content-claims sub-check is covered (violation L11–16, L40–47; no-violation L23–34, L51–58). The "5/5 incl. deny" the handoff claimed is content-claims deny, never the staleness deny | ✓ | ✓ |
| `edge-verify.mjs` (A5) | `edge-verify.test.mjs` | mixed (CLI for strict) | **DENY-covered** — `--strict` exit 1 on unaccounted edge via real CLI (L41–46) + lib fail-closed without allowlist (L33–38) | ✓ | ✓ |
| `contract.mjs` (G1) | `contract.test.mjs` | CLI | **DENY-covered** — missing change id → exit 3 (L50–52); no `--change` → exit 2 (L55–57) | ✓ | ✓ |
| `verify-change.mjs` (G2/H3) | `verify-change.test.mjs` | CLI | **DENY-covered** — pending → FAIL exit 1 (L43–49); missing id → exit 3 (L66–69); `--strict` PASS_UNPROVEN → exit 1 (L71–76) | ✓ | ✓ |
| `replay.mjs` (G3) | `replay.test.mjs` | CLI | **DENY-covered** — non-deterministic task → exit 1 (L29–42); usage error → exit 2 (L51–54) | ✓ | ✓ |
| `plan-check.mjs` (C3) | `plan-check.test.mjs` | fn only (`checkPlan`) | deny **logic** covered — broadest of all: REAL-IDS ×3, DANGLING-DEP, ACYCLIC ×2, COHERENT-ACCEPTED ×2, PARENT-EXISTS asserted as emitted problems (L41–208). CLI wrapper / exit code untested | ✓ | ✓ |
| `plan-cert.mjs` (C2) | `plan-cert.test.mjs` | fn only (`certifyPlan`) | deny **logic** covered — uncompilable signature → `certified:false` (L51–63). CLI wrapper / exit code untested | ✓ | ✓ |
| `gate.mjs` (A2/signature gate) | `pipeline.test.mjs` (via `diffSkeletons` import) | fn only | deny **logic** covered — 9 drift classes each asserted (L79–98) + signature-change-fails round-trip (L115). **`gate.mjs` itself (argv/exit 1) is spawned by zero tests** | ✓ | ✓ |
| `extract.mjs` | `pipeline.test.mjs` | fn | ALLOW-only (correct graph, private exclusion) | ✓ | ✓ |
| `validate.mjs` | none dedicated (`tooling-map.test` runs it on the good map only) | CLI (happy) | **no deny test** — no grammar-error → non-zero fixture anywhere | (✓) | ✓ (runs on real map) |
| `bundle.mjs` | `tooling-map.test.mjs` (determinism/freshness, happy) | CLI (happy) | no deny test | (✓) | ✓ (runs) |
| `coverage.mjs` (A1 file) | **NO-TEST** | — | no missing-file → FAIL fixture anywhere | — | ✓ (runs) |
| `exports-coverage.mjs` (A1 symbol) | **NO-TEST** | — | no hidden-export → FAIL fixture anywhere | — | ✓ (runs) |
| `novakai-lint.mjs` | `novakai-lint.test.mjs` + `.discriminate.test.mjs` | fn (`lint`), exit mapping reimplemented in the test | deny covered at logic level — FLAT (T2 L45–50), LOOSE-BAG (T4 L69–83), rejected file-mirror fixture (discriminate L21) | ✓ | **✗ tests not in CI** (CI runs the CLI on the real map) |
| `tooling-coverage.mjs` (I1) | `tooling-map.test.mjs` | CLI | **ALLOW-only** — the promised "unmapped module / unresolvable %% src → exit 1" is never exercised; all 5 tests assert pass on the real good map | ✓ | **✗ not in CI at all** |
| `acceptance.mjs` (E2/H1) | `acceptance.test.mjs` | fn | **DENY-covered** — wrong expectation RED (L44–51), unimplemented symbol RED (L54–57), wrong slice RED (L91–98), no lens RED (L101–107) | ✓ | ✓ (+ real plan) |
| `approve-export.mjs` (E1) | `approve-export.test.mjs` | mixed | **ALLOW-only** — no test asserts any rejection/non-zero; rejected-change filtering is asserted as positive output shape only (L132, L168) | ✓ | ✓ |
| `waves.mjs` (G5) | `waves.test.mjs` | CLI | cycle detection covered as **data** (cyclic array + exclusion, L82–85) — never a non-zero exit (script always exits 0 by design) | ✓ | ✓ |
| `orchestrate.mjs` (H4) | `orchestrate.test.mjs` | CLI | exit-1-iff-FAIL asserted but **data-dependent** on the live `public/plan.json` state (L50–53); no controlled bad-plan fixture forcing a block | ✓ | ✓ |
| loop chain (F5) | `loop-e2e.test.mjs` | CLI ×6 | **ALLOW-only** — pure happy-path spine; no stage fed bad input (exit-3 tolerance at L67 is a normal state, not a deny) | ✓ | ✓ |
| two-parser conformance (A3) | `parser-conformance.test.mjs` | fn + subprocess | agreement-equality only; divergence detection implicit in `deepEqual`, no adversarial negative fixture; skips silently if app parser unavailable (L324) | ✓ | ✓ |
| `scaffold.mjs --add-from-plan` (E3) | `writeback.test.mjs` (fn) + `loop-e2e` `--dry` | fn | ALLOW-only (append, idempotence, skip-non-add as exclusion) | ✓ | ✓ |
| `normtype` (A6, in `skeleton.mjs`) | `normtype.test.mjs` | fn | prose-rejection covered — 3 tests assert `normType(...)===null` (L34, L186, L191) | ✓ | ✓ |
| **`roadmap.mjs`** — incl. `--audit-doc`, a CI gate (CLM-005/007) and the runner of THIS audit's predicates | **NO-TEST** | — | zero test files import or spawn it; the status computation, the file/grep/cmd predicates, and the audit-doc ban are all unasserted anywhere | — | ✓ (runs `roadmap:audit`) |
| `quiz.mjs` (Keystone 1) | **NO-TEST** | — | key-recompute, scoring, exit-1-on-fail: unasserted | — | — |
| `onboard.mjs` (B1) | **NO-TEST** | — | exit-1-on-stale-map claim unasserted | — | — |
| `status.mjs` (C1) | `loop-e2e.test.mjs` L66–68 only | CLI | thin — exit ∈ {0,3} + `/pending|built/i` on the happy chain | (✓) | (✓) |
| `trust-report.mjs` | **NO-TEST** (self-declared never-a-gate) | — | — | — | — |
| CI-inline bundle-freshness (`git diff --exit-code`) | not a script | — | CI-only step; locally untestable, no local equivalent gate | — | ✓ |

Orphaned test files (exist, but wired into **neither** `spec:test:all` **nor** CI — they run never):
`tools/buildspec/diff.test.mjs`, `diff-views.test.mjs`, `diff-roundtrip.test.mjs`.
repro: `grep -c "diff.test\|diff-views.test\|diff-roundtrip.test" package.json .github/workflows/spec-gate.yml` → 0 hits for all three.

Matrix repro (any row): the cited test name + line is in the named `.test.mjs`; e.g.
`grep -n "DENY: sentinel" tools/novakai/contract-gate.test.mjs` ·
`grep -n "spawnSync\|execFileSync\|from './" tools/novakai/handoff-fresh.test.mjs` (shows fn-only import, no CLI spawn) ·
`grep -rn "roadmap.mjs" tools/**/*.test.mjs` → empty.

---

## 2. Mutation spot-check (3 predicates, per work order)

Protocol per entry: clean baseline → single-file mutation → `npm run spec:test:all` → revert → baseline re-confirmed.

### M1 — handoff-fresh.mjs: staleness deny neutralized — **SURVIVED**

mutation: `tools/novakai/handoff-fresh.mjs:146` `if (codeTs > handoffTs)` → `if (false && codeTs > handoffTs)` (the F4 freshness gate can never fire).
repro:
```
sed -i '' 's/if (codeTs > handoffTs)/if (false \&\& codeTs > handoffTs)/' tools/novakai/handoff-fresh.mjs
npm run spec:test:all            # observed: tests 166 · pass 166 · fail 0
npm run novakai:handoff:check; echo $?   # observed: "✓ handoff is at least as fresh…" · 0 (vacuous gate)
git checkout -- tools/novakai/handoff-fresh.mjs
```
observed: **166/166 green** with the F4 deny dead; the mutated gate passes everything unconditionally.
verdict: **SURVIVED** — consistent with the matrix (no test exercises `--check`); the suite cannot
detect a disabled F4 gate. Pairs with A3 (the same gate is also gameable when alive).

### M2 — contract-gate.mjs: deny disabled — two variants

**M2a (branch disable) — masked mutant, suite green *correctly*.**
mutation: `tools/novakai/contract-gate.mjs:75` `if (r.status !== 0)` → `if (false && r.status !== 0)`.
repro:
```
printf '{"tool_name":"Agent","tool_input":{"prompt":"NOVAKAI-CONTRACT: no-such-change"}}' | node tools/novakai/contract-gate.mjs; echo $?
```
observed: suite 166/166 — but the repro still exits **2** with `{"decision":"deny","reason":"contract for \"no-such-change\" produced unparseable output"}`:
the downstream `JSON.parse(r.stdout)` catch (L82) compensates, so external behavior is preserved.
verdict: not a suite failure — evidence of **redundant deny paths** in the gate (the primary deny
branch is individually dead-code-able without behavior change).

**M2b (deny() → allow, fully fail-open gate) — CAUGHT.**
mutation: `deny(reason)` body (L40–44) → `process.exit(0)`.
repro: apply, then `node --test tools/novakai/contract-gate.test.mjs`.
observed: suite **165/166, fail 1** — `✖ DENY: sentinel with an unresolvable contract id (exit 2)`.
verdict: **CAUGHT** — the one deny path the gate has is genuinely locked by its test (matches A1:
narrow deny HELD).

### M3 — roadmap.mjs: `file` predicate hard-wired true — **SURVIVED**

mutation: `tools/novakai/roadmap.mjs:67` `pass: existsSync(resolve(c.path))` → `pass: true`.
repro:
```
printf '{"items":[{"id":"X1","phase":"X","title":"ghost doc","checks":[{"kind":"file","path":"docs/DOES-NOT-EXIST.md"}]}]}' > /tmp/ghost-roadmap.json
node tools/novakai/roadmap.mjs --roadmap /tmp/ghost-roadmap.json; echo $?
```
observed: **166/166 green**; the ghost roadmap reports `✓ [BUILT] X1 — ghost doc (1/1)` · exit 0 —
a nonexistent file reads BUILT and nothing in the repo can notice.
verdict: **SURVIVED** — consistent with the matrix (`roadmap.mjs` has no test at all). This is the
script that computes the roadmap in `CLAUDE.md`'s "run the command, don't trust prose" rule, the
`novakai:roadmap:audit` CI step, **and this audit's own phase status** (`novakai:audit`).

**Mutation score: 1 caught / 3 primary mutations** (M2b caught; M1, M3 survived; M2a masked).

---

## 3. Summary → feeds AUD4

| # | finding | pairs with (AUD2) |
|---|---|---|
| T1 | F4 staleness deny has zero test coverage; a dead F4 gate is invisible to the suite (M1 SURVIVED) | A3 |
| T2 | `roadmap.mjs` — the status computer + `--audit-doc` CI gate + this audit's own predicate runner — has NO test; a vacuous `file` predicate is invisible (M3 SURVIVED) | A5, A6 |
| T3 | `contract-gate.test.mjs` **locks in fail-open as intended**: any AUD5 fix that tightens malformed/missing-input handling must also change the tests that currently require exit 0 | A1 |
| T4 | fn-only tests (plan-check, plan-cert, gate.mjs drift logic, novakai-lint, handoff-fresh) never spawn their CLIs — argv/exit wiring of five gates is mutation-blind | — |
| T5 | `tooling-coverage` deny path never exercised + whole tooling-map chain absent from CI | A7 (CLM-016) |
| T6 | A1 completeness pair `coverage.mjs` / `exports-coverage.mjs`: NO-TEST (deny proven only by running on good data in CI) | — |
| T7 | E1 `approve-export`: ALLOW-only — the approval artifact emitter has no rejection/error assertion | — |
| T8 | F5 `loop-e2e`: ALLOW-only happy spine — proves the loop runs, never that it stops | — |
| T9 | Orphaned test files: `diff.test.mjs`, `diff-views.test.mjs`, `diff-roundtrip.test.mjs` run in neither suite nor CI | — |
| T10 | `quiz.mjs` / `onboard.mjs`: NO-TEST (the two session-protocol entry gates) | A4, A8 |

Strong rows for the record: `edge-verify`, `contract`, `verify-change`, `replay`, `acceptance`,
`normtype`, `plan-check` (logic), `pipeline` drift classes — real deny fixtures, most via real CLI.
The suite's teeth are concentrated in the Phase-G spine; the meta-loop gates (F4, roadmap, quiz,
onboard) are where deny coverage is thinnest — the same place AUD2 found the live bypasses.
