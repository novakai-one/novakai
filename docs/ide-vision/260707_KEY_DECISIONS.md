# Vision Prototype — Key Decisions Record (through 2026-07-07)

The authoritative "why" behind the prototype. A new Claude must read this BEFORE proposing
changes — every item below was deliberately decided, most after multi-agent research, and
several overturn "obvious" defaults. Spec files referenced live in this folder.

## 1. Vision decisions (from Chris directly — highest authority)

1.1 **Novakai is a developer tool. Code is never removed from view.** The "zero lines of
    code" framing was explicitly rejected. Code stays visible and drillable throughout.
1.2 **The spec is a witnessed outcome, not prose.** Big builds: user declares intent →
    the app produces a confirmable prototype of the outcome → agreeing to THAT is the
    spec. Nobody signs a description; they sign the demonstrated thing.
1.3 **Prose questions to the user are a flawed pattern.** The AI asks at most ONE
    question ("specifics, or a draft to refine?"). Divergent choices become live toggles
    the user flips ON the working draft — decide by seeing/touching, never by reading.
1.4 **Trust is not removed — it is guaranteed.** Every claim on screen is proven; the
    error class eliminated is agent miscommunication/drift, not code.
1.5 **Three tabs, each activity gets its own page** (Chris overturned the earlier
    everything-on-one-canvas design as "poisoned… fine for AI, terrible for human"):
    Canvas (code only), Prototypes (draft building), Builds (jobs/work documents).
    NEVER overlay spec/build state onto the code map.
1.6 **Slice, never overlay.** 6 impacted nodes → show exactly 6 in a dedicated view.
    Real maps will have hundreds/thousands of nodes; whole-map highlighting is banned.
1.7 **Builds page = document spec per job**: saved prototype (still interactive),
    acceptance criteria, contract (patch.json + map patch + impact slice), status/dates,
    trust box (tests run / tests passed / work trusted), activity feed, review.
    Lifecycle: agent OFFERS to create the patch → authors it → human sees impact →
    approve → deploy (two distinct acts) → plain-language live activity → review.
