# Whole-repo readability standards — 4-session burndown plan (intent only)

> Owner ruling (Chris, 2026-07-10): the WHOLE repo is readable with standards enforced; the
> only exclusions are system files that cannot be linted or are data/generated/fixtures. No
> file in the repo may hold hard-to-read code. `sandbox/` and `prototypes/` are deleted, not
> burned (dead experiments; git history keeps them recoverable).
>
> This file holds INTENT — the session definitions and their exit criteria as commands. It
> never records status; the live work-state is `npx eslint . 2>&1 | tail -1` and the test
> suites named below.

## The end-state contract

```
npx eslint . --max-warnings 0                                # exit 0 — one BLOCK tier over every code file
git grep -l 'eslint-''disable' -- '*.ts' '*.mjs' '*.js'      # exactly the frozen-signatures.json registry files
node --test tools/novakai/verify/standards-parity.test.mjs   # config == doc == ledger, mechanical
node --test tools/novakai/verify/signature-guard.test.mjs    # contract-frozen signatures cannot drift
```

The exclusion ledger (the ONLY unlinted paths, each with a reason) lives in
`docs/CODING_STANDARDS.md` and is pinned against `eslint.config.js` by the parity test.

## Session 1 — scope lock + guardrails

Delete dead code (`sandbox/`, `prototypes/`, root `novakai-lint.mjs` duplicate). Extend eslint
to every remaining code file: `tests/**` at WARN, root harness at BLOCK after burning it to
zero. Write the exclusion ledger (config + doc + parity pin). Govern the two contract-anchored
`eslint-disable`s: registry table in the doc, `tools/novakai/verify/frozen-signatures.json`
manifest, `signature-guard.test.mjs` in `spec:test:all` — a frozen signature cannot change
without resyncing its contract artifact, and no third disable can appear.

Exit: `npx eslint .` reports 0 errors and exactly the tests + `src/main.ts` + carve-out
backlog; parity + guard suites green.

## Session 2 — tests burndown

Burn `tests/characterization` and `tests/e2e` to zero via contracted builders (~75 warnings
per builder, disjoint file groups, verify each group from the tree with
`npx eslint <files> --max-warnings 0`, commit per green group). Hard rule: these files ARE the
regression net — never alter an expected-value literal, golden, or corpus string;
`no-duplicate-string` fixes hoist literals to consts verbatim. `npm run test:src` and
`npx playwright test` must stay green after every group. Then promote `tests/**` to the error
tier in the three synced places (config + doc + parity test).

Exit: `npx eslint . 2>&1 | tail -1` reports exactly the `src/main.ts` + carve-out residue,
0 errors, with `tests/**` in the BLOCK list.

## Session 3 — the two oversized tooling files

Split `tools/novakai/audit/audit-run.mjs` and `tools/novakai/contract/loop-e2e.test.mjs` to
≤500 effective lines each (design work — lead-tier, not builder burndown; `tools/novakai/**`
gates/audit surfaces are contract-frozen against subagents). Resync the tooling self-map
fragments; `npm run novakai:tooling:verify` green. Remove the max-lines carve-out block from
config + doc + parity test.

Exit: `npx eslint src tools tests` reports only the `src/main.ts` residue, 0 errors; no
carve-out block exists in `eslint.config.js`.

## Session 4 — src/main.ts + tier collapse + independent audit

Fix `src/main.ts`'s warnings in place (id-length renames, statement/line unwrapping, line
wraps — measured: no max-lines hit, so no split; invariant 1 keeps `main.ts` the composition
root; the signature guard protects contract-anchored wiring). Collapse the tier model: delete
the WARN entry-ramp blocks so ONE error-severity rule set covers every glob; update doc +
parity test to assert no warn tier remains. Close with `npm run novakai:ship`, the CI chain,
and a 0-context auditor that re-proves the end-state contract from command output alone.

Exit: the end-state contract above, verbatim.
