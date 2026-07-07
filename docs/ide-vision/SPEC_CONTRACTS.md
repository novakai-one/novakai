# SPEC_CONTRACTS — the Contracts tab (K4 design spec, read-only slice)

> **This is a translation doc, not a fresh design.** The prototype's Builds tab is heavily BINDING
> (trust seal + keystone rule, seal ceremony, tide-mark rail, decision-first layout, list grammar —
> `PROTO_MANIFEST.md` §2, KEY_DECISIONS §1.7/§3.4/§8.x). None of that is re-litigated here. This
> spec pins only what is genuinely open: **(a)** the field-by-field mapping of the REAL artifacts
> onto the Builds document schema, **(b)** the read-only scope of this slice, **(c)** what "a
> build" maps to on disk, **(d)** the activity-feed source pre-K6. Certificate visuals port from
> the sha-pinned prototype regions PROBES.md already extracted (`novakai_vision_prototype.html`
> 1297–1329 `.bl-card`, 1361–1940 build-document/tide-rail/seal, 31–49 vars) — proven to render a
> real packet with zero fake data (`PROBES.md` § probe-contracts-render, PASS).

---

## 0. What K4 is and is not

- **IS**: the Contracts page (`initContracts`, mounted by the K3 shell at `#contracts`) rendering
  the repo's REAL contract/plan/verdict artifacts as (1) a builds **list** and (2) a per-build
  **certificate document**. Read-only: it renders artifacts that exist on disk; it never invokes
  tooling, never mutates state, never fabricates a value (manifest §4).
- **IS NOT**: approve/deploy invocation (explicitly a later slice of the same phase —
  `IDE_MASTER_PLAN.md` "the approve/deploy acts wire to the real gate flow in a later slice"), a
  live agent feed (K6), plan authoring, plan selection UI, or any write path. The rail count-dot
  SPEC_SHELL §2 deferred to K4 stays deferred: it lives in frozen `src/ide/shell.ts`, so it lands
  in the approve/deploy slice together with that file's unfreeze — never faked from this module.

**Nomenclature bridge (R3):** prototype "Builds" = the **Contracts** tab. On this page the display
string for one unit of work is **"build"** (KEY_DECISIONS §1.10 — single display string, trivially
swappable); the tab itself is `contracts`.

---

## 1. What "a build" maps to on disk (the open question this spec settles)

**A build = one change entry in the canonical plan, `public/plan.json`.** The list page is the
plan's `changes[]` array; the document page is one change joined with its optional generated
artifacts. Nothing else is a build.

The producers of the two richest artifacts — `novakai:contract` (packet) and
`novakai:verify-change` (verdict) — write **stdout only**; the repo has no `.novakai/` artifact
directory. The tab is a browser page (Vite serves `public/` at `/`), so K4 pins this convention:

| artifact | disk path (served path) | producer (real command, verbatim) |
|---|---|---|
| plan | `public/plan.json` → `/plan.json` | committed; the repo's live self-map plan |
| contract packet | `public/contracts/<changeId>.packet.json` | `node tools/novakai/contract/contract.mjs --change <id> --plan public/plan.json --json > public/contracts/<id>.packet.json` |
| verdict | `public/contracts/<changeId>.verdict.json` | `node tools/novakai/contract/verify-change.mjs --change <id> --plan public/plan.json --json > public/contracts/<id>.verdict.json` |

- `public/contracts/` is **generated, gitignored** (one `.gitignore` line ships with K4). A
  committed verdict could lie about HEAD; a generated one is as fresh as its run. The document
  renders each artifact's own `contractHash` / `verdictHash` as a provenance line, so the human
  can cross-check a hash against a re-run — the certificate claims "what this artifact says",
  never "what the code is now" (freshness stays the CLI's job, same honesty rule as PROBES.md's
  unsealed render).
- Invocation gotcha (PROBES.md): `npm run novakai:contract -- --json` prepends npm's banner and
  corrupts the JSON — the pinned commands use `node` directly.
- **Absence is a designed state, never an error and never simulated.** Fetch 404 on a packet →
  the contract/impact sections render their dim unproven state with the producing command beneath
  (empty-state grammar, manifest §2 "empty-states carry their command"). Fetch 404 on a verdict →
  status chip dim "unverified", seal unsealed. The gate output (`novakai:status`) is not fetched
  separately: its per-change row is already embedded in the verdict as `structural.status`, and a
  live status is exactly what a stale file cannot honestly claim.

---

## 2. List page — plan.json → the list grammar

The BINDING list grammar (raised needs-you card, `DONE` hairline section, right-aligned roll-up
`N builds · M needs you` with the needs-you fragment periwinkle) renders from:

