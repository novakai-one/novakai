# Session handoff — archive

> Superseded session entries rotated out of `SESSION_HANDOFF.md` (2026-07-03).
> Historical record only — nothing here is load-bearing. Live work-state is
> computed (`npm run flowmap:status`, `npm run flowmap:roadmap`); still-live
> sharp edges were promoted to `docs/flowmap/KNOWN_EDGES.md` at rotation time.

## 0·prev·m10-live-on-main (2026-07-04, session 4) — M10 tooling live on main (#46 merged); Phase A verified by 0-context agent; NEXT: live-fire diagnostic (Phase B) + effectiveness A/B (Phase C)

PR #46 merged (merge 594bff8); main carries the turn tooling and the PreToolUse gate arms in
any session started from here. Phase A (mechanism) was executed green by a 0-context auditor
this session. One code-derived prediction stands OPEN, audit-confirmed against real transcript
evidence but not yet observed live: the one-free-retry check (`marker.streak >= streak` in
tools/flowmap/turn-gate.mjs) likely never passes on a live transcript — the denied call's
message persists, so the retry recomputes streak N+1 and is denied again (infinite deny loop;
only batching escapes). Phase B below settles it empirically. Session-3 entry archived
verbatim in handoff-archive.md.

| What | Verify it yourself | Expect |
|---|---|---|
| tooling on main | `git log --oneline -5` + `ls tools/flowmap/turn-gate.mjs` | 594bff8 merge in lineage; file exists |
| gate armed | `grep -n "turn-gate" .claude/settings.json` | PreToolUse matcher Read\|Grep\|Glob |
| mechanism (Phase A) | `node --test tools/flowmap/turn-gate.test.mjs tools/flowmap/turns.test.mjs tools/flowmap/metrics.test.mjs` | 30/30 pass |
| full suites | `npm run spec:test:all` | green (336 pass, 0 fail) |
| measurement sane | `npm run --silent flowmap:turns -- summary` | 19+ session rows; medians ≈ baseline block in docs/flowmap/turn-baseline.json |
| dashboard | `npm run --silent flowmap:metrics` | `turns` gate row (n/a until first live deny) + turn-discipline tail line |

**Next 1 — Phase B live-fire diagnostic (one session; follow EXACTLY):**
1. From a SINGLE user prompt, perform 4 consecutive assistant calls each containing exactly ONE
   `Read` and nothing else (no Bash, no batching). All 4 reads AND the retry must stay in one
   uninterrupted assistant chain — ending the turn inserts a zero-tool assistant message that
   resets the streak (turn-gate.mjs streak loop).
2. Expect on the 4th: deny (`flowmap turn-gate: 4 consecutive single-read turns…`); marker
   `.flowmap-turn-gate.json` appears at repo root.
3. Re-issue the identical Read once, then read `npm run --silent flowmap:metrics`:
   - **Outcome X** — denied again, `0 allow · N deny`, marker rewritten: retry defect CONFIRMED.
     Fix on a new branch: `marker.streak >= streak` → `<=` in tools/flowmap/turn-gate.mjs; add a
     growing-transcript regression test to turn-gate.test.mjs (note: `<=` makes a persisting
     streak an alternating deny/allow throttle — pin that semantics in the test deliberately); PR.
   - **Outcome Y** — allowed AND marker gone AND `1 allow · 1 deny`: retry works live; no fix.
   - **Outcome Z (false Y)** — allowed but marker STILL present and `0 allow · 1 deny`: a turn
     boundary reset the streak; NOT evidence the retry works — re-run in one chain.
4. Batch-escape check: one call with 2+ reads → allowed (proves the deny message's remedy works).
5. Delete `.flowmap-turn-gate.json` afterwards — MANDATORY: a lingering marker grants the next
   streak in the same session one silent free pass.

**Next 2 — Phase C effectiveness A/B (over ~1 week of gated sessions):**
- n=1 smoke after a real work session: `npm run flowmap:turns -- check --file ~/.claude/projects/-Users-christopherdasca-Programming-novakai/<session>.jsonl` (exit 0 = targets met; caveat: batchRatio also penalizes legitimately serial Bash-heavy sessions — read the row, not just the exit code).
- Real verdict: copy ONLY post-gate transcripts (mtime after 2026-07-04) to a scratch dir, then
  `npm run flowmap:turns -- summary --dir <dir>`; compare medians vs the baseline block in
  docs/flowmap/turn-baseline.json (working means: batchRatio ≥2.0 · cacheRead ≤~3.5M ·
  toFirstSrcEdit <50k continue-track · subagentTokens >0). Do NOT judge from the unscoped
  summary — it blends the 18 pre-gate sessions.
- Record a dated `observed` block in turn-baseline.json either way (the file mandates keeping
  poorer numbers as findings).

**Carried:** M9 (W6) recorded demo per docs/flowmap/demo/prep/recording-protocol.md.

## 0·prev·m10-measure-force (2026-07-04, session 3) — M10 turn-discipline: MEASURE (flowmap:turns) + FORCE (turn-gate PreToolUse hook), baseline recorded

Branch `m10/turn-discipline` (7 commits on top of c43b460, red-then-green per tool; src/
untouched). Measured driver: agents ran ~1.26 tool calls per API turn and ~99% of session
tokens were cache re-reads; median 3.18M context tokens burned before the first src/ edit.
The session-2 entry (M9 prep, PRs #42-#45) is archived verbatim in handoff-archive.md;
its Next still stands and is carried below.

| What | Verify it yourself | Expect |
|---|---|---|
| MEASURE over real sessions | `npm run --silent flowmap:turns -- summary` | per-session table + medians (batchRatio ~1.28, self-describing target lines) |
| FORCE hook wired | `grep -n "turn-gate" .claude/settings.json` | PreToolUse matcher Read\|Grep\|Glob |
| gate behavior proven | `node --test tools/flowmap/turn-gate.test.mjs` | pass: deny at streak 4, one-free-retry marker, fail-open cases |
| one parser, no drift | `grep -l "lib/transcript.mjs" tools/flowmap/turns.mjs tools/flowmap/turn-gate.mjs` | both files |
| baseline + reassessment protocol | `cat docs/flowmap/turn-baseline.json` | methodology, targets (batchRatio >=2.0, toFirstSrcEdit <50k), validation record |
| dashboard integrated | `npm run --silent flowmap:metrics` | gate table gains `turns` row + turn-discipline tail line |
| tooling map complete | `npm run flowmap:tooling:verify` | DONE (new modules mapped under co_metrics) |
| full suites | `npm run spec:test:all` | pass (includes turns + turn-gate) |

**Next:** (carried from session 2) merge #45, then M9 (W6) recorded demo per
docs/flowmap/demo/prep/recording-protocol.md. New: review + merge `m10/turn-discipline`;
the gate goes live for the next session in this repo. After ~1 week of sessions, run the
reassessment in turn-baseline.json (`npm run flowmap:turns -- summary` vs its baseline
block) — record the observed numbers in that file whether they improved or not.

## 0·prev·m9-prep-fixes (2026-07-04, earlier session) — MVP prep fixes on `mvp/m9-prep-fixes`: stage wires edge-anchored, dock spacing, plan review reachable from unfold-primary (plannerOpen hook), M0 predicate + M9-before-M7 ordering, plan-review ruling 2026-07-04/1

Five items. (1) `src/panel/unfold.ts` — stage wires are edge-anchored: `drawStageWires` now
builds a stage-space `sbox()` and routes through the shared `wirePath()` instead of
center-to-center Béziers that overlapped the cards; `drawStageProxyWires` anchors the
card end at its box edge via a local `edgeToward()`. (2) `src/panel/unfold.ts` injected
CSS — dock spacing: `.uf-tabrow` gap 2px→6px, new `.uf-conn .uf-cl+.uf-cl{margin-left:6px}`
so inspector chips don't rely solely on parent gap (user-reported "joined sub-menu items";
**visual browser check was unavailable this session — treat as an assumption**). (3) Plan
review reachable from unfold-primary boot: new `plannerOpen` hook
(`src/core/context/context.ts` + wired in `src/main.ts`), planner overlay z-index 60→80
(`src/panel/planner.ts`) so it stacks above unfold (70), new `review plan…` button
(`id ufReviewPlan`) in unfold's io tab. (4) `docs/flowmap/mvp-roadmap.json` — M0 manual
check replaced with a cmd predicate (origin remote = novakai-one/novakai) → M0 now BUILT;
spine reordered recorded-demo BEFORE foreign-repo; M9 intent now runs on novakai (ruling
2026-07-04), M7 (react-dev) deliberately last; M5 note updated. (5)
`docs/flowmap/parity-checklist.md` — plan review row → `unfold-reachable (io tab →
ctx.hooks.plannerOpen; ruling 2026-07-04/1)`; footnote ¹ rescoped to diff review only
(z-order correction recorded); new superseding ruling 2026-07-04/1 appended. Diff review
stays post-MVP. Branch `mvp/m9-prep-fixes` — Chris reviews and merges.

| What | Verify it yourself | Expect |
|---|---|---|
| Suite green | `npm run spec:test:all` | all pass |
| src characterization green | `npm run test:src` | all pass |
| Build clean | `npm run build` | tsc + vite build, exit 0 |
| No signature drift | `npm run flowmap:gate` | clean (spec and code in sync) |
| M0 built + new spine order | `npm run flowmap:mvp` | M0 BUILT; spine `rename -> tooling-enforceable -> interface -> readability -> recorded-demo -> foreign-repo`; M9 listed before M7 |
| Ban intact | `npm run flowmap:roadmap:audit` | both scans clean |
| Plan-review ruling recorded | `grep -n "2026-07-04/1" docs/flowmap/parity-checklist.md` | hits |
| Plan review reachable | `grep -n "ufReviewPlan" src/panel/unfold.ts` | button + click handler |
| plannerOpen hook wired | `grep -n "plannerOpen" src/core/context/context.ts src/main.ts` | hook type + default + real wiring |
| Map fresh | `npm run flowmap:ship` | DONE line |
| Quiz pass bound to a live session | `npm run flowmap:onboard` (STEP 4) | re-take in YOUR session — this session's pass never attests your read |

**Next:** Chris reviews/merges this PR; visually confirm the two UI fixes (stage wires
land on card edges; dock tab/chip spacing reads as separated, not joined) — in-session
browser check was unavailable this session. Then M9 (recorded end-to-end demo on novakai)
is ready to attempt per the corrected spine; M7 (react-dev foreign-repo run) stays last.
`npm run flowmap:mvp` computes it all — never this file; queued: redesign
ship-staleness freshness predicate (see KNOWN_EDGES 2026-07-04 entry) — commit-timestamp
check false-positives on map-neutral src commits.

## 0·prev·m6-batch1 (2026-07-04, earlier session) — M6 readability batch 1 on `m6/integration` (PR #40): sonar-scale warnings 2279 → 1738 (−541), API surface hash-verified unchanged, io/layout + io/mermaid characterization tests added

28 line-budgeted passes over the worst offenders — panel/unfold −295, io −79
(`toMermaid`, complexity 87, split into module-private emit helpers),
interaction/pointer −54, render/wires −13, tools −100. Every pass re-ran
typecheck, lint, the full suite, the API hash and the score ratchet via an
independent verifier; exported signatures are additionally frozen by the drift
specs (`flowmap:gate`). Per-module delta table + full pass list:
`.readability/PR-BODY.md`. Deliberately left for the next batch, with extraction
shapes already proven (unfold `renderInspector`, mermaid `fromMermaid`, pointer
`pointerdown`/`pointerup`): `.readability/notes.md`; aborted passes:
`.readability/failures/`. Branch `m6/integration` — Chris reviews and merges
PR #40.

| What | Verify it yourself | Expect |
|---|---|---|
| Suite green | `npm run spec:test:all` | all pass |
| No exported-signature drift | `npm run flowmap:gate` | clean |
| API surface unchanged | `node .readability/scripts/api-surface.mjs && git diff --exit-code .readability/api-surface.json` | no diff |
| Warning total is real | `node .readability/scripts/score.mjs && node -e "const t=require('./.readability/baseline-scores.json').moduleTotals;console.log(Object.values(t).reduce((a,b)=>a+b,0))"` | 1738 |
| Characterization tests pass | `npm run test:src` | all pass |
| Map true + complete at HEAD | `npm run flowmap:ship` | DONE line |
| Quiz pass bound to a live session | `npm run flowmap:onboard` (STEP 4) | re-take in YOUR session |

**Next:** Chris reviews and merges PR #40; batch-2 candidates and their proven
extraction shapes are in `.readability/notes.md`. The prior queue (PR #37 review,
§C drag plan, select-all with multi-select, theme-chips ruling) is unchanged —
`npm run flowmap:mvp` computes it all, never this file.

## 0·prev·e4-f5-predicates (2026-07-03, earlier session) — E4 + F5 predicates repaired to follow the AUD5/F-06 canonical-suite indirection; roadmap computes 32 built, 0 partial

E4/F5's unmet rows grepped `spec-gate.yml` for literal test filenames
(`acceptance.test`, `plan-layout.test`, `loop-e2e.test`), but AUD5/F-06 deliberately
replaced CI test enumeration with one canonical list: CI runs `npm run spec:test:all`
and `gate-parity.test.mjs` fails the build if a CI-only enumeration reappears. All
three suites already ran in CI on every push/PR — the predicates tested the pre-F-06
mechanism, not the intent. Fix: `roadmap.json` E4/F5 checks now verify the two-link
chain (spec-gate.yml runs the canonical suite AND package.json's suite contains the
file), which stays fail-closed: breaking either link re-opens the item. No app code,
no CI change, no test change. Plan, with the rejected-alternative rationale:
`docs/flowmap/plans/e4-f5-ci-predicates.plan.md`. Branch `e4-f5-ci-predicates` —
Chris reviews and merges.

## 0·prev·m5-tabs2-verbs (2026-07-03, earlier session) — `m5-p-tabs2` + `m5-a-verbs` EXECUTED and landed: 11 changes built by contract-carrying subagents, both acceptance contracts red→green, all 16 runtime criteria probed green, M5 at 11/11 machine predicates

Both plans from PR #37 were executed in one run, in the ruled order (p-tabs2 then a-verbs —
`initUnfold`'s signature is cumulative). Five 0-context builder subagents each carried a
`FLOWMAP-CONTRACT:<id>` spawn sentinel (G4 gate validated the packet at spawn); the
orchestrator verified every landing with `flowmap:acceptance` + `flowmap:verify-change` and
committed per phase. A fresh 0-context agent then re-verified the whole landing from
command output alone, and a headless Playwright probe drove every runtime criterion in the
two plan notes against the live app (probe committed:
`docs/flowmap/probes/m5-tabs2-verbs.probe.js` — usage in its header). Branch
`m5-p-tabs2-a-verbs-build` — Chris reviews and merges. Never commit on `main` — standing
verdict in KNOWN_EDGES.md.

| What | Verify it yourself | Expect |
|---|---|---|
| P-tabs2 contract green | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-p-tabs2.plan.json` | 6/6 green — behavioural contract satisfied |
| A-verbs contract green | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-a-verbs.plan.json` | 13/13 green — behavioural contract satisfied |
| A-verbs fully landed | `npm run flowmap:status -- --plan docs/flowmap/plans/m5-a-verbs.plan.json` | 6 built · 0 pending · 0 drifted |
| P-tabs2 landed (then superseded) | `npm run flowmap:status -- --plan docs/flowmap/plans/m5-p-tabs2.plan.json` | 4 built + `uf-dock-tabs2` DRIFTED — expected supersession, NOT a regression: a-verbs deliberately widened `initUnfold` (see KNOWN_EDGES, cumulative-plans flavour); BUILT state verifiable at commit 9bb8597 |
| Pure fns PROVEN, not just shaped | `npm run flowmap:verify-change -- --change uf-slice-targets --plan docs/flowmap/plans/m5-p-tabs2.plan.json --json` (and `--change uf-verb-gate` on the a-verbs plan) | verdict `PASS`, behavioural proven:true (6/6 · 13/13) |
| Map true + complete at HEAD | `npm run flowmap:ship` | DONE line; 0 unaccounted edges |
| M5 predicates | `npm run flowmap:mvp` | M5 11/11 machine predicates (◐ only from its standing declared-manual line) |
| Types clean | `npx tsc --noEmit` | exit 0, no output |
| Runtime criteria (16) | `node docs/flowmap/probes/m5-tabs2-verbs.probe.js` (needs playwright + dev server — header explains) | 16 `[PASS]` lines, `FINAL CONSOLE ERRORS (0)` |
| Ban intact | `npm run flowmap:roadmap:audit` | both scans ✓ |
| Quiz pass bound to a live session | `npm run flowmap:onboard` (STEP 4) | re-take in YOUR session — this session's pass never attests your read |

**Honest boundaries (do not oversell):**
- Only the two pure functions carry behavioural contracts (by plan design); the other 9
  changes are `PASS_UNPROVEN` structurally and their behaviour is covered by the committed
  runtime probe, which needs a browser and is NOT in CI. E4/F5's remaining CI rows are
  unchanged by this session.
- `uf-dock-tabs2` reads DRIFTED on the p-tabs2 plan because a-verbs superseded the
  signature the same day — the 0-context verifier caught this and it is now a recorded
  KNOWN_EDGES flavour, with the residual risk that M5's acceptance-only predicates would
  NOT catch such a drift (only `flowmap:status`/`verify-change` do).
- Both landed `add` changes were hand-flipped to `modify` (the recurring lifecycle gap).
- Theme chips stay legacy-only — the THEMES→unfold-palette mapping is still Chris's open
  design ruling; the style tab ports font + appearance only.
- Builder deviations, all directed or flagged (in the PR body): `reverseEdge` re-anchors
  (plan-directed), a `selIsRealNode` guard on connect/duplicate/copy/wrap (phantom
  hierarchy-container ids), edge-verb id resolution by endpoint pair (unambiguous because
  duplicate same-direction edges are refused).

**Next (Scenario 1):** the §C drag plan (largest item, ruled standalone — design-first),
the remaining deferred decisions (select-all with multi-select), and the theme-chips
ruling whenever Chris rules. `npm run flowmap:mvp` computes it all — never this file.

## 0·prev·m5-p-panel (2026-07-03, earlier session) — M5 P-panel LANDED: the panel is a real dock (tabs at the reveal strip · resize · collapse) + the io/mermaid §B tabs batched in; acceptance 0/15 → 15/15; runtime-probed in headless Chrome

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
module stays the only serialiser; apply goes through `ctx.dom.mmd` + `applyText`). Landed on
branch `m5-p-panel`, merged by Chris (PR #36). Honest boundaries recorded at the time: dock
persistence is global, not per-diagram; active-tab click does not collapse (chevron only);
the mermaid tab's toast renders under the overlay (cosmetic, dies with legacy chrome);
resize reframes once at drag end; the headless-Chrome runtime probe (9 criteria) was
session-scratch, not repo tooling.

## 0·prev·m5-p-wires (2026-07-03, earlier session) — M5 P-wires LANDED: edge lifting — wires never cross foreign containers; acceptance 0/11 → 11/11; runtime-probed on the repo's own map

Chris's second-pass rulings are recorded in `parity-checklist.md` (new §G + rulings header:
panel resize/collapse + tabs at the "reveal" strip are ruled-in M5 work; all candidate-drops
deferred to backlog; diff/plan sequenced last). The first §G item, **P-wires**, is
implemented per Chris's design (`docs/flowmap/plans/m5-p-wires.plan.json`): the pure
`ufLiftWires` (`src/panel/unfold-lift.ts`, unfold-esc precedent) lifts every wire to sibling
anchors under the lowest common container, counts concealed endpoints for a mid-path badge,
and encodes the travel-depth rule — selected leaf = atomic reveal with arrowheads, selected
group = crossing wires anchored AT the group and highlighted, selected wire/badge = explode
into underlying relations; arrowheads exist ONLY on atomic reveals; opposite directions
merge by weight majority. `drawWires` paints the decision; `requestRoutes` routes per
containment scope with group boxes as obstacles (atomic reveals route against cards only);
the wire inspector resolves carries through the same decision. Branch `m5-p-wires` —
Chris reviews and merges. Never commit on `main` — standing verdict in KNOWN_EDGES.md.

