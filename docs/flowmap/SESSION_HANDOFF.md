# Session handoff — verifiable, not prose

> **New agent: do not trust this document. Run `npm run flowmap:onboard` first.**
> Everything below is either a *runnable claim* (a command + expected result you
> can execute) or clearly-labelled *intent* (the remaining roadmap). The verified
> state of the app lives in the tools, not in this file. Written 2026-06-30.

## 0. Start here (the whole point of this session)

```
npm run flowmap:onboard
```

That command (a) proves the map is true + complete as of HEAD, (b) gives you the 3
durable invariants, (c) points you at the verified artifacts, (d) hands you a
comprehension quiz that turns "do you understand the app?" into a pass/fail test.
Take the quiz before making any design claim:

```
npm run flowmap:quiz -- generate --n 12 --seed 1
# answer each from docs/flowmap/_bundle.mmd only, write answers.json, then:
npm run flowmap:quiz -- check --answers answers.json --seed 1   # 100% = handover trusted
```

## 1. What this session changed — each row is a runnable claim

| What | Verify it yourself | Expect |
|---|---|---|
| **The map was stale** (4 real exports missing: `downstreamCone`, `applyPlan`, `sliceIds`, `sliceStubs` + plan types). Now re-synced. | `npm run flowmap:gate` | ✓ in sync |
| **A1 — symbol-level completeness gate.** New exports in existing files can no longer hide. | `npm run flowmap:exports` | PASS (195 symbols) |
| A1 fails closed on a hidden export | add `export function foo(){}` to any mapped .ts, then `npm run flowmap:exports` | exit 1, names it |
| **A2 — completeness wired into CI** | read `.github/workflows/spec-gate.yml` | "symbol completeness" step |
| **A3 — two-parser conformance** (app `fromMermaid` vs pipeline `parseMmd` proven to agree) | `npm run spec:conformance` | 15/15 pass |
| **A4 — trust tiers** (which claims are PROVEN vs advisory vs unverified) | `npm run flowmap:trust` | 2227 verified · 323 advisory · 281 unverified |
| **C1 — verified work-state** (continuity without prose) | `npm run flowmap:status -- --plan public/plan.json` | 8 built · 8 pending, derived from code |
| **B2 — testable understanding** | the quiz commands above | 100% or it names your misses |
| **B1 — one onboarding door** | `npm run flowmap:onboard` | MAP TRUSTWORTHY + protocol |
| Nothing regressed | `npm run spec:test` · `npm run typecheck` | 7/7 · clean |

New files: `tools/flowmap/{exports-coverage,status,quiz,onboard,trust-report}.mjs`,
`docs/flowmap/curation-allowlist.txt`. Edited: `package.json` (new scripts),
`spec-gate.yml`, the `plan`/`state` fragments + regenerated `_bundle.mmd`.

The curation allowlist (`docs/flowmap/curation-allowlist.txt`) is the auditable list
of exports deliberately NOT mapped (config scalars, trivial type aliases). Editing it
is a design decision, not a workaround.

## 2. What "green" now means (and still does not)

`npm run flowmap:verify` green ⟺ the map is **structurally true and complete**: every
exported symbol is a node or an audited exclusion, every node exists in code, and every
gated signature (arity, member names, void-vs-value, clean types) matches. It does **not**
yet mean: full param/return types (31 prose holes — see `flowmap:trust`), interface field
shapes, **edges** (hand-authored, unverified), or **behaviour**. Treat edges and `desc`
as advisory until the features below land.

## 3. The loop is now closed — each row is a runnable claim

Do not trust this list — run `npm run flowmap:roadmap` for the live computed status. As of this
session the whole understand→plan→review→approve→implement→re-sync loop is built and enforced:

| Item | Verify it yourself | Expect |
|---|---|---|
| **C2 — plan dry-run cert** (apply → stubs → tsc → gate, delta vs base) | `npm run flowmap:cert -- --plan public/plan.json` | CERTIFIED |
| C2 catches a bad plan | `node --test tools/flowmap/plan-cert.test.mjs` | uncompilable signature → NOT certified |
| **D1 — layout fidelity** (planner renders real `ctx.state` positions, force-sim gone) | `node --test tools/buildspec/plan-layout.test.mjs` | real nodes keep exact position |
| **D2 — unified review surface** (planner reviews plan.json OR a raw proposal via `planFromDiff`) | `node --test tools/buildspec/plan-from-diff.test.mjs` | before/after diff → correct changes |
| **E2 — Keystone 2: behavioural acceptance tests** in the contract | `node --test tools/buildspec/acceptance.test.mjs` | correct→green, wrong→red, unimplemented→red |
| **E3 — writeback** (`scaffold --add-from-plan` adds new nodes to a fragment) | `node --test tools/buildspec/writeback.test.mjs` | idempotent node append |
| **E4 — CI enforces the whole loop** | read `.github/workflows/spec-gate.yml` | runs cert + all loop tests |
| Whole computed roadmap | `npm run flowmap:roadmap` | 13 built · 2 partial (C3, E1) |
| Nothing regressed | `npm run spec:test:all` · `npm run typecheck` | green · clean |

New commands: `flowmap:cert` (plan dry-run cert), `flowmap:acceptance` (behavioural contract),
`flowmap:writeback` (add approved nodes), `flowmap:roadmap` (computed status). New pure mapped
units: `levelPositions` (D1) and `planFromDiff` (D2) in `src/core/plan/plan.ts`.

Still partial (NOT in this session's scope, honest): **C3** authoring-time coherence (no
`plan-check.mjs` yet) and **E1** single approval export (no `approve-export.mjs` CLI — the
planner's in-app export exists, the CLI does not). Run `npm run flowmap:roadmap` to see exactly
which predicate is unmet.

The end-to-end target is now reachable: 0-context agent → `flowmap:onboard` (trusted
understanding) → build plan → `flowmap:cert` (certify before review) → human reviews the visual
diff in-app (one surface) → approval exports an enforceable spec + acceptance tests → agent
implements to green (gate AND `flowmap:acceptance`) → `flowmap:writeback` + `flowmap:ship`
re-sync the map. CI (`spec-gate.yml`) holds every link.
