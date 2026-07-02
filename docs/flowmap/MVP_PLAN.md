# NovaKai (flowmap) — MVP build plan

Personal record only. Live status: `npm run flowmap:mvp` (computed, cannot go stale).
MVP exit = recorded end-to-end run on a foreign repo (M9).

## P0 — Rename
- [ ] M0.1 Resolve naming collision with existing NovaKai repo
- [ ] M0.2 Rename flowmap repo/package → novakai; sweep path refs in plans/handoffs

## P1 — Tooling enforceable (protects everything after)
- [ ] M1.1 AUD0 inventory (`docs/flowmap/audit/00-inventory.md`)
- [ ] M1.2 AUD1 claim classification (GATE/CONVENTION/PROSE)
- [ ] M1.3 AUD2 adversarial pressure test (repro per finding)
- [ ] M1.4 AUD3 test-suite deny-path audit + mutation spot-check
- [ ] M1.5 AUD4 findings register
- [ ] M1.6 AUD5 fixes shipped via plan/contract loop
- [ ] M2.1 Hook: quiz-gate on Edit|Write (deny code edits without fresh 100% quiz)
- [ ] M2.2 Hook: plan-check on ExitPlanMode (machine-checked plan structure)
- [ ] M2.3 Hook: Stop includes flowmap:ship staleness check
- [ ] M2.4 Compliance metrics over N runs: quiz pass rate, cert pass rate, gate-deny count, PASS_UNPROVEN ratio

## P2 — Interface pillar (can run parallel to P1 design iteration in chat)
- [ ] M3.1 ViewSpec JSON contract defined (schema-validatable; renderer = pure function of spec)
- [ ] M3.2 Rule enforced: migrated features land as render(spec), no direct DOM-toggle handlers
- [ ] M4.1 Migrate Read (unfold) → Main app
- [ ] M5.1 Migrate: import
- [ ] M5.2 Migrate: mmd editing/sync
- [ ] M5.3 Migrate: slice
- [ ] M5.4 Migrate: plan view
- [ ] M5.5 Migrate: diff workspace
- [ ] M5.6 Migrate: export
- [ ] M5.7 Frontmatter + remaining main features verified present

## P3 — Readability (incremental, never big-bang)
- [ ] M6.1 Define "human readable" as enforceable conventions (naming, function length, comments) — lint rule or CLAUDE.md convention
- [ ] M6.2 Refactor per-touched-module through full loop (gate/ship/tests green each pass)
- [ ] M6.3 Targeted passes on worst offenders

## P4 — Generality proof → MVP done
- [ ] M7.1 Full pipeline run on foreign repo (react-dev); fix portability breaks
- [ ] M8.1 Compliance metrics collected on foreign-repo runs
- [ ] M9.1 Recorded end-to-end demo: 0-context agent → onboard → quiz 100 → English feature request → plan → human review in ViewSpec editor → approve → orchestrate → acceptance green → writeback

## Post-MVP (parked, not forgotten)
- [ ] Stage 5 / U8 group-promotes-to-stage (polish)
- [ ] Stage-mode wire-click noop fix (stage-3 carry)
- [ ] Power-user density: favourites, saved specs, customisation
- [ ] Improved search
- [ ] Tooled vs untooled work-order comparison study
- [ ] Browser/e2e testing (Playwright) for interface pillar
- [ ] read-review-overlay (postponed pending reading surface)
- [ ] unfold-as-primary-interface flip (held for review)