| What | Verify it yourself | Expect |
|---|---|---|
| Plan fully landed (4 changes) | `npm run flowmap:status -- --plan docs/flowmap/plans/m5-p-wires.plan.json` | 4 built · "Plan fully landed" |
| Behavioural contract green (was 0/11 red) | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m5-p-wires.plan.json` | 11/11 green, exit 0 |
| Plan still author-coherent post-landing | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/m5-p-wires.plan.json` | coherent (the landed add was flipped to modify per KNOWN_EDGES) |
| M5 per-feature predicates | `npm run flowmap:mvp` | `M5` shows (4/4); manual note remains (more rows to drain) |
| Map re-synced, gate + edges green | `npm run flowmap:ship` | DONE line; 0 unaccounted edges |
| Full tooling suite | `npm run spec:test:all` | exit 0, no failures |
| Full CI-equivalent chain | `npm run flowmap:verify:full` | DONE line |
| Ban holds on all docs | `npm run flowmap:roadmap:audit` | both scans ✓ |
| Runtime (browser): no wire crosses a foreign container; no default arrowheads; badges; group/leaf/wire selection rules | boot `npm run dev`, load `docs/flowmap/_bundle.mmd` via the mermaid tab, expand groups, then select a group header / a leaf via the tree / click a badge | 0 crossings; arrows only after leaf-select or badge-click; inspector lists the exploded wire's carries |

**Honest boundaries (do not oversell):**
- Concealed-count definition (assumption, recorded in the plan note): distinct real
  endpoints hidden behind BOTH anchors (union), not a per-side count.
- Lifting generalises Chris's "stops at outermost group" to lowest-common-container —
  strictly stronger (wires inside an expanded group respect inner boundaries too).
- Stage-mode wires are untouched (already aggregated + arrowless); the stage wire-click
  noop gap in KNOWN_EDGES.md still stands.
- Port-slot dispersal (arrowhead convergence crowding) is DEFERRED as its own build item,
  per Chris's ruling in the message that approved this build.
- Clicking a revealed strand selects its parent aggregate (deliberate: every wire click
  tells the aggregate story; re-click toggles off).
- Blast-radius wire dimming is keyed on lifted anchors — approximate when an anchor sits
  above the blast rep (cosmetic only).
- The runtime probe drove headless system Chrome via CDP against `npm run dev` with the
  repo's own bundle applied through the mermaid tab; geometry was asserted by sampling
  every drawn path against every expanded group box (0 violations, three interaction
  stages, 0 console errors). The probe script is session-scratch, not repo tooling.
- A 0-context agent independently re-ran all 5 command checks and 5 runtime criteria
  (overall PASS) and added two geometric checks the probe lacked: the selected group's
  hot wire terminates exactly on the group border (anchoring proven, not inferred), and
  the badge texts are real concealed-counts (5, 21, 5, 2, …), not decoration.

**Next (Scenario 1):** per the updated checklist (§G) the next item is **P-panel** —
inspector dock resize + collapse and panel tabs/sub-menus anchored at the "reveal" strip
(prerequisite landing zone for the §B tab migrations: io, nav, slice, mermaid, style).
Author its plan with acceptance red before code, per the loop. Resume:
`npm run flowmap:onboard`, then `npm run flowmap:mvp` for the computed M5 state; the parity
checklist rows are the feature enumeration. `npm run flowmap:mvp` computes it all — never
this file.

## 0·prev·m5-boot-flip (2026-07-03, earlier session) — M5 P-boot LANDED: boot → unfold unconditionally; surface decision removed; acceptance 0/6 → 6/6; 0-context verified

