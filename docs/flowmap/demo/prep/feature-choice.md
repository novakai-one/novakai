# M9 demo feature — pick + English request

## English request (hand this sentence to the 0-context demo agent, verbatim)

> Add a live status readout to the unfold panel that shows how many nodes and
> edges the diagram has, and appends "· 1 selected" when something is
> selected — the same information the legacy editor's status bar shows,
> ported to the primary surface so you never have to switch to legacy to see
> it.

---

## Candidates evaluated

Two parity rows I initially considered are **already built** (stale rows —
flag for a parity-checklist re-sync, but do not pick either as the demo
feature since there is nothing left to implement):

- **Esc behaviour** (§D, row "Esc behaviour ... legacy-only"): `src/panel/unfold-esc.ts`'s
  `ufEscAction` already returns `'none'` at the bottom of its priority chain
  with the comment "Escape never exits unfold (the old close() branch is gone
  by design)" — the M4-correction fix is already landed.
- **Zoom** (§D, row "Zoom ... legacy-only⁷"): `src/panel/unfold.ts:431-433,2529-2531`
  already wires `#ufZin`/`#ufZout`/`#ufZfit` to `viewXform.k` +/- and
  `fitView(true)` — manual zoom in unfold is already built.

### Candidate 1 — Status bar reaches unfold (RECOMMENDED)

- **Row**: §D "Status bar (node/edge/sel counts) | passive | `inspector`
  (`updateStatus`) | deferred-by-decision (trivial to re-add)".
- **What changes**: one new dependency-free pure file
  `src/panel/unfold-status.ts` exporting `ufStatusText(nc, ec, sel) -> string`
  (same precedent as `unfold-esc.ts`/`unfold-dock.ts`/`unfold-slice.ts`/
  `unfold-verbs.ts`); `unfold__initUnfold` (`src/panel/unfold.ts`) modified to
  add a `#ufStatus` span to the dock tab-strip markup and a `refreshStatus()`
  call from the existing repaint + selection-commit paths. `UnfoldApi`'s
  signature is **unchanged** — no new constructor deps, since node/edge
  counts (`ctx.state.nodes`/`.edges`) and selection (`spec.sel`) are already
  in scope inside `initUnfold`'s closure.
- **Blast radius**: 1 new node (`unfold__ufStatusText`, add) + 1 modified
  node (`unfold__initUnfold`, modify, description-only signature delta) + 1
  new edge (`unfold -> ufStatusText`, matching the existing internal edges to
  `ufEscAction`/`ufDockReduce`/`ufSliceTargets`/`ufVerbAllowed`). Nothing
  outside `src/panel/unfold*.ts` moves.
- **Why it demos well**: on camera, selecting/deselecting cards in unfold
  visibly changes a live counter every reviewer immediately understands; the
  pure formatter gives 5 real red-then-green acceptance cases (pluralisation,
  selection suffix, empty-string-sel edge case) that `flowmap:acceptance`
  can run — Keystone 2 bites cleanly, not just the signature gate.
- **Risks**: low. Pure `add` + `modify` only (no `remove`, so no permanent
  plan-check red per the KNOWN_EDGES `remove` gap). Must not collide with the
  existing tab-scoped `#ufCount` ("N shown", browse tab only) — the plan note
  calls this out explicitly as a design constraint the implementer must
  honor.

### Candidate 2 — Extract `toast` out of `tabs`

- **Row**: KNOWN_EDGES standing item / §D "Toast notifications | app-wide via
  `ctx.hooks.toast` | `tabs` (`toast`) — chrome module owns a shared hook |
  legacy-only⁸. `toast` must be extracted from `tabs` before `tabs` can die."
- **What changes**: new module (e.g. `src/panel/toast.ts`, `initToast(ctx) ->
  ToastApi { toast }`, reusing the existing `#toast` DOM node already in
  `index.html:215`, independent of `tabs`' own panes); `tabs__TabsApi`
  narrows (`toast` removed from the interface, a real signature change);
  `main.ts` rewires `ctx.hooks.toast = tabs.toast` (line 138) to the new
  module and the two direct call sites (`main.ts:162,168`) to call it
  instead of `tabs.toast`. The 12 other call sites across `src/` all go
  through `ctx.hooks.toast` and need **no** change — the hook indirection
  insulates them, keeping the blast radius small despite toast being used
  app-wide.
- **Blast radius**: 1 new module (add) + `tabs` modified (interface
  narrows) + `main.ts` modified (composition wiring, 3 call sites). Real
  signature change on `TabsApi` (bites contract/verify-change).
- **Why it demos well**: directly closes a named standing item from
  KNOWN_EDGES.md, so the recording doubles as proof that a specific,
  previously-recorded sharp edge got closed. Visually: trigger a toast
  (e.g. copy mermaid) and show it now originates from the new module.
- **Risks**: `toast()` itself is pure DOM I/O (`textContent` + `classList` +
  `setTimeout`) — there is no pure sub-behaviour worth an acceptance case, so
  Keystone 2 would ride on the signature gate alone (`hasBehaviouralContract:
  false` in `verify-change`'s own honesty flag) unless a synthetic pure
  helper is invented just to have one, which would be scope creep for a demo
  feature. Slightly larger diff surface (3 files) than Candidate 1.

### Candidate 3 — Help overlay reachable from unfold

- **Row**: §D "Help overlay (`?`) | helpBtn | inline in `main.ts` |
  legacy-only (unfold needs its own shortcut ref)".
- **What changes**: `main.ts:190-192` currently just toggles the legacy
  `#helpOverlay` div (static markup in `index.html:164`). Porting this means
  either a new overlay-scoped `?` handler in `unfold.ts` reusing the same
  DOM, or a genuinely new unfold-native shortcut reference panel listing the
  M5 A-verbs shortcuts (⌘C/⌘V/⌘D/⌘Z/Delete) that already exist per
  `m5-a-verbs.plan.json`.
- **Blast radius**: comparable to Candidate 1, but needs new overlay
  markup/CSS (more DOM than a one-line status span), and the "right" content
  (which shortcuts to list) is a design decision, not just a wiring job —
  more prose-dependent than a pure-formatter feature.
- **Why it's weaker for THIS demo**: less clean acceptance story (a static
  shortcut list is closer to a content decision than a testable behaviour),
  and larger DOM footprint for the same "small, one-module" bar Candidate 1
  clears more cheaply.

## Recommendation

**Candidate 1 — status bar reaches unfold.** It is the smallest true `add` +
`modify` pair (one pure function, one wiring change, zero new deps), the
parity-checklist itself already calls it "trivial to re-add", it carries a
real, richly-testable pure signature (5 acceptance cases land cleanly on the
existing `ufEscAction`/`ufDockReduce`/`ufSliceTargets` precedent so
`flowmap:acceptance` and `verify-change --strict` both have real work to do),
and the on-camera payoff (a live counter that changes when you click) is
immediate and legible to a human reviewer with zero explanation needed.
Candidate 2 (toast) is the next-best pick if a second demo run is ever
wanted — it closes a named standing debt item, but its lack of pure
sub-behaviour makes the Keystone-2 acceptance story weaker for a *first*
recorded run of the whole loop.
