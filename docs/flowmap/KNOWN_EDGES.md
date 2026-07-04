# Known edges — durable sharp edges and standing verdicts

> Promoted from `SESSION_HANDOFF.md` session entries at rotation (2026-07-03) so they
> cannot age out with the archive. Each entry is either **verifiable now** (a command or
> file pointer) or **provenance-labelled** (recorded by the session that landed the
> feature — re-verify at the pointer before relying on it). When an edge is closed,
> delete its line; this file lists live constraints, never progress.

## Tooling sharp edges

- `tools/buildspec/extract.mjs#findSymbol` returns the FIRST same-named declaration in
  document order, so a local variable named like a mapped closure symbol reads as gate
  drift. Latent for any future closure node (previously hit by a `treeRow` local).
  Verify: read `findSymbol` in `tools/buildspec/extract.mjs`.
- `flowmap:verify-change`'s `PASS_UNPROVEN` verdict exits 0 exactly like `PASS`. A caller
  that wants 100%-proven execution must check `verdict === "PASS"` in the JSON (or run
  `--strict`, H3) — never the exit code alone.
- Plan lifecycle gap (recurred 3×): once an `add` change lands, it must be hand-flipped
  to `modify` to keep `flowmap:plan-check` coherent. A built-add→done transition is a
  candidate roadmap item; until then expect this manual flip on every landed add.
  The `remove` flavour has NO workaround: once a remove lands, its node is gone from the
  base map and REAL-IDS fails permanently (plan-check is an authoring-time gate, C3).
  `flowmap:status` stays truthful ("node removed" = BUILT) and CI plan-check targets
  `public/plan.json`, so a landed plan's red plan-check is expected, not a regression
  (live examples: m5-boot-flip, m4-read-primary).
  A third flavour (recurred 2026-07-03): CUMULATIVE SEQUENTIAL PLANS — when a later
  plan's `modify` deliberately widens the same node's signature (declared cumulative in
  both plan notes, e.g. `initUnfold`), the earlier plan's row flips BUILT→DRIFTED the
  moment the later plan lands. Expected supersession, not regression: the final code
  matches the LATER plan's fm exactly (its status shows BUILT), and the earlier state is
  verifiable at the commit that landed it (live example: m5-p-tabs2's `uf-dock-tabs2`
  after m5-a-verbs — BUILT at 9bb8597, superseded by 7abcf5d).
- `flowmap:orchestrate` (H4) is a v1 driver: it provisions per-change worktrees and
  routes strict-aware verdicts via the main repo, but no build agent is wired INSIDE the
  worktrees yet. The gate cannot run inside a HEAD worktree (no gitignored `node_modules`).
- Metrics log caveats (design: `docs/flowmap/m2b-metrics-design.md` §3/§8/§11): the
  emitter is fail-silent by design (`FLOWMAP_METRICS_DEBUG=1` surfaces emit errors);
  `quiz verify` is deliberately unlogged (edit-gate spawns it per src edit); the log
  includes tool-driven runs, not only agent-initiated ones; there is no rotation/pruning.
- The tooling self-map (`docs/flowmap/_tooling.mmd`, I1) is module-level completeness,
  structure-only — `.mjs` carries no signature gate. Its truth is
  `npm run flowmap:tooling:verify` plus each module's `node --test` suite, not the
  ts-morph gate that covers `src/`.
- **Harness hook JSON vocabulary (observed live 2026-07-04, session 5):** a PreToolUse
  hook's stdout `decision` must be `"approve" | "block"`. `"deny"` fails the harness's
  schema validation and is downgraded to a NON-BLOCKING error — the tool call proceeds;
  only a `hook_non_blocking_error` attachment records it. Every flowmap gate emitted
  `deny` from birth, so **no gate had ever actually blocked live** before the 2026-07-04
  fix. Any new gate must emit `block`. Verify: `grep -n "decision: 'block'" tools/flowmap/*-gate.mjs`
  → 4 gates.
- **Harness PreToolUse timing (falsifies the original hookTiming validation):** the
  in-flight call's assistant message is NOT yet in the transcript when the hook runs.
  Transcript-based streak gates therefore see only PRIOR calls: turn-gate denies on the
  (THRESHOLD+1)th lone read, and after a deny→retry cycle the FIRST read of a following
  batched response can bounce once more (the in-flight batch is invisible; its second
  read passes via the marker; once the batched message lands the streak is broken —
  bounded to one bounce, accepted not fixed). Recorded in `turn-baseline.json`
  `validation.hookTiming`.
