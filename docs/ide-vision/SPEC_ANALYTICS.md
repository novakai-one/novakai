# SPEC_ANALYTICS — the Analytics tab (K10 design spec)

> What this document is: the design round for K10, the Analytics tab — agent spend per
> contract, per repo. What is BINDING here: the data source (§1), the definition of
> "spend" (§2), the extractor boundary contract (§3), the attribution rules (§4), and the
> colour-law compliance table (§8). What is design-choice: exact copy strings, row
> ordering, spacing values — those follow the design law
> (`260706_V3_DESIGN_SYNTHESIS.md`) and may be tuned at build time without re-opening
> this spec. The prototype has **zero Analytics coverage** (verified: no BINDING /
> ILLUSTRATIVE / FAKE row in `PROTO_MANIFEST.md` mentions Analytics — the prototype has
> only Canvas, Prototypes, Builds), so nothing is ported; only the general BINDING laws
> (colour, motion, typography, radius, empty-state grammar) apply. **No simulated data,
> ever** (ruling R3 / manifest §4): every number this tab renders is read from a real
> artifact derived from real transcripts on this machine.

## 0. What K10 is and is not

K10 renders **agent token spend for this repo**: which sessions ran, which agents they
spawned, which models they used, what they consumed — rolled up per contract, per model,
per day. It is a **ledger, not a dashboard**: plain sentence first, mono tabular
numerals beneath, near-zero saturation (design law §A/§C). It reads one derived
artifact (`public/spend.json`, §3) produced by one command (`npm run novakai:spend`).

It is **not**:
- a dollar-cost report (§2 — no price source of truth exists on this machine; a $ figure
  would be simulated data, which is banned),
