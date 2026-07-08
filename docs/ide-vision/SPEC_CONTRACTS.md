# SPEC_CONTRACTS — the Contracts tab (K4 design spec, read-only slice)

> **This is a translation doc, not a fresh design.** The prototype's Builds tab is heavily BINDING
> (trust seal + keystone rule, seal ceremony, tide-mark rail, decision-first layout, list grammar —
> `PROTO_MANIFEST.md` §2, KEY_DECISIONS §1.7/§3.4/§8.x). None of that is re-litigated here. This
> spec pins only what is genuinely open: **(a)** the field-by-field mapping of the REAL artifacts
> onto the Builds document schema, **(b)** the read-only scope of this slice, **(c)** what "a
> build" maps to on disk, **(d)** the activity-feed source pre-K6 — plus the two integration
> facts a builder cannot proceed without: the seam contract (§2) and the no-404 artifact-discovery
> rule (§1). Certificate visuals port from the sha-pinned prototype regions PROBES.md already
> extracted (`novakai_vision_prototype.html` 1297–1329 `.bl-card`, 1361–1940
> build-document/tide-rail/seal, 31–49 vars) — proven to render a real packet with zero fake data
> (`PROBES.md` § probe-contracts-render, PASS) — **re-expressed on house CSS vars, never copied
> verbatim**: the probe page carried the prototype's `:root` hexes, and any hex outside the law
> set fails the colour-law grep (§5).

---

## 0. What K4 is and is not

- **IS**: the Contracts page (`initContracts`, mounted via the seam contract in §2) rendering the
  repo's REAL contract/plan/verdict artifacts as (1) a builds **list** and (2) a per-build
  **certificate document**. It renders artifacts that exist on disk and never fabricates a value
  (manifest §4); packets/verdicts stay read-only and tooling is never invoked from the page, but
  the page now creates and advances lifecycle contract records over the dev file bridge (§8).
- **IS NOT**: approve/deploy invocation (explicitly a later slice of the same phase —
  `IDE_MASTER_PLAN.md` "the approve/deploy acts wire to the real gate flow in a later slice"), a
  live agent feed (K6), plan authoring, plan selection UI, or any write path to packets/verdicts/
  tooling. The rail count-dot
  SPEC_SHELL §2 deferred to K4 stays deferred: it lives in `src/ide/shell.ts`, which this lane
  does not own — it lands in the approve/deploy slice, never faked from this module.

**Nomenclature bridge (R3):** prototype "Builds" = the **Contracts** tab. On this page the display
string for one unit of work is **"build"** (KEY_DECISIONS §1.10 — single display string, trivially
swappable); the tab itself is `contracts`.

---

## 1. What "a build" maps to on disk (open question c, settled)

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
| artifact index | `public/contracts/index.json` | regenerated after the producers (one-liner below) |

**Artifact discovery is index-first — the page never fetches a URL that can 404.** The zero-
console-error bar (manifest §5.2, §9 here) is absolute, and Chromium logs every resource 404 as a
console error (the probe had to caveat its own favicon 404). Probing ~17 changes' artifacts by
fetch-and-404 would fail the gate by design. So:

- `public/contracts/index.json` — shape `{ "v": 1, "files": ["<changeId>.packet.json", ...] }` —
  is the **single committed file** in the directory; its committed baseline is `{"v":1,"files":[]}`.
  `.gitignore` gains two lines (shipped with K4): `public/contracts/*` and
  `!public/contracts/index.json`. Generated packets/verdicts are never committed (a committed
  verdict could lie about HEAD); a locally regenerated index is working-tree noise, never
  committed either — the committed baseline stays `files:[]`.
- After running producers, regenerate the index (no `tools/` edit — a pinned one-liner):
  `node -e 'const fs=require("fs"),d="public/contracts";fs.writeFileSync(d+"/index.json",JSON.stringify({v:1,files:fs.readdirSync(d).filter(f=>f!=="index.json"&&f.endsWith(".json")).sort()}))'`
- The page fetches `/contracts/index.json` and `/plan.json` once per render pass, then fetches
  **only files the index lists** (eagerly — all listed verdicts are needed to group the list,
  §2). An artifact not in the index is absent, cost-free, 404-free.
- **Absence is a designed state, never an error and never simulated.** Absent packet → the
  contract/impact/technical sections render their dim unproven state with the producing command
  beneath (empty-state grammar, manifest §2 "empty-states carry their command"). Absent verdict →
  status chip dim "unverified", seal unsealed. The gate output (`novakai:status`) is not fetched
  separately: its per-change row is already embedded in the verdict as `structural.status`, and a
  live status is exactly what a stale file cannot honestly claim.
- The document renders each artifact's own `contractHash` / `verdictHash` as a provenance line —
  the certificate claims "what this artifact says", never "what the code is now"; freshness stays
  the CLI's job (same honesty rule as the probe's unsealed render).
