# Handoff — slice work (done) + token-reduction path (to implement)

Branch: `reorg/src-responsibilities`. This branch is doing **two** things at once:
1. A repo/module reorg (see **`REORG_HANDOFF.md`** — that is the source of truth for the reorg).
2. Slice + agent-token work (this doc).

Read this, then `REORG_HANDOFF.md`. The map gate is **intentionally red** until the reorg
resync — do not "fix" it by forcing a stamp; that is the one lie novakai exists to prevent.

---

## Branch state (all committed, tsc-green, tree clean)

```
30e0c5a feat(slice): one shared slice formula + body slice in reading mode   <- this session
d5b305e reorg: command-anchored handoff (R1 landed; R2/R3 + map resync deferred)
2fb5ec5 reorg(unfold): split unfold.ts into view/wires/inspect/session/stage (tsc-green)
975d06f reorg: contract (plan.json) for src responsibility reorg
```

---

## Done this session — `30e0c5a` (slice made trustworthy + bodies in the UI)

Context: the slice is the mechanism that lets an agent get a node's neighbourhood at a
fraction of the tokens of the full map. It was broken in two opposite ways; both fixed.

- **One shared slice formula.** `src/panel/nav/slice.ts` `sliceFor` now computes its keep set
  via the shared `sliceModel(state, ids, { up: true, refs: true })` from
  `tools/buildspec/core/slice-core.mjs` — the same slicer the contract uses. Dropped the
  editor's duplicate `sliceIds`/`sliceStubs` path.
  - Why: the map is a `main`-rooted composition spine — **solid** edges = `main --> everything`,
    **dotted** edges = real deps. Old editor slice walked solid up to `main` then stubbed in
    all ~40 of main's children ("3 nodes · 43 boundary stubs" = whole map). Contract's old
    `{ down: true }` walked solid children of a leaf = **nothing** (1-node slice). Both wrong
    for the same reason. `{ up, refs }` = parent + real dotted deps = the useful neighbourhood.
- **Contract uses the same formula.** `tools/novakai/contract/contract.mjs` slice opts
  `{ down: true }` → `{ up: true, refs: true }`.
- **Serializer parity.** `tools/buildspec/core/mmd-parse.mjs` `toMmd` now emits **edge labels**
  (`from -->|label| to`); it already emitted `fm:meta`/kind/groups. So the contract packet no
  longer loses detail vs the editor's `toMermaid`. (63 tooling tests pass.)
- **Body slice in reading mode.** unfold slice tab now shows a **"Body slice"** pane under the
  mmd slice: the source bodies of every sliced node (`ctx.bodies` exact-key, same as
  `filterBodies`). `sliceFor` returns `ids` for this. Copy button copies **mmd + bodies**.
  `unfold.ts` (markup `#ufSliceBodies`/`#ufSliceBodiesInfo`) + `unfold-inspect-2.ts`
  (`renderSliceTab`). Module-level nodes have no `__symbol` body key → shown blank (expected,
  matches the packet); fn-level nodes fill in.
- **`sliceStubs` in `src/core/state/state.ts` is now dead in `src/`** (only the generated map +
  a verify doc-comment reference it). Left in place — deleting a mapped export needs a map
  resync. Delete it during the reorg resync.

Nothing here changed behaviour of the reorg-split modules.

---

## Continuation 1 — finish the reorg (see `REORG_HANDOFF.md` for detail)

Left: **R2** (io+render), **R3** (core/ide), **Phase B** folder moves + `main.ts` rewrite, and
the **deferred map resync** (repath `%% src` in the split fragments, then `npm run novakai:ship`;
delete dead `sliceStubs` in the same pass). Code split first, map resync last, per Chris's call.

---

## Continuation 2 — the real objective: cut agent development token cost

**The problem, grounded:** every agent is told (CLAUDE.md working rules + SessionStart onboard)
to read `docs/novakai/_bundle.mmd` (250 KB / 4,401 lines ≈ ~60K tokens) **plus**
`public/bodies.json` (616 KB ≈ ~150K tokens) before its first edit — **~200K+ tokens** of
mandated reading per session (`tokensToFirstSrcEdit` median ~3M). A slice like the one now in
the panel is ~5–6 nodes + a few bodies ≈ **2–4K tokens**. Ceiling on savings ≈ **50–100×** — IF
the slice is sufficient context, which is the one thing still **unverified**.

**Key structural fact (already in the code):** `tools/novakai/gates/edit-gate.mjs` gates a
**subagent by its contract packet** (the slice), **not** the quiz — only the **main agent** is
quiz-gated on the full map. So "give the subagent a slice instead of the whole map" is the
existing C2 design; this session's fixes just made the packet rich enough to rely on.

### Recommended path (in order)

- **Phase 0 — regenerate the map (unblock).** The map is stale (onboard STOPs on unmapped
  `unfold/*`; quiz-pass goes stale when the map changes). This is the reorg resync above —
  do it first. `npm run novakai:ship`, commit map + `ship-stamp.json`. Also makes quiz
  questions accurate again (they generate from the map).
- **Phase 1 — prove the slice is enough (one experiment; de-risks everything).** Take one real
  task. Spawn a subagent with **only** its contract slice packet (rich mmd + bodies) — no
  full-map read — and see if it completes correctly. Measure `tokensToFirstSrcEdit`
  (`npm run novakai:turns`). This is the empirical answer; do it before touching any gate.
- **Phase 2 — make the slice the default context unit.**
  - Subagents: rely on the packet as their whole context (already the design). Contract slices
    `{ up, refs }` + bodies around the target `ref`; the orchestrator picks the ref from the
    plan. The new slice panel lets a human eyeball the exact packet before spawning.
  - Main agent: use the scoped track (`novakai:onboard --continue --plan`, already exists) for
    scoped/continue work; reserve full-map onboard for genuine whole-app design.
- **Phase 3 — trim blocks that don't earn their cost.**
  - CLAUDE.md working rule "read bodies.json + _bundle.mmd before any claim" → "read the slice
    for the area you touch." Kills the mandated full reads.
  - Quiz non-blocking: **test behind a flag and MEASURE drift** — don't just flip it.

### On "blocks that aren't helping"
- **Full-map mandatory reads** — the real waste. Replace with slices.
- **Quiz gate** — *keep it*, don't remove. It is the "0-drift subagent" trust keystone. **Shrink
  its scope to the slice** → get the tokens back without losing the guarantee.
- **Broken onboard on a stale map** — pure friction now. Fixed by Phase 0.

**Headline: don't delete the gates — shrink their scope from the whole map to the slice.**

---

## Gotchas carried from the reorg (don't relearn the hard way)

1. Subagent edits need `NOVAKAI-CONTRACT` + `NOVAKAI-PLAN` sentinels — prose briefs get
   gate-denied.
2. `isolation: worktree` branches from the base commit (no plan) → gate blocks; run in the
   main tree.
3. Big files balloon an agent past ~300K and it drifts — chunk small, commit at first green.
4. Map resync needs a symbol→file manifest from the split agent; grep is ambiguous.
