# AUD2 — Adversarial pressure test

Phase AUD2 (`docs/novakai/audit/WORK_ORDER.md`). Attempt to break every GATE from `01-claims.md`.
Each entry: attack · `repro:` · observed result · verdict (HELD / BROKEN / PARTIAL / UNDETERMINED).
**No fixes** — findings feed AUD4/AUD5. Status: `npm run novakai:audit`.

## Method + safety

- **Execution mode = hybrid by cost** (decided at plan time): every cheap local repro was EXECUTED
  and its verbatim output pasted; harness/remote attacks (hook firing across session types, branch
  protection) are documented with the repro and labelled `[config-read]` / `[not-executed]` + why.
- All git-mutating attacks ran in a **throwaway detached worktree**
  (`git worktree add --detach <scratch> HEAD`), removed after (`git worktree remove --force`). The
  main tree was verified clean afterward (`git status --short` showed only the three audit docs).
- Predicate/roadmap attacks ran against **scratch roadmap JSON + scratch files** in the session
  scratchpad — the repo's own `roadmap.json` / audit files were never mutated.
- No pushes. No fixes. Every BROKEN verdict is recorded, not repaired.

Two corrections to prior recon, verified here and reflected below:
1. `contract-gate.test.mjs` **is** in CI (`spec-gate.yml:61`) — the "no CI coverage" claim is refuted.
2. `.quiz-answers.json` is **tracked in git** (not ignored), and the committed copy is **stale**
   (scores 33% against the current map), so a naive stored-file replay does not currently pass.

---

## Coverage matrix (every AUD1 GATE id → attack entry)

This is the artifact for the manual predicate ("human confirms coverage is complete, not sampled").
Every id classed GATE in `01-claims.md` maps to an executed or documented attack.

| attack | GATE ids covered | verdict |
|---|---|---|
| **A1** contract-gate fail-open | CLM-037, CLM-038, CLM-075 | BROKEN (narrow deny HELD) |
| **A2** contract-gate CI coverage | (recon claim) | HELD (refuted — test in CI) |
| **A3** handoff-fresh freshness | CLM-014 | BROKEN |
| **A4** quiz enforcement/replay | CLM-011, CLM-051, CLM-076 (CONVENTION, attacked as claimed pass/fail) | BROKEN (unenforced) |
| **A5** hollow-file predicates | CLM-006, CLM-053(status) (CONVENTION) | BROKEN |
| **A6** audit-doc ban evasion | CLM-005, CLM-007, CLM-053(audit) | PARTIAL (false-neg + false-pos) |
| **A7** CI-only enforcement + triggers + branch protection | CLM-003, 004, 008, 009, 010, 012, 015, 018, 030, 031, 032, 033, 034, 035, 036, 039, 040, 041, 042, 043, 046, 049, 050, 052, 057, 058, 059, 072, 073, 074, 077, 078 | PARTIAL / UNDETERMINED |
| **A8** hook firing surface | CLM-013, CLM-047 (+ CLM-045 Stop nudge) | PARTIAL (crash-skip BROKEN) |

The A7 set is the "runs correctly, in CI only" gate family: each exits non-zero on its own fault
(verified individually by the CI suite + `spec:test:all`), so their *mechanism* HELD; their shared
bypass is the CI-trigger/branch-protection/local-non-enforcement surface documented in A7.

---

## Attack entries

### A1 — contract-gate fail-open (CLM-037/038/075) — BROKEN (narrow deny HELD)

`repro:`
```
printf '{"tool_name":"Agent","tool_input":{"prompt":"NOVAKAI_CONTRACT: frame-transform"}}' | node tools/novakai/contract-gate.mjs; echo $?   # typo → 0
printf '{"tool_name":"Agent","tool_input":{"prompt":"NOVAKAI-CONTRACT: no-such-change"}}'  | node tools/novakai/contract-gate.mjs; echo $?   # unresolvable → 2 DENY
echo 'not json' | node tools/novakai/contract-gate.mjs; echo $?                                                                             # malformed → 0
printf '{"tool_name":"Agent","tool_input":{}}' | node tools/novakai/contract-gate.mjs; echo $?                                              # empty → 0
printf '{"tool_name":"Agent","tool_input":{"prompt":"go build"}}' | node tools/novakai/contract-gate.mjs; echo $?                           # absent → 0
```
observed:
- Sentinel typo `NOVAKAI_CONTRACT` (underscore) → **exit 0** (ungated spawn).
- Correct `NOVAKAI-CONTRACT:` + unresolvable id → **exit 2**, `deny` JSON + stderr (deny path works).
- Malformed stdin → **exit 0**. Empty `tool_input` → **exit 0**. Sentinel absent → **exit 0**.
- Non-`Agent`/`Task` tool names never reach the hook (matcher `Agent|Task`); main-agent Edit/Write
  is ungated by design (`WORK_ORDER.md:27`) — blast radius: the entire working tree is editable
  with no contract.

