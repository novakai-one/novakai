# unfold UX repair — staged plan (2026-07-02, Chris design review #2)

> Executor: Claude chat session over MCP. Stages sized to fit one session each without timeout.
> Run stages in order. Each stage ends: gate green, commit, one-line handoff note appended here.

## Design north star (context for every stage)

Reference: legacy editor (screenshot `Screenshot_2026-07-02_at_2_48_56_pm.png`, dark UI).
Selecting a wire or an interface there puts it in focus and surfaces rich info
(edge label, line style, routing, inspector). THIS is the target experience for unfold:
show the plumbing; every click yields information, focus, connection. Current unfold has
drifted — groups are mere collapse containers hiding children, not instruments of
understanding. Fix direction: immersion + information density on interaction, not
hide/show management.

## Issue register

| ID | Issue | Evidence | Severity |
|----|-------|----------|----------|
| U1 | `← explore` button noop in stage card header. Claude Code could not reproduce; treat as unconfirmed-repro, instrument first. | Explore_button_noop.png | bug |
| U2 | Wires not selectable, not informative. Legacy editor wires were both (click → inspector: label, style, routing). Unfold wires are passive lines. | dark screenshot vs current | design gap, high |
| U3 | Stage wiring inconsistent: `render` selected → 2 wires shown; deselect → group in focus, wires incomprehensible/uninformative. Improve, do not remove. | wiring_inconsistencies_in_view.png | design gap, high |
| U4 | Main stage disconnected from reveal toggles: while stage focused, toggling side-panel layers changes the BACKGROUND canvas only; stage content unaffected. Suspected architectural flaw in how stage/spotlight is rendered (separate render path not subscribed to layer state). Diagnosis required before fix. | user report, hard to screenshot | architectural, highest |
| U5 | Canvas clicks trigger native text selection/highlight (unexpected). Likely missing `user-select: none` on canvas/card text. | user report | bug, cheap |
| U6 | Group click = expand only. A group (e.g. "Rendering & viewport") cannot be selected or inspected; it is purely a hide/collapse wrapper. Groups must be selectable info sources: click selects + shows group-level info; expansion is a separate affordance. | rendering_viewport_unselectable png | design gap, high |
| U7 | Open/close animation too fast + jumpy. Fast/jumpy = cheap. Target: slow, smooth, premium, calm, in control. Ease curves + duration pass. | user report | polish |
| U8 | Selecting anything (incl. groups like "Editor") should promote it to main stage — user clicked it because they want to focus it. Chris flags possible over-optimisation → CAPTURED AS PLANNED BUILD, not immediate. Design before build. | user report | planned, deferred |

## Stages

Each stage = one chat session. Protocol per stage: onboard (`npm run flowmap:onboard`), read this file,
execute, verify in browser via Chrome MCP where visual, gate + commit, append result line under the stage.

### Stage 0 — diagnosis only, no code changes
Map the stage/spotlight architecture in `src/panel/unfold.ts`: how stage renders, what state it
reads, why reveal-layer toggles bypass it (U4), why wires degrade on deselect (U3), where the
explore handler binds (U1). Output: short findings section appended below + chosen fix approach
per issue. This de-risks every later stage.

### Stage 1 — cheap fixes
U5 (`user-select` on canvas), U7 (animation durations/easing pass), U1 (instrument + fix explore
noop using Stage 0 findings; if genuinely unreproducible, add logging and close with evidence).

### Stage 2 — stage ↔ layer-state integration (U4) + stage wire coherence (U3)
Stage render path must subscribe to the same layer/reveal state as the canvas. Then make
stage-mode wiring consistent between selected/deselected states.

### Stage 3 — selectable, informative wires (U2)
Wire click → selection + inspector info (endpoints, kind, direction; label/routing where model
has it). Parity target: legacy editor wire selection experience, adapted to reading mode.

### Stage 4 — groups as first-class selectable objects (U6)
Click selects group + surfaces group-level info (role, child count, external connections);
expand/collapse moves to explicit affordance (chevron/dblclick). Aligns with north star.

### Stage 5 — selection promotes to stage (U8) — DESIGN FIRST, then build
Deferred by Chris. Produce interaction design proposal for review before any code.

## Stage 0 findings (2026-07-02)

Architecture: explore mode has ONE orchestrator, `render(refit)` (unfold.ts ~L1197):
computeBlast → renderCanvas(contentEl) → enterStagger → focusDim → renderTree →
renderInspector → drawWires(wiresEl). Stage mode is a SEPARATE imperative cluster —
`renderStageGroup` / `stageProxies` / `drawStageWires` painting into `stageLayer` —
invoked ONLY from stage entry points (`stageMode`, `select`, `stageTravel`, rename,
frontmatter change). `render()` has no stage branch.

