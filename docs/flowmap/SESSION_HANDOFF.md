# Session handoff — verifiable, not prose

> **New agent: do not trust this document. Run `npm run flowmap:onboard` first.**
> Everything below is either a *runnable claim* (a command + expected result you
> can execute) or clearly-labelled *intent* (the remaining roadmap). The verified
> state of the app lives in the tools, not in this file.

## 0. Start here

```
npm run flowmap:onboard
```

Proves the map is true + complete as of HEAD, prints the 3 invariants, hands you the
quiz. Prove your read before any design claim:

```
npm run flowmap:quiz -- generate --n 12 --seed 1
# answer each from docs/flowmap/_bundle.mmd only, write answers.json, then:
npm run flowmap:quiz -- check --answers answers.json --seed 1   # 100% = handover trusted
```
## 0·now (2026-07-04, session 2) — M9 prep complete: overlay review path fixed+verified, dock hierarchy, ship-staleness content-hash, map curation, demo prep (PRs #42 #43 #44 #45)

Four PRs await review, all independently verified by a 0-context agent (suites green, ship
round-trip porcelain-empty on each branch). User verdicts recorded this session: stage-wire
fix confirmed good (assumption cleared); dock spacing was a *design* problem — redesigned as
label-species hierarchy, not more gap (#42). Planner full-migration hypothesis checked and
refuted: overlay path is complete; only wiring was broken (#42). Demo feature ruled: fresh
small src feature — unfold status readout (docs/flowmap/demo/prep/feature-choice.md).

| What | Verify it yourself | Expect |
|---|---|---|
| #42 keyboard gate present | `grep -n "plannerVisible" src/panel/unfold.ts src/core/runtime/runtime.ts src/panel/planner.ts` | capture-handler early-return + flag set/clear |
| #42 stale-on-return fixed | `grep -n "plannerClosed" src/main.ts src/core/context/context.ts` | hook wired to unfold.refreshFromModel |
| #42 behavior (CDP-proven this session) | open planner via io tab → ⌘Z/Delete → Escape | model byte-identical; Escape closes planner only |
| #43 staleness predicate | `node tools/flowmap/ship-staleness.mjs < /dev/null; echo $?` | 0 on clean tree; 2 after dirtying src/ |
| #43 stamp idempotent | run `npm run flowmap:ship` twice → `git status --porcelain` | empty both times |
| #44 dead code gone | `ls src/panel/diff-workspace.ts` | no such file |
| #44 rulings recorded | `grep -n "2026-07-04/2" docs/flowmap/parity-checklist.md` | deletion ruling hits |
| Demo plan coherent | `npm run flowmap:plan-check -- --plan docs/flowmap/demo/prep/plan.json` | ✓ coherent |
| Demo protocol | `cat docs/flowmap/demo/prep/recording-protocol.md` | capture method, artifact set, M9 predicates |
| Suites on every PR branch | `npm run spec:test:all && npm run test:src && npm run build` | all pass |
| M9 next in spine | `npm run flowmap:mvp` | M9 (P4) listed before M7 |

**Residual for Chris on #42 (eyeball at merge):** inspector chip tints + dark theme were
code-verified only (headless render can't reach them); optional refinement — faint per-tab
boundary on inactive tabs. Everything else on #42 was render- or CDP-verified live.

**Next:** merge #42/#43/#44 in any order; merge #45 LAST (it supersedes SESSION_HANDOFF.md —
on conflict with #43's handoff edit, take #45). Then M9 (W6): the recorded demo per
docs/flowmap/demo/prep/recording-protocol.md — fresh 0-context agent runs the loop on the
status-readout request; Chris drives planner review (genuine mouse input only);
`flowmap:verify-change` with `--strict`; artifacts land in docs/flowmap/demo/ and M9's manual
check converts to the predicates in the protocol doc.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