verdict: **BROKEN as a "100% gate"** (CLM-037 overstates). It is a *narrow* gate: it only DENIES a
spawn that carries the exact-cased sentinel AND fails to resolve a contract. Any typo, absent
sentinel, malformed input, or non-Agent path fails open (CLM-038 is accurate). The one path it
guards (CLM-075 deny) HELD.

### A2 — contract-gate CI coverage — HELD (recon claim refuted)

`repro:` `grep -n contract-gate.test .github/workflows/spec-gate.yml` → **`61: - run: node --test tools/novakai/contract-gate.test.mjs`**.
observed: the gate's own test runs in CI's `buildspec-tests` job. verdict: **HELD** — earlier recon
that it was CI-omitted is wrong. (Whether that test exercises the DENY path vs only ALLOW is an
AUD3 question, not settled here.)

### A3 — handoff-fresh freshness is gameable (CLM-014) — BROKEN

Ran in a detached worktree. `repro:`
```
git worktree add --detach <wt> HEAD && cd <wt>
node tools/novakai/handoff-fresh.mjs --check; echo $?                          # baseline clean → 0
printf '\n//x\n' >> src/main.ts && git commit -qam code; node …handoff-fresh --check; echo $?   # code newer → 1
printf '\n<!--x-->\n' >> docs/novakai/SESSION_HANDOFF.md; node …handoff-fresh --check; echo $?    # handoff DIRTY → 0
git checkout -- docs/…/SESSION_HANDOFF.md; printf '\n//y\n' >> src/main.ts
printf '\n<!--noop-->\n' >> docs/…/SESSION_HANDOFF.md; git commit -qam both; node …handoff-fresh --check; echo $?  # same-commit tie → 0
```
observed:
- Baseline (clean) → **exit 0**. Code committed newer than handoff → **exit 1** (gate fires correctly).
- Handoff dirtied with one uncommitted comment → **exit 0** "handoff is being updated" — the gate
  passes unconditionally regardless of how far code advanced.
- A no-content handoff touch committed in the **same commit** as code (equal committer `%ct`) →
  **exit 0** (test is strict `codeTs > handoffTs`).
- `[executed]` git-error case: running `--check` outside a git repo → **exit 0** (try/catch swallow).

verdict: **BROKEN.** Three independent bypasses: (1) any dirty edit to the handoff, (2) same-commit
tie with an empty touch, (3) freshness is committer-timestamp-based (`%ct`, settable via
`--date`/`GIT_COMMITTER_DATE`), never content. The gate proves recency-of-touch, not that the
handoff reflects the code. (In CI the checkout is clean, so bypass (1) is local/dirty-context only;
(2) and (3) apply in CI too.)

### A4 — quiz is unenforced + replayable (CLM-011/051/076) — BROKEN (as an enforced gate)

`repro:`
```
grep -rnE 'quiz' .github/ .claude/                                   # → empty
node tools/novakai/quiz.mjs check --answers .quiz-answers.json --seed 1; echo $?
git ls-files --error-unmatch .quiz-answers.json                      # → tracked
```
observed:
- Quiz appears in **no** workflow and **no** hook. `novakai:onboard` only *prints* the quiz
  instructions (STEP 4); it never runs `check` and exits 0 regardless.
- The committed `.quiz-answers.json` (tracked, not ignored) scores **4/12 (33%)** at seed 1 →
  quiz `check` correctly **exit 1**. So the exit-code contract HELD, but the stored file is stale.
