# Round-2 orchestration protocol (IDE Phase K lanes)

> A leader session reads this after `npm run novakai:onboard` + the quiz (protocol §1/§2 in
> CLAUDE.md). This file is the operating protocol for round 2 — it does not restate app internals
> (the map does that) and it carries no hand-written status markers: every claim below is either a
> durable rule or a command to run.

## Role

The LEADER session orchestrates only: it issues work orders, coordinates the merge train, and owns
`docs/novakai/SESSION_HANDOFF.md` and the shared docs under `docs/ide-vision/`. It delegates all
build/verify work to subagents or separate windows — never edits `src/` itself. Chris merges every
PR; the leader never merges.

## Context (verify each with the command given)

- **Seam merged** — the 6 tab factories are wired in `main.ts`:
  `git show origin/main:src/main.ts | grep -c "initContracts\|initAgents\|initFilesPage\|initHome\|initRules\|initAnalytics"`
  → `6`. K4/K6–K10 read PARTIAL in `npm run novakai:ide` (the factory-grep check is met, the
  per-tab spec-file check and the manual render check are not) — this is the intended, honest
  in-flight state, not a bug.
- **Binding Design-tab flow ruling**: `docs/ide-vision/260707_RULING_DESIGN_FLOW.md` (+ its
  reference PNG). It supersedes the `DEFAULT_ASSUMPTIONS` open item in `SPEC_DESIGN.md` and
  constrains K4 (contracts carry attached prototype objects; contracts are creatable from the
  Design tab) and K8 (Home chat is not Design chat — do not conflate the two entry points).
- **Chris's Chrome extension is broken** — run every manual render check via headless
  Playwright/Chromium, never the extension. `gh` CLI is not installed on this machine — talk to
  GitHub via `curl` + `printf 'protocol=https\nhost=github.com\n\n' | git credential fill` for a
  token.

## Branch registry (the ONLY round-2 branches; one lane = one branch = one PR)

| Lane | Branch | Factory | Worktree | Notes |
|---|---|---|---|---|
| Contracts | `k4/contracts` | `initContracts` | `../novakai-k4` | spec committed (`SPEC_CONTRACTS.md`), thin-translation depth |
| Agents | `k6/agents` | `initAgents` | `../novakai-k6` | spec committed (`SPEC_AGENTS.md`); additionally owns `vite.config.ts` + the PTY bridge |
| Files | `k7/files` | `initFilesPage` | `../novakai-k7` | spec committed (`SPEC_FILES.md`) — factory name is **`initFilesPage`**, not `initFiles` (that name collides with the existing editor save/load module `io/files.ts`) |
| Home | `k8/home` | `initHome` | `../novakai-k8` | **branch does not exist yet** — verify with `git ls-remote --heads origin \| grep k8/home` (empty = not started); no design round has run (no `docs/ide-vision/SPEC_HOME.md` on any branch); `initHome` is already stubbed in `main.ts` on `main` waiting to be filled |
| Rules | `k9/rules` | `initRules` | `../novakai-k9` | spec committed (`SPEC_RULES.md`) |
| Analytics | `k10/analytics` | `initAnalytics` | `../novakai-k10` | spec committed (`SPEC_ANALYTICS.md`), including a build-phase-notes section appended post-approval |

Verify which lane branches currently exist on origin:
`git ls-remote --heads origin | grep -E "k(4|6|7|8|9|10)/"`.
Do not assume a branch's spec is audit-clean from its existence alone — a fresh leader re-reads
the branch's own spec doc and its commit history to confirm the design round actually reached the
"1 clean 0-context opus audit (failed audit → fix → re-audit until clean)" bar before handing it
to a builder; the commit trail (challenger findings → audit-N findings → approver-N nits,
converging to no more findings) is the evidence, not a status line anyone wrote down.

**Frozen for every lane** (no lane branch may touch these — collisions break the merge train):
`src/main.ts`, `src/ide/shell.ts`, `src/ide/pages.ts`, `css/styles.css`, `docs/novakai/*`,
`docs/ide-vision/*` (the shared docs belong to the leader; each tab's own spec file and its own
per-tab CSS at `src/ide/<tab>.css` are the exception — a lane owns its own spec + its own CSS file,
nothing shared).

## Session split (binding process rule)

Design sessions END at SPEC READY: spec committed + pushed on the lane branch, audit trail
reported, worktree removed, session closed. A FRESH 0-context builder session then works only from
the committed spec — it does not know how the spec was written and must not ask the design
session's context for help. Spec insufficiency discovered mid-build is reported as a gap, never
improvised around.

## Design-round depth

