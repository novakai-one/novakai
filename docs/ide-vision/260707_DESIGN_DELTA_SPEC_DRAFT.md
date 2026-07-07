# Design Delta Spec — DRAFT (2026-07-07)

> **DRAFT for Chris's approval — nothing here is binding until approved.**
> Scope is **layout / spacing / borders / line-breaks / typography-hierarchy / density ONLY.
> Zero functional changes** — no new wires, data, interactions, or behavior. Where a delta
> would touch a binding rule in `260707_KEY_DECISIONS.md §3` it is flagged **CONFLICT** and
> left undecided for Chris.
>
> Sources: the two `design-idea-examples/*.html` files are **artistic references only** — a
> layout grammar Chris likes (spacing, hierarchy, card treatment, section rhythm). They are
> NOT authoritative on behavior, color, wires, or data. Values below were read by computed-style
> probe in real Chromium at 1440×900, not guessed. Prototype values are cited by selector.
>
> Screenshots this spec is grounded in (all in the session scratchpad):
> `proto_builds.png`, `proto_detail_minimap.png`, `proto_detail_snap.png`, `proto_detail_undo.png`,
> `ref_list.png`, `ref_detail.png`.

**One thing to hold onto:** the reference is a *light-theme, serif, dashboard-flavoured* mock.
Adopting its **hierarchy and card grammar** is separable from adopting its **typeface, palette,
and trust-flattening** — the latter three collide with binding law. Each delta below splits those.

---

## Deltas — highest visual impact first

### 1. Page-level display title (biggest single difference)
- **(a) Proto now:** the Builds *list* has **no page title at all** — only a 10px mono uppercase
  eyebrow `BUILDS` (`.sec-title`: `var(--mono)`, `font-size:10px`, `font-weight:500`,
  `text-transform:uppercase`). The build *document* leads with an inline `.bd-header .bd-title`
  at `font-size:19px; font-weight:600` sans, sharing its row with the status pill.
- **(b) Reference:** a large display **H1** — list `Builds` at **40px** `Newsreader` serif,
  weight 500, `letter-spacing:-0.4px`; detail `Minimap viewport sync` at **40px/42px** serif.
  Each sits under a wide-tracked eyebrow (`NOVAKAI` / `NOVAKAI · BUILDS`, 11px sans, weight 500,
  `letter-spacing:1.54px`, uppercase). The build title in a *list card* is 25px serif w500.
- **(c) Surfaces:** Builds list, build document.
- **(d) CONFLICT (partial):** the serif face (`Newsreader`) violates the **mono/sans house law
  (§3.8)**. The *size/hierarchy* jump (tiny caption → large display heading) is separable and
  law-safe if rendered in `var(--sans)`. Flagging the typeface only.

