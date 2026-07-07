# PROTO MANIFEST — novakai vision prototype

> **In-repo canonical copy (imported 2026-07-07).** This manifest, the prototype HTML it pins,
> and every doc it lists as BINDING live together in `docs/ide-vision/` — the out-of-repo
> sandbox is history, never a dependency. The `../design-idea-examples/` mocks referenced in §6
> are historical input that stayed out-of-repo deliberately; nothing requires them (the rulings
> in `260707_KEY_DECISIONS.md §8` already settled everything they informed). The sandbox
> `260707_SESSION_HANDOVER.md` likewise stayed behind — its verification-evidence precedent is
> carried by `260707_KEY_DECISIONS.md` §5/§7.11/§8.10.

> **Manifest written against this version of `novakai_vision_prototype.html`:**
> - Line count: **6869**
> - `shasum -a 256`: **07a97ebad8ae91de352fc98a5f7c52aa607491d31b0d80cb74a9e625fa24f029**
>
> If the file's sha differs from the above, an anchor may have moved — re-grep before trusting a line region.
> Anchors below are *strings*, not line numbers, precisely so they survive edits: `grep -F "<anchor>" novakai_vision_prototype.html`.

---

## 0. How to use this file

You are a fresh builder in the **main repo** (`/Users/christopherdasca/Programming/novakai`), asked to
implement a feature that this prototype demonstrates. The prototype is a 6.7k-line single-file HTML demo that
deliberately mixes three kinds of truth: **BINDING** design law, **ILLUSTRATIVE** behavior, and **FAKE**
scaffolding. This manifest is the classification layer so you don't port the fakes or re-argue the settled.

**Read, in this order:**
1. This file (`PROTO_MANIFEST.md`) — top to bottom, once.
2. `260707_KEY_DECISIONS.md` — the authoritative *why*. Every `§N.N` reference in this manifest points there.
3. For the **real app's** architecture (where you'll actually build): in the main repo run
   `npm run novakai:onboard`, then read `docs/novakai/_bundle.mmd`. The real app already has edge rendering,
   `ctx.state`, a router, and a data pipeline — you are porting *design intent onto that*, not rebuilding the demo.

**Extract exact values by anchor — never read the HTML whole:**
```
grep -nF "<anchor string from the tables below>" novakai_vision_prototype.html   # find the region
sed -n '<start>,<end>p' novakai_vision_prototype.html                            # read only that region
```

**NEVER:**
- Read `novakai_vision_prototype.html` linearly / in full. It is 6869 lines; grep the anchor and read the region.
- Port anything from the **FAKE** list (§4). The wires, the simulation, the dataset, persistence — all placeholder.
- Re-litigate a settled decision. If it's in `260707_KEY_DECISIONS.md §8` (design-delta rulings) or §1 (Chris's
  vision calls), Chris already ruled it. The reference mocks in `../design-idea-examples/` are **historical input**,
  not a live spec (§6 below).
- Introduce a color outside the two-actor law (§2, first row). This is the single most-protected rule in the product.

---

## 1. What the prototype is

The **6-months-out product vision**, built as a working single standalone HTML file (vanilla JS, zero external
requests, dark, deterministic). It has **three tabs** — **Canvas** (the code map, code only), **Prototypes**
(building a draft by intent + live toggles), **Builds** (jobs as certificate-style work documents). It demonstrates
the full loop: **intent → draft with live toggles → build document → approve → deploy → trust seal**. Plain
language leads everywhere; the technical layer (commands, shas, packet ids) is always exactly one click/hover deep.
This is the **WITNESSED spec** — Chris signed off on the *demonstrated thing running in a browser*, not on prose
describing it (`§1.2`). Treat the observed behavior of this file, filtered through this manifest, as the contract.

---

## 2. BINDING — implement exactly

Each row: element · one-line spec · source `§` in KEY_DECISIONS · grep anchor for exact values.

