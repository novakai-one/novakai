# Semantic Zoom — Build Synthesis (BINDING)

Judged from 3 independent same-brief designs (method rule 2.1). Winner: the scrubbed
"signature match-move" design; grafted: the evidence-ground descent metaphor and the
engineering hygiene items from the other two. All three converged on: sig stage then
code stage, code rendered as ink (NO syntax highlighting — color is meaning), seam
persists as the only color, no dataset changes needed, no new keyboard bindings,
fixed node footprint, map text unselectable, panel carries the untruncated source.

Design law reference: `260706_V3_DESIGN_SYNTHESIS.md` §A binding; decisions:
`260707_KEY_DECISIONS.md`. All empirical unknowns are SETTLED by a Chromium probe;
**[PROBE-SETTLED]** notes below are facts, not guesses:
- Per-frame CSS-var recalc at this scale holds 60fps (17×15 elements, worst frame
  17.7ms, zero >20ms).
- Text: render code at a direct small WORLD font-size in the single transform
  context — do NOT counter-scale-nest (measurably softer). Use font-size 2.4px /
  line-height 3.0px world (screen 9.6/12.0 at z=4; 11 lines = 33px ≤ the 36px slot).
- Mono advance (the app's `--mono` stack, macOS SF Mono): exactly 0.6 × font-size
  (7.200px at 12px). For the match-move, measure once at init (one offscreen
  measurement, cached) rather than hardcoding — robust if the font stack resolves
  differently.
- Max-zoom is assumed in exactly ONE place: line ~3448 wheel clamp
  `clamp(V.zT * factor, 0.35, 2.5)` → change 2.5 to 4.0. fitAll's max=1 (line
  ~3426) and the per-event factor clamp (line ~3447) are unrelated — leave them.
  No copy anywhere mentions zoom numerically. Eyeball grid density at z=4.
- Dataset invariant verified on all 17 nodes (16 + resizeNode): body 10–11 lines,
  `body[0].includes(sig)` everywhere. Longest lines: 64/66 (history/undo), 68
  (panel/theming), else ≤61. At 2.4px world font (1.44px/char) a 68-char line is
  ~98px — fits the ~152px interior. Do NOT edit the dataset; the law is ≤68 chars.

## 1. Core principle — scrubbed, never timed

The entire transition is a pure function of rendered zoom `V.z`, computed in
`applyTransform()` and written once per frame as CSS custom properties on the canvas
world root; node layers consume them via opacity/transform only. **Zero new timers.
Zero new flourish.** Idle = zero moving pixels by construction; reversible
mid-gesture; hold z anywhere and the frame is still.

```
--p-sig  = clamp((z − 1.25) / 0.25, 0, 1)   /* signature band 1.25 → 1.50 */
--p-code = clamp((z − 2.00) / 0.50, 0, 1)   /* source band    2.00 → 2.50 */
--invz   = 1 / max(1, z)
```

Zoom clamp: `0.35–2.5` → `0.35–4.0` (the line ~3448 wheel-handler constant — the
only place, per probe). `fitAll` still clamps ≤ 1 — the opening cascade and every
behavior below z = 1.25 stay pixel-identical.

## 2. Stages (node footprint NEVER changes: 176×54 world px; edges/positions untouched)

- **z 0.35–1.25 — map**: exactly today's card. Pixel-identical.
- **band 1.25–1.50**: the node's real `sig` fades in beneath the title
  (`opacity: var(--p-sig)`), mono ~8px world, `--ink-dim`, at (12, 35) world px.
  Row always in the DOM — no layout shift.
- **z 1.50–2.00 — signature**: card = kind + title + one true line of mono.
- **band 2.00–2.50 — the card becomes code** (§3).
- **z 2.50–4.00 — source**: reading range; comfortable at z 4.

## 3. The transition (all faces absolutely stacked; opacity + transform only)

- **Title** never torn down: scrubbed `scale(1 → 0.55)`, translate to (12, 4.5),
  `transform-origin: left top`, driven by `--p-code`. It becomes the file header.
- **Kind chip**: `opacity: calc(1 − var(--p-code))`.
- **Signature match-move (the beat — protect it)**: the stage-B sig span does not
  fade out; it travels — scrubbed by `--p-code` — from (12, 35) @ 8px world to the
  exact offset where its own substring sits inside body line 1
  (`prefix = body[0].indexOf(sig)`, x = 12 + prefix × charAdvance; advance measured
  once at init — probe says 0.6 × font-size on this stack), scaling to the body
  text size (2.4px world). In the
  last third (`--p-code` 0.7→1.0) it crossfades with the real line-1 span at the
  identical position, so `export function ` and the trailing `{` materialize around
  the words already being read. Lines 2…n resolve beneath with a per-line scrub
  stagger: line *i* opacity = `clamp((pCode − 0.35 − i·0.05) / 0.2)` via CSS calc
  with a per-line `--i`.