- **K4**: thin translation spec — the prototype's Builds tab is heavily BINDING per
  `PROTO_MANIFEST.md`, so the spec mostly transcribes real values. Challenger + 1 clean 0-context
  audit.
- **K6–K10**: full round — challenger + 1 clean 0-context opus audit (failed audit → fix →
  re-audit until clean). Zero prototype coverage exists for these tabs, so more of the spec is
  original design, not transcription.

## Builder work-order template (paste into a fresh window per lane at SPEC READY; fill ⟨⟩)

```
You are a 0-CONTEXT BUILDER for the novakai IDE, lane ⟨tab⟩, branch ⟨branch⟩. Main checkout
/Users/christopherdasca/Programming/novakai is READ-ONLY. Your contract is the committed spec —
you know nothing about how it was written and must not ask.

1. git -C /Users/christopherdasca/Programming/novakai fetch origin && git -C
   /Users/christopherdasca/Programming/novakai worktree add ../novakai-⟨k#⟩-build ⟨branch⟩ (retry
   15s on lock errors) · npm ci (never npm install).
2. Rebase onto origin/main. Verify Gate B yourself: git show origin/main:src/main.ts | grep -q
   ⟨initFn⟩.
3. npm run novakai:onboard, then take the quiz in THIS session (STEP 4) — 100% before any src
   edit.
4. Read docs/ide-vision/SPEC_⟨X⟩.md and docs/ide-vision/260707_RULING_DESIGN_FLOW.md. Ambiguous
   spec = STOP and report the gap.
5. Build with sonnet subagents. HARD WHITELIST: src/ide/⟨tab⟩*.ts, src/ide/⟨tab⟩.css, your tests/
   goldens (K6 also vite.config.ts + PTY bridge). Everything else frozen. Your initX stub exists —
   fill it in. docs/CODING_STANDARDS.md is machine-enforced.
6. Prove: typecheck+lint clean, suites green, npm run novakai:ide non-manual checks pass; then a
   fresh 0-context opus subagent re-proves from command output alone, incl. the manual check per
   docs/novakai/ide-roadmap.json (headless Chromium, zero console errors, color law). Record the
   verdict.
7. npm run novakai:ship from YOUR worktree, commit, push, PR to main via curl. Chris merges.
   Generated-file conflicts after another merge: git rebase origin/main && npm run novakai:ship,
   commit, force-push own branch only. Report PR READY + command-anchored summary.
```

## Merge train

First-green-first-merged. After each merge the leader tells still-open lanes to rebase + reship
(mechanical: `git rebase origin/main && npm run novakai:ship`, commit, push). The leader never
merges — that is always Chris.

## Queued next work orders

- **Design-choice / spec-drift audit — the successor leader's FIRST duty, before any builder
  order.** This is Chris's explicit standing worry: the shipped Design tab (`src/ide/design*.ts`)
  and every lane `SPEC_*.md` that exists on an origin lane branch can each individually look fine
  yet quietly drift from what Chris actually ruled. Before issuing any builder work order, spawn a
  0-context opus subagent to audit `src/ide/design*.ts` + every existing lane spec AGAINST
  `docs/ide-vision/260707_RULING_DESIGN_FLOW.md` + `docs/ide-vision/PROTO_MANIFEST.md` +
  `docs/ide-vision/IDE_MASTER_PLAN.md`, hunting exactly this kind of drift between what Chris ruled
  and what the specs/build actually encode — the K5 flow gap that prompted the ruling doc in the
  first place is the reference case for what drift looks like. Findings go to Chris before any
  Gate-B build proceeds on an affected lane; lanes the audit finds unaffected proceed as normal.
- **K5.1** (Design tab completion per the ruling doc: chat entry, AI-proposed assumptions, "create
  build" → rendered HTML prototype, approve → add to contract new/existing). Trigger: after K4's
  spec lands, since K5.1 hands off to K4's attachment surface. Runs as its own lane
  (branch `k5.1/*`), same design→build split as every other lane.
- **Remote-branch cleanup**: `git branch -r --merged origin/main | grep -v "main\|HEAD"` lists
  merged branches still present on origin (why Chris sees many pushes with no open PR — GitHub
  keeps a branch after its PR merges until someone deletes it). With Chris's approval, delete each
  with `git push origin --delete <branch>`.
- **K8 design round**: no branch exists yet and no prototype coverage exists for Home (per
  `docs/novakai/ide-roadmap.json`'s K8 intent: "no prototype design exists"). This lane needs a
  full design round from scratch (challenger + 1 clean 0-context opus audit, failed audit → fix →
  re-audit until clean) before any builder work order can be written for it, once it is picked up.
