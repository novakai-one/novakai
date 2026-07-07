# Design Delta — APPROVED APPLY BRIEF (2026-07-07)

Chris-approved rulings over `260707_DESIGN_DELTA_SPEC_DRAFT.md`. This file is the ONLY
authority for the fix round. The draft spec holds the exact measured values; this file says
which deltas apply and how the conflicts were ruled. Target file:
`novakai_vision_prototype.html` (this folder). **Zero functional changes** — layout, spacing,
typography-size, grouping, borders, density only. All existing behavior, wiring, timers,
state machine, and dataset stay byte-identical in effect.

## Chris's rulings on the flagged conflicts (all law KEPT — no overrules)

- **Typeface:** NO serif. Take the reference's size/hierarchy jump in `var(--sans)`.
- **Radius:** KEEP 9px house radius everywhere. Chris explicitly prefers less-round corners.
  - **Bonus directive from the same ruling: Chris hates rounded oval/capsule pills.** Status
    pills/chips must not read as capsules — use a squarer chip (≤6px radius on small chips is
    fine; never fully-rounded). Apply to the list status pills and any chip-shaped element.
- **Subtitle:** stays REMOVED (do not re-add delta 6).
- **Trust seal:** untouched — keystone rule, three sentences, seal ceremony all stay exactly
  as-is (delta 7 rejected).
- **List bottom-anchor + footer command line:** stays (delta 9 list-half rejected).
- **Light theme / warm hues / theme pickers / Newsreader:** rejected per the draft's
  NOT-deltas section. Two-actor color law (§3.2 KEY_DECISIONS) is inviolable.

## APPLY these deltas (numbers reference the draft spec; use its measured values)

1. **D1 (sans half):** Large display page titles in `var(--sans)`. Builds list gains a page
   title `Builds` (~40px, weight 500, tight tracking ~-0.4px) under its eyebrow. Build
   document title scales from 19px to display size (~32–40px — judge against the header row
   layout; status pill stays adjacent but must not crowd). List-card build title ~20–25px.
   **Chris clarification (2026-07-07): titles are page/document headings, literal and
   descriptive only.** Each build IS a page — its heading is the job's name verbatim
   ("Minimap viewport sync"), never dramatic prose or a pitch (§1.9 stands; the old
   no-headings rule was about sales copy, not about descriptive document titles). The
   **Prototypes list gets the SAME page-title grammar** (`Prototypes` + eyebrow) — it is a
   base/list page like Builds. **The Canvas gets NO heading of any kind — explicitly
   inappropriate there.**
2. **D2 (geometry half):** The build that needs the human becomes a raised card — 9px radius,
   1px border, **neutral slate tone-step fill** (must NOT read amber/warm; verify against
   §3.2), padding ~26px 28px, title + existing one-line note + inline `Review →` affordance
   that triggers the EXISTING row-open behavior (no new wiring). Completed/other builds
   demote to quiet borderless rows.
3. **D3:** Group the list by state — actionable card(s) on top; completed under a `DONE`
   section label with hairline rule; right-aligned roll-up `N builds · M needs you` computed
   from existing state. Color: ink/neutral, or periwinkle on the needs-you fragment (human
   judgment = periwinkle is law-legal). Never a warm/new hue.
4. **D4 (additive half only):** Keep the tide-mark rail + rail labels EXACTLY as-is. Add
   count metadata beside the rail labels (e.g. `2 proven · 1 needs you`, `3 nodes touched`).
   Collapse secondary sections (contract/impact detail, activity/"how it got here") to
   expandable rows — expand/collapse MUST use `grid-template-rows 0fr→1fr` (engineering law
   4.2), quantized durations 120/240ms, house easing, instant on keyboard (§3.5).
5. **D5:** Raise `Approve` / `Request changes` to sit directly under the build-document
   title area, above the evidence. PLACEMENT ONLY: same handlers, same disable-on-click,
   approve→deploy remain two distinct acts (§1.7/§1.12).
6. **D9 (document half):** Left-align the build-document reading column under a persistent
   header instead of horizontally centering it. Column width stays 760px (§3.4 binding).
7. **D10:** Eyebrows: sans, 10–11px, weight 500, uppercase, letter-spacing ~1.5px, placed
   directly above page titles as `NOVAKAI · BUILDS` grammar. Top-bar breadcrumb stays.
8. **D11:** Density pass: airier actionable blocks (padding 20–28px), body line-height ~1.5,
   quieter roomier done-rows — paired with the delta-4 collapses so net first-look density
   improves.

## Hard constraints (violating any = failed round)

- Canvas, semantic zoom, dataset, state machine, router, timers: untouched. The Canvas gets
  NO page heading (Chris, explicit). At z ≤ 1.25 the canvas must stay pixel-identical to the
  current build.
- Prototypes tab: the ONLY change allowed there is the page-title + eyebrow grammar from
  delta 1 (it is a list/base page like Builds). Everything else on that tab: untouched.
- Two-actor color law §3.2. Motion law §3.5 (idle = zero moving pixels; no new timers —
  collapses are CSS-driven). No progress bars/spinners/toasts (§3.9).
- After editing: `node --check` the extracted script, then self-check in real Chromium
  (file:// URL, 1440×900): zero console/page errors, drive both scenario lanes end-to-end,
  screenshot Builds list + build document before/after and LOOK at them.
- Append a short §8 to `260707_KEY_DECISIONS.md` recording this round's rulings (sans kept,
  9px kept + anti-capsule pills, subtitle stays removed, seal untouched, hierarchy/card/
  grouping/decision-first adopted from the design-idea references).

Independent verification follows this round — the builder's self-report is not acceptance
(KEY_DECISIONS 2.4).
