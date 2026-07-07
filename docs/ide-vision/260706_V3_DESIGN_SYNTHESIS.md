# V3 Design Synthesis — the polish-round amendment

Synthesis of 6 independent design explorations (3× build document, 3× first-open/signature),
an 18-item wow ideation, and a 3-agent engineering consensus. This file AMENDS plan V3 §3
and details the polish round applied after the base build verifies. Where this conflicts
with V3, this wins. House identity is preserved: slate palette, 9px radius, mono/sans law.

## A. The app-wide grammar (three convergent votes — binding)

**Color is meaning, never decoration. Two actors, two hues:**
- `--edge-sel` teal `#4fe0cd` = **machine-proven**. Appears ONLY where a runnable command
  verified a claim (proof seams, proven pins, verified edges).
- `--accent` periwinkle `#7c8cff` = **the human**. Focus, selection, the active section,
  the one judgment machines can't make. Never used for machine states.
- `--proven` green `#5fd0a0` = **a gate's verdict** (trust seal lines, PASS). Exclusive to
  verdicts; criteria/claims use teal, not green.
- `--attested` amber = pending/human-attested. `--ink-dim`/hollow = unproven — always
  shown honestly, never hidden.
- A screenshot should be <5% saturated pixels. Green/amber never fill an area; dots,
  seams, and glyphs only.

**The signature element — the proof seam.** A thin teal line that exists only where
something is proven, draws itself once (scaleY/scaleX from origin, 240–420ms), then holds
still forever. One primitive, three grammars:
- **Canvas node**: a 2px inset seam on the node's left edge (top/bottom inset 3px,
  radius 1px, faint 8px teal glow at 50%). Unproven node: dim dashed border, no seam.
- **Prototype card**: the seam is the card's full-height left spine; teal where backed by
  working behavior, dim-dashed where still narrated.
- **Build document**: the seam is the margin rail's tide mark (see C).

**Typeface encodes truth-status** (already in V3, now law): machine-emitted = mono
(commands, ids, shas, counts, verdicts); human prose = system-ui. Every numeral
`font-variant-numeric: tabular-nums`. Real `−` (U+2212) in diffstats; `·` mid-dots.

## B. The opening (first ten seconds — replaces V3 §5 hint-only opening)

One-time, deterministic, on first Canvas render only (session flag; hash re-entry is
instant; `prefers-reduced-motion` skips to the settled frame):

1. **0–0.2s** — pure `--bg`. Deliberate stillness.
2. **0.2–0.8s** — dot grid fades up (see D for grid spec).
3. **0.8–2.2s** — nodes fade in BARE (hairline, no seams) in dependency order, left
   column → right, 50ms stagger — the map arrives unproven.
4. **1.2–2.6s** — **the proof cascade**: each node's teal seam draws in (240ms, 30ms
   stagger, same dependency order); functional edges draw in after their endpoints
   (stroke-dashoffset, batched reads before writes, initial values set while
   visibility:hidden, transition armed on next rAF).
5. In the footer strip, a mono counter runs in lockstep: `claims proven · 0 → 58`,
   then settles into the real line: `map verified @ 3fb0e83 · 16 nodes · 0 drift`.
6. **≤3s** — absolute stillness. Nothing moves again until the human does.

The map proves itself in front of you, then goes quiet. No words, no logo, no splash.

## C. The build document — "certificate, not dashboard" (three convergent votes)

Layout: single 760px column; ONLY the embedded prototype and the impact slice may break
out wider (~1000px plates). Spacing law: **large between, tight within** — 72–80px between
sections, 8/16px inside them. No boxes except the three that earn one (trust seal,
prototype plate, contract viewer); criteria, activity, review sit borderless on the slate.

**1. The trust seal** (top, directly under the header — the page's signature):
- Three sworn plain sentences, 16px system-ui ink, generous leading:
  `The tests ran.` / `The tests passed.` / `The work is trusted.`
  Each with a 6px status glyph left (hollow → amber pending → filled) and its evidence
  flush right in dim mono, connected by faint dot leaders
  (`The tests passed. ······ 3 / 3`).
- **The keystone rule:** line 3's glyph and text stay dim/hollow until lines 1 and 2 have
  filled — trust is visibly *derived*, never asserted. Lines 1–2 fill in ink/teal; line 3
  is the ONLY green thing on the page.
- **The seal ceremony:** while unproven, the box border is a dashed dim hairline. When all
  three land, a solid hairline frame draws itself around the box in one continuous ~1.2s
  stroke (SVG rect, dashoffset), and a small mono stamp fades in bottom-right:
  `sealed jul 6 · 8c41d97`. Happens once, ever. This is the page's emotional peak.
- Each line expands in place (grid-rows 0fr→1fr) onto a darker inset ground `#12151a`
  ("beneath the document"): the per-test list, each with its mono command + verdict +
  fixed duration, and a `⧉ copy` whose label crossfades to `copied` in place (no toast).

**2. Progress without a bar — the tide mark:**
- A margin rail in the left gutter: small-caps 11px section labels (`trust · try it ·
  acceptance · contract · activity · review`), each with a state dot; sticky per section.
- Sections not yet reached render as **draft**: ~40% opacity, dots hollow; they **set**
  to full ink (500ms) as the lifecycle reaches them, top to bottom. The boundary hairline
  — the tide mark — visibly rises. Progress is how much of the document has set.
- The active section's rail dot is the page's only `--accent` use; while the fleet works
  it carries the one permitted slow breath (2.4s opacity 0.4→1). At most ONE thing on the
  page is mid-animation at any moment.

**3. Acceptance criteria**: borderless plain sentences, hollow dot → teal-filled as each
proves (600ms settle crossfade, no flash). `text-wrap: balance` so no orphan words.

**4. Contract**: patch.json / map patch as mono viewers revealed onto the inset dark
ground; the impact slice is a still monochrome **figure in a paper** — hollow-ring nodes,
hairline edges at 40%, the new/changed node solid with a single accent ring, caption
`impact slice — 6 nodes touched`. Its one-time blast wave: a single soft ring expands
from the changed node along the edges (~700ms, once, then still).

**5. Activity**: plain sentences; the NEWEST line renders full-ink present-tense (the live
status readout), older lines settle to dim past-tense — the feed IS the progress narration.
`plain · technical` is a small-caps toggle; the swap crossfades each row IN PLACE (paired
strings, absolutely stacked spans, row size reserved — zero reflow). The retry line enters
danger-tinted and eases to neutral over 1.5s (an honest wince, then calm).

**6. Review**: one plain sentence first (`Everything checked out — 3 changes, all proven.`),
ledger numerals beneath (20px mono tabular), then exactly ONE human-judgment card — the
only signed, subjective element; attest seals it with the recorded, expiring artifact line.

**7. Trust-link triangulation** (wow item, binding): hovering a criterion softly highlights
its node(s) in the impact slice and its test row in the seal's proof layer (shared
data-node/data-test attrs, one delegated listener, `.linked` class). One fact, three
places, visibly the same object.

