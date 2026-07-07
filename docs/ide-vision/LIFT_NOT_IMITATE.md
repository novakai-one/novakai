# LIFT_NOT_IMITATE — the rule for porting prototype UI

Ported UI is **lifted verbatim** from the prototype's real CSS
(`docs/ide-vision/novakai_vision_prototype.html`) — never paraphrased through
a prose design spec. K5's first pass (`SPEC_DESIGN.md`, the K5 design round)
described the prototype's controls in prose instead of copying their CSS,
and premium detail died in translation on the way: a sliding-knob toggle
became two flat pill buttons, the draft card's layered depth went flat, and
a 40px display title was dropped entirely. This file is the fix, made
durable — so it can't re-drift the same way next time.

## The rule

1. **Lift, don't paraphrase.** When a UI element already exists in the
   prototype, copy its real CSS values (dimensions, radii, colours as CSS
   vars, transitions) from the prototype file. Grep the class name, read
   the rule, copy the values. A prose spec is not the source of truth for
   *how something looks* — the prototype's CSS is. (The prose spec is still
   the source of truth for *behaviour* — what a click does, what gets
   persisted.)
2. **Every deviation is a declared, machine-checkable law — never a stray
   prose intent.** If the build must differ from the prototype (a dropped
   eyebrow, realigned columns, a colour-law drop), write that deviation
   down as something a grep or a computed-style assertion can prove, in the
   same PR as the deviation. "We decided to drop X" living only in a commit
   message or a spec paragraph is exactly the failure mode this file exists
   to close.
3. **Component identity is asserted, not just visual similarity.** A ported
   switch must literally be a switch — a track element sized like the
   prototype's, containing a knob whose transform moves on flip. A
   computed-style/DOM-shape gate must fail if a substitution (e.g. pills
   standing in for a switch) sneaks back in. See
   `tests/e2e/design-lift.spec.ts`.
4. **A computed-style gate proves build == prototype minus declared
   deltas.** Not a screenshot diff, not a human eyeballing it — a
   Playwright spec reading `getComputedStyle()` on the running page,
   asserting the lifted values landed (dimensions, transform on flip,
   transition presence, box-shadow shape) and that the colour law held (no
   teal/green tokens in the Design CSS block).

## Durable design values (not just for K5)

- **No neon, no glow, anywhere.** Depth comes from tone-steps
  (`--panel`/`--panel-2`/`--panel-3`), 1px hairline borders
  (`--line`/`--line-bright`), and the single inset highlight
  (`--shadow-card`: `inset 0 1px 0 rgba(255,255,255,.03)`). No colour-halo
  `box-shadow`, no glowing accent edges on panels, rails, or cards. The
  periwinkle accent (`--accent`) marks the human's own choice via solid
  fill/border/knob — never a glow.
- **Data speaks for itself. No AI-speak.** No gratuitous "here's a summary"
  narration, no chatty copy standing in for the actual data. If the
  mechanism needs one question, ask exactly that one question — nothing
  wraps it in prose.
- **Calm, classy, smooth.** Motion is the house 240ms `--ease`
  (`cubic-bezier(.22,1,.36,1)`) or the grid-track `0fr→1fr` technique —
  never a bounce, never instant except for keyboard-triggered actions.

## K5 declared deltas (this PR — a worked example of the rule above)

- **Eyebrow** (`NOVAKAI · PROTOTYPES`) — dropped, not ported. Design's page
  title stands alone.
- **Saved-outcome rows** — realigned into fixed CSS Grid columns (name /
  status chip / date / discard) so every row lines up regardless of
  status-word width; the prototype's `.pt-row` has no status chip so has no
  such alignment need. The status chip is squared to ~5px radius, not a
  capsule.
- **The bottom anchor line** ("a saved draft is working behavior, not a
  mockup") — not ported; Design has no CLI equivalent to point at.
- **Lawful, permanent drops** (`SPEC_DESIGN.md` §0/§1/§5): the draft card's
  teal left-spine `::before` + its glow (`--edge-sel`,
  `rgba(79,224,205,.5)`) — colour law bans teal in Design, nothing here is
  machine-proven; the scripted word-by-word "AI thinks, then types"
  choreography — Design's one question renders instantly, it is a static UI
  fork, not simulated AI narration (PROTO_MANIFEST §4). The native
  `confirm()` dialog on discard stays — it is real browser behaviour, not
  decoration.

## Cross-references

- `docs/ide-vision/SPEC_DESIGN.md` — the K5 design spec (§5 has the
  two-actor colour law this file's no-neon/no-teal/no-green rule extends
  app-wide).
- `docs/ide-vision/novakai_vision_prototype.html` — the prototype; grep
  class names, read only the matched ranges (the file is huge).
- `tests/e2e/design-lift.spec.ts` — the gate: computed-style + DOM-shape
  assertions proving the Design tab matches this file's rule.