| list element | source (JSON path) |
|---|---|
| one card per build | `plan.changes[i]` |
| card title (22px, verbatim) | `change.id` |
| card meta chips | `change.status` (add/modify/remove) · `change.phase` · `change.risk` · `change.target.ref` |
| grouping: DONE | verdict file present ∧ `verdict.verdict === "PASS"` |
| grouping: needs-you (raised card) | everything else — no verdict file, `FAIL`, or `PASS_UNPROVEN` (all three genuinely await a human or a run) |
| roll-up `N builds · M needs you` | `N = changes.length`, `M =` needs-you count, computed pure over live fetched state (engineering law 4.1) |
| card affordance | `Review →` opens the document route |

Route: hash carries page + id only (KEY_DECISIONS §4.1) — `#contracts` = list,
`#contracts/<changeId>` = document. The K3 router owns the first segment; this module parses the
remainder itself and re-renders on `hashchange`. No localStorage, no other state.

---

## 3. Document page — field-by-field mapping onto the §1.7 schema

The §1.7 document sections, in the prototype's order, each mapped to its real source. Every
rendered VALUE must be traceable to a JSON path of a fetched artifact (probe methodology); a
section whose artifact is absent renders its dim state + producing command.

| §1.7 section | real source (JSON path) | notes |
|---|---|---|
| eyebrow + display title | `plan.base` eyebrow · `change.id` verbatim, 32px/500 sans | literal descriptive, never pitch (§8.1) |
| lifecycle action row | **empty this slice** | BINDING `.bd-offer:empty { display:none }` — the empty offer row collapses, no void, no disabled ghost buttons (§7 below) |
| status / dates | `verdict.structural.status` (built/pending/drifted/missing) · `verdict.verdict` · no date rendered — no artifact carries one; a fake date is banned | chip hues per §5 |
| saved prototype (plate) | **absent until K5** — section omitted entirely (not an empty frame); K5 adds the plate when a real design artifact exists | §1.7 lists it; the artifact doesn't exist yet |
| intent (plain language first) | `packet.intent.problem` / `.approach` / `.rationale` (+ `.alternative`/`.tradeoff` when present); fallback `change.intent` from the plan when no packet | plain layer default |
| technical layer (one toggle deep) | `packet.signature.name` + `.interfaces[]` (accepts/returns) · `packet.source.path` + `::symbol` | opacity-only crossfade, reserved row, zero reflow (manifest §3) |
| contract (patch + map + slice) | `packet.contractVersion` + `packet.contractHash` (provenance line) · `packet.deps` · `packet.coherent` + `.coherenceProblems[]` | collapsible secondary section (§8.5 `.xwrap` 0fr→1fr grammar) |
| impact slice | `packet.blastRadius.affected[]` / `.entryPoints[]` / `.maxDepth` + `packet.subMap.nodes/edges` as a small hand-laid SVG of exactly the N impacted nodes | slice never overlay (BINDING). Empty blast radius renders the real zero with an honest caption (probe precedent). `null` (edge change / no packet) → dim state + command |
| acceptance criteria | `change.acceptance.cases[].name` (plan) joined with `verdict.behavioural.cases[].{name,pass}` when verdict present | per-case result is mono text `pass` / `fail` in ink — **green criterion dots are rejected forever** (KEY_DECISIONS §3.9); green appears only on the overall verdict + seal line 3 |
| trust seal | see §4 | |
| activity feed | see §6 | |
| review | **absent this slice** — attest/defer are human acts, wired with approve/deploy later; section omitted | §8.8's review-spotlight belongs to the acting slice |

---

## 4. Trust seal over the real verdict (the keystone, honestly)

The seal's three sworn sentences map to verdict fields — nothing else may fill them:

| seal line | fills when | source |
|---|---|---|
| 1 — the tests ran | `verdict.behavioural.hasContract === true` | with `total` woven in (`N cases ran`) |
| 2 — the tests passed | line 1 filled ∧ `passed === total` | `verdict.behavioural.passed` / `.total` |
| 3 — the work is trusted (green) | `verdict.verdict === "PASS"` | keystone rule: stays dim unless 1+2 are filled — which `PASS` guarantees by construction (`verify-change.mjs` folds structural built ∧ behavioural proven); the renderer still enforces the visual dependency rather than trusting the enum |