### 2. Elevate the actionable build into a card; demote the rest to quiet rows
- **(a) Proto now:** every build is a flat equal-weight `.bl-row` — `border-bottom:1px solid
  var(--line)` (#2a3140), `padding:16px 8px`, title 13.5px/500, note 12px, a right-side status
  pill (`building`/`done`/`awaiting review`) + mono date. No item is visually elevated.
- **(b) Reference:** the item that needs the human is a **raised card** — `border-radius:12px`,
  `1px` border, a warm neutral fill, `padding:26px 28px`, containing title + one-line note +
  an inline `Review →` affordance. Completed builds collapse to plain borderless rows.
- **(c) Surfaces:** Builds list.
- **(d) CONFLICT (color aspect only):** the card *fill/border* is a tone step — law-safe **iff**
  it stays a neutral slate tone and does not read as amber (`amber = pending/attested`, §3.2) or
  any two-actor color. The card *geometry* (radius→see delta 8, padding, elevation) is safe.

### 3. Group by state ("DONE" section) + a count summary
- **(a) Proto now:** one flat chronological list; state is carried per-row by a status pill; no
  section grouping, no roll-up count.
- **(b) Reference:** actionable builds sit at top (as the card, delta 2); completed builds fall
  under a `DONE` section label with a hairline rule; a right-aligned summary reads
  `3 builds · 1 needs you`.
- **(c) Surfaces:** Builds list.
- **(d) CONFLICT (color aspect only):** the `1 needs you` fragment is rendered in a warm accent
  in the reference — must NOT introduce a color outside the two-actor law (§3.2). Render it in
  ink/periwinkle-or-neutral, not a new hue. Grouping + count text itself is law-safe.

### 4. Build-document section grammar: inline headers + hairlines vs. left tide-rail
- **(a) Proto now:** each section is announced by a **left margin rail** — `.bd-col` is
  `grid-template-columns:120px minmax(0,760px)`; `.bd-rail-label` is mono 11px small-caps,
  lowercase, `letter-spacing:.1em`, sitting in the 120px gutter; a **teal tide-mark spine**
  (`.bd-rail::before`, 2px, `--edge-sel`, glow) rises beside set sections. All sections render
  expanded inline, separated by `row-gap:76px`.
- **(b) Reference:** sections are announced by **inline serif headers** in the reading column —
  `What it should do` / `What changed` / `How it got here`, **18px serif w500**, each trailed by
  count metadata (`2 proven · 1 needs you`, `3 nodes touched`, `10 steps · 4 min`) and separated
  by thin full-width horizontal rules. Secondary sections collapse to a single expandable row
  with a chevron.
- **(c) Surfaces:** build document.
- **(d) CONFLICT (hard):** the **left tide-mark rail/spine is binding signature geometry**
  (§3.1 "tide-mark rail on build documents", §3.4). Replacing it with inline headers + hairlines
  removes the signature. **Do not decide.** The *separable, law-safe* half is additive: (i) put
  **count metadata beside the existing rail labels**, and (ii) **collapse secondary sections**
  (contract/impact, activity/"how it got here") to expandable rows to cut first-look density.

### 5. Primary actions raised directly under the title
- **(a) Proto now:** lifecycle actions live low in the document (in the review/attestation area);
  the header row carries only title + status pill + dates.
- **(b) Reference:** `Approve build` (filled) + `Request changes` (outline) sit **immediately
  under the title/subtitle**, above the evidence — decision-first layout.
- **(c) Surfaces:** build document.
- **(d) No conflict** on placement itself, BUT note §1.7/§1.12 (approve→deploy are **two distinct
  acts**, ceremony scales with size) — raising the buttons must not collapse the two acts into
  one. Placement-only, wiring unchanged.

### 6. One-line subtitle under the title
- **(a) Proto now:** header subtitle was **deliberately removed** for density (§6 open items:
  "softened (header subtitle removed)").
- **(b) Reference:** a gray sans one-liner sits under the H1 — 14.5–16px, color ~#6b6b6a,
  `line-height:24px` ("Every automated check passed. One thing needs your eyes before it ships.").
- **(c) Surfaces:** build document, Builds list card.
- **(d) CONFLICT:** re-adds the subtitle a prior pass deliberately cut. Flagging the reversal —
  do not decide.

### 7. Trust: collapsed one-liner vs. the always-open keystone seal
- **(a) Proto now:** trust is the page's **signature** — three sworn sentences always expanded in
  a bordered seal (`.trust-seal`, dashed→solid draw), with dot leaders and the keystone rule
  (line 3 cannot fill until 1+2 do).
- **(b) Reference:** trust is collapsed to a **single summary line** — `All checks green
  3 ran · 3 passed · work verified` with a `Details` disclosure.
- **(c) Surfaces:** build document.
- **(d) CONFLICT (hard):** collapsing trust guts the **keystone rule and the seal ceremony
  (§3.4)** — trust visibly derived is the thesis. **Do not adopt.** Listed only because the
  reference does it and the contrast is instructive.

### 8. Corner radius: 12–16px vs. 9px
- **(a) Proto now:** `--radius:9px` on every boxed element (`.trust-seal`, tabs use 7px).
- **(b) Reference:** cards `border-radius:12px`, outer panels 14–16px.
- **(c) Surfaces:** all (Builds list, build document, canvas, prototypes).
- **(d) CONFLICT:** **9px radius is kept house identity (§3.8)** — designer proposals of other
  radii were explicitly overruled. Flagging; do not decide.

### 9. Reading-column alignment & vertical anchoring
- **(a) Proto now:** the 760px column is **horizontally centered** (`.bl-col`/`.bd-col`
  `margin:0 auto` / `justify-content:center`), and the Builds *list* is **bottom/vertically
  anchored** — `.list-center { display:flex; flex-direction:column; min-height:100% }` with
  `> :first-child { margin-top:auto }`, so content floats to the lower-middle of the viewport
  (visible in `proto_builds.png`). This is tied to the empty-state-carries-its-command grammar
  (§3.10, the footer `novakai verify-change …` line).
- **(b) Reference:** content is **top-anchored and left-aligned** — a ~240px text sidebar, then a
  reading column starting at x≈307–341, ~756–843px wide, beginning near the top of the panel.
- **(c) Surfaces:** Builds list, build document.
- **(d) No hard conflict,** but the list's bottom-anchor is deliberate (empty-state framing). The
  safe delta is the build-document column: left-align it under a persistent header rather than
  centering. The list's vertical anchor should be decided with §3.10 in mind.

### 10. Eyebrow tracking & breadcrumb
- **(a) Proto now:** eyebrows are mono, 10–11px, uppercase / small-caps; the global breadcrumb
  `novakai · builds` lives in the top bar, not above the title.
- **(b) Reference:** eyebrows are sans, 10–11px, weight 500, **wider `letter-spacing:1.4–1.55px`**,
  uppercase, placed **directly above the title** as `NOVAKAI · BUILDS`.
- **(c) Surfaces:** Builds list, build document.
- **(d) No conflict** (both sans/mono-legal if kept sans). Purely tracking + placement.

### 11. Card / row internal density
- **(a) Proto now:** list rows are tight (`padding:16px 8px`), body note 12px; build-doc sections
  are very airy (`row-gap:76px`).
- **(b) Reference:** cards are airier (`padding:20–28px`), body `line-height:24px` on 16px (1.5),
  done-rows quiet and roomy; but secondary sections are *collapsed*, so the page reads denser
  overall despite airier blocks.
- **(c) Surfaces:** Builds list, build document.
- **(d) No conflict.** Net effect worth adopting: airier actionable blocks + collapsed secondary
  sections = the reference's "calm but complete" feel, addressing the §6 "four framings of one
  truth" density note.

---

## NOT deltas — recommend ignoring

- **Light "Ivory" theme / warm palette.** A theme choice; the prototype is dark by law-neutral
  design and both must obey the **two-actor color law (§3.2)**. Do not port reference hues.
- **The theme/skin pickers** (`Serif/Sans`, `Graphite/Ink/Carbon`, color swatch grid). Functional
  chrome of the mock, out of scope (§1.11 no persistence/integrations focus).
- **`Newsreader` serif wholesale.** Flagged in delta 1/4 as a §3.8 conflict; do not adopt the
  face — only consider the size/hierarchy in `var(--sans)`.
- **The `1 needs you` warm accent color** and any non-law hue on labels — color-law violation risk.
- **Flattening trust to a one-liner** (delta 7) — kills the keystone; listed for contrast only.
- **The filled avatar circle** at the top of the reference sidebar — identity chrome, not layout.
- **Any wiring implied by `Review →` / `Approve build` / `Watch it →`** — these are layout
  affordances only; behavior stays exactly as the prototype already implements it.
- **Console/functional gaps in the reference files** — they are non-functional mocks by nature.