- **Transcript format drift (2026-07-04):** subagent spend in session transcripts is now
  `<subagent_tokens>N</subagent_tokens>` (was `subagent_tokens: N`), and the same
  notification line can be re-emitted 2-3×. `turns.mjs` matches both forms and dedupes
  before summing; any NEW transcript-derived metric must do the same or it over/under-counts.
  Verify: `node --test tools/flowmap/turns.test.mjs`.

## Map trust boundaries

- 4 advisory edges are audited, not proven — real `ctx.hooks`/runtime relations with no
  import. 1 prose type hole remains (a single-quoted dynamic-import type, genuinely
  non-normalizable). Verify the live split: `npm run flowmap:trust`.
- The SessionStart/Stop protocol hooks live in `.claude/settings.json` and fire only in
  this harness; F4 in CI (`flowmap:handoff:check`) is the verifying backstop.
- **Standing verdict (2026-07-04) — `ctx.hooks` members are not, and will not be, enumerated
  as map nodes.** The ship-staleness bullet above (2026-07-04) observed that individual
  `Hooks` members (`plannerOpen`, `enterContainer`, etc.) hit 0 hits in `_bundle.mmd` despite
  being real, wired hooks (verify: `grep -c "enterContainer\|plannerOpen" docs/flowmap/_bundle.mmd`
  → 0). Ruling: this is correct, not a gap — `ctx.hooks` members are type-level detail inside
  the exported `Hooks` type (`core/context/context.ts`); the map stays symbol-level (one node
  per exported symbol, per A1), not member-level inside a type. The real member list lives in
  `public/bodies.json` under the `context` node's `Hooks` type body, and is gate-checked via
  that type's signature (`flowmap:gate`), same as any other exported type. Do NOT add per-hook
  nodes to the map — a per-member map would be a different, finer-grained completeness unit
  than A1/A5 define and would need its own gate, not an ad hoc addition.

## App edges (provenance: the session entries now in `handoff-archive.md`)

- The unfold/stage/wire closure keystones (incl. `ufOpen`/`ufClose`) are mapped
  structure-only — ctx/DOM-bound, no behavioural contracts. The E2/H1 factor-to-pure
  rule applies whenever contracts are wanted for them.
- The `deriveView` + dumb-painter layer is deliberately deferred (M4/M5 seam): the
  reducer and pure mutation logic are acceptance-proven; the painters remain DOM-bound.
- `sel`/`stage`/`query` are stored in the v1 ViewSpec but not restored on boot — an open
  M5 decision, additive.
- Stage-mode wire-click is a noop — open gap from the UX-repair stages.
- Proxy pills do not reposition on window resize until the next interaction.
- On the first open after a reload, the trust layer's restore races the allowlist fetch
  (the layer arrives off — never wrong, just off until toggled).
- A wire mid-`.uf-enter` animation is recreated without the class at the settle redraw
  when many cards stagger (visual only).
- The hub-fade threshold (out-degree > 8) and weight-ramp exponent (.6) are tuned by
  eye in this repo, not derived.
- Proxy selection-filter deviation from the prototype (deliberate): frame-attributed
  module-level links persist when a card is selected; only child-attributed links are
  filtered — without this, staging via leaf-select would show zero pills.
- A synthetic `dispatchEvent(new PointerEvent('pointerdown', …))` (no OS-backed pointer
  id) trips `stageEl.setPointerCapture` in `unfold.ts` (~line 952) with a pageerror.
  Harness artifact only — real mouse input never produces it (isolated + reproduced
  2026-07-03, see `docs/flowmap/probes/m5-tabs2-verbs.probe.js` header). Drive probes
  with genuine `page.mouse` input, never fabricated PointerEvents.

## Standing human verdicts (Chris, 2026-07-02 — supersede only with a new verdict)

- `read-review-overlay`: POSTPONED. Design-review-first — do not build without human
  review, regardless of plan pendency.
- U8 (selection promotes to main stage, UX-repair stage 5): design-first, still open —
  produce an interaction design proposal for Chris BEFORE any code.
- Git workflow (Chris, 2026-07-03): **never commit on `main`** — not even docs. Work on
  a feature branch, push, open a PR (`curl` + `git credential fill`; no `gh` CLI on this
  machine); Chris approves and merges. GitHub branch protection blocks a `main` push, but
  nothing blocks a LOCAL `main` commit — the mistake surfaces only at push time, so the
  branch must exist BEFORE the first commit of a session. Verify the remote state:
  `git log --oneline origin/main -1` vs your branch.