- Invocation gotcha (PROBES.md): `npm run novakai:contract -- --json` prepends npm's banner and
  corrupts the JSON — the pinned commands use `node` directly.
- On a fresh checkout or `vite build` the directory holds only the empty index, so every build
  renders unverified/unsealed. **That is correct behaviour, not a bug**: a clean tree has proven
  nothing yet.

---

## 2. The seam contract (what K4 requires of the seam PR — verified, not assumed)

The K3-era shell (`src/ide/shell.ts` at origin/main pre-seam) matches the hash by **exact**
membership in `TAB_ORDER` and hardcodes `emptyPage(...)` for every non-codebase tab — it has no
page-module delegation and would route `#contracts/<id>` to the codebase fallback. `shell.ts`,
`pages.ts` and `main.ts` are owned by the seam PR, not this lane. K4 therefore **depends on the
seam PR** providing, and Gate B verifies by command before any K4 src work starts
(`git show origin/main:src/main.ts | grep -q initContracts`):

1. **A mount seam**: `main.ts` calls `initContracts(...)` and the shell renders that page's
   element for the `contracts` tab instead of its empty state. The stub signature the seam ships
   is the one K4 fills — K4 adds no rival mechanism (no parallel `hashchange` host-grabbing, no
   `shell.ts` edit from this lane).
2. **Segment-aware routing**: a hash whose **first `/`-separated segment** is a tab id routes to
   that tab (`#contracts/frame-transform` → contracts page). The shell owns the first segment
   only; the page module reads the full hash itself for the remainder.

If the merged seam satisfies (1) but not (2), the K4 fallback is pinned here so implementations
cannot fork: the document route becomes **in-page state** — the list renders at `#contracts`, a
card's `Review →` swaps the page element's content to the document without changing the first
segment (hash becomes `#contracts/<id>` only if the router provably tolerates it; otherwise the
sub-route is dropped this slice and deep-linking arrives with the approve/deploy slice). Either
way: `hashchange` re-render, page = pure function of (hash, fetched artifacts), no localStorage,
no other state (KEY_DECISIONS §4.1).

---

## 3. List page — plan.json → the list grammar

The BINDING list grammar (raised needs-you card, `DONE` hairline section, right-aligned roll-up
`N builds · M needs you` with the needs-you fragment periwinkle) renders from:

| list element | source (JSON path) |
|---|---|
| one card per build | `plan.changes[i]` |
| card title (22px, verbatim) | `change.id` |
| card meta chips | `change.status` (add/modify/remove) · `change.phase` · `change.risk` · `change.target.ref` |
| grouping: DONE | verdict listed in index ∧ `verdict.verdict === "PASS"` |
| grouping: needs-you (raised card) | everything else — no verdict, `FAIL`, or `PASS_UNPROVEN` (all three genuinely await a human or a run) |
| roll-up `N builds · M needs you` | `N = changes.length`, `M =` needs-you count, computed pure over live fetched state (engineering law 4.1) |
| card affordance | `Review →` opens the document (route per §2) |

Grouping requires every listed verdict up front — the index-first eager fetch in §1 is
load-bearing for the first paint, not an optimisation.

---

## 4. Document page — field-by-field mapping onto the §1.7 schema

The §1.7 document sections, in the prototype's order, each mapped to its real source. Every
rendered VALUE must be traceable to a JSON path of a fetched artifact (probe methodology).

**Two distinct honest-empty rules, pinned:** (i) an **absent artifact** (not in the index) renders
the section's dim state **plus the producing command** beneath; (ii) a **null field inside a
present artifact** is that artifact's real value — the section renders the dim state **plus an
honest caption, no command** (there is no command that would make an edge change grow a
signature). Edge changes emit `source:null`, `signature:null`, `blastRadius:null`, `subMap:null`
by construction (`contract.mjs`); a plan change may carry no `acceptance` block at all.