- **Body**: cap 11 lines; longer bodies replace the last slot with dim mono
  `··· N more lines` (`--ink-faint`). Full source stays one click deep in the panel.
  Text rendering (probe-settled): direct world font-size 2.4px / line-height 3.0px
  mono in the single transform context — no counter-scale nesting.
  `white-space: pre`; no runtime wrapping.
- **Ink only**: body in `--ink` at ~90%; NO syntax highlighting.
- **Evidence ground (descent metaphor)**: a stacked `#12151a` ground layer inside
  the node — proven: `opacity: var(--p-code)`; attested: `calc(var(--p-code)*0.6)`;
  unproven: none — unproven keeps its dashed border, regular fill, `--ink-dim` body
  (code never hidden — ruling 1.1 — but it hasn't earned the evidence layer).
- **Border**: fades to transparent as `--p-code` rises; an inset
  `box-shadow: 0 0 0 calc(1px*var(--invz))` hairline takes over.

## 4. Seam · edges · grid

- **Seam**: unchanged element, `width: calc(2px * var(--invz))` — constant 2px
  screen for z ≥ 1 (identical below). Glow unchanged. Never redraws or animates.
  Proof stays the only color at the bottom of the descent.
- **Edges**: `stroke-width: calc(1.7px * var(--invz))`. Arrowheads fade with
  `opacity: calc(1 − var(--p-code))` (a counter-scaled hairline beside a fat
  triangle is noise; direction stays one click deep). Hover/selection focus
  behavior byte-identical at all stages.
- **Grid**: existing 48↔24 crossfade untouched; NO third layer. One multiplier on
  both layers: `gridQuiet = 1 − 0.6*clamp((z−2.2)/0.8, 0, 1)` — paper recedes to
  40% by z = 3 so the ink reads. Vignette, footer gate line, hint line: untouched.

## 5. Interaction

- Hover, click/select (the one drop shadow), panel, `ensureVisible`, Escape stack,
  `f` re-fit: all byte-identical. Keyboard never animates.
- At `--p-code ≥ 0.5`, node click opens the panel with `view source` pre-expanded
  (reuse the existing expander + Escape plumbing verbatim). Below that: today's
  behavior exactly.
- **Double-click a node** (currently a no-op — additive): glide to zT = 3.2 centered
  on it via the existing glide path. Double-click background = re-fit (unchanged).
  Dive/surface as one symmetric gesture pair. Reduced motion: snap instead of glide.
- Map code stays `user-select: none`; copyable source is the panel's, one click deep.
- **Change-lane trap (named check)**: `interact/resize` mounting mid-source-depth
  must render born-as-code (mount path uses the same CSS vars — it does if faces are
  plain var consumers) with its arrival glow intact.

## 6. Dataset

No changes — probe verified all 17 nodes carry `sig` + a deterministic 10–11-line
`body` with `body[0].includes(sig)` true everywhere; longest line 68 chars, which
fits. Codify the law in a comment near the dataset: body required, ≤ 13 lines,
≤ 68 chars/line, pre-wrapped, `body[0].includes(sig)`.

## 7. Performance

- Per-frame additions: 3–4 CSS var writes on one element + grid multiplier folded
  into existing writes. No layout reads/writes per frame. rAF still stops at settle.
  Probe-measured at this exact scale: worst frame 17.7ms, zero frames >20ms.
- Mount ALL code faces at init (~180 spans for 17 nodes — trivial; opening cascade
  untouched since faces sit at opacity 0 at fit zoom). Leave a `ponytail:` comment:
  lazy mount + at-settle viewport culling is the upgrade path at hundreds-of-nodes
  scale; at source zoom the viewport holds ≤ ~15 footprints regardless of map size.

## 8. Verification bar (for the independent verifier — unchanged standard)

`node --check` on the extracted script. Playwright + real Chromium 1440×900, ZERO
console/page errors. Full regression: opening cascade settles still; both scenario
lanes end-to-end; change lane; node panel + view source; Escape order; `f`.
New checks: screenshots at z 1.0 / 1.4 / 1.8 / 2.2 / 3.2 / 4.0 and LOOK at them
(sig fade, match-move mid-band held still at 2.2, code legible at 3.2+, seam a
hairline, grid receded, no overlap/blur); dblclick dive + background surface;
panel pre-expanded source at depth; change-lane node born-as-code at depth;
unproven node honest at depth; idle = zero moving pixels at every stage.