1.8 **Plain language first, everywhere.** Default copy is simple/human ("a subagent is
    building the resize handles"); the technical layer (commands, packet ids, shas) is
    always exactly one click/hover deep. "Packet" was swept from the plain layer
    ("piece of work / work order") — jargon leak was a confirmed cold-user complaint.
1.9 **No headlines, no marketing copy, no taglines anywhere.** The prototype must speak
    for itself; a cold user infers the product unaided (validated: a 0-context engineer
    articulated the full thesis in under a minute).
1.10 **Word "Builds"** chosen for jobs/tickets (single display string; trivially
    swappable).
1.11 **Out of scope by Chris's call:** real AI in the app, terminal integration, Claude
    Code subscription wiring, persistence, integrations (debugger/observability/DB/
    deploy — positioned as future plug-ins, not features).
1.12 **Proportionate ceremony.** Small changes (canvas change-lane) get a one-packet
    quick chain, no prototype step, no review card. Ceremony scales with change size.

## 2. Method decisions (from Chris — govern how future work is done)

2.1 **Design choices**: sample N independent agents on the SAME brief; repeated sampling
    reveals the modal answer, but the gem may be the distinctive minority option —
    choose with judgment, not vote-counting.
2.2 **Engineering choices** (objective, works-or-doesn't): multi-agent consensus;
    disagreements settled by empirical probe in a real browser, not debate.
2.3 **Builder agents drift past ~200k tokens** — retire them; hand over to FRESH agents
    via spec files on disk (never via conversation context).
2.4 **Independent verification is mandatory**: builder self-reports are never accepted;
    a fresh agent re-proves in real Chromium with a ZERO console/page error bar, plus a
    0-context wow test (cold impression, scores).

## 3. Design decisions (from the 6-variant fan-out + research; see 260706_V3_DESIGN_SYNTHESIS.md)

3.1 **The signature: the proof seam.** Thin teal line that exists only where a claim is
    machine-proven; draws once, then still forever. All 3 independent designers converged
    on "proof is the only color" — adopted. Geometry: left-edge seam on canvas nodes,
    left spine on prototype cards, tide-mark rail on build documents.
3.2 **Two-actor color law (binding):** teal #4fe0cd = machine-proven claim · periwinkle
    #7c8cff = the human (focus/selection/active/judgment) · green #5fd0a0 = a VERDICT
    only (seal line 3, PASS) · amber = pending/attested · dim/hollow = unproven (shown
    honestly, never hidden). Green on claims was found twice as a violation and fixed —
    protect this law in any future change.
3.3 **The opening**: one-time deterministic proof cascade (grid → bare nodes → seams
    draw in dependency order → edges draw → footer counter settles into the real gate
    line), total stillness by ~3s. This IS the thesis stated without words.
3.4 **Build document = certificate, not dashboard** (3/3 designers converged): 760px
    single column, prototype + impact slice as wider "plates"; trust seal = three sworn
    sentences (The tests ran / passed / work is trusted) with dot leaders; **keystone
    rule** — line 3 cannot fill until 1+2 fill (trust visibly derived); **seal ceremony**
    — dashed frame draws solid in one 1.2s stroke + `sealed <date> · <sha>` stamp, once
    ever. Progress = tide mark + sections setting from 40%-draft to full ink. NO progress
    bars, percentages, spinners, ETAs — ever.
3.5 **Motion law**: single easing cubic-bezier(.22,1,.36,1); durations quantized
    120/240/480ms (600 rare); micro <300ms; keyboard actions NEVER animate (Escape is
    instant); idle = zero moving pixels; the two grand one-time moments (opening
    cascade, seal ceremony) get the entire flourish budget (selective emphasis —
    frequency down, flourish up).
3.6 **Depth**: near-zero shadows — tone steps + hairlines + 1px inner top highlight;
    exactly ONE drop shadow app-wide (selected canvas node); evidence grounds are
    DARKER (#12151a) than their parent ("the layer beneath the document").
3.7 **Grid**: 24px dots with every-4th brighter; crossfades to 48px pitch below zoom
    0.6. Rejected: grid parallax (2-of-3 against).
3.8 **Kept house identity**: 9px radius, slate palette, mono/sans law — designer
    proposals of 4/6px radius were overruled to stay novakai.
3.9 **Explicitly rejected forever** (don't reinvent): overlays on the map, progress
    bars, toasts (confirm in place: copy→copied), real cross-route FLIP (ghost-clone
    glide instead), italic draft-ink, green criterion dots, chat-transcript views
    (replies are artifacts), sound/confetti ("green is the celebration").
3.10 **Wow items implemented** (from ranked ideation): settling narrated feed; spec↔test
    ↔slice hover triangulation; self-assembling map; review spotlight (everything
    certified dims; the one judgment is the only lit element); decide-by-hovering
    (toggle hover previews its consequence on the draft at partial strength);
    blast-wave ring (once); word-by-word AI question; empty states carrying their
    command; approval seals into a recorded line. NOT implemented (deliberate): semantic
    zoom (heavy; only if base is flawless), certainty ring (superseded by keystone).

## 4. Engineering decisions (3-agent consensus; see 260706_V3_CORRECTIONS.md)

4.1 Pure state-machine rendering: timers mutate STATE only; pages are pure renders;
    hash carries page/id only. This is why mid-build navigation is safe.
4.2 grid-template-rows 0fr→1fr for all expand/collapse (never measured max-height).
4.3 Pan/zoom: single rAF lerp toward targets; epsilon-snap then stop; zoom-to-cursor
    solved on TARGET values; deltaMode normalization; ctrlKey = pinch.
4.4 WAAPI for enter staggers (replays correctly on route re-entry).
4.5 Plain↔technical crossfade: paired absolutely-stacked spans, reserved row size,
    opacity only — zero reflow.
4.6 Draft canvas: factory (isolated instances — it exists in two places); pointer
    capture; touch-action:none on handles only; pointercancel = pointerup; z-raise on
    interaction.
4.7 All lifecycle buttons disable on click until next state renders; deploy renders as
    its own row disabled 400ms (fixed a real double-fire found by verification).
4.8 One monotonic clock per build's activity timestamps (found running backwards; in a
    trust UI this was rated the most credibility-damaging defect).

## 5. Verification evidence chain (as of this record)

- Base build: 74/74 independent Chromium checks, ZERO console/page errors, no
  regressions after polish. Wow test (0-context senior engineer): design 9/10, motion
  8/10, clarity 8/10, novelty 9/10, wow 8/10 — identified the whole thesis unaided.
- Design critique (dedicated, vs synthesis): 13 defects found → all queued/fixed in the
  final refinement round together with wow items 3.10 (spotlight, hover-preview).
- Drivers + screenshots live in the session scratchpad (ephemeral); the method is
  reproducible: playwright-core + Chromium, 1440×900, zero-error bar, LOOK at PNGs.

## 6. Known open items / candidates for a future pass

- Build-document density for first-timers: softened (header subtitle removed) but watch
  it; the wow tester still felt "four framings of one truth" before it clicked.
- Prototype re-run after completion replays on the finished world (reload = fresh run) —
  accepted limitation, by design.
- Accepted defect (Chris, explicit): code-text sub-pixel softness at non-integer zooms
  (crisp at z4). Standing guidance from the same ruling: fix HIGH-severity findings;
  don't burn time on low-severity/low-impact ones — more revisions are coming.

## 7. Semantic zoom (shipped 2026-07-07, later same day; spec: 260707_SEMANTIC_ZOOM_SYNTHESIS.md)

7.1 **Built via the standing method end-to-end**: 3 independent same-brief designers →
    judged synthesis (winner: scrubbed "signature match-move" design; grafted: the
    evidence-ground descent metaphor + engineering hygiene from the other two) →
    empirical Chromium probe settled all fact-shaped unknowns BEFORE building →
    fresh Opus builder → independent functional verifier + independent design critic
    in parallel → consolidated fix round → targeted regression fix → re-verified green.
7.2 **Scrubbed, never timed** (the defining call): all stage transitions are pure
    functions of rendered zoom, written as CSS vars in applyTransform per frame and
    consumed via opacity/transform calc() only. Zero new timers. Idle = zero moving
    pixels by construction; every held frame is a legitimate rest state (and defects
    against that bar were treated as HIGH).
7.3 **Stages**: map (≤1.25, pixel-identical to the verified base) → signature band
    1.25–1.50 → sig stage → source band 2.00–2.50 → reading range to z 4.0 (clamp
    raised 2.5→4.0; the only max-zoom constant in the file, probe-confirmed).
7.4 **The signature match-move is the protected beat**: the sig line travels into its
    own substring inside body line 1 and the code materializes around it. Travel/scale
    must ARRIVE by p-code 0.7 (clamp(p/0.7)) so the 0.7→1.0 crossfade runs between
    identically-sized spans — raw-p-code timing ghosts (found and fixed).
7.5 **Color law extended downward**: code is ink (NO syntax highlighting — color is
    meaning); teal seam counter-scaled to a constant 2px screen hairline is the only
    color at the bottom of the descent; evidence ground #12151a under proven (full) /
    attested (0.6) / unproven (none — dashed border, dim ink, still shown).
7.6 **Node footprint never changes** (176×54): all faces absolutely stacked; edges/
    positions/slice math untouched. Grid gets a quiet multiplier at depth (no third
    grid layer). Arrowheads fade out at depth.
7.7 **Dive gesture**: dblclick node dives to z 3.2 centered; dblclick background
    surfaces. Implementation is a window-capture pointerdown-pair detector (native
    dblclick unusable — the first click's glide moves the node out from under the
    pointer); any pointermove ≥6px invalidates the pending pair (two same-spot drags
    must never read as a double-click — found as a regression, fixed, re-verified).
7.8 **Escape-stack order at depth**: deselect is pushed BEFORE openPanel so the
    pre-expanded source collapses on the first Escape, panel on the second.
7.9 **Dataset law codified** (comment above DATA.nodes): body required, ≤13 lines,
    ≤68 chars/line, pre-wrapped, body[0].includes(sig) — the match-move depends on it.
7.10 **Probe facts worth keeping**: mono advance = 0.6 × font-size (measure at init
    anyway); render code at direct small world font-size, never counter-scale-nested
    (measurably softer); per-frame CSS-var recalc at this scale holds 60fps (worst
    17.7ms). Mount all code faces at init; lazy-mount/culling is the documented
    upgrade path at hundreds-of-nodes scale (ponytail comment in the file, ~L3369).
7.11 **Verification evidence**: two independent verifier suites (22 checks + 9-check
    re-probe) + independent design critique; zero console/page errors in every run;
    idle screenshots byte-identical; z1.0 map pixel-identical to the verified base.

## 8. Design-delta round (2026-07-07; brief: 260707_DESIGN_DELTA_APPLY_BRIEF.md)

The design-idea references (`design-idea-examples/*.html`) contributed **hierarchy and
layout grammar only**; typeface, palette, and trust-flattening were rejected as they
collide with binding law. Rulings applied this round:

8.1 **Sans kept, no serif (§3.8).** The reference's size/hierarchy jump (tiny eyebrow →
    large display heading) was adopted in `var(--sans)` — never `Newsreader`. Large page
    titles: Builds list `Builds` (40px/500), build-document heading = the job's name
    **verbatim** (32px/500; "minimap viewport sync", never prose/pitch — §1.9 was always
    about sales copy, not descriptive document titles), list-card title 22px.
8.2 **9px house radius kept (§3.8); anti-capsule pills.** Chris hates oval/capsule pills:
    `.chip` radius dropped 20px→5px so status chips read as squarer chips, never capsules.
    Card/seal radius stays the 9px house value.
8.3 **Subtitle stays removed** (delta 6 rejected — density call from §6 kept).
8.4 **Trust seal untouched** (delta 7 rejected): three sworn sentences, keystone rule,
    seal ceremony, `sealed <date> · <sha>` stamp all byte-identical in effect.
8.5 **Tide-mark rail untouched (§3.1/§3.4); delta 4 additive only:** count metadata added
    *beside* the existing rail labels (e.g. `2 / 2 proven`, `3 nodes`); secondary sections
    (contract, activity) collapse to expandable rows — reusing the existing `.xwrap`
    (grid-template-rows 0fr→1fr, 240ms, house easing; keyboard-instant via `html.kbd-instant`
    — engineering law 4.2 / §3.5). Live arrivals auto-open so the blast-wave / settling-feed
    beats are not hidden.
8.6 **Adopted from the references:** display hierarchy + eyebrows (`NOVAKAI · BUILDS`, sans
    11px/500, 1.5px tracking, above the title; top-bar breadcrumb kept); the actionable
    build as a **raised card** — neutral slate tone-step fill (`--panel-2`, NOT amber/warm —
    §3.2), 9px radius, 1px border, `Review →` re-using the existing row-open; **grouping by
    state** (actionable cards on top, `DONE` section under a hairline, right-aligned roll-up
    `N builds · M needs you` with the needs-you fragment in periwinkle = the human, §3.2);
    **decision-first** — the lifecycle action row (`approve`/`deploy`/`create patch`) raised
    directly under the title, above the evidence (placement only; approve→deploy stay two
    distinct acts, §1.7/§1.12); build-document reading column **left-aligned** under a
    persistent header (760px width kept, §3.4); density pass (airier cards, collapses net-cut
    first-look density).
8.7 **Two-actor color law (§3.2) preserved** everywhere: card fill is neutral slate, the
    only accent is periwinkle (the human) on the roll-up + card hover; amber stays the
    awaiting/attested status hue; no new hue introduced.
8.8 **Judgment call within brief latitude:** for an *awaiting-review* build the raised
    action row is empty (its decision is attest/defer, which stays in the REVIEW section to
    preserve the review-spotlight design, §3.10). The raised `Approve` applies to
    *awaiting-approval* builds (verified via the change-lane). Grouping is pure over live
    state (engineering law 4.1) — a build completing mid-scenario re-renders into the right
    group (verified: b-minimap building→awaiting-review moved row→card; a change-lane build
    approved→deployed→done landed in DONE).
8.9 **Scope guards:** Prototypes list got ONLY the page-title + eyebrow grammar; Canvas got
    **no heading of any kind** (Chris, explicit); canvas/zoom/dataset/state-machine/router/
    timers untouched; z≤1.25 map pixel-identical.
8.10 **Verification:** `node --check` on the extracted script passed; real Chromium
    (playwright-core + ms-playwright chromium-1228, file://, 1440×900) drove both scenario
    lanes end-to-end (canvas change-lane → done; prototype → build) plus collapse expand/
    collapse and a lifecycle completion into DONE — **zero console/page errors**; after-shots
    `after_builds.png` / `after_detail.png` / `after_prototypes.png` / `after_canvas.png` in
    the session scratchpad. Independent verification still required (§2.4).