| §1.7 section | real source (JSON path) | notes |
|---|---|---|
| eyebrow + display title | eyebrow `plan · <plan.base>` · title `change.id` verbatim, 32px/500 sans | literal descriptive, never pitch (§8.1) |
| lifecycle action row | **empty this slice** | BINDING `.bd-offer:empty { display:none }` — the empty offer row collapses, no void, no disabled ghost buttons (§8 below) |
| status / dates | `verdict.structural.status` (built/pending/drifted/missing/**invalid**) · `verdict.verdict` · no date rendered — no artifact carries one; a clock-sourced date would be fake data | chip hues per §6; `invalid` renders dim with `coherenceProblems` text doing the work |
| saved prototype (plate) | **absent until K5** — section omitted entirely (not an empty frame); K5 adds the plate when a real design artifact exists | §1.7 lists it; the artifact doesn't exist yet |
| intent (plain language first) | `packet.intent.problem` / `.approach` / `.rationale` (+ `.alternative`/`.tradeoff` when present); fallback `change.intent` from the plan when no packet | plain layer default |
| technical layer (one toggle deep) | `packet.signature.name` + `.interfaces[]` (accepts/returns) · `packet.source.path` + `::symbol`; `signature:null`/`source:null` (edge / structure-only change) → rule (ii): dim + caption "structure-only change — no symbol binding" | opacity-only crossfade, reserved row, zero reflow (manifest §3) |
| contract (patch + map + slice) | `packet.contractVersion` + `packet.contractHash` (provenance line) · `packet.deps` · `packet.coherent` + `.coherenceProblems[]` | collapsible secondary section (§8.5 `.xwrap` 0fr→1fr grammar) |
| impact slice | `packet.blastRadius.affected[]` / `.entryPoints[]` / `.maxDepth` + `packet.subMap.nodes/edges` as a small hand-laid SVG of exactly the N impacted nodes | slice never overlay (BINDING). Empty-but-real blast radius renders the zero with an honest caption (probe precedent); `blastRadius:null` → rule (ii) |
| acceptance criteria | `change.acceptance.cases[].name` (plan) joined with `verdict.behavioural.cases[].{name,pass}` when verdict present; no `acceptance` block in the plan → rule (ii): dim + caption "no behavioural contract in the plan (E2)" — consistent with seal line 1 | per-case result is mono text `pass` / `fail` in ink — **green criterion dots are rejected forever** (KEY_DECISIONS §3.9); green appears only on the overall verdict + seal line 3 |
| trust seal | see §5 | |
| activity feed | see §7 | |
| review | **absent this slice** — attest/defer are human acts, wired with approve/deploy later; section omitted | §8.8's review-spotlight belongs to the acting slice |

---

## 5. Trust seal over the real verdict (the keystone, honestly)

The seal's three sworn sentences map to verdict fields — nothing else may fill them:

| seal line | fills when | source |
|---|---|---|
| 1 — the tests ran | `verdict.behavioural.hasContract === true` | with `total` woven in (`N cases ran`) |
| 2 — the tests passed | line 1 filled ∧ `passed === total` | `verdict.behavioural.passed` / `.total` |
| 3 — the work is trusted (green) | `verdict.verdict === "PASS"` | keystone rule: stays dim unless 1+2 are filled — which `PASS` guarantees by construction (`verify-change.mjs` only emits `PASS` when behaviourally proven); the renderer still enforces the visual dependency rather than trusting the enum |

- `PASS_UNPROVEN` renders lines honestly: built structurally, line 1 dim ("no behavioural
  contract"), line 3 dim. Never green (H3's whole point: no silent over-trust).
- No verdict → seal unsealed, all lines dim, producing command beneath (exactly the state probe 3
  shipped and the session lead accepted).
- **Seal ceremony (~1.2s draw, once ever):** plays only on a live unsealed→sealed transition
  *within a session* (a verdict appearing/changing to `PASS` across a re-fetch). A document that
  loads already-PASS renders the frame already solid, no replay — "once ever" without a
  persistence layer this read-only slice doesn't have. Stamp renders `sealed · <verdictHash
  first 12>` — **no date**: no artifact carries one, and a clock-sourced date on a certificate
  would be fake data. When a later slice adds a dated verdict artifact, the stamp gains the date.
- Tide-mark rail: BINDING geometry untouched; a section's tide sets when its backing artifact
  section is present-and-proven (e.g. acceptance tide sets on `behavioural.proven`), with §8.5's
  additive count metadata beside the labels (`3/3 proven`, `N nodes`).

---

## 6. Colour law application (two-actor law, §3.2 — the product)

| element | hue | why lawful |
|---|---|---|
| tide-mark rail, proven counts | teal `#4fe0cd` | machine-proven claim (verdict-backed) |
| needs-you roll-up fragment, card hover, selection | periwinkle `#7c8cff` | the human |
| seal line 3 · overall `PASS` | green `#5fd0a0` | a VERDICT only — nowhere else, ever |
| `pending` / `PASS_UNPROVEN` / attested chips | amber | pending/attested |
| unverified, absent artifacts, unproven claims, `invalid` | dim `#565f6e` / hollow | unproven, shown honestly |

No new hue. Per-case pass/fail text is ink, not green (§3.9). `drifted`/`FAIL` render in amber/ink
chip grammar with the word doing the work — no red exists in the law and none is introduced.
Reviewer grep: any hex literal in `css/contracts.css` outside the existing law set + slate/line
vars fails the verify row (same check as SPEC_SHELL §6). The prototype CSS port therefore
converts every extracted hex to its house var — verbatim copy is a law violation by grep.

---

## 7. Activity feed pre-K6 (open question d, settled honestly)

**Empty until K6.** The prototype's feed is FAKE (manifest §4: scripted scheduler, narrated agent,
"do not build integrations off the demo's narration") and the K4 read-only slice has no real
execution-pipeline source (the only durable trail, `docs/novakai/metrics/session-log.jsonl`, is
gitignored and unserved). The section therefore renders the BINDING empty-state grammar — one dim
mono line ("activity arrives when agents run in the repo") + fainter `agents — xterm over the
dev-server bridge · K6`. No scripted player, no timers, no placeholder rows. K6 wires the real
source; this section is the seam it plugs into.

---

## 8. Read-only means read-only for packets/verdicts/tooling (scope b, pinned)

- No approve, no deploy, no attest/defer, no re-run button, no CLI invocation from the page. The
  BINDING decision-first geometry is honoured by the *collapsing* empty offer row — the raised row
  exists in the DOM grammar and appears only when a later slice puts a real act in it. Rendering
  disabled ghost buttons would imply an act this slice cannot perform.
- The one write path this slice does have: lifecycle `ContractRecord`s (draft/active/review/
  completed, plus refs and history) go through the dev file bridge's `/novakai/contracts` and
  `/novakai/contracts/write` routes (`contract-store.ts`) — create-from-change, free-form create,
  and advance. That bridge never touches packets, verdicts, or tooling; it is process-local to
  `npm run dev` and absent in a production build, matching the rest of the file-bridge pattern.
- The later slice (same phase, per IDE_MASTER_PLAN) adds: approve/deploy wired to the real gate
  flow, the review section, deep-link hardening if §2's fallback was taken, the rail count-dot
  (with `shell.ts` ownership), and dated verdicts if the artifact grows a date.

---

## 9. Files, module shape, standards

- `src/ide/contracts.ts` — `initContracts(...)`: fills the seam stub; owns sub-route state (§2),
  index-first fetch + join of plan/packet/verdict, list render. Document renderers split into
  `src/ide/contracts-doc.ts` — and K11's BLOCK tiers bite at **function** level too
  (max-lines-per-function on `src/ide/**`): render one section per small function, a
  section-table dispatch, never one mega-render.
- `css/contracts.css` — imported by `contracts.ts`; `css/styles.css` is never touched.
  Certificate CSS ports from the pinned prototype regions re-expressed on house vars (§6); 9px
  radius, mono/sans only, no serif.
- `public/contracts/index.json` (committed baseline `{"v":1,"files":[]}`) + the two `.gitignore`
  lines (§1) ship with K4 and belong to this lane.
- Vanilla TS, hand-built DOM, zero dependencies, pure render over fetched state (re-fetch on
  `hashchange`; no store beyond module locals).
- Tests: a Playwright journey that generates the packet+verdict for `frame-transform` (the one
  change in `public/plan.json` carrying real acceptance cases — and a real `PASS`) via the §1
  commands in its setup, regenerates the index, opens the list and the document, and asserts
  rendered `textContent` equals the fetched JSON values (probe 3's methodology — `textContent`,
  not `innerText`), the DONE/needs-you grouping, the sealed-static seal, the absent-artifact dim
  states for a change with no artifacts, and **zero console errors** across all of it. Goldens
  per J1's regeneration story.

---

## 10. Verification (how the K4 predicate is met)

`docs/novakai/ide-roadmap.json` K4 checks: spec file exists (this file) · `initContracts` greps in
`src/main.ts` (the seam) · manual: "document renders from real .novakai/plan artifacts in
Chromium, zero console errors, color law intact". The manual check procedure:

1. `npm run novakai:bodies` (fresh bodies), then the two §1 producer commands for
   `frame-transform` into `public/contracts/`, then the §1 index one-liner.
2. `npm run dev` → open `#contracts` → list renders from `/plan.json`, grouped by real verdicts;
   open the `frame-transform` document → certificate renders; every value traceable to a JSON
   path; seal state matches the verdict file's enum honestly (a real `PASS` → sealed-static).
3. Chromium console: zero errors — including zero resource 404s (index-first discovery makes this
   achievable, §1). Colour-law grep on `css/contracts.css`: zero out-of-law hex.
4. `npm run novakai:ide` — K4 non-manual checks pass; J1 net green; 0-context re-prove per
   IDE_MASTER_PLAN §3.

**Predicate hardening:** the §9 Playwright journey is the manual note's command form — it proves
render-from-real-artifacts + zero console errors mechanically. `docs/novakai/ide-roadmap.json` is
frozen for this lane, so flipping the K4 `manual` check to a `cmd` predicate pointing at that
journey is recorded here as an explicit orchestrator follow-up for the build PR review — the
command will already exist and pass.
