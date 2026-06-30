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

## 1. This session (continuity) — a map-truth fault, found + fixed; plan NOT implemented

Resumed the in-flight plan (`public/plan.json`). Before implementing, found and fixed a
**map-completeness fault**, then stopped at the tooling's own human-review gate. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **Map was incomplete:** `camera.zoomToNode` existed in code + was called cross-module, but was absent from the map. Now documented. | `grep -n camera__zoomToNode docs/flowmap/_bundle.mmd` | node present (kind/sig/src + `--> applyCam` edge) |
| Fixed map is true + complete + in sync | `npm run flowmap:ship` | DONE line · gate in sync · 0 unaccounted edges (284) |
| `zoomToNode` is a real cross-module call, not dead code | `grep -n "camera.zoomToNode" src/panel/navigator.ts` | navigator.ts:124 |
| In-flight plan state (unchanged by the fix — `frameNode` still absent) | `npm run flowmap:status -- --plan public/plan.json` | 8 built · 8 pending |
| Plan is certified but **awaits human review** — 0 changes carry a signature | `node tools/flowmap/plan-cert.mjs --plan public/plan.json` | CERTIFIED · "Safe to send to human review" |

**Plan defect to reconcile before building `frame-node`:** the plan *adds* `camera__frameNode`
("centres but never zooms") — but `camera.zoomToNode` already exists, already does the centre-only
behaviour, and navigator already calls it (navigator.ts:124). `frame-node` is therefore an
**evolution of `zoomToNode`** (add zoom-to-readable), not a greenfield add. The plan was authored
against a map that hid `zoomToNode`. Decide evolve-vs-add at review before implementing.

**Open risk (the flowmap gap this fault exposed):** inner / API-surface functions are not
completeness-gated — only top-level exports are (A1). A cross-module-called API method hid in the
map for many commits. Candidate roadmap item: extend the completeness gate to API-surface members.

## 1a. Gap-1 load-test — first behavioural contract authored (NOT implemented)

Authored a real Keystone-2 contract for the reconciled `frame-node` and ran it through the gates.
Stopped at the implement boundary — no app code written. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Plan now carries a real signature (was 0/16) | `node tools/flowmap/plan-cert.mjs --plan public/plan.json` | CERTIFIED · "1 carry a proposed signature" |
| The behavioural contract BITES (red until implemented) | `npm run flowmap:acceptance -- --plan public/plan.json` | 0/3 green · "no %% src mapping … not implemented" |
| The testable core is a pure fn (`state.frameTransform`) | `grep -n '"frame-transform"' public/plan.json` | the change + `fm` + `acceptance.cases` |
| Plan still coherent + approval export builds | `npm run flowmap:plan-check -- --plan public/plan.json` | coherent (17 changes) |

**To finish the closure (implement step, held for your review):** implement
`state.frameTransform(n, vw, vh, wantZ, zMin, zMax) -> {x,y,z}` (centre via `nodeCenter`, clamp z to
[zMin,zMax]); ship the map; then `flowmap:acceptance` flips **3/3 green** and `flowmap:status` flips
`frame-transform` to BUILT — the first proof the design→contract→implement→test half of the loop
closes on a real change.

**New gap found this step:** the Keystone-2 harness (`acceptance.mjs`) only tests PURE, top-level
EXPORTED functions (`mod[symbol](...args)` + deepStrictEqual). DOM/ctx-bound API methods and new UI
modules — most of the app, incl. every other pending change — cannot carry a behavioural contract
directly; their logic must be factored to pure functions first. Candidate roadmap item: a ctx/DOM
acceptance harness, or a documented "factor-to-pure" contracting rule.

## 1·prev. Prior session — each row is a runnable claim

This session closed the gaps the previous handoff left open (C3, E1) **and** the deeper
untracked gaps surfaced in review: unverified edges (the biggest), prose-typed signatures,
and the unenforced *agent* protocol. The loop is now closed at the meta level too.