## D. Global finish upgrades

- **Grid**: 24px pitch (was 16), dots 1px `rgba(231,234,241,.05)`, every 4th dot lifted
  to `.08` (a whispered major rule). Below zoom ~0.6 crossfade to 48px pitch so density
  stays constant. No parallax.
- **Depth**: near-zero shadows. Elevation = tone steps (panel → panel-2 → panel-3) +
  hairline `rgba(231,234,241,.06→.10 hover)` + 1px inner top highlight
  `inset 0 1px 0 rgba(255,255,255,.03)`. Exactly ONE drop shadow in the app: the selected
  canvas node (`0 8px 30px rgba(0,0,0,.45)`). Evidence/proof grounds are DARKER than
  their parent (`#12151a`), reading as the layer beneath.
- **Motion law**: single easing everywhere `cubic-bezier(0.22, 1, 0.36, 1)`. Durations
  quantized: 120ms (hover/micro) · 240ms (state) · 480ms (panels/cards) · 600ms
  (emphasis, rare). Nothing exceeds 600ms except the two one-time ceremonies (opening
  cascade, seal stroke). Hover states change opacity/border/light only — no transform
  lifts, no scale pops. One property per interaction. Idle = zero moving pixels.
- **Focus/selection**: `box-shadow: 0 0 0 1px var(--accent), 0 0 0 4px rgba(124,140,255,.12)`,
  identical for mouse and keyboard. No default outlines.
- **The AI's one question** arrives word-by-word (~55ms/word opacity stagger, no caret) —
  a sentence being weighed, not typed.
- **Draft canvas physicality**: damped lerp on the last few px before min/max size clamps
  (resistance you feel), size readout eases toward `--accent-2` near bounds.
- **Empty states**: one dim mono line + beneath it, fainter, the command that would
  populate the view.
- **Prototype→build handoff**: ghost-clone glide (consensus pattern) — the sealed draft
  row's clone travels to the Builds rail item, the dot ticks as it lands, the document
  unfolds beneath. ~500ms.
- Wordmark: a 2px dot beside `novakai` settles to `--proven` when the gate glyph's verify
  pulse completes on load — the smallest always-on trust signal.

## D2. Premium-practice addenda (from sourced research — binding)

- **Focus ring, instant**: `box-shadow: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent)` with
  `transition: none` — a crisp gap+ring that appears instantly (focus must never be
  ambiguous). Replaces the soft-halo focus spec in D. Selection (canvas nodes) keeps the
  soft glow; keyboard focus gets this crisp ring.
- **Never animate keyboard-initiated actions** (Escape closes instantly, no ease-out;
  typed input responds immediately). Animation is for pointer-driven and system-driven
  changes only.
- **Micro-interactions < 300ms.** Anything a user does many times a session (hover,
  expand a row, toggle) must resolve ≤ 240ms. The 480–600ms tier is reserved for rare
  structural moves (panel entry, page transition). Panel slide-in may use the native-sheet
  curve `cubic-bezier(0.32, 0.72, 0, 1)` at 480ms.
- **Object permanence**: an element that persists into the next state is never torn down
  and re-rendered — it visibly remains/moves (the draft card COMPACTS into its sealed row;
  the ghost-clone handoff; the pending activity line SETTLES into history). Nothing that
  stays is replaced.
- **Selective emphasis**: flourish budget scales inversely with frequency. Frequent
  actions (hover, expand, toggle) are near-silent; the once-per-build seal ceremony and
  the once-per-session opening cascade are the only two grand moments. Nothing else
  competes with them.
- **Eyebrow labels** (section titles): 12px is too large at this density — keep 10–11px
  mono uppercase, tracking +0.08–0.12em, `--ink-dim` (matches the Linear pattern).

## E. Explicitly rejected (so the builder doesn't reinvent them)

- Grid parallax (2 of 3 designers against: depth without honesty).
- Flat 4–6px radius system (house identity is 9px; keep it).
- Italic "draft ink" slant for unset sections (fussy; opacity + hollow dots suffice).
- Any progress bar, percentage, ETA, or spinner anywhere.
- Green criterion dots (green is the seal's verdict alone; claims prove in teal).
- Real cross-route FLIP (ghost-clone glide only).
- Toasts (all confirmations happen in place, in words).