- **U4 root cause (confirmed):** every side-panel mutation routes through `render()`
  (layer row click → `render(false)`; tree reveal/hide checkbox → `render(true)`).
  While `STAGE` is set these rebuild only the blurred background canvas; stageLayer is
  never re-rendered. CSS-class layers (desc/iface/metrics/trust — toggled as classes on
  `overlay` by `applyLayerClasses`) DO reach staged cards, but: `color` is an inline
  per-card style set at `cardEl` build time, `blast` hop classes are baked at build
  time, wire layers (calls/deps) only affect `drawWires`, and hidden-set changes never
  re-filter staged children. Fix: make `render()` stage-aware — when `STAGE`, also
  refresh stage projection (rebuild staged cards + proxies + stage wires) so both
  projections subscribe to the same view state.
- **U3 root cause (confirmed):** `drawStageWires` (a) ignores `layers.calls`/`layers.deps`
  entirely (draws all EDGES), (b) is asymmetric on selection: proxy wires filtered by
  `if (SEL && stageRepOf(SEL) && s !== SEL) continue;` → selected = only SEL's wires;
  deselected = every card→pill wire at uniform style (clutter, no weight/opacity ramp
  like `drawWires`). `stageProxies` also re-aggregates pills per selection (`selStaged`
  filter) so the pill set itself mutates on select/deselect. Fix: honor wire layers;
  keep pill set stable; on selection dim non-SEL wires instead of omitting; adopt the
  explore weight/opacity ramp for visual consistency.
- **U1 root cause (high confidence):** stageEl pan `pointerdown` handler (~L585)
  excludes only `.uf-card,.uf-ghead,.uf-open,.uf-dock` before calling
  `stageEl.setPointerCapture(e.pointerId)`. `.uf-sleave` (← explore) and the whole
  stagelayer are NOT excluded → pointer capture retargets pointerup/click to stageEl →
  the button's `onclick` never fires. Explains Claude Code non-repro: programmatic
  `el.click()` bypasses pointer capture. Fix: add `.uf-stagelayer` to the exclusion.
- **U5:** no `user-select:none` on `.uf-stage`/cards (only `.uf-ghead` has it); pan
  drags select card text. Fix: `.uf-stage{user-select:none}` + restore `user-select:text`
  on `.uf-cname[contenteditable]` and `.uf-body pre`.
- **U7:** jumpiness sources: `toggleExpand` → full `renderCanvas` rebuild (removed
  cards vanish frame-instant, no exit transition), `.uf-world.anim` .42s on fit/pan vs
  .9s reframe (inconsistent), wire redraw pops at settle. Cheap pass: unify durations
  (.42 → ~.65s expo), lengthen sgroup/proxy/card transitions. Exit animations = not
  cheap (needs keyed diffing), out of Stage 1 scope.

## Stage results log
(append one line per completed stage: date · stage · commit · verify command)

- 2026-07-02 · stage 0 · 224d466 · read findings above; verify: `grep -n "setPointerCapture" src/panel/unfold.ts` (no stagelayer exclusion), `grep -n "layers.calls" src/panel/unfold.ts` (absent in drawStageWires)
- 2026-07-02 · stage 1 · c8f002c · gate green, tsc clean; verify in browser: drag over card text (no native selection), stage a group → click "← explore" (exits), fit/expand motion slower (.7s expo). U1 fix is the pointer-capture exclusion — real-mouse verify pending, logging unnecessary given confirmed mechanism.
- 2026-07-02 · stage 2 · e03b954 · gate + lint green, tsc clean; verify in browser: stage a group → toggle calls/deps/colour/blast in side panel (stage content updates, wires appear/disappear), hide a staged child via tree (card leaves stage), hide all children (stage exits to explore), select staged card then deselect (pills stay put, other wires dim to .16 not vanish). Real-mouse browser verify pending (Chrome MCP not connected this session).
- 2026-07-02 · stage 3 · (this commit) · gate green, tsc clean, 166/166; human-verified in browser (explore mode): wire click → select + inspector (endpoints/kind/direction/carries), re-click deselects, prior wire/node deselected on new wire click, hover pre-light, canvas click-without-drag deselects (3px drag threshold, fixed post-verify). KNOWN GAPS carried forward: (a) stage-mode wire click is a noop despite hit paths being appended to sWiresEl — investigate (suspect stagelayer stacking/pointer-events), wires must be first-class in stage too; (b) stage-mode background click no-op (accepted for now — ← explore exits).