- Because `check` recomputes the key from the on-disk `_bundle.mmd`, correct answers are
  derivable *from the same map the agent is "tested" on* — a script can pass without understanding;
  and a fresh 100% answers file, once committed, replays whenever the map is unchanged.

verdict: **BROKEN** as "understanding becomes pass/fail" (CLM-011): nothing forces the quiz, so it
gates nothing. The literal stored-file replay is currently ineffective only by accident (the
committed answers drifted to 33%); the mechanism (derive-from-map, then replay) is trivially
bypassable. Nothing binds answers/seed/map to HEAD.

### A5 — hollow files satisfy roadmap predicates (CLM-006 / CLM-053 status) — BROKEN

Ran against scratch roadmap JSON + scratch files. `repro:`
```
: > hollow-inventory.md                       # 0 bytes
printf '| claim |\n' > hollow-claims.md        # only the grep token
node tools/novakai/roadmap.mjs --roadmap hollow-roadmap.json   # H0(file)+H1(grep) → both BUILT
node tools/novakai/roadmap.mjs --roadmap hollow-roadmap.json >/dev/null; echo $?   # → 0
```
observed: a **0-byte** file satisfies a `file` predicate (BUILT); a file whose only content is
`| claim |` satisfies the AUD0-style `grep` predicate (BUILT). `roadmap.mjs` exits **0** for all
status outcomes — missing/partial never fail the build; only `--audit-doc` can exit non-zero.
verdict: **BROKEN.** "Recomputed, so it cannot lie" (CLM-006/053) holds only for *presence/pattern*,
not content. Self-referential note: **this very audit's** AUD0/AUD1/AUD2 predicates (file + a grep
token) could be met by hollow files — the predicates check that a doc exists and contains a header,
not that the audit was actually done.

### A6 — audit-doc ban evades and false-positives (CLM-005/007/053 audit) — PARTIAL

`repro:`
```
# false-negative: evasive status phrasing
node tools/novakai/roadmap.mjs --audit-doc evade.md; echo $?     # table "done ✅", "Status — shipped", <div>state: built</div> → 0
# false-positive: a doc that QUOTES the banned pattern
node tools/novakai/roadmap.mjs --audit-doc docs/novakai/audit/01-claims.md; echo $?   # → 1
```
observed:
- **False-negative:** a status table cell `| done ✅ |`, the sentence `Status — A2 is shipped`, and
  `<div>state: built</div>` (the `state:` not at line-start) all pass (**exit 0**). The ban only
  matches `**State:**` or a line-leading `state: <emoji|word>` — any other phrasing of status evades.
- **False-positive:** `01-claims.md` L45, which *quotes* the pattern `**State:**` while describing
  the linter, is flagged (**exit 1**). The ban cannot distinguish a status marker from prose that
  mentions one.
- Scope: CI runs `--audit-doc` only against `CLAUDE.md` (`spec-gate.yml`), so other docs (including
  these audit files) may carry hand-written status freely.

verdict: **PARTIAL.** The ban catches the two literal forms it targets, but is both evadable
(false-negatives on any other phrasing) and over-eager (false-positive on quotes), and is scoped to
one file.

### A7 — the CI-gate family: real mechanism, CI-only enforcement, unknown teeth — PARTIAL / UNDETERMINED

Covers the "exit-1-in-CI" gates (validate, lint, coverage, exports, gate, edges, acceptance, cert,
plan-check, conformance, loop-e2e, canonical, contract, verify-change, replay, waves, bundle-freshness).
`repro:`
```
# CI-only steps absent from the local novakai:verify chain
for s in handoff:check cert plan-check roadmap:audit acceptance; do \
  grep -c "novakai:$s" .github/workflows/spec-gate.yml; \
  node -e "console.log(require('./package.json').scripts['novakai:verify'].includes('$s'))"; done
# local-only tests absent from CI
for t in slice-core.test novakai-lint.test novakai-lint.discriminate.test tooling-map.test; do \
  grep -c "$t" .github/workflows/spec-gate.yml; done      # all → 0
# path triggers
sed -n '/on:/,/jobs:/p' .github/workflows/spec-gate.yml
# branch protection
gh api repos/:owner/:repo/branches/main/protection
```
observed:
- Each gate's mechanism HELD individually (its own `.test` passes in `spec:test:all`/CI).
- **CI-only, not locally forced:** `handoff:check`, `cert`, `plan-check`, `roadmap:audit`,
  `acceptance` run in CI but are **not** in the local `novakai:verify`/`ship` chain — a developer
  who runs `novakai:ship` never exercises them.
