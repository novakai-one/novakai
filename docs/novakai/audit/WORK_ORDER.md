# Tooling audit — work order (INTENT ONLY)

Status is COMPUTED, never written here:

```
npm run novakai:roadmap -- --roadmap docs/novakai/audit/audit-roadmap.json
```

Rules for all phases:
- Every finding must include a `repro:` command. No finding without repro.
- No fixes during AUD0–AUD4. Fixes are AUD5, via the standard plan/contract loop.
- One CC session per phase. Session start: `npm run novakai:onboard` (hook-forced) + read this file + read prior phase outputs.
- Outputs land in `docs/novakai/audit/` with the exact filenames the predicates check.

## AUD0 — Inventory → `00-inventory.md`
Enumerate: `tools/**/*.mjs`, `.claude/settings.json` hooks, `.github/workflows/*`, package.json scripts.
Extract every claimed guarantee (grep prove|gate|enforce|"0 drift"|fails in CLAUDE.md, tool file headers, echo strings).
Emit table: `| claim | claimed mechanism | file |`.

## AUD1 — Classification → `01-claims.md`
Per claim: GATE (machine-blocked) / CONVENTION (script exists, nothing forces running it) / PROSE (words only).
Per GATE: exact trigger (hook event / CI job / lifecycle) + bypass surface.

## AUD2 — Adversarial pressure test → `02-attacks.md`
Attempt to break each GATE. Entry format: attack, `repro:` command, observed result, verdict.
Minimum attack list:
- contract-gate fail-open: malformed stdin, tool rename, sentinel typo (`NOVAKAI_CONTRACT`), sentinel absent. Main-agent Edit/Write is ungated by design — document blast radius.
- Hooks: fire in `.claude/worktrees`? resumed sessions? `claude -p` headless? subagent sessions? abnormal exit (see `.git/index.lock.bak`)?
- Stale-state: edit src/, skip novakai:ship, commit locally — anything blocks pre-CI?
- `.quiz-answers.json`: replay old answers, hand-edit, staleness vs HEAD unchecked?
- CI: diff spec-gate.yml scripts vs local `novakai:verify`; branch protection actually enabled?
- roadmap.json predicates: satisfiable by hollow/trivial files?
- handoff-fresh: freshness definition (mtime? commit?) gameable?

## AUD3 — Test-suite deny-path audit → `03-tests.md`
Per gate script: does its `.test.mjs` cover the DENY path or only ALLOW?
Mutation spot-check: deliberately break 3 predicates, run `npm run spec:test:all`, record which mutations survive. Revert after.

## AUD4 — Findings register → `04-findings.md`
`| id | severity | claim broken | repro | proposed fix | fix cost |`
severity ∈ keystone-bypass / gap / hygiene.

## AUD5 — Fixes
One finding per plan/contract under `docs/novakai/plans/`. Each fix ships with a test failing pre-fix, passing post-fix. Track via `novakai:status`; convert AUD5 manual check to `cmd` checks once plans exist.