| Element | Spec | § | Anchor (grep -F) |
|---|---|---|---|
| **Two-actor color law** | teal `#4fe0cd` = machine-proven claim · periwinkle `#7c8cff` = the human (focus/selection/judgment) · green `#5fd0a0` = a VERDICT only (PASS / seal line 3) · amber `#d9a066` = pending/attested · `#565f6e` = unproven (shown honestly, never hidden). No hue outside this set, ever. | 3.2 | `--edge-sel:#4fe0cd` · `--accent:#7c8cff` · `--proven:#5fd0a0` · `--attested:#d9a066` · `--unproven:#565f6e` |
| **Proof seam — canvas node** | thin teal left-edge seam; exists ONLY where a claim is machine-proven; draws once then still forever; unproven/attested nodes carry no seam. | 3.1 | `.cv-seam {` · `the proof seam — a thin teal line` |
| **Proof seam — prototype card** | same seam as the card's teal left **spine** (2px, `left:0`). | 3.1 | `the proof seam as the card's left spine` |
| **Proof seam — build document** | teal **tide-mark rail** rising in the left gutter beside sections that have set (2px, glow). Binding geometry — do NOT replace with inline headers/hairlines. | 3.1 / 3.4 | `the tide mark — the proof seam grammar` · `.bd-rail .bd-rail-inner` |
| **Trust seal** | three sworn sentences (tests ran / passed / work trusted) with dot leaders in a bordered seal; NOT a dashboard, no bars/%/spinners/ETAs. | 3.4 | `.trust-seal {` |
| **Keystone rule** | seal line 3 (`trusted`, green) stays dim until lines 1+2 have filled — trust visibly *derived*. | 3.4 | `the keystone rule — line 3 stays dim` |
| **Seal ceremony** | dashed frame draws solid in one ~1.2s stroke, `sealed <date> · <sha>` stamp, **once ever**. | 3.4 | `.trust-seal.sealed` · `.ts-frame` |
| **Motion law — easing** | one easing everywhere: `cubic-bezier(.22,1,.36,1)`. Panel entry may use the native-sheet curve only. | 3.5 | `--ease:cubic-bezier(.22,1,.36,1)` · `const EASE = 'cubic-bezier(.22,1,.36,1)'` |
| **Motion law — durations** | quantized 120/240/480ms (600 rare); micro <300ms. Named constants, no magic numbers. | 3.5 | `§A · named duration constants` |
| **Motion law — keyboard instant** | keyboard actions NEVER animate (Escape instant), via a global instant class. | 3.5 | `html.kbd-instant` |
| **Motion law — idle = zero moving pixels** | rAF stops by not rescheduling once at rest; every held frame is a legitimate rest state. | 3.5 / 7.2 | `idle: stop by not rescheduling` |
| **Depth / shadow law** | depth = tone steps + hairlines + 1px inner-top highlight; near-zero shadows; exactly ONE drop shadow app-wide (the selected canvas node); evidence grounds are DARKER than parent. | 3.6 | `--shadow-node:inset 0 1px 0` · `the ONE drop shadow in the app` · `--ground:#12151a` |
| **Grid spec** | 24px dot pitch, every-4th dot brighter; a 48px-pitch layer crossfades in below zoom ~0.6. No grid parallax. | 3.7 | `dot grid — 24px pitch` · `.cv-grid-lo { background-size:192px 192px, 48px 48px` |
| **9px radius + anti-capsule chips** | `--radius:9px` on every boxed element (house identity); status chips squared to 5px so they never read as capsules. | 3.8 / 8.2 | `--radius:9px` · `squarer chip — no capsule pills` |
| **Typography law** | mono + sans only (NO serif / Newsreader); display page titles in `var(--sans)`; titles are **literal descriptive** (the job's name verbatim), never marketing/pitch copy anywhere. | 3.8 / 1.9 / 8.1 | `--mono:ui-monospace` · `--sans:system-ui` · `.eyebrow {` |
| **Page-title scope** | Builds list, build-document, Prototypes list get eyebrow + display title. **Canvas gets NO heading of any kind — ever.** | 8.1 / 8.9 | `Builds/Prototypes list header` · `persistent page header` · `§I · canvas page — the codebase map, code only, calm` |
| **Slice, never overlay** | impacted-node views render exactly the N impacted nodes as a small hand-laid SVG; whole-map highlighting is banned. | 1.6 | `slice diagrams — small hand-laid SVGs from data` |
| **Blast-wave ring** | a single soft ring expands once on the impact slice, then still. | 3.10 | `function blastWave` |
| **Plain-language-first, tech one click deep** | plain + technical stacked in one row, opacity-only crossfade (no reflow); default copy is human, technical layer one toggle deep. | 1.8 / 4.5 | `plain + technical stacked in one row` · `plainState:` |
| **Proportionate ceremony** | small changes get a quick chain (no prototype step, no review card); ceremony scales with change size. | 1.12 / 8.6 | `QUICK_TOTAL` · `change lane — Scenario B enters here` |
| **Decision-first build document** | the lifecycle action row (approve/deploy/create-patch) sits raised directly under the title, above the evidence; empty offer row collapses (no void). approve→deploy stay two distinct acts. | 1.7 / 8.6 / 8.8 | `.bl-card {` · `.bd-offer:empty { display:none; }` |
| **List grammar** | needs-you build = raised neutral-slate card; completed builds under a `DONE` hairline section; right-aligned roll-up `N builds · M needs you` (needs-you fragment periwinkle). | 8.6 / 8.7 | `.bl-card {` · `.bl-done-label` · `state roll-up computed from live` |
| **Semantic zoom** | stages are pure functions of rendered zoom written as CSS vars per frame (scrubbed, not timed); map ≤1.25 pixel-identical to base; clamps at 4.0. | 7.2 / 7.3 | `function applyTransform` · `0.35, 4.0` |
| **Signature match-move** | the teal sig line travels into its own substring inside body line 1 and code materializes around it; must arrive by p-code 0.7 so the crossfade runs between identically-sized spans. | 7.4 | `the signature match-move span` |
| **Dive gesture** | dblclick node dives to ~z3.2 centered; dblclick background surfaces. Detected by a pointerdown-pair detector (native dblclick unusable); any move ≥6px invalidates the pending pair. | 7.7 | `double-click dive is detected on POINTERDOWN pairs` |
| **Dataset law** | every node carries a `sig`, body required, ≤13 lines, ≤68 chars/line, pre-wrapped, `body[0].includes(sig)` — the match-move depends on it. | 7.9 | `dataset law (semantic zoom)` |
| **Empty-states carry their command** | a designed empty state = one dim mono line + a fainter command beneath it (e.g. `novakai verify-change …`). | 3.10 | `designed empty state: one dim mono line` · `novakai verify-change` |

---

## 3. ILLUSTRATIVE — match the behavior, not the code

The demo's *implementation* here is a means to an end; the real app has its own architecture. Reproduce the
**observable behavior**, using the real app's `ctx.state` / router / rendering — do not copy the demo's code.

| Aspect | Observable behavior to preserve | Anchor (for reference only) |
|---|---|---|
| **Pure state-machine rendering** | timers mutate STATE only; pages are pure renders of state; navigation mid-build is safe; a build completing mid-scenario re-renders into the correct group. The real app already has `ctx.state` — parity of *behavior* is the requirement, not this file's `V`/`DATA` objects. | `§G · app state` |
| **0fr→1fr collapse technique** | expand/collapse animates layout via `grid-template-rows:0fr→1fr` (never measured max-height), 120/240ms, house easing, instant on keyboard. | `grid-template-rows:0fr` |
| **WAAPI enter staggers** | list children stagger in ~45–70ms apart and **replay correctly on route re-entry** (WAAPI, not CSS keyframes that fire once). | `function staggerIn` |
| **Scrubbed (not timed) zoom** | zoom stage transitions are computed per-frame from the rendered zoom and consumed via opacity/transform calc(); zero new timers; every held frame rests. Implement against the real app's transform, not this `applyTransform`. | `function applyTransform` |
| **Pointer-pair dive detector** | double-tap-to-dive works even when the first click's glide moves the node out from under the pointer; a >6px move between presses cancels the pair. Behavior, not this exact listener. | `double-click dive is detected on POINTERDOWN pairs` |
| **Plain↔technical crossfade** | the swap is opacity-only over absolutely-stacked spans with a reserved row size — zero reflow. | `plain + technical stacked in one row` |

---

## 4. FAKE — do not port

Demonstrates the vision; must NOT ship. Each has its real-app replacement.

| Fake thing | Why it's fake | What replaces it in the real app |
|---|---|---|
| **Wires / edges** (`path.wire` + `path.head`) | known-poor placeholder geometry — acknowledged as the weak part of the demo. | The **real novakai app already renders edges properly**; edge data + geometry come from `docs/novakai/_bundle.mmd`, not this file. Anchor: `.cv-edges g.edge path.wire` · `functional edges — consumer → dependency`. |
| **Deterministic simulation / agent activity** | scripted feed player advancing a fixed schedule; no real work happens; no `Math.random()`, no real clock. | Real build/agent state from the actual execution pipeline. Anchor: `function runSched` · `determinism: no Math.random()`. |
| **Mock dataset** (`§F · demo dataset`) | 16 hand-authored fictional code nodes + fake shas + scripted builds/prototypes. | Real nodes/bodies/edges from the map + bodies pipeline (`_bundle.mmd` / `public/bodies.json`). Anchor: `§F · demo dataset` · `deterministic 7-char fake sha`. |
| **No persistence** | reload = fresh run; nothing is stored. | Real persistence is out of scope for the prototype but exists as needed in the app. (`§1.11`, handover Open items.) |
| **Re-run replays on the finished world** | re-running a completed intent replays on the already-finished state (reload to get a fresh run). | Accepted demo limitation only — not a behavior to reproduce. (`§6`, handover Open items.) |
| **Any implied AI / terminal / subscription integration** | the feed *narrates* an agent but there is no real AI, terminal, or Claude Code wiring behind it. | Explicitly **out of scope** — do not build integrations off the demo's narration. (`§1.11`.) |

---

## 5. Acceptance pattern

Any implementation of a proto feature is verified the way this prototype was (the standing method, `§2.4`):

1. **Real Chromium** (playwright-core + Chromium, e.g. 1440×900) — not jsdom, not a unit test standing in for the UI.
2. **Zero console / page-error bar** — any console error or pageerror fails the run.
3. **Drive the journey end-to-end** — actually click through both lanes (canvas change-lane → done; prototype →
   build → approve → deploy → seal), plus collapses and a live re-group.
4. **Screenshot and LOOK** — capture PNGs and inspect them; motion/idle correctness is a visual judgment.
5. **Idle byte-identical** — an idle screenshot must be byte-identical across captures (proves idle = zero moving
   pixels, `§3.5`/`§7.2`).
6. **Independent verifier, never the builder** — a fresh 0-context agent re-proves from the command output alone
   (`§2.4`; MEMORY: verified-builds-need-independent-auditor).

Precedent to point at: the **verification evidence chain** in `260707_SESSION_HANDOVER.md` (74/74 regression +
29/29 refinement + 9/9 delta checks, zero errors, 0-context wow test) and `260707_KEY_DECISIONS.md §5 / §7.11 / §8.10`.

---

## 6. Provenance

**Binding vs historical** (mirrors the handover's artifact-chain read order in `260707_SESSION_HANDOVER.md`):
**BINDING** — `260707_KEY_DECISIONS.md` (all decisions + rationale), `260706_V3_DESIGN_SYNTHESIS.md` (design law),
`260706_V3_CORRECTIONS.md` (architecture/content corrections), `260707_SEMANTIC_ZOOM_SYNTHESIS.md` (zoom spec),
`260707_DESIGN_DELTA_APPLY_BRIEF.md` (the delta round, with measured values in `260707_DESIGN_DELTA_SPEC_DRAFT.md`),
and this manifest. **HISTORICAL** (context, not live spec) — `260706_NOVAKAI_VISION_HANDOVER.md` (original vision;
KEY_DECISIONS §1 overrides where they differ), the polish/refinement briefs, the zoom/delta *design briefs* and
*critiques*, and superseded build plans (V1, V2). All design conflicts were **already ruled by Chris**
(`260707_KEY_DECISIONS.md §8`); a builder who finds the reference mocks in `../design-idea-examples/` must treat
them as **historical input** — a layout grammar Chris liked — not a live spec, and never as authority on color,
wires, data, typeface, or trust presentation, all of which the rulings already settled.
