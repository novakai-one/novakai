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
## 0·now (2026-07-03, this session) — M5 P-panel LANDED: the panel is a real dock (tabs at the reveal strip · resize · collapse) + the io/mermaid §B tabs batched in; acceptance 0/15 → 15/15; runtime-probed in headless Chrome

The second §G item, **P-panel**, is implemented per the ruling (plan:
`docs/flowmap/plans/m5-p-panel.plan.json`): the pure `ufDockReduce`
(`src/panel/unfold-dock.ts`, unfold-esc/unfold-lift precedent) owns every chrome decision —
tab switching (a tab click always expands a collapsed panel; unknown/active tabs are no-ops),
collapse, width clamping [240, 580], and normalization of the persisted value (localStorage
`unfold.dock`, a GLOBAL chrome preference, deliberately not the per-diagram ViewSpec). The
strip literally typed "reveal" is now the tab row (reveal · io · mermaid) with a collapse
chevron; a drag handle on the panel's left border resizes; collapsed leaves a slim rail.
BATCHED §B migrations landed on the new tabs: **io** (save .mmd / load .mmd / load
bodies.json — exposed on `FilesApi` as `loadMmdText`/`loadBodies` so the legacy inputs and
the tab share ONE code path) and **mermaid** (serialised text / apply / copy — the mermaid
module stays the only serialiser; apply goes through `ctx.dom.mmd` + `applyText`). Branch
`m5-p-panel` — Chris reviews and merges. Never commit on `main` — standing verdict in
KNOWN_EDGES.md.

| What | Verify it yourself | Expect |
|---|---|---|
| Plan fully landed (4 changes) | `npm run flowmap:status -- --plan docs/flowmap/plans/m5-p-panel.plan.json` | 4 built · "Plan fully landed" |
| Behavioural contract green (was 0/15 red) | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-p-panel.plan.json` | 15/15 green, exit 0 |
| Plan still author-coherent post-landing | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/m5-p-panel.plan.json` | coherent (the landed add was flipped to modify per KNOWN_EDGES) |
| M5 per-feature predicates | `npm run flowmap:mvp` | `M5` shows (7/7); manual note remains (more rows to drain) |
| Map re-synced, gate + edges green | `npm run flowmap:ship` | DONE line; 0 unaccounted edges |
| Full tooling suite | `npm run spec:test:all` | exit 0, no failures |
| Full CI-equivalent chain | `npm run flowmap:verify:full` | DONE line |
| Ban holds on all docs | `npm run flowmap:roadmap:audit` | both scans ✓ |
| Runtime (browser): tab row at the reveal strip; io round-trips .mmd + bodies; mermaid applies; resize clamps; collapse rail; reload restores | boot `npm run dev`, click the io / mermaid tabs, drag the panel's left border, click the chevron, reload | tabs switch bodies; load root.mmd rebuilds the surface; width clamps 240–580; rail expands back; `unfold.dock` restores; 0 console errors |

**Honest boundaries (do not oversell):**
- Dock persistence is global (`unfold.dock`), not per-diagram — recorded assumption; flip to
  ViewSpec later if Chris rules otherwise.
- Clicking the active tab does NOT collapse (no-op); collapse is only the chevron — recorded
  assumption in the plan note.
- The mermaid tab transports apply through the legacy `ctx.dom.mmd` textarea (the mermaid
  module reads it); the legacy toast renders under the unfold overlay, so apply/copy feedback
  is invisible while unfold is open — cosmetic, dies with the legacy chrome.
- nav / slice / style §B rows are NOT migrated (nav overlaps unfold's browse search — needs a
  design ruling, not a port; slice/style are design-heavy). They land as future tabs on this
  infrastructure.
- Resize reframes the stage once at drag end, not per pixel; mid-drag the stage does not
  reflow (deliberate).
- The runtime probe (headless system Chrome via CDP against `npm run dev`, fresh profile)
  verified 9 criteria incl. a real diagram.mmd download, root.mmd + bodies.json loads through
  the real file inputs (`DOM.setFileInputFiles`), a trusted-input resize drag with both
  clamps, collapse/expand, and reload persistence — 0 exceptions, 0 console errors. The probe
  script is session-scratch, not repo tooling.

**Next (Scenario 1):** per the checklist the remaining §B tab migrations are **nav / slice /
style** (now unblocked by the tab infrastructure; nav needs a design ruling vs unfold's
browse search first), then §A model verbs, with **diff/plan review last** by ruling. Author
each plan with acceptance red before code, per the loop. Resume: `npm run flowmap:onboard`,
then `npm run flowmap:mvp` for the computed M5 state; the parity checklist rows are the
feature enumeration. `npm run flowmap:mvp` computes it all — never this file.

## Archive + durable edges

Superseded session entries live in `docs/flowmap/handoff-archive.md` (historical record,
nothing load-bearing). Sharp edges and standing human verdicts that outlive their session
entries live in `docs/flowmap/KNOWN_EDGES.md` — read that before designing against
tooling or unfold internals; do not re-derive them from the archive.
