# V3 Corrections & Engineering Addendum (binding; overrides plan V3 where they conflict)

These were issued mid-build from the adversarial plan review and a 3-agent engineering
consensus. Any agent working on `novakai_vision_prototype.html` must honor all of them.

## Architecture

1. Pure state-machine rendering: ALL build lifecycle state lives in in-memory state
   objects; timers mutate STATE only; pages are pure renders of state. No setTimeout ever
   writes DOM directly. Navigating away mid-build and returning re-renders correct
   progress. Hash carries page/id only, never lifecycle state. Unknown build/prototype id
   in hash → redirect to the list page with a designed one-line not-found state.
2. Build document sections all render from the start as collapsed "pending" placeholders
   and expand in place when real — never insert sections mid-scroll.
3. Expand/collapse via `grid-template-rows: 0fr→1fr` (child overflow:hidden, grid item
   min-height:0, padding on an inner element). No measured max-height.
4. Draft canvas module is a factory returning isolated instances (own state per
   instance) — it appears in Prototypes AND build documents; never shared block state.
5. Every lifecycle button (create build / approve / deploy / looks right / create patch)
   disables on click until the next state renders (no double-fire).
6. Lerp loop: epsilon-snap (|delta| < 0.001) then stop by not rescheduling.
   Zoom-to-cursor math on TARGET values at wheel time
   (`wx=(mx-tx)/ts; ts*=f; tx=mx-wx*ts`). `deltaMode===1` ⇒ ×16; ctrlKey wheel = pinch
   (`s *= Math.exp(-deltaY*0.01)`, clamped). `will-change:transform` only while moving.
7. Activity feed: fixed-height inner panel; autoscroll ONLY while pinned to bottom;
   scroll-up pauses with a quiet "jump to latest"; `overscroll-behavior:contain`.
   Embedded draft canvas has no wheel handler; `touch-action:none` on handles/blocks
   only; preventDefault on handle pointerdown; `pointercancel` handled like pointerup;
   `user-select:none` toggled on body during drag only.
8. Enter staggers: Web Animations API (`el.animate(..., {delay:i*50, fill:'both'})`);
   cancel stale handles on rapid re-entry. No class-toggle/forced-reflow staggers.
9. SVG edge draw-in: batch ALL getTotalLength() reads before writes; set initial
   dasharray/dashoffset behind `visibility:hidden` (never display:none); arm transition
   on next rAF; cache lengths.
10. Prototype→build handoff: NO real cross-route FLIP — ghost-clone glide (absolutely
    positioned clone of the sealed row travels to the Builds rail item ~500ms, fades as
    the document enters beneath, then removed).
11. Any zoom-threshold behavior: hysteresis (on 1.8 / off 1.6), checked in the existing
    rAF tick only on threshold-cross.

## Content coherence

12. Pre-seeded world must be consistent: `snap guides while dragging` prototype chip =
    `in build →` (its build is awaiting review). `confirmed · linked to done build`
    pairing only after a build completes. When the resize build completes, flip its
    prototype chip. Clicking any sealed/confirmed prototype opens a READ-ONLY sealed
    thread with `→ open build`. `theme editor` opens as a resumable draft (one scripted
    line + generic draft). No thread opens blank.
13. All three pre-seeded builds fully scripted like the resize build: named impacted
    nodes, 2–4 plain criteria, 5–8 activity lines (plain+technical pairs), concrete
    ledger numbers. `undo spans grouped moves` (done) gets the MOST detail: sealed
    contract, complete honest activity trail including one past retry, attested review.
14. `minimap viewport sync` does NOT loop: finite non-repeating feed that completes to
    `awaiting review` after ~25s of app runtime (its dot then joins the rail count).
15. Footer node count matches visible nodes: `16 nodes` → `17 nodes`. Gate glyph sha and
    footer sha read one shared mapSha state value.
16. Builds rail dot = computed count of builds in {awaiting approval, awaiting review},
    recomputed on every state change.
17. Resize impact slice pinned: ghost `interact/resize` + render, interact/drag,
    interact/select, interact/viewport, core/context; edges only among those. Rejected
    alternative DEFAULT copy: `a shortcut was rejected — it would break how modules stay
    independent`; technical form (`render → state · modules never import each other —
    call ctx.hooks`) one hover/click deep.
18. Scenario B slice rule: clicked node + first IN neighbor + first OUT neighbor
    (fallbacks if missing), three boxes in a row.
19. UNGATED flagship: ANY typed outcome yields a working draft canvas WITH at least one
    live behavioral toggle. Ghost suggestion `resizable blocks on the canvas` is
    click-to-fill. `adjust` reveals a one-line input + acknowledgment converging back to
    confirm — never a dead button.
20. Canvas tier display at rest: nodes uniform except the ONE unproven node
    (dashed/faint). Tier revealed via panel chip + hover only.
21. Escape order: innermost-open first (expanded row → assumptions → panel), one level
    per press — and Escape acts INSTANTLY (no eased close on keyboard actions).
22. REVIEW leads with one plain sentence; numeral ledger is a smaller supporting row.
