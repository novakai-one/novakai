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
## 0·now (2026-07-03, this session) — `m5-p-tabs2` + `m5-a-verbs` EXECUTED and landed: 11 changes built by contract-carrying subagents, both acceptance contracts red→green, all 16 runtime criteria probed green, M5 at 11/11 machine predicates

Both plans from PR #37 were executed in one run, in the ruled order (p-tabs2 then a-verbs —
`initUnfold`'s signature is cumulative). Five 0-context builder subagents each carried a
`FLOWMAP-CONTRACT:<id>` spawn sentinel (G4 gate validated the packet at spawn); the
orchestrator verified every landing with `flowmap:acceptance` + `flowmap:verify-change` and
committed per phase. A fresh 0-context agent then re-verified the whole landing from
command output alone, and a headless Playwright probe drove every runtime criterion in the
two plan notes against the live app (probe committed:
`docs/flowmap/probes/m5-tabs2-verbs.probe.js` — usage in its header). Branch
`m5-p-tabs2-a-verbs-build` — Chris reviews and merges. Never commit on `main` — standing
verdict in KNOWN_EDGES.md.

| What | Verify it yourself | Expect |
|---|---|---|
| P-tabs2 contract green | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-p-tabs2.plan.json` | 6/6 green — behavioural contract satisfied |
| A-verbs contract green | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-a-verbs.plan.json` | 13/13 green — behavioural contract satisfied |
| A-verbs fully landed | `npm run flowmap:status -- --plan docs/flowmap/plans/m5-a-verbs.plan.json` | 6 built · 0 pending · 0 drifted |
| P-tabs2 landed (then superseded) | `npm run flowmap:status -- --plan docs/flowmap/plans/m5-p-tabs2.plan.json` | 4 built + `uf-dock-tabs2` DRIFTED — expected supersession, NOT a regression: a-verbs deliberately widened `initUnfold` (see KNOWN_EDGES, cumulative-plans flavour); BUILT state verifiable at commit 9bb8597 |
| Pure fns PROVEN, not just shaped | `npm run flowmap:verify-change -- --change uf-slice-targets --plan docs/flowmap/plans/m5-p-tabs2.plan.json --json` (and `--change uf-verb-gate` on the a-verbs plan) | verdict `PASS`, behavioural proven:true (6/6 · 13/13) |
| Map true + complete at HEAD | `npm run flowmap:ship` | DONE line; 0 unaccounted edges |
| M5 predicates | `npm run flowmap:mvp` | M5 11/11 machine predicates (◐ only from its standing declared-manual line) |
| Types clean | `npx tsc --noEmit` | exit 0, no output |
| Runtime criteria (16) | `node docs/flowmap/probes/m5-tabs2-verbs.probe.js` (needs playwright + dev server — header explains) | 16 `[PASS]` lines, `FINAL CONSOLE ERRORS (0)` |
| Ban intact | `npm run flowmap:roadmap:audit` | both scans ✓ |
| Quiz pass bound to a live session | `npm run flowmap:onboard` (STEP 4) | re-take in YOUR session — this session's pass never attests your read |

**Honest boundaries (do not oversell):**
- Only the two pure functions carry behavioural contracts (by plan design); the other 9
  changes are `PASS_UNPROVEN` structurally and their behaviour is covered by the committed
  runtime probe, which needs a browser and is NOT in CI. E4/F5's remaining CI rows are
  unchanged by this session.
- `uf-dock-tabs2` reads DRIFTED on the p-tabs2 plan because a-verbs superseded the
  signature the same day — the 0-context verifier caught this and it is now a recorded
  KNOWN_EDGES flavour, with the residual risk that M5's acceptance-only predicates would
  NOT catch such a drift (only `flowmap:status`/`verify-change` do).
- Both landed `add` changes were hand-flipped to `modify` (the recurring lifecycle gap).
- Theme chips stay legacy-only — the THEMES→unfold-palette mapping is still Chris's open
  design ruling; the style tab ports font + appearance only.
- Builder deviations, all directed or flagged (in the PR body): `reverseEdge` re-anchors
  (plan-directed), a `selIsRealNode` guard on connect/duplicate/copy/wrap (phantom
  hierarchy-container ids), edge-verb id resolution by endpoint pair (unambiguous because
  duplicate same-direction edges are refused).

**Next (Scenario 1):** the §C drag plan (largest item, ruled standalone — design-first),
the remaining deferred decisions (select-all with multi-select), and the theme-chips
ruling whenever Chris rules. `npm run flowmap:mvp` computes it all — never this file.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