- **Local-only, not in CI:** `slice-core.test`, `novakai-lint.test`, `novakai-lint.discriminate.test`,
  and the whole tooling-map chain (`tooling-map.test`, `tooling-coverage`, `novakai:tooling:verify`)
  → CI count **0**. The tooling map (Phase I) is verified in no CI job.
- **Path-trigger gap:** `spec-gate.yml` fires only on `src/**`, `docs/novakai/**`, `tools/**`, the
  workflow file, `package.json`. Commits touching only `.claude/**` (hooks!), `public/plan.json`
  (which cert/plan-check/acceptance target!), `.quiz-answers.json`, or root configs do **not**
  trigger the gate.
- **Branch protection:** `[not-executed]` — `gh` CLI is not installed in this environment
  (`command not found: gh`). **UNDETERMINED.** If the `spec-gate` jobs are not *required* status
  checks on `main`, every CI gate above is advisory — this is the single highest-leverage open
  question and must be answered (re-run the `gh api` repro where `gh` is authed, or read the branch
  settings in the GitHub UI).

verdict: **PARTIAL** (mechanisms hold; enforcement has real CI/local divergence + a path-trigger
hole) and **UNDETERMINED** on the load-bearing branch-protection question.

### A8 — hook firing surface (CLM-013/047, CLM-045 Stop) — PARTIAL (crash-skip BROKEN)

`repro:`
```
node -e "const h=require('./.claude/settings.json').hooks; console.log(h.SessionStart[0].matcher, '|', h.Stop[0].matcher)"
ls -la .git/index.lock.bak .git/index.lock.old2
# firing across session types: [not-executed] — needs a live harness
```
observed:
- SessionStart matcher is `startup|resume`; Stop has **no** matcher. Nothing in `settings.json`
  scopes hooks for `.claude/worktrees`, `claude -p` headless, or subagent sessions — firing in
  those contexts is a harness property, `[config-read]` only, **not executed** here.
- **Crash-skip (BROKEN):** the Stop hook (handoff-fresh nudge) fires only on a *clean* Stop. Two
  zero-byte abnormal-exit artifacts exist — `.git/index.lock.bak`, `.git/index.lock.old2` — proving
  sessions have already died mid-operation in this repo; those sessions never emitted Stop, so the
  freshness nudge never ran. A session that crashes after editing `src/` bypasses the end-of-session
  reminder entirely.
- onboard-as-gate (CLM-047): `novakai:onboard` exits 1 on a stale map, but whether SessionStart
  exit-1 actually blocks the session is harness-controlled; the quiz (the "understanding" half) is
  printed, never enforced (A4), so a session proceeds un-quizzed.

verdict: **PARTIAL.** The happy-path hooks fire (this session's SessionStart onboard ran); the Stop
nudge is structurally skipped on abnormal exit (BROKEN), and cross-session-type firing is
UNDETERMINED without a live-harness test.

---

## Summary of verdicts (feeds AUD4)

| id | target | verdict |
|---|---|---|
| A1 | contract-gate "100% gate" | BROKEN (fail-open; narrow deny holds) |
| A2 | contract-gate CI coverage | HELD (recon refuted) |
| A3 | handoff freshness (F4) | BROKEN (dirty / tie / timestamp) |
| A4 | quiz pass/fail (Keystone 1) | BROKEN (unenforced; replay mechanism) |
| A5 | roadmap predicates | BROKEN (hollow files pass; never blocks) |
| A6 | audit-doc status ban | PARTIAL (false-neg + false-pos; 1-file scope) |
| A7 | CI-gate family enforcement | PARTIAL + UNDETERMINED (branch protection) |
| A8 | hook firing surface | PARTIAL (crash-skip BROKEN) |

Highest-severity open item for AUD4/AUD5: **A7 branch-protection UNDETERMINED** — if CI is not a
required check, the entire CI-gate family (A7) collapses from GATE to CONVENTION. Resolve first.