| What | Verify it yourself | Expect |
|---|---|---|
| **A5 — edge verification.** The whole call graph was UNVERIFIED (283 edges, warnings only) — yet blast-radius / `downstreamCone` all walk it. Now every edge is code-backed or audited. | `npm run flowmap:edges` | 279 code-backed · 4 advisory · **0 unaccounted** |
| A5 fails closed | `node --test tools/flowmap/edge-verify.test.mjs` | 5/5 (strict exits 1 on an unaccounted edge) |
| A5 advisory edges are audited, not hidden | `cat docs/flowmap/edge-advisory-allowlist.txt` | 4 `ctx.hooks` edges, each with rationale |
| **A6 — type gate tightened.** Object-literal + function types now compared, not skipped as prose. | `npm run flowmap:gate` | ✓ in sync · **1** prose hole (was 32) |
| A6 locked + found real drift | `node --test tools/buildspec/normtype.test.mjs` | 25/25 (also fixed `showTab` `which` drift) |
| **C3 — authoring-time coherence.** | `npm run flowmap:plan-check -- --plan public/plan.json` | ✓ coherent (16 changes) |
| **E1 — single approval export.** | `npm run flowmap:approve -- --plan public/plan.json --out /tmp/x` | approved.mmd + contracts + CHECKLIST.md + plan.json |
| **F1–F3 — agent protocol made durable + bookended.** | `grep -n "Session protocol" CLAUDE.md` · `cat .claude/settings.json` | protocol section · SessionStart(onboard)+Stop(handoff) hooks |
| **F4 — meta-loop is verifiable.** Handoff must be ≥ as fresh as the last code commit. | `npm run flowmap:handoff:check` | ✓ (exits 1 when the handoff lags code) |
| **F5 — the loop runs end-to-end** (plan-check → cert → approve → status → writeback → edges) on the real plan, as one chain. | `npm run flowmap:loop` | 1/1 |
| **trust report reflects A5/A6** | `npm run flowmap:trust` | ~2526 verified · 32 partial · 0 unverified edges |
| Whole computed roadmap | `npm run flowmap:roadmap` | 21 built (Phase A–F) |
| Nothing regressed | `npm run spec:test:all` · `npm run typecheck` | 101/101 · clean |

New files: `tools/flowmap/{edge-verify,plan-check,approve-export,handoff-fresh,loop-e2e.test,edge-verify.test,plan-check.test,approve-export.test}.mjs`,
`tools/buildspec/normtype.test.mjs`, `docs/flowmap/edge-advisory-allowlist.txt`, `.claude/settings.json`.
Edited: `package.json` (scripts + suite), `spec-gate.yml` (CI), `roadmap.json` (A5 + Phase F + C2/C3 hardening),
`trust-report.mjs` (edge tiering), `skeleton.mjs` (A6 normalizers), `CLAUDE.md` (Session protocol + A5/F defs).

## 2. What "green" now means

`npm run flowmap:verify` green ⟺ the map is structurally true + complete (A1) **and its edges
are code-backed-or-audited (A5)**. The signature gate now compares object-literal/function types
too (A6) — 1 prose hole remains (a single-quoted dynamic-import type, genuinely non-normalizable).
`desc=` strings are still ADVISORY by design.

## 3. Remaining intent (run `npm run flowmap:roadmap` for live status)

The understand→…→re-sync loop and the **meta-loop** (agent protocol) are both built and CI-enforced.
Honest remaining edges, none blocking:
- 1 prose type hole (see above) — needs type-resolution to close, low value.
- 4 advisory edges are *audited*, not *proven* — they are real `ctx.hooks`/runtime relations with
  no import (invariant #2). Proving them would need call-graph extraction through `ctx.hooks`; the
  allowlist is the deliberate, reviewed boundary until then.
- The SessionStart/Stop hooks live in `.claude/settings.json`; they fire in *this* harness. They are
  the forcing half; F4 (CI) is the verifying half.