The approved boot-flip plan (`docs/flowmap/plans/m5-boot-flip.plan.json`, PR #33 review)
was implemented: `resolveBootSurface`/`normalizeSurface`/`AppSurface`/`SURFACE_KEY` removed
(not inverted) from `src/`, `main.ts` opens unfold unconditionally after first paint, the
dock ✕ replaced by an explicit `legacy` compare affordance, the Esc chain's decision factored
into the pure `ufEscAction` (`src/panel/unfold-esc.ts`) whose bottom is `'none'`. A 0-context
agent verified all 12 criteria (5 command, 7 runtime, fresh-profile browser). Branch
`m5-boot-flip`, PR #34 — merged by Chris. Superseded by the P-wires session entry in
`SESSION_HANDOFF.md`; its honest boundaries that remain live (remove-flavoured plan-lifecycle
gap; `favicon.ico` 404; drag-geometry ownership options-only) are in `KNOWN_EDGES.md` or the
design doc, not here.

## 0·prev·m4-correction (2026-07-03, earlier session) — M4 correction: unfold IS the app; boot-flip plan authored, acceptance red, awaiting Chris's review

The shipped M4 misread the goal (sticky surface choice, overlay-on-editor). Corrected intent
from Chris: boot → unfold always; the legacy canvas is a temporary compare surface, deleted
at parity; no ✕ on unfold. That session recomputed the verify step, recorded Chris's rulings,
rewrote the M4 predicates, and authored the boot-flip plan — code was deliberately not
written: acceptance was red, the plan awaited Chris's review in the flowmap app.
Branch `m4-correction`, PR #33 (merged by Chris). Commits `ef0f9dc` (parity checklist) →
`ec8367d` (design doc + M4 predicates + plan) → `0d7fa97` (handoff rotation). Superseded by
the implementing session's entry in `SESSION_HANDOFF.md`; the map-accuracy findings it
recorded (dead `main -->|29 diff workspace|` edge; unfold's missing `avoidRouter` edge) were
fixed in that session.

## 0·prev·m4 (2026-07-03, earlier session) — M4 BUILT: read is the primary surface — the boot decision is pure, sticky and acceptance-proven

M4 executed through the full loop (design contract `docs/flowmap/m4-read-primary-design.md` committed
doc-first; map-first fragments; plan red before code). The P1 flip from §0a is live: the app boots into
the unfold reading overlay via `resolveBootSurface` — a pure viewspec function (empty model → editor;
otherwise the stored surface is sticky and the default is read); `open()`/`close()` record the choice
under `SURFACE_KEY` (`flowmap.surface.v1`, a config key string, allowlisted like `LS_KEY`). Branch
`m4-read-primary`, commits doc `458068c` → map+plan `f176bde` → code `cba5ee0`. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **M4 is BUILT — computed, not prose** | `npm run flowmap:mvp` | `M4 — Read (unfold) migrated to main app (6/6)` [BUILT], zero manual lines |
| The behavioural contract was red before the code | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m4-read-primary.plan.json` | 10/10 green (strict normalize ×5, boot decision table ×5) |
| Plan coherent, fully landed | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/m4-read-primary.plan.json` · `npm run flowmap:status -- --plan docs/flowmap/plans/m4-read-primary.plan.json` | coherent (6 changes, 7 deps) · 6 built |
| The boot flip is one live top-level line | `grep -n 'resolveBootSurface(' src/main.ts` | 1 hit (~line 236), in the boot block after the history baseline |
| Surface recorded at the transitions, not in persistView | `grep -c 'SURFACE_KEY' src/panel/unfold.ts` | 3 (import + open→'read' + close→'edit') |
| The new contract is mapped | `grep -c 'viewspec__AppSurface\|viewspec__normalizeSurface\|viewspec__resolveBootSurface' docs/flowmap/_bundle.mmd` · same for `unfold__ufOpen\|unfold__ufClose` | 25 · 21 |
| Reducer-style property tests joined the bundled suite | `node tools/buildspec/run-bundled-test.mjs tools/buildspec/viewspec.test.mjs` | 7/7 (5 M3 + 2 M4) |
| Whole suite green · typecheck clean | `npm run spec:test:all` · `npm run typecheck` | 300 pass 0 fail (285+6+2+7) · exit 0 |
| Map true + complete + in sync | `npm run flowmap:ship` → `git diff --stat docs/flowmap/_bundle.mmd` | DONE line · empty |
| Status ban holds on all docs | `npm run flowmap:roadmap:audit` | both scans ✓ |
| Run it | `npm run dev` → clear localStorage → reload | arrival = the reading overlay (5 region cards); ✕ → editor, reload stays editor; Read → reload stays read; `flowmap.surface.v1` holds `'read'`/`'edit'` |

**Runtime-verified this session** (headless Chromium DOM assertions against the dev server — the
Chrome-MCP extension was not connected): fresh profile boots READ and records `'read'`; ✕ returns to
the editor and survives reload; Read is sticky across reload; a garbage stored value (`'READ'`) falls
back to the read default; **0 console errors / 0 page exceptions across four reloads**.

**Honest boundaries (do not oversell):**
- `ufOpen`/`ufClose` are structure-only map nodes (ctx/DOM-bound closures); the acceptance-proven half
  is the pure pair (`normalizeSurface`/`resolveBootSurface`). The runtime paragraph above is the
  behavioural evidence for the DOM half.
- Tooling sharp edge found (not fixed, latent for any future closure node): `extract.mjs#findSymbol`
  takes the FIRST same-named declaration in document order, so a local variable named like a mapped
  closure reads as gate drift — hit by `treeRow`'s `open` local (renamed `isOpen` in `cba5ee0`).
- M4's title says "migrated to main app": unfold has lived in `src/panel` since before M3; what M4
  adds — and what its 6 predicates prove — is boot-primacy + the surface contract, per its intent line.
- The editor still fully boots underneath the overlay (deliberate: ✕ reveals a ready editor); cost is
  one editor first-paint on read boots.
- `sel`/`stage`/`query` restore-on-boot remains an open M5 decision, unchanged from M3's boundary.
- `main__firstRender` carries no `%% src` binding (an architectural node — main.ts boot code is
  module-level, no named function), so 5/6 plan targets are symbol-verifiable; the 6th is covered by
  the grep predicate on `src/main.ts` plus the runtime run.
- A 0-context verifier independently recomputed all of the above from commands alone; its verdict —
  delivered, with the real-browser runtime as the one boundary it cannot cross — is exactly what the
  headless-browser run above covers. "ViewSpec-driven rendering" is proven by M3's contract, not
  re-proven by M4's predicates.

**Next (Scenario 1):** Chris reviews/merges the M4 PR (doc → map+plan → code commit order). Then **M5**
(feature-migration checks, one plan per feature) is the open P2 item; the two CI partials (E4:
acceptance+plan-layout steps, F5: loop-e2e step in `spec-gate.yml`) remain the small open gaps;
`npm run flowmap:roadmap` / `npm run flowmap:mvp` compute all of it — never this file.

## 0·prev·m2b-build (2026-07-03, earlier session) — M2b BUILT: compliance metrics — trust becomes a rate over N runs, not one green run

M2b executed per the reviewed design contract (`docs/flowmap/m2b-metrics-design.md`, §10 test-first
order, every step red before its code). One fail-silent emitter (`tools/flowmap/lib/metrics-log.mjs`,
the one invariant: logging may never change a gate's decision, exit code, stdout or latency class),
one CLI (`tools/flowmap/metrics.mjs` — `summary` + the transparent `wrap` ship recorder), and
instrumentation in ALL FOUR gates + `quiz.mjs check` + `verify-change.mjs` + `plan-cert.mjs` (CLI
path only — `certifyPlan` stays a pure import). The log (`docs/flowmap/metrics/session-log.jsonl`)
is gitignored session telemetry; the summarizer is green on a fresh clone. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **M2b is BUILT — computed, not prose** | `npm run flowmap:mvp` | `M2b — Compliance metrics (7/7)` [BUILT], zero manual lines |
| Emitter invariant proven (fail-silent on a broken destination, FLOWMAP_ROOT seam) | `node --test tools/flowmap/lib/metrics-log.test.mjs` | 4/4 |
| Summarizer failure semantics (absent/empty log exit 0, malformed skip+count, 0/0 = n/a never 0%, `wrap` exit/signal transparency, start/end pairing, `--since`/`--last`) | `node --test tools/flowmap/metrics.test.mjs` | 12/12 |
| Every instrumented tool metered with exit codes UNCHANGED (each file carries an M2b test) | `node --test tools/flowmap/edit-gate.test.mjs tools/flowmap/plan-gate.test.mjs tools/flowmap/ship-staleness.test.mjs tools/flowmap/contract-gate.test.mjs tools/flowmap/quiz.test.mjs tools/flowmap/verify-change.test.mjs` | 53/53 |
| plan-cert records on the CLI path only (library importers never double-record) | `node --test tools/flowmap/plan-cert.test.mjs` | 4/4 (incl. the M2b wiring test) |
| Ship runs are recorded via a transparent wrapper | `grep -n 'metrics.mjs wrap --event ship' package.json` · `npm run flowmap:ship; echo $?` · `npm run flowmap:metrics` | `flowmap:ship` wraps `flowmap:ship:steps` · DONE + 0 · `ship runs : ≥1 run(s)` |
| The four intent metrics read back | `npm run flowmap:metrics` (or `-- --json`) | quiz pass rate · per-gate allow/deny · ship runs/ok/aborted/median · cert pass rate · PASS_UNPROVEN ratio (n/a where no data) |
| The log is session-local, never committed | `git check-ignore docs/flowmap/metrics/session-log.jsonl` | path echoed (ignored) |
| Determinism untouched: verify-change stdout byte-identical around the side log | `node --test tools/flowmap/verify-change.test.mjs` · `npm run flowmap:mutate` | 9/9 (incl. byte-identity test) · 4/4 HARNESS GREEN |
| Tooling self-map carries both new modules (I1) | `grep -c 'metrics' docs/flowmap/_tooling.mmd` · `npm run flowmap:tooling:verify` | ≥8 · DONE line |
| Whole suite green · typecheck clean | `npm run spec:test:all` · `npm run typecheck` | 298 pass 0 fail (285+6+2+5) · exit 0 |
| Src map untouched by this session (tools-only change) | `npm run flowmap:ship` → `git diff --stat docs/flowmap/_bundle.mmd` | DONE (512 nodes · 334 edges) · empty |
| Status ban holds on all docs | `npm run flowmap:roadmap:audit` | both scans ✓ |

**Honest boundaries (do not oversell):**
- The emitter is fail-silent BY DESIGN (design §3/§8): a broken emitter silently undercounts rather
  than ever influencing a gate. `FLOWMAP_METRICS_DEBUG=1` surfaces emit errors.
- Test suites route emitter output to scratch sinks via `FLOWMAP_ROOT` (the seam design §3 names) —
  including five test files that previously spawned tools without it (contract-gate, quiz,
  verify-change, loop-e2e, orchestrate). Without this, every local `spec:test:all` run would have
  inflated the deny counts with fixture traffic. Test-env-only change; no product behavior touched.
- Real-log events include tool-driven runs (e.g. roadmap `cmd` predicates spawning `verify-change`),
  not only agent-initiated ones — the log measures this working copy's activity, not intent.
- `ship-staleness`'s anti-loop (`stop_hook_active`) and git-unavailable passthroughs are NOT logged:
  they are not decisions (the design table names only the block/fresh paths).
- `quiz verify` is deliberately unlogged (edit-gate spawns it per src/ edit — design §4 non-goal).
- Out of scope, unchanged (design §11): log rotation/prune, multi-log aggregation, sampling.

**Next (Scenario 1):** Chris reviews/merges the M2b PR. Then **M4** (unfold → main-app surface,
unblocked, ViewSpec-driven by construction) is the natural P2 item; the two CI partials on the main
roadmap (E4: acceptance+plan-layout steps, F5: loop-e2e step in `spec-gate.yml`) remain the small
open gaps; `npm run flowmap:roadmap` / `npm run flowmap:mvp` compute all of it — never this file.

## 0·prev·m3 (2026-07-03, earlier session) — M3 BUILT: ViewSpec contract — one serializable spec, pure reducer, unfold rides the commit seam

M3 executed at Chris's direction (M2b build remains the open P1 follow-up, orthogonal). The reading
view's ~10 closure variables became ONE serializable `ViewSpec` (Z pan/zoom excluded by Chris's
verdict; `fmOpen` included so no DOM-toggle exemption survives day one); `src/core/viewspec/viewspec.ts`
(pure, zero imports) holds the contract — `normalizeViewSpec` is the schema boundary (a pre-M3
localStorage entry is a valid subset, migration branch-free), `reduceView` the only mutation path.
In unfold, `commit(action)` = reduce → frozen install → per-action paint (today's hand-tuned render
subsets transcribed BEHIND the boundary). This is the FIRST plan to carry H1 projection acceptance
cases — red before the code existed, green after. Review order in the PR is doc → code (design
contract committed first: `docs/flowmap/m3-viewspec-design.md`). Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **M3 is BUILT — computed, not prose** | `npm run flowmap:mvp` | `M3 — ViewSpec contract (7/7)` [BUILT], zero manual lines |
| The behavioural contract is real (was red pre-impl) | `npm run flowmap:acceptance -- --plan docs/flowmap/plans/m3-viewspec.plan.json` | 7/7 green (migration, id-confinement, fold/reveal/guard/exclusion invariants) |
| The old closure view vars are GONE (machine form of "no direct DOM-toggle handlers") | `! grep -qE 'let (SEL\|SELW\|QUERY\|STAGE\|FOCUS_TYPE\|FM_OPEN)' src/panel/unfold.ts; echo $?` | 0 |
| Both load boundaries route through the schema | `grep -c 'normalizeViewSpec(' src/panel/unfold.ts` | 2 (persist-load + build stale-drop) |
| Reducer properties too fiddly for JSON cases | `node tools/buildspec/run-bundled-test.mjs tools/buildspec/viewspec.test.mjs` | 5/5 (normalize idempotence, frozen-input non-mutation, toggle round-trip, hide-clears-sel, stage guard) |
| Plan coherent, fully landed | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/m3-viewspec.plan.json` · `npm run flowmap:status -- --plan docs/flowmap/plans/m3-viewspec.plan.json` | coherent (6 changes, 5 deps) · 6 built |
| Map true + complete + in sync (viewspec module + ufCommit are nodes) | `npm run flowmap:ship` · `grep -c 'viewspec__' docs/flowmap/_bundle.mmd` | DONE (512 nodes · 334 edges, 0 unaccounted) · ≥40 |
| Whole suite green · typecheck clean | `npm run spec:test:all` · `npm run typecheck` | 275 pass 0 fail (262+6+2+5) · exit 0 |
| Design contract + status ban | `ls docs/flowmap/m3-viewspec-design.md` · `npm run flowmap:roadmap:audit` | present · both scans ✓ |
| Run it | `npm run dev` → paste `_bundle.mmd` → Apply → **Read** | arrival = 5 region cards + calls wires; click camera (revealed) → group center-stage + 7 pills; peek → travel; reload restores expanded/hidden/layers (a pre-M3 stored view still loads) |

**Runtime-verified in a REAL browser this session** (Playwright on the dev server, all via the actual
UI): arrival 5 region cards + calls-on, enter-stagger classes live mid-transition, select→auto-stage
(pills=7, angles correct), peek→travel (Rendering & viewport → Side panels), ✕ ladders
stage→explore→editor, desc layer + tree search (56/526 rows), full-spec persistence across a page
reload, seeded legacy + garbage `unfold.view` entries load without crash, escape-chain walks to
close(), fold-all resets to 5 roots. **0 console errors** (a frozen-spec violation would have thrown).

**Honest boundaries (do not oversell):**
- "Renderer = pure function of spec" is honest at the REDUCER + consumer level: render() and the
  painters consume only the spec (+ declared animation/camera infra) and the mutation logic is pure
  and acceptance-proven — but the painters themselves are still DOM-bound (the full
  `deriveView` + dumb-painter layer is deliberately M4/M5 work, behind this same seam).
- Deliberate unifications, not pure transcription (all reducer-centralized invariants): tree-chevron
  collapse now folds descendants like the canvas toggle; raw `SEL =` writes (peek/travel/goto) now
  clear the mutually-exclusive focuses; Escape-deselect converges with click-deselect's subset paint.
- `sel/stage/query` are stored in the v1 spec but NOT restored on load (selectSync owns the mode
  boundary) — restoring them is an M4 decision, additive.
- Plan changes were authored `modify`-from-start against the already-bundled fragment nodes (map-first
  authoring), so the documented add→modify lifecycle flip is avoided by construction — the
  falsifiability lives in the acceptance cases, which were run red before implementation.

**Next (Scenario 1):** Chris reviews/merges the M3 PR (doc commit first). Then either the **M2b build**
(design contract `docs/flowmap/m2b-metrics-design.md` §10, still the open P1 item) or **M4** (unfold →
main-app surface, now unblocked and ViewSpec-driven by construction); `npm run flowmap:mvp` computes
both — never this file.

## 0·prev·m2b (2026-07-03, earlier session) — M2b design-first: metrics design contract + roadmap predicate conversion (design only, PR for review)

M2b (compliance metrics) enters via the design-first route: this session emits the reviewed design
contract `docs/flowmap/m2b-metrics-design.md` and converts M2b's roadmap `manual` note into 7 machine
predicates — the build contract a follow-up session executes. **No collector code exists yet, by
design** — Chris reviews the design PR before any build. All design judgments (verdict events in
scope beyond the brief's three families, gitignored session-local log, fail-silent emitter invariant,
ship recorded via a transparent `wrap` subcommand) are logged with rejected alternatives in the doc
itself. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| The design contract exists | `ls docs/flowmap/m2b-metrics-design.md` | present |
| M2b is computed against real predicates — the manual note is gone | `npm run flowmap:mvp` | `M2b — Compliance metrics (1/7)`, six `✗ unmet` build predicates, zero `· manual` lines |
| The predicates prove instrumentation, not mere file existence | `grep -A9 '"id": "M2b"' docs/flowmap/mvp-roadmap.json` | file ×2 · grep ×4 (`lib/metrics-log` call-sites in edit-gate + quiz, npm wiring, ship wrap) · cmd ×1 (summarizer green on empty log) |
| The design doc passes the status-marker ban | `npm run flowmap:roadmap:audit` | both scans ✓ (16 docs) |
| Nothing yet implies build progress | `ls tools/flowmap/metrics.mjs docs/flowmap/metrics 2>&1` | both: No such file or directory |
| Map untouched by this session | `npm run flowmap:ship` → `git diff --stat docs/flowmap/_bundle.mmd` | DONE line · empty |

**Next (Scenario 1):** Chris reviews the design PR. On approval, the build session follows the
test-first order in `docs/flowmap/m2b-metrics-design.md` §10; `npm run flowmap:mvp` computes M2b's
progress against the 7 predicates at every step — never this file.

## 0·prev·m2 (2026-07-03, earlier session) — M2 protocol hooks landed, one PR per hook (3 PRs, test-first)

M2's intent ("session-protocol rules become machine gates") starts landing. Hook 1: PreToolUse now
DENIES a `src/` Edit|Write unless a quiz pass verifies against the CURRENT map bytes (`quiz.mjs verify`,
the F-03 artifact) — protocol rule 2 is enforced, not remembered. Test-first: 8 CLI fixture tests were
red before the gate existed. Scope decision (documented in the tool header): only `src/` paths are gated —
the quiz proves understanding of the src map, so that is the claim the gate can enforce; tools/docs/config
edits keep their own gates (tooling-coverage, roadmap:audit, handoff-fresh). Hooks 2/3 (ExitPlanMode
plan-check) and 3/3 (Stop ship-staleness) follow, one PR each. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| The hook is wired | `grep -n 'Edit\|Write' .claude/settings.json` | matcher `Edit\|Write` → `node tools/flowmap/edit-gate.mjs` |
| Deny/allow logic proven offline | `node --test tools/flowmap/edit-gate.test.mjs` | 8/8 |
| A src/ edit in a checkout with no quiz pass DENIES | `printf '{"tool_name":"Edit","tool_input":{"file_path":"src/main.ts"}}' \| FLOWMAP_ROOT=$(mktemp -d) node tools/flowmap/edit-gate.mjs; echo $?` | deny JSON + `2` |
| The gate is in the tooling self-map (I1) | `grep -c 'editGate' docs/flowmap/_tooling.mmd` | ≥4 (node + kind + src + meta) |
| Its test is in the ONE canonical suite (CI runs it by construction, F-06) | `grep -c 'edit-gate.test.mjs' package.json` | 1 |
| M2 progress is computed, not prose | `npm run flowmap:mvp` | M2 (2/3): `Edit\|Write` + `ExitPlanMode` met · `ship` unmet |

**Hook 2/3 — ExitPlanMode plan-gate (this PR).** C3 coherence enforced at plan-approval time: exiting
plan mode DENIES while the named (`FLOWMAP-PLAN:<path>` in the plan text) or in-flight (`public/plan.json`)
plan fails `plan-check`; near-miss sentinels deny; no plan anywhere allows. Test-first: 9 CLI fixture
tests red before the gate existed.

| What | Verify it yourself | Expect |
|---|---|---|
| The hook is wired | `grep -n 'ExitPlanMode' .claude/settings.json` | matcher → `node tools/flowmap/plan-gate.mjs` |
| Deny/allow logic proven offline | `node --test tools/flowmap/plan-gate.test.mjs` | 9/9 |
| Approval of an incoherent in-flight plan DENIES | fixture repro in the test ("no sentinel, in-flight public/plan.json is INCOHERENT") | exit 2 + deny JSON |
| The gate is in the tooling self-map (I1) | `grep -c 'planGate' docs/flowmap/_tooling.mmd` | ≥4 |
| Its test is in the ONE canonical suite | `grep -c 'plan-gate.test.mjs' package.json` | 1 |

**Hook 3/3 — Stop-hook ship-staleness (this PR).** Protocol rule 5 ("every session ends with a
re-sync") becomes a machine gate: the Stop hook BLOCKS a session end (exit 2, once — `stop_hook_active`
is the anti-loop) while the shipped map lags `src/`, naming the exact re-sync command. Design decision
(recorded in the tool header, per the M2 intent "ship-staleness in Stop hook"): the hook demands
`flowmap:ship`, it does not run the pipeline itself — a Stop hook that silently regenerated the map
would mutate the tree at every stop and hide the re-sync from history. Test-first: 7 CLI fixture tests
red before the gate existed.

| What | Verify it yourself | Expect |
|---|---|---|
| The hook is wired | `grep -n 'ship-staleness' .claude/settings.json` | Stop hook → `node tools/flowmap/ship-staleness.mjs` |
| Deny/allow logic proven offline | `node --test tools/flowmap/ship-staleness.test.mjs` | 7/7 |
| The gate is in the tooling self-map (I1) | `grep -c 'shipStaleness' docs/flowmap/_tooling.mmd` | ≥4 |
| Its test is in the ONE canonical suite | `grep -c 'ship-staleness.test.mjs' package.json` | 1 |
| **M2 is BUILT — computed, not prose** | `npm run flowmap:mvp` | `M2 — Protocol hooks live (3/3)` [BUILT] |

**PR ledger for this session (merge in order — stacked):** #24 edit-gate → #25 plan-gate → #26 ship-staleness.
Merging is deliberately left to Chris (the harness denied agent self-merge; required checks gate each PR).
M2b (compliance metrics) remains the open follow-up in P1.

## 0·prev·m0 (2026-07-03, this session) — M0: repo renamed flowmap → novakai · AUD5 register CLOSED by human confirmation

Chris renamed the GitHub repo to `novakai-one/novakai` (local dir moved to `/novakai`, remote already
updated). This session swept the hardcoded repo refs and, on Chris's explicit confirmation, removed the
AUD5 manual closure note — the register is closed and AUD5 is now fully computed. Tool branding is
deliberately unchanged: `flowmap:*` scripts, `flowmap-spec-tools`, and the `@novakai-one/flowmap-spec-tools`
npm-scope example in `tools/DISTRIBUTION.md` are the tool's name, not the repo's. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Remote points at the renamed repo | `git remote get-url origin` | `https://github.com/novakai-one/novakai.git` |
| No stale repo refs remain (the one hit is the npm-scope tool-branding example, kept by decision) | `grep -rn "novakai-one/flowmap" --exclude-dir=node_modules --exclude-dir=.git .` | exactly 1 hit: `tools/DISTRIBUTION.md` (`@novakai-one/flowmap-spec-tools`) |
| Package renamed | `grep '"name"' package.json` | `"name": "novakai"` |
| AUD5 manual note removed → register closure is computed, not prose | `npm run flowmap:audit` | AUD5 **[BUILT] (20/20)** — no manual line; AUD2 stays [PARTIAL] (its own sign-off, by design) |
| Required checks still bind post-rename | `curl -s https://api.github.com/repos/novakai-one/novakai/rules/branches/main` | ruleset with `required_status_checks` = buildspec-tests + flowmap-drift |
| **Binding demonstrated live**: PR #22's first push went RED — `mutate.test.mjs`'s synthetic find-anchor was `"name": "flowmap",`, which the rename removed from `package.json` (invisible locally: the harness worktrees from HEAD, which pre-commit still said flowmap). Anchor updated to `"name": "novakai",` | `node --test tools/flowmap/mutate.test.mjs` · `curl -s "https://api.github.com/repos/novakai-one/novakai/actions/runs?branch=m0-repo-rename&per_page=4"` | 5/5 · first-push runs `failure` (buildspec-tests), fix-push runs `success` |

## 0·prev·f19 (2026-07-02, part 3) — F-19 FIXED+VERIFIED · first AUD5 fix landed (CI green on PR #1)

Chris enabled branch protection (the F-19 fix) and its rejection of a direct `main` push routed this
work through PR #1 (`aud-work`). The PR's red CI exposed — and this session fixed — a test-portability
bug that had been failing `spec-gate` on main invisibly. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **F-19 fix verified by machine** — ruleset on `main` requires exactly the two audit-recommended checks | `curl -s https://api.github.com/repos/novakai-one/novakai/rules/branches/main` | ruleset 18426727: `required_status_checks` = **buildspec-tests + flowmap-drift**, `pull_request` required, `non_fast_forward` + `deletion` blocked |
| **F-19 demonstrated live**: `spec-gate` had been FAILING on every recent main push, unnoticed (no protection = red CI, merges anyway) | `curl -s "https://api.github.com/repos/novakai-one/novakai/actions/runs?branch=main&per_page=8"` → conclusions | spec-gate runs 28–31 `failure` on 4 consecutive main commits, sibling deploy runs `success` |
| Root cause + fix (commit `033b014`): `replay.test.mjs` used shell `$RANDOM`; dash (ubuntu `/bin/sh`) has no `$RANDOM`, so the fixture degenerated to `exit 0` and the leak-detector test failed in CI while passing on macOS bash. Fixed with a counter-file task portable to any POSIX sh | `git show 033b014 --stat` · `node --test tools/flowmap/replay.test.mjs` | 1 file · 5/5 |
| CI green on the fix — including the FIRST-EVER CI execution of the 4 steps that were skipped behind the failure (contract-gate, waves, handoff-fresh, orchestrate tests) | `curl -s "https://api.github.com/repos/novakai-one/novakai/actions/runs?branch=aud-work&per_page=2"` | both runs on `033b014` `success` |
| **NEW F-02 evidence — F4's CI check is structurally vacuous:** `spec-gate.yml` checks out at default `fetch-depth: 1`; in a depth-1 clone every `git log -1 -- <path>` resolves to the single HEAD commit, so `handoff:check` always sees the A3 "same-commit tie" and passes — proven by run 34/35 passing `flowmap-drift` on a commit where `tools/` was strictly newer than the handoff | `grep -A1 "actions/checkout" .github/workflows/spec-gate.yml` | no `fetch-depth` (→ depth 1). The F-02 fix plan must add `fetch-depth: 0` to `flowmap-drift` |

**AUD5 ledger (one PR per fix, register order per Chris):**

| finding | fix | verify |
|---|---|---|
| F-19 | Chris: ruleset 18426727 (verified above) | `curl -s https://api.github.com/repos/novakai-one/novakai/rules/branches/main` |
| (live bug) | replay.test dash-portability, `033b014` | `node --test tools/flowmap/replay.test.mjs` → 5/5 |
| **F-04** | hollow predicates killed: `file` checks require `minBytes` (default 1 — a 0-byte file never reads BUILT again), `grep` checks take `count` (a lone pasted token no longer satisfies a table predicate); the audit's own predicates strengthened to content-bearing counts; `roadmap.mjs` gets its first test — 10 CLI-spawned deny fixtures, **3 failing pre-fix** (the exact A5/M3 attacks), 10/10 post-fix — wired into `spec:test:all` + CI; AUD5's check is now cmd+manual (computed) | `node --test tools/flowmap/roadmap.test.mjs` → 10/10 · `npm run flowmap:audit` → AUD5 [PARTIAL] (1/1 + manual) · `npm run flowmap:plan-check -- --plan docs/flowmap/plans/aud5-f04.plan.json` → coherent |
| **F-01** | contract-gate fails CLOSED on everything sentinel-shaped or unverifiable: near-miss sentinels (`FLOWMAP_CONTRACT`, wrong case, missing id) DENY; malformed stdin DENIES (the `Agent\|Task` matcher guarantees the payload is a spawn); prose "flowmap contract" stays allowed; header rewritten to honest scope; the tests that LOCKED IN fail-open (T3) flipped — **4 new DENY tests red pre-fix**, 10/10 post-fix; primary deny branch pinned by reason text (closes the M2a masked-mutant redundancy) | `node --test tools/flowmap/contract-gate.test.mjs` → 10/10 · AUD2 A1 repros now: typo → 2, malformed → 2, no-sentinel → 0 · plan: `docs/flowmap/plans/aud5-f01.plan.json` |
| **F-02** | F4 gate fails CLOSED: shallow clone → exit 1 (the vacuous-CI hole — `flowmap-drift` now checks out with `fetch-depth: 0`, per Chris), git-unavailable → exit 1 (was vacuous pass, A3), dirty-handoff bypass LOCAL-only (ignored under CI); `--check` gets its first CLI deny tests in date-pinned fixture repos — **3 fail-closed cases red pre-fix**, 10/10 post-fix; the accepted boundary (timestamp freshness, atomic-commit tie passes, H5 counters empty touches) is stated in the tool header | `node --test tools/flowmap/handoff-fresh.test.mjs` → 10/10 · `grep -B1 'fetch-depth' .github/workflows/spec-gate.yml` → `flowmap-drift` full-history (the job that runs `handoff:check`; `buildspec-tests` uses fixture repos and needs none) · plan: `docs/flowmap/plans/aud5-f02.plan.json` |
| **F-03** | the quiz pass is now a machine-checked artifact: 100% `check` writes `.flowmap-quiz-pass.json` bound to the sha256 of the exact map bytes; new `quiz verify` proves it against the CURRENT map (any map change → STALE); `onboard` STEP 4 prints the live state every session start; answers + pass artifact gitignored (A4 replay surface closed; same-map answer replay is inherent and stated in the header); 5 CLI deny/pass tests on a hand-knowable fixture map | `node --test tools/flowmap/quiz.test.mjs` → 5/5 · `node tools/flowmap/quiz.mjs verify` → states pass/stale/absent · plan: `docs/flowmap/plans/aud5-f03.plan.json` |
| **F-05** | status-marker ban broadened from 2 literal regexes on 1 file to phrasing classes on `CLAUDE.md` + all of `docs/**`: status table cells (`\| done ✅ \|`), status sentences (`Status — shipped`), `state:` anywhere in a line (incl. HTML) all DENY; quoted context (fenced blocks, inline code, blockquotes) is exempt — the A6 false-positive on docs that *describe* the ban is gone; new `--audit-tree docs --allow docs/flowmap/status-ban-allowlist.txt` (allowlist currently empty, entries need a reason); **3 tests red pre-fix**, 14/14 post-fix | `node --test tools/flowmap/roadmap.test.mjs` → 14/14 · `npm run flowmap:roadmap:audit` → both scans ✓ · plan: `docs/flowmap/plans/aud5-f05.plan.json` |

| **F-06** | CI and local now consume ONE canonical gate list: `spec-gate.yml` runs `npm run spec:test:all` (the package.json list is the single source; the formerly local-only `slice-core` + both `flowmap-lint` tests + `tooling-map` test now run in CI by construction) and keeps the real-plan acceptance step; new `flowmap:verify:full` chains the five formerly-CI-only gates (roadmap:audit, cert, plan-check, acceptance, handoff:check) after `flowmap:verify` for local parity; `gate-parity.test.mjs` — inside the suite — fails if a CI-only enumeration reappears or verify:full loses a gate; **2 tests red pre-fix**, 5/5 post | `node --test tools/flowmap/gate-parity.test.mjs` → 5/5 · `npm run flowmap:verify:full` → DONE banner · plan: `docs/flowmap/plans/aud5-f06.plan.json` |

| **F-07** | `spec-gate.yml` triggers carry NO path filter any more — the old `paths:` list excluded `.claude/**` (the hooks), `public/plan.json` (the exact file cert/plan-check/acceptance target), `.quiz-answers.json` and root configs, so commits touching only those never ran the gate; every push/PR now gates, and a gate-parity test fails if a filter reappears; **1 test red pre-fix**, 6/6 post | `node --test tools/flowmap/gate-parity.test.mjs` → 6/6 · `grep -c 'paths:' .github/workflows/spec-gate.yml` → 0 · plan: `docs/flowmap/plans/aud5-f07.plan.json` |

| **F-08** | the tooling-map chain's promised deny paths are exercised for the first time (AUD3 T5 was ALLOW-only): an UNMAPPED load-bearing module → exit 1, a DANGLING `%% src` → exit 1, an unresolvable `#symbol` → exit 1 — three CLI fixtures in `tooling-map.test.mjs` asserting the exact problem class in stdout; the CI half of the finding was closed by F-06 (spec:test:all contains the tooling-map suite, so the whole chain now runs in CI by construction) | `node --test tools/flowmap/tooling-map.test.mjs` → 8/8 · `grep -c 'spec:test:all' .github/workflows/spec-gate.yml` → ≥1 · plan: `docs/flowmap/plans/aud5-f08.plan.json` |

| **F-09** | handoff staleness surfaces at session START, not only at clean Stop (attack A8: a crashed session never fires the Stop-hook nudge): `onboard` STEP 7 runs `handoff-fresh --check` and prints ✓ HANDOFF FRESH or ⚠ HANDOFF LAGS THE CODE + treat-as-suspect instructions — a nudge, not a gate (onboard's exit stays about map trust; F4 CI is the backstop); `onboard.test.mjs` (new, in the suite) is onboard's first test — **1 assertion red pre-fix** | `node --test tools/flowmap/onboard.test.mjs` → 2/2 · `npm run flowmap:onboard` → STEP 7 shows the live verdict · plan: `docs/flowmap/plans/aud5-f09.plan.json` |

| **F-10** | the mutation-blind gate CLIs get their first spawn tests (AUD3 T4: `gate.mjs` was spawned by zero tests; plan-check / plan-cert / flowmap-lint were fn-only): `cli-wiring.test.mjs` spawns each real CLI — gate in-sync → 0 / drift → 1 / no args → 2; plan-check incoherent → 1 / unreadable → 2 / real plan → 0; plan-cert usage errors → 2 (good path already spawned by loop-e2e); flowmap-lint flat-mirror → 1 / no path → 2 / real bundle → 0. `handoff-fresh` was covered by F-02 | `node --test tools/flowmap/cli-wiring.test.mjs` → 6/6 · plan: `docs/flowmap/plans/aud5-f10.plan.json` |

| **F-11** | the A1 completeness pair and the grammar gate get their first deny fixtures (AUD3 T6: their exit-1 claims were proven only by running on good data): `coverage.mjs` uncovered file → 1 / covered → 0; `exports-coverage.mjs` hidden export → 1 / allowlisted → 0 (real ts-morph fixture project); `validate.mjs` edge-to-undefined-node → 1 / valid → 0 / no arg → 2 — all via the real spawned CLIs in `completeness.test.mjs` (in the suite) | `node --test tools/flowmap/completeness.test.mjs` → 3/3 · plan: `docs/flowmap/plans/aud5-f11.plan.json` |

| **F-12** | the approval-artifact emitter gets its rejection paths (AUD3 T7 was ALLOW-only): missing args → 2, unreadable plan → 2, all-changes-rejected → exit 0 with an EXPLICITLY empty artifact (plan.json 0 changes, clean checklist); plus a real behavior fix — `--accepted-only` on a plan with NO `verdicts` map used to silently export EVERY change (the opposite of the flag's promise) and now REFUSES with exit 2, emitting nothing; **1 test red pre-fix**, 7/7 post | `node --test tools/flowmap/approve-export.test.mjs` → 7/7 · plan: `docs/flowmap/plans/aud5-f12.plan.json` |

| **F-13** | the loop is proven to STOP, not just run (AUD3 T8: `loop-e2e` was a pure happy-path spine): a second chain feeds an incoherent fixture plan (dangling dep + modify of a nonexistent node) through the same stage order an orchestrating agent uses — plan-check blocks with exit 1, nothing downstream executes, no approval artifact is emitted | `node --test tools/flowmap/loop-e2e.test.mjs` → 2/2 · plan: `docs/flowmap/plans/aud5-f13.plan.json` |

| **F-14** | `orchestrate`’s only blocking check was data-dependent on the live `public/plan.json` (if that plan ever became fully built, the exit-1 path would go unexercised): a fixture plan adding a node whose symbol can never exist now proves exit 1 UNCONDITIONALLY — dispatched in wave 0, verdict FAIL, summary.fail 1, exit 1 | `node --test tools/flowmap/orchestrate.test.mjs` → 7/7 · plan: `docs/flowmap/plans/aud5-f14.plan.json` |

| **F-15** | A3 "parsers **provably** agree" can no longer vacuously pass: in CI (`CI=true`, set by GitHub Actions) an unavailable app-parser subprocess FAILS `parser-conformance.test.mjs` instead of silently `test.skip`ing the whole cross-parser half; locally the lenient skip stays (older Node). Testable via the `FLOWMAP_FORCE_APP_UNAVAILABLE` seam; `conformance-strict.test.mjs` (in the suite) locks both modes | `node --test tools/buildspec/conformance-strict.test.mjs` → 2/2 · `npm run spec:conformance` → 23/23, 0 skipped · plan: `docs/flowmap/plans/aud5-f15.plan.json` |
| (live flakes ×2) | **suite made race-free after F-06/F-09 wired heavy spawns into it.** (a) `onboard.test` reruns `flowmap:verify`, which rewrote `_bundle.mmd` via shell redirect — a parallel `edge-verify.test` could read the torn file (`import-backed edges too few: 0`, PR #16): `flowmap:bundle` + `flowmap:tooling:bundle` now write `.tmp` then `mv` (atomic). (b) onboard STEP 6 executed roadmap `cmd` predicates, spawning gate tools — incl. `orchestrate` with real git worktrees — concurrently with the suite (its worktree tripped `orchestrate.test`'s cleanup assertion): `onboard.test` now spawns with `FLOWMAP_ROADMAP_SKIP_CMD=1` (cmds only downgrade, per roadmap.mjs; every other step runs real). Suite wall 36s → 18s | `grep -c "mv docs/flowmap/_bundle.mmd.tmp" package.json` → 1 · `npm run flowmap:bundle && git status --short docs/flowmap/` → clean · `grep -n FLOWMAP_ROADMAP_SKIP_CMD tools/flowmap/onboard.test.mjs` → env set |

| **F-16** | the three orphaned diff tests run again (AUD3 T9: wired into neither suite nor CI — and two of them CANNOT run under plain `node --test`, their TS imports need the documented runner): `diff.test.mjs` joined the `node --test` list; `diff-views.test.mjs` + `diff-roundtrip.test.mjs` run via `run-bundled-test.mjs` at the end of `spec:test:all`; a gate-parity test keeps all three wired | `npm run spec:test:all` → 228 + 6 + 2, 0 fail · `node --test tools/flowmap/gate-parity.test.mjs` → 7/7 · plan: `docs/flowmap/plans/aud5-f16.plan.json` |

| **F-17** | the two session-protocol entry gates get their deny/verdict tests (AUD3 T10): `onboard` is proven to REFUSE — a doctored isolated worktree (one fragment deleted, node_modules symlinked) exits 1 with "STOP — the map is NOT trustworthy" AND names the exact uncovered file (right-reason pinned); `status` verdict classes locked on fixture plans against the real code — unimplemented add → `pending`, structure-only modify of a real node → `built`, wrong proposed signature → `drifted`, all-built → exit 0, no plan → exit 2 | `node --test tools/flowmap/onboard.test.mjs` → 3/3 · `node --test tools/flowmap/status.test.mjs` → 2/2 · plan: `docs/flowmap/plans/aud5-f17.plan.json` |

| **F-18** | `waves` exit-0-on-cycle is now DOCUMENTED as design (a caller reading only the exit code was silently proceeding on cyclic plans) and gated on demand: new `--strict` exits 1 when the plan has ≥ 1 dependency cycle (matching the `verify-change --strict` precedent), the report still carries the cyclic ids, cycle-free strict runs stay 0, and the human CYCLE line says how to make it blocking; **1 test red pre-fix**, 7/7 post | `node --test tools/flowmap/waves.test.mjs` → 7/7 · plan: `docs/flowmap/plans/aud5-f18.plan.json` |

| **mutate harness** (post-register, from the AUD3 MH findings) | `flowmap:mutate` re-runs the AUD3 mutation experiment mechanically instead of by-hand-in-the-main-tree: corpus `tools/flowmap/mutations.json` seeded with M1/M2a/M2b/M3, each applied in an ISOLATED git worktree at HEAD (node_modules symlinked), two tiers (fast = the entry's own test file · full = whole `spec:test:all`), find-anchor must match HEAD exactly once or the harness REFUSES (stale corpus, exit 2). Expectations set to measured reality: **all 4 caught on both tiers** — the AUD5 fixes (F-01/F-02/F-04) demonstrably kill the AUD3 survivors. An expected-caught that survives = a deny test silently died → exit 1. Harness itself deny-proven by meta-tests (green / broken-expectation / refusal via the real CLI) | `npm run flowmap:mutate` → 4/4 HARNESS GREEN · `npm run flowmap:mutate:full` → 4/4 (≈2 min) · `node --test tools/flowmap/mutate.test.mjs` → 5/5 · plan: `docs/flowmap/plans/mutate-harness.plan.json` |

**All five register keystones are fixed** (F-19 + F-01…F-04), and the gap wave has begun (F-05,
F-06, F-07, F-08, F-09, F-10, F-11, F-12, F-13, F-14, F-15 landed — the gap wave is CLOSED).
With F-18, **the AUD5 register is CLOSED**: every agent-fixable finding (F-01…F-18) is fixed test-first and merged through required-check-green PRs; F-19 was fixed by Chris (branch protection). The `flowmap:mutate` harness (per the audit's mutation findings) is BUILT and green — see its ledger row above.

## 0·prev·aud4 (2026-07-02, this session, continued) — AUD4 LANDED: findings register, A7 RESOLVED (5 of 6 audit phases)

Same session as AUD3 below (phase-per-session rule waived by Chris's explicit "Continue with AUD4").
Output: `docs/flowmap/audit/04-findings.md` — 19 findings consolidating A1–A8 + T1–T10/M1–M3, each
with repro, proposed fix, and cost. **A7 is resolved by human attestation: Chris confirmed `main`
has NO branch protection** — recorded verbatim in F-19, now the register's most severe confirmed
finding (until fixed, every "CI blocks" mechanism runs but does not gate). No fixes (work-order
rule). Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| AUD4 predicates met | `npm run flowmap:audit` | AUD0–AUD1 ✓ · AUD2 [PARTIAL] (manual sign-off, by design) · AUD3 ✓ · **AUD4 [BUILT] (2/2)** · AUD5 unverified (fixes not started) |
| Register is complete, not sampled | `grep -c '^| F-' docs/flowmap/audit/04-findings.md` · `sed -n '/Coverage map/,/AUD5 ordering/p' docs/flowmap/audit/04-findings.md` | 19 rows · every A1–A8 / T1–T10 / M source id maps to a finding (A2 = HELD, no finding) |
| A7 resolution recorded verbatim | `grep -n 'no branch protection' docs/flowmap/audit/04-findings.md` | F-19 row + header note, attested by Chris 2026-07-02 |
| Register passes the status-marker ban | `node tools/flowmap/roadmap.mjs --audit-doc docs/flowmap/audit/04-findings.md` | ✓ no hand-written status |
| Map untouched by the audit | `npm run flowmap:ship` → `git diff --stat docs/flowmap/_bundle.mmd` | DONE line · empty |
| Suite still green | `npm run spec:test:all` | 166/166 |

**Severity roll-up:** 5 keystone-bypass (F-01 contract-gate "100% gate", F-02 F4 freshness, F-03
quiz/Keystone-1, F-04 roadmap predicates + untested roadmap.mjs, **F-19 no branch protection**) ·
11 gap · 3 hygiene. Full table + AUD5 ordering: `docs/flowmap/audit/04-findings.md`.

**Next (Scenario 1 — AUD5, fixes via the standard loop):**
1. **F-19 is Chris's, one setting:** protect `main`, require `buildspec-tests` + `flowmap-drift` as
   required status checks. Post-fix verify: `gh api repos/novakai-one/novakai/branches/main/protection`.
2. Then one plan per finding under `docs/flowmap/plans/` in the register's recommended order
   (F-04 first of the agent-fixable keystones — it repairs the instrument the other fixes are
   measured with). Each fix ships with a test failing pre-fix. As plans land, convert AUD5's
   `manual` check in `docs/flowmap/audit/audit-roadmap.json` to `cmd` checks.

## 0·prev·aud3 (2026-07-02, this session) — AUD3 LANDED: deny-path matrix + mutation spot-check (4 of 6 audit phases)

Executed AUD3 per `docs/flowmap/audit/WORK_ORDER.md` (onboard ✓, quiz 12/12 seed 1 ✓, plan approved
by Chris). Output: `docs/flowmap/audit/03-tests.md` — every GATE script classified
DENY-covered / ALLOW-only / NO-TEST with cited assertions, plus the 3-mutation spot-check. No fixes
(work-order rule). Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| AUD3 predicates met | `npm run flowmap:audit` | AUD0 ✓ · AUD1 ✓ · AUD2 [PARTIAL] (manual sign-off, by design) · **AUD3 [BUILT] (2/2)** |
| Matrix covers every gate + findings carry repros | `grep -c '^| ' docs/flowmap/audit/03-tests.md` · `grep -c 'repro' docs/flowmap/audit/03-tests.md` | 42 table rows · 8 repro blocks |
| Mutation verdicts recorded | `grep -c 'SURVIVED' docs/flowmap/audit/03-tests.md` | 6 (M1 + M3 survived, each cited 3×) |
| Mutations were reverted (nothing mutated survives in the tree) | `npm run spec:test:all` · `git diff --stat tools/` | 166/166 · empty |
| Map untouched by the audit | `npm run flowmap:ship` → `git diff --stat docs/flowmap/_bundle.mmd` | DONE line · empty |
| New doc passes the status-marker ban | `node tools/flowmap/roadmap.mjs --audit-doc docs/flowmap/audit/03-tests.md` | ✓ no hand-written status |

**Headline AUD3 results (details + repros in `03-tests.md`):**
- **M1 SURVIVED:** the F4 staleness deny (`handoff-fresh.mjs --check`) can be disabled with the
  whole suite staying 166/166 — no test exercises `--check`; the claimed deny coverage is the H5
  content-claims sub-check only.
- **M3 SURVIVED:** `roadmap.mjs` — the status computer, the `flowmap:roadmap:audit` CI gate, and
  this audit's own predicate runner — has NO test; with `file` predicates hard-wired true, a
  nonexistent doc reads BUILT and nothing notices.
- **M2b CAUGHT:** fully fail-open contract-gate is caught by `DENY: sentinel with an unresolvable
  contract id (exit 2)` — the one deny the gate has is genuinely locked. (M2a variant: the primary
  deny branch alone is masked by the downstream unparseable-output deny — redundant deny paths.)
- **T3 (fix-shaping):** `contract-gate.test.mjs` asserts fail-open (malformed/missing input → exit 0)
  as *required* behavior — an AUD5 fix that tightens the gate must change those tests too.
- Orphaned tests run nowhere: `diff.test.mjs`, `diff-views.test.mjs`, `diff-roundtrip.test.mjs`
  (in neither `spec:test:all` nor CI).

**Observed working-tree note (not this session's doing, left untouched):** `.quiz-answers.json` is
deleted in the working tree but still tracked at HEAD (`git status --short` → ` D .quiz-answers.json`).
Likely Chris's response to the A4 finding. Whoever commits next: decide deliberately (it is NOT
staged by this session's scoped commits).

**Next (Scenario 1):** AUD4 findings register (`04-findings.md`) — consolidate A1–A8 + T1–T10 into
`id | severity | claim broken | repro | proposed fix | fix cost`. **Resolve A7 branch protection
first** (`gh api repos/novakai-one/novakai/branches/main/protection`, or Chris reads Settings →
Branches): it decides whether the CI-gate family is GATE or CONVENTION. Then AUD5 fixes, one
finding per plan, each with a test failing pre-fix. No fixes until AUD4 is complete.

## 0·prev·aud (2026-07-02, earlier session) — TOOLING AUDIT AUD0→AUD1→AUD2 LANDED (M1 spine, 3 of 6 phases)

Executed the first three tooling-audit phases per `docs/flowmap/audit/WORK_ORDER.md`. Outputs are
the three predicate-checked docs; the audit found real gate weaknesses (recorded, NOT fixed — fixes
are AUD5). Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| AUD0/AUD1 BUILT, AUD2 predicates met | `npm run flowmap:audit` | AUD0 (2/2) · AUD1 (2/2) · AUD2 [PARTIAL] (2/2 auto; PARTIAL = the manual "coverage complete" sign-off, by design) |
| Inventory: every claim has a stable CLM id | `grep -c 'CLM-' docs/flowmap/audit/00-inventory.md` | 60+ (claim rows across CLAUDE.md, tool headers, echo strings) |
| Every claim classified once | `for n in $(grep -oE 'CLM-[0-9]+' docs/flowmap/audit/00-inventory.md \| sort -u); do echo "$n $(grep -c "\| $n " docs/flowmap/audit/01-claims.md)"; done` | every id → 1 |
| Attacks carry repros | `grep -c 'repro:' docs/flowmap/audit/02-attacks.md` | 9 |
| Map still in sync (audit touched no code) | `npm run flowmap:ship` | DONE line; `git diff --stat docs/flowmap/_bundle.mmd` empty |

**Confirmed-BROKEN gates (repro in `02-attacks.md`), for AUD4/AUD5:**
- **contract-gate fail-open (A1):** sentinel typo `FLOWMAP_CONTRACT`, malformed/empty/absent stdin
  all exit 0. Only the exact-cased `FLOWMAP-CONTRACT:` + unresolvable-id path DENIES (exit 2). repro:
  `printf '{"tool_name":"Agent","tool_input":{"prompt":"FLOWMAP_CONTRACT: x"}}' | node tools/flowmap/contract-gate.mjs; echo $?` → 0.
- **handoff freshness F4 (A3):** dirty-handoff early-exit, same-commit tie, and `%ct`-timestamp
  (not content) each pass a stale handoff. repro in `02-attacks.md` (detached worktree).
- **quiz unenforced (A4):** `grep -rnE quiz .github/ .claude/` → empty; nothing runs it. Committed
  `.quiz-answers.json` is tracked + stale (33% at seed 1).
- **hollow-file roadmap predicates (A5):** a 0-byte file satisfies a `file` check; `roadmap.mjs`
  exits 0 for all statuses — including this audit's own predicates.

**Highest open item (UNDETERMINED, resolve first):** A7 branch protection — `gh` was absent in this
env. repro: `gh api repos/:owner/:repo/branches/main/protection`. If `spec-gate` is not a *required*
check on `main`, the whole CI-gate family is advisory.

**Two recon corrections proven here:** `contract-gate.test.mjs` IS in CI (`spec-gate.yml:61`);
`.quiz-answers.json` is TRACKED (not git-ignored).

**Next (Scenario 1):** AUD3 (test-suite deny-path audit + mutation spot-check) →
`node tools/flowmap/roadmap.mjs --roadmap docs/flowmap/audit/audit-roadmap.json`. Then AUD4 findings
register, AUD5 fixes via the plan/contract loop. No fixes until AUD0–AUD4 complete (work-order rule).

## 0·prev·now (2026-07-02, this session) — UX-repair STAGE 4 LANDED: groups are first-class selectables (U6)

Stage 4 of `docs/flowmap/plans/unfold-ux-repair.md` executed per protocol (onboard ✓, quiz 12/12 ✓,
plan approved by Chris, Chrome-MCP browser-verified). Commit `53c32a6` (code+map) + this log. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Two new gated keystones exist at the planned symbols | `grep -n "function selectGroup\|function groupConns" src/panel/unfold.ts` | both present (named closures) |
| Both are in the shipped map with gated signatures | `grep -c "%% src unfold__uf\(SelectGroup\|GroupConns\) " docs/flowmap/_bundle.mmd` | 2 |
| Map true + complete + in sync | `npm run flowmap:ship` | DONE line, 0 unaccounted (325 edges) |
| Suite green · typecheck clean | `npm run spec:test:all` · `npm run typecheck` | 166/166 · exit 0 |
| Selection ≠ expansion for groups | `npm run dev` → Read → click a region header (e.g. "Rendering & viewport") | selects (ring + GROUP inspector: derived role, contains(n), aggregated uses→/←used-by with weights); chevron folds without selecting; collapsed group card selects; ⤢/dblclick expands |
| Aggregation grammar = stage pills | select a nested group; read "uses →" | sibling groups stay themselves; foreign subtrees compress to their top group (`proxyTargetOf` reuse) |
| Blast honours the group | blast layer ON → select a group | ripple seeds from the whole subtree; members stay lit; no full-canvas dim |
| Regressions held | module card click still stages; wire click still selects; ← explore / Esc chain / layer-toggle stage refresh unchanged | per stages 1–3 |
| Stage log is the fine-grained record | `sed -n '/stage 4 · 53c32a6/p' docs/flowmap/plans/unfold-ux-repair.md` | one line: verified behaviors + notes |

**Honest boundaries (do not oversell):**
- Group selection deliberately does NOT promote to stage — that is U8 (**stage 5, design-first, still open**). `select()` was refactored to `selectGroup()` + the unchanged stage-entry tail; module-card staging is byte-equivalent behavior.
- The two keystones are closure functions gated at `file#symbol`, structure-only (ctx/DOM-bound; E2/H1 factor-to-pure applies if contracts are wanted). `groupConns` is *near*-pure over closure state — a factor-to-pure candidate.
- Expanded-module-header selection shares the exact code path verified live on hier groups, but was not clicked live (the loaded 41-module map has no drilled module children).
- dblclick-on-header fires select→deselect before folding — the pre-existing cardEl click/dblclick pattern, kept for consistency.
- Stage-mode wire-click noop (stage-3 gap) remains open.

**Next (Scenario 1):** UX-repair **stage 5 (U8)** — selection promotes to main stage: produce an interaction
design proposal for Chris BEFORE any code (his register entry flags possible over-optimisation). Also open:
`read-review-overlay` (POSTPONED by verdict), the unfold-as-primary flip (P1, unblocked, Chris's call),
stage-mode wire-click noop.

## 0a. HUMAN DESIGN VERDICTS + NEW PRIORITIES (2026-07-02 pm, from Chris) — read before building anything

> **UPDATE (2026-07-02 later): second design review after Claude Code session. New staged UX-repair
> plan supersedes P2–P4 ordering below — see `docs/flowmap/plans/unfold-ux-repair.md` (8 issues,
> 6 stages, executed stage-per-session via chat). grouping-directive verdict unchanged.**

Chris reviewed the two design-review-first changes and the running app. Verdicts:

1. **`grouping-directive`: APPROVED — build it.** Chris judges dialect risk low; the directive should
   also be used to fix the existing self-map, which currently shows little/no grouping. Syntax shape
   (`%% group` form, nesting or flat) is implementer's proposal — present the chosen syntax in the
   commit/handoff, don't block on another review round.
2. **`read-review-overlay`: POSTPONED.** Do not build until the unfold reading surface is further
   along (items below). Leave it pending in the plan.

New priority order — these come BEFORE `grouping-directive` except where noted:

| # | Task | Notes |
|---|---|---|
| P1 | **Unfold is the primary interface, not an overlay.** | Direction is committed NOW; the actual promotion (app opens into unfold; dense editor becomes the secondary surface) executes once P2–P4 land. Record the direction wherever the committed-direction note lives (plan `note`, this file). |
| P2 | **Wires are not useful.** Two parts: (a) libavoid/avoidRouter is not being used meaningfully in reading mode — routing quality is poor; (b) wires carry no information value at current density (screenshot: full-calls layer = spaghetti, tells no story). Fix routing AND rethink what the calls layer shows at high fold levels. | High effort. Visual iteration required — verify in a real browser, not just tests. |
| P3 | **Stage-focus + wire-travel regression.** Prototype `prototypes/unfold-v3-stage.html` shows: main-stage focus with connections to other nodes rendered as travel-able wires/proxy pills (peek → travel). Chris reports this is MISSING in the app despite handoff below claiming `stageMode`/`stageProxies`/`stageTravel` landed (bbb59e8). First step: verify at runtime against the prototype side-by-side; determine regression vs never-integrated-behaviourally vs overstated claim; then restore to prototype parity. | Do not trust the claims table below for these three symbols until runtime-verified. |
| P4 | **Bug: stage-mode ✕ (close) is a noop.** Focused/stage window does not close on ✕. Small fix. | Do first — cheap. |

After P1–P4: build `grouping-directive`, then revisit `read-review-overlay` design.

## 0a·outcome (2026-07-02, this session) — P4 + P3 + P2 LANDED · `grouping-directive` BUILT

All four items from 0a executed in the ordered priority (P4 → P3 → P2 → grouping-directive),
each runtime-verified in a real browser during the session. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **P4 — ✕ ladders.** In stage mode ✕ closes the STAGE window (back to explore); a second ✕ exits to the editor | `npm run dev` → Read → click any module card → ✕ → ✕ | stage → explore → editor (Esc unchanged) |
| **P3 — verdict: never-integrated-behaviourally.** `stageMode/stageProxies/stageTravel` existed and were wired, but proxy aggregation assumed leaf-level cross-module edges (the prototype's data). This model's cross-module edges attach at MODULE ids, which `stageRepOf` can never map to a staged child — so pills/travel NEVER appeared. Fixed: frame-attribution (edges incident to the stage or its ancestors), group-level aggregation, pill de-overlap, childless-travel guard, module-card click stages | `npm run dev` → Read → click a module (e.g. camera inside its group) | group center-stage, directional pills around it, peek → travel arrives from the right direction, reciprocal pill back |
| P3 aggregation is group-aware | stage `camera` (unfold Editor / Canvas / Rendering & viewport first) | pills read "config, state — Domain model", "pointer, keyboard — Direct manipulation" … one pill per foreign GROUP |
| **P2(a) — reading-mode wires are libavoid-routed.** New `routeGraph(rects, edges)` seam in `render/avoidRouter` (same worker + wasm + fallback, promise-based, no ctx cache); unfold routes aggregated wires around card + group-header boxes; elbows paint first, routed polylines upgrade in place | `grep -n "export function routeGraph" src/render/avoidRouter.ts` · `grep -n "function requestRoutes" src/panel/unfold.ts` | both present; run Read with calls on — wires flow through corridors, zero card crossings |
| **P2(b) — the calls layer tells a story at high fold.** Weight ramp (heavy flows pop, light noise recedes), hub fan-outs (out-degree > 8, e.g. the composition root) fade, and **calls is ON by default for a fresh view** (approved decision #1 restored — it had regressed to all-off) | `npm run dev` → Read (fresh view, or clear `unfold.view` in localStorage) | wires visible on arrival; main.ts trunk subdued; select → its flows light |
| **grouping-directive — the syntax (implementer's choice, per verdict):** `%% group <gid> "<label>" [parent <gid2>]` declares a group (nestable); `%% group-member <gid> <nodeId>` assigns one top-level node per line. Line-per-fact like `%% kind`/`%% parent`; groups are hierarchy METADATA — no geometry, invisible to the canvas | `grep -c "^%% group " docs/flowmap/_bundle.mmd` · `grep -c "^%% group-member " docs/flowmap/_bundle.mmd` | 14 · 41 (every one of the 41 modules grouped) |
| Both parsers agree on the dialect (A3) incl. pruning rules, and the overlay survives round-trip | `npm run spec:conformance` | 23/23 (new corpus: declarations, nesting, dangling-parent + undeclared-group pruning) |
| Keystone exists at the planned symbol | `grep -n "export function parseGroupDirective" src/io/mermaid.ts` | present (called by `fromMermaid`; serialized back by `toMermaid`, sorted) |
| The self-map is GROUPED (the 0a ask "fix the existing self-map") | `npm run dev` → load `_bundle.mmd` text → Apply → Read | arrival = **5 region cards** (Editor · Domain model · Review & planning · Persistence & IO · Orchestration), not 41 flat modules |
| Plan reads BUILT after the documented add→modify flip (4th lifecycle occurrence) | `npm run flowmap:status -- --plan docs/flowmap/plans/unfold-integration.plan.json` | **7 built · 1 pending** (pending = `read-review-overlay`, POSTPONED by verdict) |
| Map true + complete + in sync | `npm run flowmap:ship` | DONE line (498 nodes · 319 edges, 0 unaccounted) |
| Whole suite green · typecheck clean | `npm run spec:test:all` · `npm run typecheck` | 166/166 · exit 0 |

**Where the dialect landed:** parse `src/io/mermaid.ts#parseGroupDirective` (+ `fromMermaid`), serialize `toMermaid`;
state `state.hier` (`core/state` + `Hier`/`HierGroup` in `core/types`); persisted in autosave + history snapshots;
pipeline parser `tools/buildspec/mmd-parse.mjs` (parse + `toMmd` emit); bundler pass-through `tools/flowmap/bundle.mjs`;
validation `tools/flowmap/validate.mjs` (undeclared group / missing member / id-collision = ERROR); authored grouping in
`docs/flowmap/root.mmd` (promoted verbatim from `sandbox/unfold/hierarchy.json`, which is now **deleted** per the approved intent).

**P1 note (direction, recorded here per 0a):** P2–P4 have landed, so the unfold-as-primary-interface promotion is now
UNBLOCKED. The actual flip (app opens into reading mode; dense editor secondary) is deliberately NOT executed —
it is a surface-order decision for Chris's next review.

**Honest boundaries (do not oversell):**
- The stage/wire keystones remain closure functions gated at `file#symbol`, structure-only (ctx/DOM-bound; E2/H1 factor-to-pure applies if contracts are wanted). `parseGroupDirective` IS pure and exported — a behavioural contract is now authorable for it, but none was authored this session.
- Proxy selection-filter deviation from the prototype: frame-attributed links (module-level edges) persist when a card is selected; only child-attributed links are filtered. Without this, staging via leaf-select would show zero pills again — the deviation is what makes the feature exist at this model's edge granularity.
- Pill de-overlap preserves the true angular ORDER of group centroids but relaxes magnitudes (the editor's near-1-D layout would stack every pill otherwise).
- The hub-fade threshold (out-degree > 8) and weight-ramp exponent (.6) are tuned by eye in this repo, not derived.
- `sandbox/unfold/` (historical, per the stale-doc rule) fetched `hierarchy.json` at runtime; its demo now 404s that fetch. The live app is unaffected.
- `unfold.view` persistence is keyed by containment roots; the grouping changed those, so stored reading views reset once (fresh default = calls on, folded to regions).
- An editor autosave predating the dialect carries `hier: {}` until the bundle text is re-applied (autosave loads hier only once saved with it).

## 0b. This session (2026-07-02, earlier) — 6 of 8 integration wirings LANDED; the 2 design-review-first changes deliberately remain

The unfold-integration plan's buildable set is implemented: `read-sel-sync`, `read-persist-view`,
`read-edit-title`, `read-edit-frontmatter`, `read-trust-layer`, `read-shared-wires` — code + map,
gate-green, independently confirmed by a 0-context agent from command output alone. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| 6 wirings landed, 2 held for review | `npm run flowmap:status -- --plan docs/flowmap/plans/unfold-integration.plan.json` | **6 built · 2 pending** (pending = `read-review-overlay`, `grouping-directive`) |
| Plan coherent after the documented add→modify lifecycle flip | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/unfold-integration.plan.json` | coherent (8 changes, 3 deps) |
| Every keystone symbol exists in code | `grep -c "function \(selectSync\|persistView\|trustLayer\|wirePath\|renameInPlace\|mountFrontmatter\)" src/panel/unfold.ts` | 6 |
| Every keystone is in the shipped map with a gated signature | `grep -c "%% src unfold__uf\(SelectSync\|PersistView\|TrustLayer\|WirePath\|RenameInPlace\|MountFrontmatter\) " docs/flowmap/_bundle.mmd` | 6 |
| Map true + complete + in sync + edges accounted | `npm run flowmap:ship` | DONE line (490 nodes · 311 edges, 0 unaccounted) |
| Whole suite green · typecheck clean | `npm run spec:test:all` · `npm run typecheck` | 158/158 · exit 0 |
| Run it | `npm run dev` → select a node in the editor → **Read** | the selection arrives selected in reading mode; Esc/✕ hands it back centred; Enter renames in place (mermaid text updates); inspector **edit** mounts the frontmatter editor; **trust** layer auto-enables on the dev server and dashes the 4 advisory edges amber |

**Where each approved decision landed (all in `src/panel/unfold.ts`; `main.ts` gained only the deps wiring):**
- `selectSync('open'|'close')`: open seeds SEL from `ctx.state.sel` (+ revealNode); close hands back via
  `deps.selection.selectOnly` + `deps.camera.zoomToNode`. `initUnfold(ctx, deps)` now follows the
  navigator deps pattern (`{ selection: SelectionApi; camera: CameraApi }`).
- `persistView('save'|'load')`: localStorage `unfold.view`, keyed by sorted containment roots; saved at
  the end of every `render()` (a reload mid-session loses nothing); no stored entry ⇒ fully folded, all
  layers off.
- `trustLayer()`: optional advisory source — same-origin `edge-advisory-allowlist.txt` (content-type
  guarded) or a per-layer **load…** button; `ALLOW` drives dashed amber wires + `advisory` chips on
  inspector connections; absent source = the layer row stays disabled, never wrong.
- `wirePath(a, b)`: reading-mode wires now use `portPos`/`bestSides` (core/state) + the `orthoPath`
  elbow (render/wires); the local orthoPath was deleted — one geometry, not two.
- `renameInPlace(id)`: Enter / double-click on the selected card → contenteditable name; commits write
  `fm.name` when present else `label`, then hooks render + sync + pushHistory + persist. Never a
  private write path. Escape cancels without touching the model.
- `mountFrontmatter(host, id)`: the inspector's **edit** button mounts
  `panel/inspector-frontmatter`'s `renderFrontmatterSection` (the same runtime-import precedent
  `panel/inspector.ts` set); committed edits re-derive the folded view from ctx.state.

**Runtime-verified in a real browser this session** (dev server + Chrome, re-runnable via the Run-it
row): selection round-trip both directions, rename → `camera["cameraRenamed"]` in the mermaid text,
frontmatter desc → serialized + re-derived onto the card, full-reload view persistence (expanded set +
3 layers), exactly 4 advisory edges dashed, Enter-in-search and Escape-mid-rename guards hold, 0
console errors.

**Honest boundaries (do not oversell):**
- The 6 keystones are closure functions gated at `file#symbol` — structure + signature, **no
  behavioural contracts** (all ctx/DOM-bound; the E2/H1 factor-to-pure rule applies if contracts are wanted).
- Built by the main session agent, not per-change subagents: all six changes converge on the same
  closure in `unfold.ts`, so per-change worktrees would collide (the H4 boundary). Verification was
  still independent: a 0-context agent confirmed delivery from the 8 commands above, output-only.
- On the very first open after a reload, the trust layer's restore races the allowlist fetch — if the
  fetch has not landed yet the layer arrives off (never wrong, just off until toggled).
- **Lifecycle gap recurred (3rd occurrence):** landed adds hand-flipped add→modify to keep plan-check
  coherent — same as `frame-transform` and the stage plan. The built-add→done transition remains a
  candidate roadmap item.

**Next (Scenario 1):** the remaining 2 changes are flagged **design-review-first in their intents —
do not build without human review**: `read-review-overlay` (plan/diff review as a reading-mode layer)
and `grouping-directive` (promote `hierarchy.json` to a first-class `%% group` dialect directive;
touches the gated dialect, A3 conformance follows).

## 0a·prev00. Earlier (2026-07-02) — the STAGE plan is IMPLEMENTED: all 7 changes landed in `src/panel/unfold.ts`

The approved v3 "stage" design was integrated into the app's reading mode. All 7 plan changes are
code + map, gate-green. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| All 7 stage changes landed | `npm run flowmap:status -- --plan docs/flowmap/plans/unfold-v3-stage.plan.json` | **7 built · 0 pending** |
| Plan coherent after the documented add→modify lifecycle flip | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/unfold-v3-stage.plan.json` | coherent (7 changes, 4 deps) |
| Every keystone symbol exists in code | `grep -nE "function (enterStagger|focusDim|reframeToFit|stageMode|stageProxies|stageTravel|typeFocus)" src/panel/unfold.ts` | 7 matches |
| Map true + complete + in sync with the new symbols | `npm run flowmap:ship` | DONE line (483 nodes · 300 edges, 0 unaccounted) |
| New nodes in the map with gated signatures | `grep -c "unfold__uf\(EnterStagger\|FocusDim\|Reframe\|StageMode\|Proxies\|Travel\|TypeFocus\)" docs/flowmap/_bundle.mmd` | >0 (nodes + kind + src + fm:meta) |
| Whole suite green | `npm run spec:test:all` | 158/158 |
| Typecheck clean | `npm run typecheck` | exit 0 |
| Run it | `npm run dev` → **Read** → click any card | staggered entrances; select → focus illumination + stage projection; proxy pills; peek → travel; type click → carriers light |

**Where each approved decision landed (all in `src/panel/unfold.ts`, planner-isolation intact — no other app file touched):**
- Stagger + wire draw-in: `enterStagger` + `.uf-born/.uf-in/.uf-enter` CSS; wires delay via `wireEnterAt`.
- Focus illumination: `focusDim` (CSS-class pass, no rebuild); hot wires get `.uf-hot` flow animation in `drawWires`.
- Reframe: `reframeToFit` (~.9s expo, `anim2` class), replaces post-structural `fitView` after first fit.
- Stage projection: `stageMode` + `renderStageGroup`; `.staged` blurs/fades `.uf-world`; Esc/`← explore` exits, explore state untouched.
- Proxies: `stageProxies`; angle from `centroidOf()` over real `ctx.state` node positions (rootOf-aggregated).
- Peek→travel: `peekProxy` + `stageTravel`; arrival slides from `fromAngle + π`; reciprocity automatic via shared centroids.
- Type focus: `typeFocus` + clickable `.uf-t` tokens in `ifaceLine`; inspector lists carriers; derives from U (built from ctx.state), no parallel index.
- ViewSpec seam: view state remains the serializable closure set (expanded/hidden/SEL/layers + new STAGE/FOCUS_TYPE); no DOM-held state added.

**Honest boundaries (do not oversell):**
- The 7 keystones are closure functions gated at `file#symbol` (like `ufBuild`) — structure+signature gated, **no behavioural contracts authored** (all are ctx/DOM-bound; the E2/H1 factor-to-pure rule applies if contracts are wanted).
- Proxy pills do not reposition on window resize until the next interaction.
- A wire mid-`.uf-enter` animation is recreated without the class at the settle redraw when many cards stagger (visual only).
- **Lifecycle gap recurred (2nd occurrence):** landed adds had to be hand-flipped add→modify to keep plan-check coherent — same as `frame-transform`. The built-add→done transition remains a candidate roadmap item.

**Next (Scenario 1):** `npm run flowmap:status -- --plan docs/flowmap/plans/unfold-integration.plan.json` — 8 pending feature-parity wirings, orthogonal to stage; `read-review-overlay` and `grouping-directive` are flagged **design-review-first** in their intents (do not build without human review).

## 0a·prev0. Earlier (2026-07-02, chat) — the STAGE design is APPROVED; it is a plan + a runnable design contract

The human iterated three interface prototypes in a Claude chat and **approved v3 ("stage")** as the
first design that matched the vision. The approved artifact and the build plan are in the repo. The
integration itself was NOT started (deliberate — chat context exhausted; plan-first per doctrine).

| What | Verify it yourself | Expect |
|---|---|---|
| **Design contract** — the approved prototype, self-contained, open in any browser | `open prototypes/unfold-v3-stage.html` | explore mode (staggered fade-up unfold, wires always on, reframe-to-fit) → click any module → stage mode (group center-stage, world blurred behind, directional proxy pills, peek → travel) |
| **Build plan** — 7 falsifiable adds, all `unfold` module keystones | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/unfold-v3-stage.plan.json` | coherent (7 changes, 4 deps) |
| Resume point | `npm run flowmap:status -- --plan docs/flowmap/plans/unfold-v3-stage.plan.json` | 7 pending — phase 1 (stagger, focus-dim, reframe) is low-risk and unblocks phase 2 |
| Prior integration plan still valid underneath | `npm run flowmap:status -- --plan docs/flowmap/plans/unfold-integration.plan.json` | 8 pending (feature-parity wiring; orthogonal to stage) |

**Approved design decisions (intent — the DO-NOT-REGRESS list):**
1. **Wires are the default layer, never a toggle.** The wiring/plumbing IS the product's story.
2. **No instant DOM-swap reveals.** Staggered fade-up entrances (~55ms stagger, ~650ms expo ease);
   wires draw themselves in (stroke-dash) after cards land. Slow = premium; jumpy = rejected.
3. **Stage projection solves the legacy canvas-scale problem.** Canvas coordinates stay the single
   spatial truth; stage mode is a second *projection* of the same graph: focused group center-stage
   at readable size, external connections compressed into directional proxy pills. Proxy angle =
   true angle between group centroids (derive from ctx.state positions — the human's manual layout
   becomes the source of directions). Travel cost abolished; spatial meaning preserved. Pattern
   name: focus+context with off-screen proxies.
4. **Peek → travel.** Proxy click expands in place (names + desc); explicit travel swaps the target
   group onto stage, arriving FROM its direction; origin becomes a reciprocal-direction proxy.
5. **Focus illumination.** Select → card glows, 1-hop neighbours lit, its wires flow (animated
   dash), all else dims ~15-25%. Type click in frontmatter → every carrier module lights across the
   surface. These are the approved "magic" moments.
6. **ViewSpec doctrine.** Every interaction mutates one serializable spec object; screen =
   render(spec). Phase-2 LLM writes the same JSON — interface work now must keep this seam.
7. **Rejected designs (do not rebuild):** whole-canvas-always-visible; reveal-as-nested-toggle-list
   without spatial wires; anything requiring pixel travel to distant nodes.

**Stale-doc rule for the next agent:** `sandbox/` (incl. `sandbox/unfold/`) and `prototypes/*` other
than `unfold-v3-stage.html` are historical. Consult them for mechanism only, never for design
direction. Design direction = `prototypes/unfold-v3-stage.html` + the two plans above.

## 0a·prev1. Earlier session — the unfold direction is COMMITTED: legacy frozen, reading mode landed in the app

The human committed to the unfold direction as the app's UI direction. Three deliverables, each runnable:

| What | Verify it yourself | Expect |
|---|---|---|
| **Legacy preserved** — the pre-unfold editor frozen as a BUILT snapshot (immune to src/ changes) | `cat sandbox/legacy/README.md` · `git tag -l legacy-editor` · open `/sandbox/legacy/` on the dev server | README with source commit · tag exists · old editor boots |
| **Reading mode landed in `src/`** — `initUnfold` (planner isolation pattern): full-screen folded view of ctx.state, 7 opt-in layers, browse tree, inspector with ctx.bodies source | `grep -n "initUnfold" src/main.ts` · `npm run flowmap:gate` · open `/` → **Read** button | wired in composition root · in sync (unfold in `_bundle.mmd`) · 465-node map arrives as 40 folded cards |
| Map true+complete with the new module | `npm run flowmap:ship` · `npm run spec:test:all` | DONE line (475 nodes · 293 edges, 0 unaccounted) · 158/158 |
| **The migration is a plan, not prose** — remaining feature-wiring enumerated as falsifiable adds | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/unfold-integration.plan.json` · `npm run flowmap:status -- --plan docs/flowmap/plans/unfold-integration.plan.json` | coherent (8 changes) · **8 pending** — the build checklist for the next sessions |

**Where to resume (Scenario 1):** `npm run flowmap:status -- --plan docs/flowmap/plans/unfold-integration.plan.json`.
Phase 1 (`read-sel-sync`, `read-persist-view`) is low-risk and unblocks phase 2; `read-review-overlay`
and `grouping-directive` are flagged design-review-first in their intents. A change reads BUILT only
when its keystone symbol exists in code and the map — structure-only modifies were deliberately
avoided because they read BUILT while unbuilt (shape ≠ intent).

## 0a·prev. Earlier today — `sandbox/unfold` rebuilt as the opt-in *understanding surface* (outside `src/`)

The "folded organism" prototype (`sandbox/unfold/`) was rebuilt to match the stated vision: zero
titles/narration on the surface, the app's **own parser** instead of a hand-rolled one, and a wider
opt-in reveal vocabulary (8 layers incl. trust tiers + blast radius). Changes NO app code. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Full handoff for the surface | `cat sandbox/unfold/README.md` | command-anchored doc (thesis · reveals · self-check) |
| Model + claims self-check (headless) | `node sandbox/unfold/verify.mjs` | PASS — coverage · grammar surface · advisory edges · bodies keys · blast walk |
| One parser, not two | `grep -n "from '../../src" sandbox/unfold/main.ts` | `fromMermaid` from `src/io/mermaid` (+ types) |
| Zero chrome (no header/brand/narration in markup) | `grep -cE '<header|class="brand"|Nothing selected|Everything starts folded' sandbox/unfold/index.html` | 0 (comments describing the thesis don't count; markup does) |
| Strict-TS clean (sandbox is outside tsconfig, checked ad hoc) | `npx tsc --noEmit -p <scratch tsconfig incl. sandbox/unfold/main.ts + src>` | exit 0 |
| Touched NO app code / map / tooling | `git status --short -- src tools docs public` | empty |
| Repo gates unaffected | `npm run flowmap:gate` · `npm run flowmap:roadmap:audit` | in sync · pass |
| Run it | `npm run dev` → `/sandbox/unfold/` | two cards, everything else opt-in via the reveal panel |

**Design decisions this session (intent, for review):** wires paint above group surfaces (z-index —
otherwise intra-region edges are invisible = the layer lies by omission); render pipeline uses plain
timers, not rAF (rAF freezes in occluded windows); bundle subgraphs surface as an extra unfold level
("clusters"); trust layer derives from `flowmap:trust` semantics (signatures verified · desc advisory ·
edges code-backed unless in `docs/flowmap/edge-advisory-allowlist.txt`); `hierarchy.json` stays a
curated overlay — promoting it to a first-class `.mmd` directive is the named next increment.

## 0b. Prior session — a design SANDBOX (outside `src/`; does NOT touch the app or the loop)

A read-only architecture-auditor prototype was added under `sandbox/`. It **reuses** real repo
modules (parser, theme, wire geometry) but changes no app code, exports nothing, writes no
`.mmd`, and is invisible to the flowmap tooling — so it is orthogonal to the understand→…→re-sync
loop documented below. The full, command-anchored handoff lives in `sandbox/README.md`. Each row runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Full sandbox handoff (run it, reuse, 6 views, next step) | `cat sandbox/README.md` | command-anchored doc |
| Run it | `npm run dev` → open `http://localhost:5173/sandbox/` | header: `live _bundle.mmd · … · parsed by the repo's own fromMermaid()` |
| It touched NO app code | `git status --short -- src tools` | empty |
| It reuses real modules, one-way | `grep -nE "^import .* from '\.\./src" sandbox/main.ts` | `fromMermaid` · `config` (THEMES/KIND_TINT/esc) · `wires` (orthoPath) · `state` (portPos/bestSides) |
| Tooling still green (sandbox is outside `src/`) | `npm run flowmap:gate` · `npm run flowmap:exports` · `npm run flowmap:coverage` | in sync · PASS · PASS |
| Next increment (design intent) | `sed -n '/Known limit/,$p' sandbox/README.md` | drive the real `render`/`wires` via a minimal `AppContext` → audits as overlays on the actual canvas |

## 1·now. Tooling self-map (Phase I) — the map now documents its own generator

The map covered `src/` only; the ~32 load-bearing `.mjs` modules that RUN the loop (onboard, gate,
contract, waves, orchestrate…) were invisible to it. They now have their own flowmap —
`docs/flowmap/_tooling.mmd`, a **sibling bundle** kept out of the ts-morph `src` gate — proven
true + complete + architectural + deterministic by machine. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Tooling map bundles + valid + architectural + complete + deterministic | `npm run flowmap:tooling:verify` | DONE line · lint PASS · all 32 modules mapped · 5/5 tests |
| Every load-bearing `tools/` module is mapped or audited-excluded (no silent gap) | `npm run flowmap:tooling:coverage` | PASS — 32 modules mapped, 32 %% src resolve |
| It is architecture altitude, not a flat file-mirror | `node tools/flowmap/flowmap-lint.mjs docs/flowmap/_tooling.mmd` | RESULT: PASS (0 warnings) |
| Exclusions are audited, not silent | `cat docs/flowmap/tooling-curation-allowlist.txt` | 5 entries (scratch / harness / contract-instrument), each with a reason |
| The committed map is fresh (re-bundle is byte-identical) | `npm run flowmap:tooling:bundle && git status --short docs/flowmap/_tooling.mmd` | clean (no diff) |
| Phase I computes BUILT (status, not prose) | `npm run flowmap:roadmap` | `I1 [BUILT]` (5/5) · 32 built |
| The `src` map + whole suite still green (the tooling map is a sibling) | `npm run flowmap:verify` · `npm run spec:test:all` | 0 unaccounted edges · 158/158 |
| Review overlay that authored this (viewable in the editor) | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/tooling.plan.json` | coherent (103 changes) |

**How it was built (the flowmap way):** 6 subsystem fragments (`tools/**/<subsystem>.flowmap.mmd`)
authored by 6 subagents, each under an enforceable, self-verifiable contract —
`node tools/flowmap/frag-check.mjs <fragment> --container <id> --expect <ids>` must exit 0 — then
gated centrally by `flowmap:tooling:verify`. No subagent output was accepted on prose; only the checks.

**New files:** `docs/flowmap/root-tools.mmd`, `docs/flowmap/_tooling.mmd`,
`docs/flowmap/tooling-curation-allowlist.txt`, `docs/flowmap/plans/tooling.plan.json`,
`tools/flowmap/{tooling-coverage,frag-check,tooling-map.test}.mjs`, and 6 fragments
(`tools/buildspec/buildspec.flowmap.mmd`, `tools/flowmap/{integrity,understand,continuity,plan-approve,contract-spine}.flowmap.mmd`).
**Edited:** `package.json` (scripts + suite), `docs/flowmap/roadmap.json` (Phase I), `CLAUDE.md` (I1 def).

**Honest boundaries (do not oversell):**
- **Structure-only.** `.mjs` carries no `fm` signature and is NOT gated by `flowmap:gate` (ts-morph
  `allowJs:false`). The tooling map's truth is `flowmap:tooling:verify` (grammar + lint + completeness
  + symbol-truth + determinism) plus the modules' own `node --test` suites — not signature-level like
  the `src` gate.
- **Completeness is module-level, not symbol-level.** Every tooling *file* is a node; a tool's
  individual exported functions are not each gated the way `src` exports are (A1). Extending
  symbol-level completeness to `.mjs` is a candidate follow-on (captured only here + as this bullet).
- **Separate bundle.** `flowmap:onboard` / `flowmap:ship` still operate on `_bundle.mmd` (the app).
  The tooling map is enforced by `flowmap:tooling:verify`, which runs inside `spec:test:all` (so CI
  covers it via `tooling-map.test.mjs`).

## 1·recent. Phase H — the two-contract gap closure (purpose review → built)

A purpose review found the AI↔human↔AI and AI↔subagent contracts were *demonstrable* but not yet
*load-bearing*; five seams. Phase H closes them. Tooling-track items are verified by their own
`node --test` + `flowmap:replay`; status is computed by the roadmap predicate. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **H1 — projection acceptance**: behavioural contracts now bind ctx/DOM-bound code, not only pure fns | `node --test tools/buildspec/acceptance.test.mjs` | 10/10 (slice GREEN · wrong-slice RED · no-lens RED · determinism) |
| **H2 — editor decision artifact**: the editor emits `approved-plan.json` = plan+verdicts; the CLI mints the bundle | `grep -n approved-plan.json src/panel/planner.ts` · `node --test tools/flowmap/approve-export.test.mjs` | present · 4/4 (incl. editor→CLI round-trip) |
| **H3 — verify-change `--strict`**: a shaped-but-unproven change no longer exits 0 | `node tools/flowmap/verify-change.mjs --change fit-clamp --json --strict; echo $?` · `… --change frame-transform --json --strict; echo $?` | `1` (unproven) · `0` (proven) |
| **H4 — orchestrator + worktree isolation**: waves → per-change worktree+contract → strict verdict → canonical summary | `node tools/flowmap/orchestrate.mjs --plan public/plan.json` · `node --test tools/flowmap/orchestrate.test.mjs` | wave-0 dispatch + summary (exit 1 = unbuilt, expected) · 6/6 |
| H4 determinism (worktree side-effects must not perturb stdout) | `node tools/flowmap/replay.mjs --task "node tools/flowmap/orchestrate.mjs --plan public/plan.json --json" --n 5` | `DETERMINISTIC` · one hash |
| **H5 — handoff content-falsifiability**: a handoff that misstates a file's git state fails the gate | `node --test tools/flowmap/handoff-fresh.test.mjs` | 5/5 (incl. the real two-bullet pattern + no false positive) |
| Phase H computes BUILT (status, not prose) | `npm run flowmap:roadmap` | H1–H5 `[BUILT]` · 32 built |
| Plan coherent + certified; whole suite green; map in sync | `npm run flowmap:plan-check -- --plan docs/flowmap/plans/phase-h.plan.json` · `npm run spec:test:all` · `npm run flowmap:gate` | coherent · 158/158 · in sync |

**Plan + machine-checked intent** (coherence proven by `npm run flowmap:plan-check -- --plan
docs/flowmap/plans/phase-h.plan.json`): `docs/flowmap/plans/phase-h.plan.json`.

**Honest boundaries (do not oversell):**
- Like Phase G, four of five are `.mjs` TOOLING — deliberately NOT in `_bundle.mmd`, NOT gated by
  `flowmap:gate`; verified by `node --test` + `flowmap:replay`. The plan is checked by
  `flowmap:plan-check` only (it also passes `plan-cert` with zero delta). H2's editor change IS
  app-TS and rides `flowmap:gate`.
- **H4 is a v1 driver**: it provisions an isolated worktree per dispatched change and drops the
  contract packet in (the workspace a parallel build-agent would use), and routes the strict-aware
  verdict via the MAIN repo — a HEAD worktree lacks gitignored `node_modules` (ts-morph), so the
  gate cannot run inside it. Wiring an actual build agent INTO each worktree (then re-verifying from
  within) is the next increment; the schedule, the isolation and the routed verdict exist here.
- **H5 retains the dirty-handoff bypass**: while `SESSION_HANDOFF.md` is modified in the working
  tree, `flowmap:handoff:check` exits 0 without running the content check (the agent is editing it).
  The content check's correctness is proven by `node --test tools/flowmap/handoff-fresh.test.mjs`
  and by running `checkContentClaims` on this file's own HEAD revision (it flagged the prior
  false Phase-G claim, which is now removed). Commit state is derivable from `git status`.

## 1·earlier. Phase G — the agent/subagent contract spine (route, not compute)

Built the tooling that makes subagent execution verifiable with **zero prose in the verdict or
handover**: a 0-context subagent receives a deterministic *contract packet*, returns a tool-computed
*verdict* (not a narration), and `replay` proves "100 runs → 1 result". Honest boundary (accepted):
100 identical **verdicts**, not 100 identical diffs; the code-writing interior stays creative, only
its verdict and handover are deterministic. Independently confirmed by a 0-context Opus verifier.
Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **G1 — contract packet**: self-contained + byte-deterministic, routes to real map/source/cone | `npm run flowmap:contract -- --change frame-transform --json` | canonical packet: `source`, `signature`, `acceptance.cases`, `blastRadius`, `deps`, `contractHash` |
| **G2 — verdict is data-only** (no prose/paths/time), PASS on a real green change | `npm run flowmap:verify-change -- --change frame-transform --json` | `"verdict":"PASS"` · behavioural 3/3 · `verdictHash` |
| G2 — verdict is **honest about strength** (3-valued) | `npm run flowmap:verify-change -- --change fit-clamp --json` · `… --change frame-node --json` | `PASS_UNPROVEN` (built, no contract) · `FAIL` (pending) |
| **G3 — the 100→100 proof**: one hash across N runs | `npm run flowmap:replay -- --task "node tools/flowmap/verify-change.mjs --change frame-transform --json" --n 20` | `DETERMINISTIC — all 20 runs identical` · exit 0 |
| G3 — leak detector is **not vacuous** (catches a real leak) | `npm run flowmap:replay -- --task "node -e \"process.stdout.write(String(Math.random()))\"" --n 8` | `NON-DETERMINISTIC` · exit 1 |
| **G4 — spawn-gate** enforces the contract, fails open | `node --test tools/flowmap/contract-gate.test.mjs` · `grep -n contract-gate .claude/settings.json` | 6/6 · `PreToolUse` hook wired |
| **G5 — parallel execution scheduler**: deterministic topological waves from deps + live status | `npm run flowmap:waves -- --plan public/plan.json` | `wave 0 (ready now): …` dispatchable set · later waves unlock as deps land |
| G5 — the waves output is deterministic (100→100) | `npm run flowmap:replay -- --task "node tools/flowmap/waves.mjs --plan public/plan.json --json" --n 12` | `DETERMINISTIC` · one hash · exit 0 |
| Phase G computes BUILT (status, not prose) | `npm run flowmap:roadmap` | G1–G5 `[BUILT]` · 32 built |
| **E4 gap fixed** — acceptance now runs on the REAL plan in CI (was engine-test only) | `grep -n "flowmap:acceptance -- --plan" .github/workflows/spec-gate.yml` | present in buildspec-tests |
| Map still true+complete (tooling lives outside src/) · whole suite green | `npm run flowmap:verify` · `npm run spec:test:all` | green · all pass |

**New files (all in `tools/flowmap/`):** `lib/canonical.mjs`, `contract.mjs`, `verify-change.mjs`,
`replay.mjs`, `contract-gate.mjs`, `waves.mjs`, and tests `canonical.test.mjs`, `contract.test.mjs`,
`verify-change.test.mjs`, `replay.test.mjs`, `contract-gate.test.mjs`, `waves.test.mjs`. Plus
`docs/flowmap/plans/subagent-contract.plan.json`. **Edited:** `package.json` (scripts + suite),
`docs/flowmap/roadmap.json` (Phase G), `.github/workflows/spec-gate.yml` (G tests + E4 fix),
`.claude/settings.json` (PreToolUse gate).

**Honest boundaries (do not oversell):**
- The spine is **.mjs tooling, not app TS symbols** — it is deliberately NOT in `_bundle.mmd` and NOT
  gated by `flowmap:gate` (the gate runs ts-morph `allowJs:false`; recon confirmed). Its verification
  is its own `node --test` suites + `flowmap:replay`. The meta plan
  (`docs/flowmap/plans/subagent-contract.plan.json`) is checked by `flowmap:plan-check` only.
- The contract packet carries an advisory free-text `intent` block (problem/approach/rationale). It is
  deterministic and hashed, but it is prose — it is *not* load-bearing for the verdict (`verify-change`
  ignores it), same status as `desc=`.
- **`PASS_UNPROVEN`** exits 0 like `PASS`; a strict caller that wants 100%-proven execution must check
  `verdict === "PASS"` in the JSON, not just the exit code.

**Remaining intent (Phase G follow-ons, none blocking):** the **wave-scheduler is now built**
(`flowmap:waves`, G5) — an orchestrator can fan out the wave-0 set to N parallel subagents, each
under its `flowmap:contract`, collect `flowmap:verify-change` verdicts, then advance. What remains is
per-change **work isolation** (a git worktree per contract so parallel subagents don't collide on the
tree) and the **orchestrator loop** that actually drives waves → dispatch → verify → next wave. The
per-task contract (packet + verdict + replay + gate) and the schedule (waves) exist; the autonomous
driver that chains them is the last piece.

## 1. This session (continuity) — a map-truth fault, found + fixed; plan NOT implemented

Resumed the in-flight plan (`public/plan.json`). Before implementing, found and fixed a
**map-completeness fault**, then stopped at the tooling's own human-review gate. Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| **Map was incomplete:** `camera.zoomToNode` existed in code + was called cross-module, but was absent from the map. Now documented. | `grep -n camera__zoomToNode docs/flowmap/_bundle.mmd` | node present (kind/sig/src + `--> applyCam` edge) |
| Fixed map is true + complete + in sync | `npm run flowmap:ship` | DONE line · gate in sync · 0 unaccounted edges (285) |
| `zoomToNode` is a real cross-module call, not dead code | `grep -n "camera.zoomToNode" src/panel/navigator.ts` | navigator.ts:124 |
| In-flight plan state (unchanged by the fix — `frameNode` still absent) | `npm run flowmap:status -- --plan public/plan.json` | 8 built · 8 pending |
| Plan is certified but **awaits human review** — 0 changes carry a signature | `node tools/flowmap/plan-cert.mjs --plan public/plan.json` | CERTIFIED · "Safe to send to human review" |

**Plan defect to reconcile before building `frame-node`:** the plan *adds* `camera__frameNode`
("centres but never zooms") — but `camera.zoomToNode` already exists, already does the centre-only
behaviour, and navigator already calls it (navigator.ts:124). `frame-node` is therefore an
**evolution of `zoomToNode`** (add zoom-to-readable), not a greenfield add. The plan was authored
against a map that hid `zoomToNode`. Decide evolve-vs-add at review before implementing.

**Open risk (the flowmap gap this fault exposed):** inner / API-surface functions are not
completeness-gated — only top-level exports are (A1). A cross-module-called API method hid in the
map for many commits. Candidate roadmap item: extend the completeness gate to API-surface members.

## 1a. Gap-1 CLOSED — first behavioural contract authored AND implemented

The design→contract→implement→test half of the loop now closes on a real change: `state.frameTransform`
(the pure, testable core of `frame-node`). Each row is runnable.

| What | Verify it yourself | Expect |
|---|---|---|
| Pure testable core implemented | `grep -n "export function frameTransform" src/core/state/state.ts` | present (6-line pure fn) |
| Behavioural contract GREEN (was red pre-impl) | `npm run flowmap:acceptance -- --plan public/plan.json` | 3/3 green · "the change is DONE (shaped AND correct)" |
| Map in sync (signature gate) | `npm run flowmap:gate` | `state__frameTransform` signature matches code |
| Change reads BUILT | `npm run flowmap:status -- --plan public/plan.json` | `frame-transform [BUILT]` (modify) · 9 built · 8 pending |
| Plan coherent + cert green + full suite green | `npm run flowmap:plan-check -- --plan public/plan.json` · `npm run spec:test:all` | coherent (17) · 158/158 |

**Lifecycle finding (new gap):** an `add` change, once implemented + shipped into the map, becomes
INCOHERENT against REAL-IDS ("adds a node that already exists"). The loop has no automatic
"change-landed" transition — `frame-transform` had to be hand-flipped `add`→`modify` to keep
plan-check / loop-e2e green. Candidate roadmap item: a built-add → modify/`done` transition so the
plan artifact doesn't self-drift the moment an add lands.

**Open gap (E2 surface):** the Keystone-2 harness (`acceptance.mjs`) only tests PURE, top-level
EXPORTED functions (`mod[symbol](...args)` + deepStrictEqual). DOM/ctx-bound methods and new UI
modules — most of the app, incl. every other pending change — must be factored to pure functions to
be behaviourally contractable (this is why `frame-node`'s core became `state.frameTransform`).
Candidate roadmap item: a ctx/DOM acceptance harness, or a documented "factor-to-pure" rule.

**Still held for your review (the camera applier):** `frame-node` (add `camera__frameNode`) remains
PENDING — it is the thin DOM applier over `frameTransform`, and its evolve-vs-add reconciliation
against the existing `camera.zoomToNode` (navigator.ts:124) is a design decision left to review.

## 1·prev. Prior session — each row is a runnable claim

This session closed the gaps the previous handoff left open (C3, E1) **and** the deeper
untracked gaps surfaced in review: unverified edges (the biggest), prose-typed signatures,
and the unenforced *agent* protocol. The loop is now closed at the meta level too.

| What | Verify it yourself | Expect |
|---|---|---|
| **A5 — edge verification.** The whole call graph was UNVERIFIED (283 edges, warnings only) — yet blast-radius / `downstreamCone` all walk it. Now every edge is code-backed or audited. | `npm run flowmap:edges` | 281 code-backed · 4 advisory · **0 unaccounted** |
| A5 fails closed | `node --test tools/flowmap/edge-verify.test.mjs` | 5/5 (strict exits 1 on an unaccounted edge) |
| A5 advisory edges are audited, not hidden | `cat docs/flowmap/edge-advisory-allowlist.txt` | 4 `ctx.hooks` edges, each with rationale |
| **A6 — type gate tightened.** Object-literal + function types now compared, not skipped as prose. | `npm run flowmap:gate` | ✓ in sync · **1** prose hole (was 32) |
| A6 locked + found real drift | `node --test tools/buildspec/normtype.test.mjs` | 25/25 (also fixed `showTab` `which` drift) |
| **C3 — authoring-time coherence.** | `npm run flowmap:plan-check -- --plan public/plan.json` | ✓ coherent (16 changes) |
| **E1 — single approval export.** | `npm run flowmap:approve -- --plan public/plan.json --out /tmp/x` | approved.mmd + contracts + CHECKLIST.md + plan.json |
| **F1–F3 — agent protocol made durable + bookended.** | `grep -n "Session protocol" CLAUDE.md` · `cat .claude/settings.json` | protocol section · SessionStart(onboard)+Stop(handoff) hooks |
| **F4 — meta-loop is verifiable.** Handoff must be ≥ as fresh as the last code commit. | `npm run flowmap:handoff:check` | ✓ (exits 1 when the handoff lags code) |
| **F5 — the loop runs end-to-end** (plan-check → cert → approve → status → writeback → edges) on the real plan, as one chain. | `npm run flowmap:loop` | 1/1 |
| **trust report reflects A5/A6** | `npm run flowmap:trust` | ~2526 verified · 32 partial · 0 unverified edges |
| Whole computed roadmap | `npm run flowmap:roadmap` | 32 built (Phase A–I) |
| Nothing regressed | `npm run spec:test:all` · `npm run typecheck` | 158/158 · clean |

New files: `tools/flowmap/{edge-verify,plan-check,approve-export,handoff-fresh,loop-e2e.test,edge-verify.test,plan-check.test,approve-export.test}.mjs`,
`tools/buildspec/normtype.test.mjs`, `docs/flowmap/edge-advisory-allowlist.txt`, `.claude/settings.json`.
Edited: `package.json` (scripts + suite), `spec-gate.yml` (CI), `roadmap.json` (A5 + Phase F + C2/C3 hardening),
`trust-report.mjs` (edge tiering), `skeleton.mjs` (A6 normalizers), `CLAUDE.md` (Session protocol + A5/F defs).

## 2. What "green" now means

`npm run flowmap:verify` green ⟺ the map is structurally true + complete (A1) **and its edges
are code-backed-or-audited (A5)**. The signature gate now compares object-literal/function types
too (A6) — 1 prose hole remains (a single-quoted dynamic-import type, genuinely non-normalizable).
`desc=` strings are still ADVISORY by design.

## 3. Remaining intent (run `npm run flowmap:roadmap` for live status)

The understand→…→re-sync loop and the **meta-loop** (agent protocol) are both built and CI-enforced.
Honest remaining edges, none blocking:
- 1 prose type hole (see above) — needs type-resolution to close, low value.
- 4 advisory edges are *audited*, not *proven* — they are real `ctx.hooks`/runtime relations with
  no import (invariant #2). Proving them would need call-graph extraction through `ctx.hooks`; the
  allowlist is the deliberate, reviewed boundary until then.
- The SessionStart/Stop hooks live in `.claude/settings.json`; they fire in *this* harness. They are
  the forcing half; F4 (CI) is the verifying half.

---

## (archived 2026-07-03) onboarding-cost: the quiz pass is session-bound and module-scoped; the handoff is rotated

Built from Chris's approval of the onboarding-cost design (design doc committed first:
`docs/flowmap/onboard-cost-design.md`; plan `docs/flowmap/plans/onboard-cost.plan.json`;
tests red before code per item). Branch `onboarding-cost`, commits `db168ac` (handoff
rotation) → `f0cb1cd` (session binding) → `86ae1e7` (per-module staleness) →
`876c8d2` (two-track onboarding) → `8bcc85e` (session-aware onboard display).
Verify rows lived in the session entry; the durable ones: `node --test tools/flowmap/quiz.test.mjs`
(15/15), `edit-gate.test.mjs` (16/16), `onboard.test.mjs` (5/5), `npm run spec:test:all` (318 pass).
Honest boundaries recorded at the time: scoped flow machine-tested but not yet driven by a real
0-context session; session binding ends cross-session pass inheritance by design; `verify --file`
trusts `%% src` with a colocated-basename fallback; neighbour staleness is direct-edges-only.

## archived 2026-07-03 (same day, execution session) — the planning entry this replaced

### 0·now (2026-07-03, planning session) — third-pass rulings RECORDED + `m5-p-tabs2` / `m5-a-verbs` PLANNED: coherent, acceptance-RED before code

Chris ruled (recorded in `parity-checklist.md`, third-pass block): nav closed (browse is the
replacement), slice + style migrate as dock tabs on a two-row strip, §A model verbs migrate
hidden-by-default, diff/plan review post-MVP, select-all deferred with multi-select, legacy
kept as reference with clashes surfaced (first: THEMES styles only canvas `--*` vars unfold
never consumes, so style ports font via `--uf-font` + unfold's appearance control; theme
chips stay legacy-only pending a ruling). Two plans authored acceptance-red-before-code:
`m5-p-tabs2` (ufSliceTargets + SliceApi.sliceFor one path, applyFont→--uf-font, five tabs
two rows) and `m5-a-verbs` (ufVerbAllowed gate, nodes single-owner mutations, overlay
shortcuts + '⋯' menu + connect mode). Order load-bearing: p-tabs2 then a-verbs
(initUnfold's signature cumulative). Landed as PR #37 (merge c196d32). At-the-time verify
rows (superseded by the execution session's entry): plan-check coherent 5+6 changes,
acceptance 0/6 and 0/13 red on the not-yet-existing pure files, M5 9/11 with exactly the
two plan-acceptance rows unmet.

## archived 2026-07-04 (session 3 supersedes) — session 2 M9-prep entry, verbatim

## 0·now (2026-07-04, session 2) — M9 prep complete: overlay review path fixed+verified, dock hierarchy, ship-staleness content-hash, map curation, demo prep (PRs #42 #43 #44 #45)

#42/#43/#44 are merged to main (verify: `git log --oneline -5 main`); #45 (this handoff +
demo prep) is the last one open, with main merged back into it. All four were independently
verified by a 0-context agent (suites green, ship round-trip porcelain-empty on each branch). User verdicts recorded this session: stage-wire
fix confirmed good (assumption cleared); dock spacing was a *design* problem — redesigned as
label-species hierarchy, not more gap (#42). Planner full-migration hypothesis checked and
refuted: overlay path is complete; only wiring was broken (#42). Demo feature ruled: fresh
small src feature — unfold status readout (docs/flowmap/demo/prep/feature-choice.md).

| What | Verify it yourself | Expect |
|---|---|---|
| #42 keyboard gate present | `grep -n "plannerVisible" src/panel/unfold.ts src/core/runtime/runtime.ts src/panel/planner.ts` | capture-handler early-return + flag set/clear |
| #42 stale-on-return fixed | `grep -n "plannerClosed" src/main.ts src/core/context/context.ts` | hook wired to unfold.refreshFromModel |
| #42 behavior (CDP-proven this session) | open planner via io tab → ⌘Z/Delete → Escape | model byte-identical; Escape closes planner only |
| #43 staleness predicate | `node tools/flowmap/ship-staleness.mjs < /dev/null; echo $?` | 0 on clean tree; 2 after dirtying src/ |
| #43 stamp idempotent | run `npm run flowmap:ship` twice → `git status --porcelain` | empty both times |
| #44 dead code gone | `ls src/panel/diff-workspace.ts` | no such file |
| #44 rulings recorded | `grep -n "2026-07-04/2" docs/flowmap/parity-checklist.md` | deletion ruling hits |
| Demo plan coherent | `npm run flowmap:plan-check -- --plan docs/flowmap/demo/prep/plan.json` | ✓ coherent |
| Demo protocol | `cat docs/flowmap/demo/prep/recording-protocol.md` | capture method, artifact set, M9 predicates |
| Suites on every PR branch | `npm run spec:test:all && npm run test:src && npm run build` | all pass |
| M9 next in spine | `npm run flowmap:mvp` | M9 (P4) listed before M7 |

**Residual for Chris on #42 (eyeball at merge):** inspector chip tints + dark theme were
code-verified only (headless render can't reach them); optional refinement — faint per-tab
boundary on inactive tabs. Everything else on #42 was render- or CDP-verified live.

**Next:** #42/#43/#44 merged; merge #45, then M9 (W6): the recorded demo per
docs/flowmap/demo/prep/recording-protocol.md — fresh 0-context agent runs the loop on the
status-readout request; Chris drives planner review (genuine mouse input only);
`flowmap:verify-change` with `--strict`; artifacts land in docs/flowmap/demo/ and M9's manual
check converts to the predicates in the protocol doc.