- `PASS_UNPROVEN` renders lines honestly: built structurally, line 1 dim ("no behavioural
  contract"), line 3 dim. Never green (H3's whole point: no silent over-trust).
- No verdict file → seal unsealed, all lines dim, producing command beneath (exactly the state
  probe 3 shipped and the session lead accepted).
- **Seal ceremony (~1.2s draw, once ever):** plays only on a live unsealed→sealed transition
  *within a session* (a verdict file appearing/changing to `PASS` across a re-fetch). A document
  that loads already-PASS renders the frame already solid, no replay — "once ever" without a
  persistence layer this read-only slice doesn't have. Stamp renders `sealed · <verdictHash
  first 12>` — **no date**: no artifact carries one, and a clock-sourced date on a certificate
  would be fake data. When a later slice adds a dated verdict artifact, the stamp gains the date.
- Tide-mark rail: BINDING geometry untouched; a section's tide sets when its backing artifact
  section is present-and-proven (e.g. acceptance tide sets on `behavioural.proven`), with §8.5's
  additive count metadata beside the labels (`3/3 proven`, `N nodes`).

---

## 5. Colour law application (two-actor law, §3.2 — the product)

| element | hue | why lawful |
|---|---|---|
| tide-mark rail, proven counts | teal `#4fe0cd` | machine-proven claim (verdict-backed) |
| needs-you roll-up fragment, card hover, selection | periwinkle `#7c8cff` | the human |
| seal line 3 · overall `PASS` | green `#5fd0a0` | a VERDICT only — nowhere else, ever |
| `pending` / `PASS_UNPROVEN` / attested chips | amber | pending/attested |
| unverified, absent artifacts, unproven claims | dim `#565f6e` / hollow | unproven, shown honestly |

No new hue. Per-case pass/fail text is ink, not green (§3.9). `drifted`/`FAIL` render in amber/ink
chip grammar with the word doing the work — no red exists in the law and none is introduced.
Reviewer grep: any hex literal in `css/contracts.css` outside the existing law set + slate/line
vars fails the build-plan verify row (same check as SPEC_SHELL §6).

---

## 6. Activity feed pre-K6 (the open question, settled honestly)

**Empty until K6.** The prototype's feed is FAKE (manifest §4: scripted scheduler, narrated agent,
"do not build integrations off the demo's narration") and the K4 read-only slice has no real
execution-pipeline source (the only durable trail, `docs/novakai/metrics/session-log.jsonl`, is
gitignored and unserved). The section therefore renders the BINDING empty-state grammar — one dim
mono line ("activity arrives when agents run in the repo") + fainter `agents — xterm over the
dev-server bridge · K6`. No scripted player, no timers, no placeholder rows. K6 wires the real
source; this section is the seam it plugs into.

---

## 7. Read-only means read-only (scope b, pinned)

- No approve, no deploy, no attest/defer, no re-run button, no CLI invocation from the page. The
  BINDING decision-first geometry is honoured by the *collapsing* empty offer row — the raised row
  exists in the DOM grammar and appears only when a later slice puts a real act in it. Rendering
  disabled ghost buttons would imply an act this slice cannot perform.
- The later slice (same phase, per IDE_MASTER_PLAN) adds: approve/deploy wired to the real gate
  flow, the review section, the rail count-dot (unfreezes `shell.ts`), and dated verdicts if the
  artifact grows a date.

---

## 8. Files, module shape, standards

- `src/ide/contracts.ts` — `initContracts(ctx)`: fills the K3 stub; owns route parsing below
  `#contracts`, fetch + join of plan/packet/verdict, list + document render. Split renderers into
  `src/ide/contracts-doc.ts` if K11 length tiers demand it — same directory, same ownership.
- `css/contracts.css` — imported by `contracts.ts` (`import '../../css/contracts.css'`);
  `css/styles.css` is never touched. Certificate CSS ports from the pinned prototype regions
  (header note) re-expressed on house vars; 9px radius, mono/sans only, no serif.
- Vanilla TS, hand-built DOM, zero dependencies, pure render over fetched state (re-fetch on
  `hashchange`; no store beyond module locals). K11 BLOCK tiers apply (`src/ide/**` glob).
- Tests: a Playwright journey that serves a generated packet+verdict for `frame-transform` (the
  one change in `public/plan.json` carrying real acceptance cases), opens `#contracts/<id>`, and
  asserts rendered `textContent` equals the fetched JSON values (probe 3's 9-assertion
  methodology — assert `textContent`, not `innerText`), plus the absent-artifact dim states with
  no console errors. Goldens per J1's regeneration story.

---

## 9. Verification (how the K4 predicate is met)

`docs/novakai/ide-roadmap.json` K4 checks: spec file exists (this file) · `initContracts` greps in
`src/main.ts` (the seam) · manual: "document renders from real .novakai/plan artifacts in
Chromium, zero console errors, color law intact". The manual check procedure:

1. `npm run novakai:bodies` (fresh bodies), then the two §1 producer commands for
   `frame-transform` into `public/contracts/`.
2. `npm run dev` → open `#contracts` → list renders from `/plan.json`; open
   `#contracts/frame-transform` → certificate renders; every value traceable to a JSON path;
   seal state matches the verdict file's enum honestly.
3. Chromium console: zero errors. Colour-law grep on `css/contracts.css`: zero out-of-law hex.
4. `npm run novakai:ide` — K4 non-manual checks pass; J1 net green; 0-context re-prove per
   IDE_MASTER_PLAN §3.
