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
## 0·now (2026-07-03, this session) — M5 P-wires LANDED: edge lifting — wires never cross foreign containers; acceptance 0/11 → 11/11; runtime-probed on the repo's own map

Chris's second-pass rulings are recorded in `parity-checklist.md` (new §G + rulings header:
panel resize/collapse + tabs at the "reveal" strip are ruled-in M5 work; all candidate-drops
deferred to backlog; diff/plan sequenced last). The first §G item, **P-wires**, is
implemented per Chris's design (`docs/flowmap/plans/m5-p-wires.plan.json`): the pure
`ufLiftWires` (`src/panel/unfold-lift.ts`, unfold-esc precedent) lifts every wire to sibling
anchors under the lowest common container, counts concealed endpoints for a mid-path badge,
and encodes the travel-depth rule — selected leaf = atomic reveal with arrowheads, selected
group = crossing wires anchored AT the group and highlighted, selected wire/badge = explode
into underlying relations; arrowheads exist ONLY on atomic reveals; opposite directions
merge by weight majority. `drawWires` paints the decision; `requestRoutes` routes per
containment scope with group boxes as obstacles (atomic reveals route against cards only);
the wire inspector resolves carries through the same decision. Branch `m5-p-wires` —
Chris reviews and merges. Never commit on `main` — standing verdict in KNOWN_EDGES.md.

| What | Verify it yourself | Expect |
|---|---|---|
| Plan fully landed (4 changes) | `npm run flowmap:status -- --plan docs/flowmap/plans/m5-p-wires.plan.json` | 4 built · "Plan fully landed" |
| Behavioural contract green (was 0/11 red) | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-p-wires.plan.json` | 11/11 green, exit 0 |
| Plan still author-coherent post-landing | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/m5-p-wires.plan.json` | coherent (the landed add was flipped to modify per KNOWN_EDGES) |
| M5 per-feature predicates | `npm run flowmap:mvp` | `M5` shows (4/4); manual note remains (more rows to drain) |
| Map re-synced, gate + edges green | `npm run flowmap:ship` | DONE line; 0 unaccounted edges |
| Full tooling suite | `npm run spec:test:all` | exit 0, no failures |
| Full CI-equivalent chain | `npm run flowmap:verify:full` | DONE line |
| Ban holds on all docs | `npm run flowmap:roadmap:audit` | both scans ✓ |
| Runtime (browser): no wire crosses a foreign container; no default arrowheads; badges; group/leaf/wire selection rules | boot `npm run dev`, load `docs/flowmap/_bundle.mmd` via the mermaid tab, expand groups, then select a group header / a leaf via the tree / click a badge | 0 crossings; arrows only after leaf-select or badge-click; inspector lists the exploded wire's carries |

**Honest boundaries (do not oversell):**
- Concealed-count definition (assumption, recorded in the plan note): distinct real
  endpoints hidden behind BOTH anchors (union), not a per-side count.
- Lifting generalises Chris's "stops at outermost group" to lowest-common-container —
  strictly stronger (wires inside an expanded group respect inner boundaries too).
- Stage-mode wires are untouched (already aggregated + arrowless); the stage wire-click
  noop gap in KNOWN_EDGES.md still stands.
- Port-slot dispersal (arrowhead convergence crowding) is DEFERRED as its own build item,
  per Chris's ruling in the message that approved this build.
- Clicking a revealed strand selects its parent aggregate (deliberate: every wire click
  tells the aggregate story; re-click toggles off).
- Blast-radius wire dimming is keyed on lifted anchors — approximate when an anchor sits
  above the blast rep (cosmetic only).
- The runtime probe drove headless system Chrome via CDP against `npm run dev` with the
  repo's own bundle applied through the mermaid tab; geometry was asserted by sampling
  every drawn path against every expanded group box (0 violations, three interaction
  stages, 0 console errors). The probe script is session-scratch, not repo tooling.
- A 0-context agent independently re-ran all 5 command checks and 5 runtime criteria
  (overall PASS) and added two geometric checks the probe lacked: the selected group's
  hot wire terminates exactly on the group border (anchoring proven, not inferred), and
  the badge texts are real concealed-counts (5, 21, 5, 2, …), not decoration.

**Next (Scenario 1):** per the updated checklist (§G) the next item is **P-panel** —
inspector dock resize + collapse and panel tabs/sub-menus anchored at the "reveal" strip
(prerequisite landing zone for the §B tab migrations: io, nav, slice, mermaid, style).
Author its plan with acceptance red before code, per the loop. Resume:
`npm run flowmap:onboard`, then `npm run flowmap:mvp` for the computed M5 state; the parity
checklist rows are the feature enumeration. `npm run flowmap:mvp` computes it all — never
this file.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