- cross-repo (ruling R4, verbatim: *"Per-repo scoping everywhere. Each repo gets its own
  analytics / contracts / everything. Cross-repo is out of scope for now."*),
- live/streaming (no polling, no timers; idle = zero moving pixels, design law §D),
- a writer: everything under `~/.claude` is **READ-ONLY** to novakai (same rule
  `tools/novakai/audit/audit-run.mjs` already enforces in its header).

"Per project" in the vision-record table (row 7: *"spend on agents, cost per project /
per contract"*) resolves to **per repo**: no distinct "project" entity exists anywhere
in the tooling (no id field, no artifact) — R4's per-repo unit and the plan
(`public/plan.json`) are the only real scopes. This spec uses repo and contract; a
"project" dimension is not invented.

## 1. The data source — what spend data actually exists (verified on disk)

The only per-repo, per-session, per-model token record on this machine is the Claude
Code transcript store:

```
~/.claude/projects/<encoded-cwd>/            one dir per checkout; name = cwd with '/'→'-'
  <root-session-uuid>.jsonl                  one per top-level session
  <root-session-uuid>/
    subagents/agent-<agentId>.jsonl          one per spawned subagent
    subagents/agent-<agentId>.meta.json      { agentType, description, toolUseId, spawnDepth }
```

Fields (verified against real transcripts; identical to what
`tools/novakai/audit/audit-run.mjs` — PR #57 — already parses):

| field | on which lines | used for |
|---|---|---|
| `sessionId` | every line | session grouping — **in-file, never by filename** (a subagent transcript can be filed under a foreign session's dir on resume/fork; audit-run's `discoverTranscripts()` establishes this rule) |
| `cwd` | every line | repo + contract attribution (§4) |
| `gitBranch` | every line | display only (orchestrate worktrees are detached-HEAD, so branch is not a reliable join key) |
| `timestamp` (ISO) | every line | session start/end, per-day rollup |
| `isSidechain` + `agentId` | subagent lines | per-agent split; joins to `agent-<agentId>.meta.json` for `agentType` |
| `message.model` | `type:"assistant"` lines | per-model rollup (root and subagents genuinely differ, e.g. lead on one model, builders on another) |
| `message.usage` | `type:"assistant"` lines | the tokens: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens` |
| `message.id` | `type:"assistant"` lines | **dedupe key** — usage repeats identically across streamed partial lines of one message; summing without dedupe inflates (audit-run's `tokensOf()` documents and handles this) |

Prior art is binding: `tools/novakai/audit/audit-run.mjs` (script `novakai:audit-run`)
already implements single-session forensics over exactly this substrate. K10's extractor
(§3) generalizes its extraction across **all** sessions of this repo instead of one
`--session <uuid>`, and must agree with it numerically (§3, conformance check).

Sources considered and rejected:
- `~/.claude/stats-cache.json` — global per-user rollup, **no repo dimension**; useless
  for R4 scoping. Also its per-model `costUSD` is 0 for every model (verified), which is
  the direct evidence for §2.
- `~/.claude/telemetry/` — failed-to-send internal product events; neither complete nor
  a ledger.
- `docs/novakai/metrics/session-log.jsonl` (`novakai:metrics`) — gate/quiz/ship
  compliance events, a different metric family; not token spend. Not rendered by K10.

## 2. What "spend" means (pinned)

**Spend = token counts, per model.** Four counters plus one derived figure, adopting
`audit-run.mjs`'s existing definitions verbatim so the two tools can never disagree on
semantics:

- `input` — `usage.input_tokens`
- `output` — `usage.output_tokens`
- `cacheCreation` — `usage.cache_creation_input_tokens`
- `cacheRead` — `usage.cache_read_input_tokens`
- `bill = input + output + cacheCreation` (cacheRead displayed but excluded, matching
  audit-run — cache re-reads are the cheap tier)

**No dollar figures.** There is no source of truth for price on this machine: transcripts
carry no cost field, `stats-cache.json`'s `costUSD` is unpopulated, and the repo contains
no price table. A hand-typed $/Mtok table would be exactly the simulated data the
manifest bans. When a real machine-readable price source exists, dollars become a new
column in a `spendVersion` bump — until then the tab says tokens and means it.

## 3. The extractor — `npm run novakai:spend` → `public/spend.json`

**THE declared boundary contract of this tab.** A Node CLI
(`tools/novakai/analytics/spend.mjs`, script `"novakai:spend"`) scans the transcript
store and writes the derived artifact the tab renders. This resolves the access gap
explicitly: **no K2 probe covers a browser reading `~/.claude`** — probe-files proved
only user-picked directories via `showDirectoryPicker`, not an implicit fixed home path.
So the browser never reads `~/.claude`; a Node tool derives, the tab renders — the same
real-artifact pattern probe-contracts-render proved for K4, and the same
serve-from-`public/` pattern as `bodies.json` (which is also gitignored and
regenerated; `public/spend.json` gets the identical `.gitignore` treatment — it is
machine-local usage data and must never be committed).

Extractor rules (each is a restatement of a verified fact from §1):
1. Group lines by in-file `sessionId` across every `.jsonl` under the repo's project
   dir(s) — never by filename.
2. Dedupe usage by `message.id` before summing; first usage seen per id wins.
3. Split per agent: lines without `agentId` are the lead; each `agentId` is one
   subagent, `agentType` from its `.meta.json` sidecar when present.
4. Per-model: keyed by `message.model` per assistant message (an agent's messages can
   in principle span models; keying per message, not per transcript, is the honest sum).
5. READ-ONLY under `~/.claude` — the extractor never writes there.
6. Deterministic given the transcript set: same files in, same JSON out (stable sort by
   `sessionId`; `generatedAtIso` is the single timestamp field and lives outside the
   sorted data).

**Numeric conformance check (A3 pattern — two parsers must provably agree):**
`tools/novakai/analytics/spend.test.mjs` (a `node --test` file) picks one real session
present on the machine, runs `novakai:audit-run --session <id> --json` and compares its
combined token totals against the same session's entry in the extractor's output —
exact equality or the test fails. Two independent readers of the same substrate are
never allowed to disagree silently. (If the machine has no transcripts at all, the test
skips with an explicit `SKIP: no transcript store` — a skip is visible, not a silent
pass.)

**Artifact shape** (`spendVersion: 1`):

```json
{
  "spendVersion": 1,
  "generatedAtIso": "2026-07-07T…",
  "repoRoot": "/Users/…/novakai",
  "projectDirs": ["~/.claude/projects/-Users-…-novakai", "…orchestrate worktree dirs…"],
  "sessions": [
    {
      "sessionId": "uuid",
      "startedAtIso": "…", "endedAtIso": "…",
      "cwd": "/Users/…", "gitBranch": "main",
      "contractId": "fit-clamp",
      "agents": [
        { "agentId": null, "agentType": "lead", "models": { "<model-id>": { "input": 0, "output": 0, "cacheCreation": 0, "cacheRead": 0, "bill": 0 } } },
        { "agentId": "a07…", "agentType": "general-purpose", "models": { "…": { } } }
      ],
      "totals": { "input": 0, "output": 0, "cacheCreation": 0, "cacheRead": 0, "bill": 0 }
    }
  ]
}
```

The artifact holds **facts only** (sessions, agents, per-model counters, attribution).
All rollups — by model, by contract, by day, repo totals — are computed in the tab's
pure model module (§6) from `sessions`, mirroring the K5 split (pure model / DOM render
/ factory) and keeping the rollup logic unit-testable in Node without a browser.

## 4. Attribution — per-repo and per-contract, verifiably or not at all

**Per-repo scope** = the project dirs whose transcripts belong to this checkout:
1. the dir whose decoded name is the current repo root (audit-run's own
   `PROJECT_DIR` construction, generalized from its hardcoded path to `process.cwd()`), and
2. the orchestrate worktree dirs: `novakai:orchestrate` provisions each change's
   isolated worktree at `join(tmpdir(), 'novakai-orchestrate-wt-' + sha256hex(ROOT).slice(0, 12), changeId)`
   (verbatim from `orchestrate.mjs`). The sha ties those dirs to **this** repo root
   deterministically — so their project dirs are in scope, and their transcripts are
   this repo's spend.

Sibling manual worktrees (e.g. lane checkouts like `../novakai-k10`) get their own
project dirs and are **out of scope in v1** — each checkout is its own R4 unit. The
extractor logs which project dirs it scanned into `projectDirs` so the scope is always
inspectable, never implied. (Ceiling noted: collapsing lane worktrees into the parent
repo needs a repo-identity ruling — deferred, not designed away.)

**Per-contract attribution** — the join must be code-backed or absent:
- A session whose `cwd` sits under the orchestrate worktree base for this repo has its
  change id **in the path** (`…-wt-<sha12>/<changeId>`): `contractId = <changeId>`.
  This is machine-proven — the id was put there by `orchestrate.mjs`, and the
  `CONTRACT.json` orchestrate writes into each worktree corroborates it.
- Every other session: `contractId = null` → rendered in the **unattributed** bucket,
  dim (`--ink-dim`), per the two-actor law's "unproven = dim/hollow". Never guessed
  from timestamps, branch names, or prose.

`contractId` values join to `changes[].id` in `public/plan.json` — the same key
`novakai:contract` / `verify-change` / the Contracts tab already key on, so Analytics
and Contracts can cross-link on a shared, real id (K4 seam, not duplicated data).

## 5. The page — a spend ledger under the design law

Layout top to bottom (eyebrow `NOVAKAI · ANALYTICS`, literal title `Agent spend`, no
taglines — decisions §1.9, §8.1):

1. **One plain sentence first** (design-law §C review-grammar): e.g.
   `Agents spent 41.2M tokens in this repo — 38 sessions, 3 attributed to contracts.`
   Human-readable prose in system-ui; every numeral inside it mono is overkill — the
   sentence is prose, the ledger beneath carries the machine numerals.
2. **Totals ledger** — repo totals as 20px mono `tabular-nums` numerals (input · output
   · cacheCreation · cacheRead · bill), labels in 11px dim mono. Mid-dot separators,
   real `−` (U+2212) if a delta ever renders.
3. **By model** — one ledger table: model id (mono), the five counters. Sorted by bill
   desc.
4. **By contract** — one table: `contractId` (mono, linking intent: same id the
   Contracts tab shows), sessions count, bill; final row **unattributed** in
   `--ink-dim`. Attribution chips (if any) follow anti-capsule chip grammar (5px
   radius, never oval — decisions §8.2).
5. **By day** — the only chart: a **hairline spark** of daily bill. 1px polyline +
   1.5px dots in ink tones (`--ink-dim` line, `--ink` dots), no area fill, no axis
   chrome beyond two dim mono labels (first/last date). This is dots-seams-glyphs
   territory (§A: *"Green/amber never fill an area; dots, seams, and glyphs only"*) —
   and satisfies the <5% saturated-pixels screenshot rule trivially because it uses no
   saturated hue at all.
6. **Sessions** — table: start date (mono), models (mono), agents count, bill, contract
   id or dim `—`. Sorted newest first.

Bans honored: **no progress bars, no percentages-as-meters, no gauges, no pie/filled
bars, no spinners** (decisions §3.4/§3.9 — "rejected forever"). No new hues: this page
is almost entirely ink tones; teal/periwinkle/green/amber appear only where §8 says.
Elevation via tone steps + hairlines, zero new drop shadows (the app's single shadow
stays spent on the selected canvas node). Motion: content appears with the house
easing/durations on route-in only; idle = zero moving pixels. Numbers format with a
thin-space or none — never locale commas in mono ledgers; `41 203 114` or `41.2M` per
design-time choice, `font-variant-numeric: tabular-nums` always.

A `generated <iso> · npm run novakai:spend` footer line in faint mono states the
artifact's freshness and the command that regenerates it — plain language first,
technical layer one glance deep (decisions §1.8). Refresh is a re-run of the command +
in-page reload of the artifact via an explicit button-shaped action; no auto-polling.

## 6. Module breakdown

House architecture, K5's proven split, all under `src/ide/` (K11 BLOCK-tier limits
apply: file ≤ 500 lines, function ≤ 60, complexity ≤ 15, params ≤ 4, depth ≤ 4 — the
three-module split exists to stay under them):

- **`src/ide/analytics-model.ts`** — pure, DOM-free: the `SpendFile` / `SessionSpend`
  types mirroring §3's shape; rollup functions (`rollupByModel`, `rollupByContract`,
  `rollupByDay`, `repoTotals`); formatters (`fmtTokens`). Unit-tested in Node.
- **`src/ide/analytics-render.ts`** — DOM builders: the sentence, the ledgers, the
  tables, the SVG spark. Pure functions of model output → elements; no fetch, no state.
- **`src/ide/analytics.ts`** — the factory `initAnalytics(ctx, deps)`: owns page state
  (`loading | missing | loaded(SpendFile) | error`), fetches `/spend.json` on mount,
  renders via the render module, exposes the page API the shell's page host mounts.
  State-machine rendering only (decisions §4.1): events mutate state, one render
  function paints it.
- **`css/analytics.css`** — the per-tab stylesheet, imported by `analytics.ts` (Vite
  handles CSS imports). `css/styles.css` is never touched.
- **`src/ide/analytics.novakai.mmd`** — the map fragment(s) covering the three modules,
  like `design.novakai.mmd` does for K5; `novakai:ship` re-syncs.
- **`tools/novakai/analytics/spend.mjs`** + **`spend.test.mjs`** — the extractor and its
  conformance test (§3). Tooling, not app runtime; joins the tooling map like every
  other `tools/` module (I1 gate).

Public API (final signatures belong to the map, not this prose — this pins the shape):

```ts
export function initAnalytics(ctx: AppContext, deps: AnalyticsDeps): AnalyticsApi
// AnalyticsApi: { mount(host: HTMLElement): void }  — the page-host contract the shell expects
// AnalyticsDeps: {} in v1 — Analytics reads an artifact, it needs no other module's hooks yet
```

Cross-module calls, if any ever appear (e.g. "open this contract in the Contracts tab"),
go through `ctx.hooks` — never a direct import (invariant 2).

## 7. Wiring

The seam PR (frozen files, owned by the orchestrator) already gives `main.ts` an
`initAnalytics` stub call and the shell a route for `analytics`. K10 fills the stub's
target **in its own module files only**. Frozen and untouched by this lane:
`src/main.ts`, `src/ide/shell.ts`, `src/ide/pages.ts`, `css/styles.css`,
`docs/novakai/ide-roadmap.json`, `docs/novakai/SESSION_HANDOFF.md`.

`pages.ts` currently carries the placeholder empty-state row
`analytics — per-repo metrics · K10` (SPEC_SHELL §7 marks line-2 strings as
*"placeholders each owning phase finalizes"*). **K10 pins the final command:
`npm run novakai:spend`.** Because `pages.ts` is frozen for this lane, the pinned string
ships inside the tab's own data-missing state (§5/§9) — once the tab is functional, the
shell's static empty state no longer renders for `analytics`, so the placeholder row is
superseded rather than edited. If the orchestrator prefers the `pages.ts` row updated to
match, that is a one-string orchestrator edit; the spec's pin is the authority either way.

## 8. Two-actor colour law compliance

The most-protected rule (decisions §3.2). Analytics is a machine-fact surface — almost
everything on it is machine-emitted, so almost everything is **mono + ink tones**, and
saturation stays near zero (well inside the <5% screenshot rule):

| surface | treatment | why |
|---|---|---|
| all token numerals, model ids, session ids, dates | mono, `--ink` / `--ink-dim`, tabular-nums | machine-emitted = mono; counts are facts, not verdicts — no hue |
| `contractId` on an attributed row | mono with a teal (`--edge-sel`) glyph/seam accent — a dot or hairline, never a fill | the attribution is machine-proven (path constructed by `orchestrate.mjs`); teal marks machine-proven, glyphs-not-areas |
| unattributed bucket / missing values | `--ink-dim`, hollow `—` | unproven = dim/hollow |
| the one plain sentence | system-ui, `--ink` | human-readable prose layer |
| refresh action | standard periwinkle (`--accent`) focus/interaction states only | the human's hue belongs to human action surfaces |
| green (`--proven`) / amber (`--attested`) | **absent** | no gate verdict and no pending-human state exists on this page; using them would dilute their meaning |

## 9. Empty / missing states (finalizing the SPEC_SHELL placeholder)

Empty-state grammar is BINDING (SPEC_SHELL §7): one dim mono line + one fainter command
line; no spinner, no illustration, no "coming soon".

- **`spend.json` absent (404)** — line 1: `agent spend per contract, per project`;
  line 2 (`.empty-cmd`): `npm run novakai:spend`. This is the pinned final command.
- **artifact present, zero sessions** — the honest ledger: the plain sentence states
  `No agent sessions recorded for this repo yet.` with the same command footer. Zero is
  data, not an empty state.
- **artifact present, wrong `spendVersion`** — one dim mono line naming the mismatch
  and the regenerate command. Never render numbers from a shape this spec doesn't pin.
- **fetch/parse error** — one dim mono line with the error class + the command. No toast
  (toasts for errors are not in the empty-state grammar; §3.9's rejected-forever list
  keeps this page quiet).

## 10. The K6 soft-gate — what changes when SPEC_AGENTS.md lands

K10's intent says data-source design follows the Agents tab "since it measures their
runs". As of this spec's writing, no `k6/*` branch exists on origin (verify:
`git ls-remote origin 'refs/heads/k6/*'` — empty). The dependency resolves cleanly
because the substrate is independent of K6: **Claude Code writes the transcript store
whether it runs in the K6 terminal, a plain terminal, or an orchestrate worktree.** K6
changes *where agents run*, not *what they record.* So:

- Everything in §1–§5 stands regardless of K6's design.
- When `SPEC_AGENTS.md` lands: if it pins a run-record artifact richer than the
  transcript (e.g. an explicit session↔contract mapping emitted at spawn), Analytics
  **adopts it as an additional attribution source** in `analytics-model.ts` —
  additive (fewer unattributed sessions), never a `spendVersion` break. The K10 build
  phase re-reads `SPEC_AGENTS.md` before starting and records in its PR whether an
  adoption hook was added or explicitly deferred.

## 11. What K10 explicitly does NOT do (deferred, not designed away)

- **Dollar cost** — until a real machine-readable price source exists (§2).
- **Cross-repo rollups** — R4. Includes lane-worktree collapse (§4 ceiling).
- **Live/streaming spend** — no polling, no timers, no PTY-bridge consumption; a future
  live view would ride K6's bridge and gets its own design round.
- **`stats-cache.json` / telemetry rendering** — wrong scope, wrong family (§1).
- **Filtering/search UI, date-range pickers** — v1 renders the whole per-repo ledger;
  interaction grows only when real use demands it.
- **Editing anything** — the tab is a pure reader; the extractor is READ-ONLY under
  `~/.claude` and writes only `public/spend.json`.
- **A "project" entity** — per-repo and per-contract are the real scopes (§0).

## 12. Acceptance criteria

Machine-checkable at build time (these are the hardened predicates the build PR
proposes for `docs/novakai/ide-roadmap.json` — that file is frozen for this lane, so
editing it is the orchestrator's explicit act, per the master-plan rule that each
phase's spec hardens its own predicates):

1. `file` — `docs/ide-vision/SPEC_ANALYTICS.md` (this document).
2. `grep` — `initAnalytics` in `src/main.ts` (the seam, filled).
3. `grep` — `export function initAnalytics` in `src/ide/analytics.ts`.
4. `file` — `src/ide/analytics-model.ts`, `src/ide/analytics-render.ts`,
   `css/analytics.css`, `src/ide/analytics.novakai.mmd`.
5. `grep` — `"novakai:spend"` in `package.json`; `file` —
   `tools/novakai/analytics/spend.mjs`.
6. `cmd` — `node --test tools/novakai/analytics/spend.test.mjs` (the audit-run numeric
   conformance check, §3 — exits 0, with visible SKIP only when no transcript store
   exists).
7. `cmd` — `node --test` on the analytics-model rollup unit tests.
8. `grep` — `public/spend.json` in `.gitignore` (the artifact is machine-local, never
   committed).
9. Manual — Chromium render check per the house acceptance pattern: real browser, the
   tab renders real extractor output with zero console/page errors; empty-state renders
   per §9 when `spend.json` is absent; two-actor colour law visually checked (§8).
10. The J1 regression net and `npm run novakai:verify:full` stay green; `npm run
    novakai:ship` re-syncs the map (fragments in §6); the tooling map gate (I1) covers
    `tools/novakai/analytics/`.

Delivery is proven the house way: a fresh 0-context agent re-proves from command output
alone — never from the builder's account.
