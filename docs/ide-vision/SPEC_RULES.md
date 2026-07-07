# SPEC_RULES — K9, the Rules tab

> **What K9 is.** The Rules tab renders and edits the organisational ruleset the novakai gates
> actually consume — THE artifacts on disk, never a parallel copy that can drift
> (`IDE_MASTER_PLAN.md` K9; `docs/novakai/ide-roadmap.json` item K9).
>
> **What is BINDING here and what is a design choice.** Binding on this spec: the K9 law itself
> ("renders and edits the rules the contract gates actually consume — never a parallel copy"),
> the real-artifacts-only rule (PROTO_MANIFEST §4 — no simulated data, ever), the two-actor
> colour law (KEY_DECISIONS §3.2), the empty-state grammar (PROTO_MANIFEST §2 "designed empty
> state: one dim mono line"), and K11 BLOCK-tier lint on every file under `src/ide/**`
> (`eslint.config.js:76-90`). The prototype has **zero Rules coverage** — the manifest's three
> screens are Canvas/Prototypes/Builds (`PROTO_MANIFEST.md` §1), so everything else in this
> spec is a design choice this spec makes, traced against the real gate sources below.

## §0 — What K9 is and is not

K9 **is**:
- A live, read-from-disk view of every rule artifact the gates consume, grouped by the gate
  that consumes it, each carrying the exact command that consumes it.
- An editor for the artifacts that are genuinely runtime-read config (§1 category A) — writes
  go to THE file on disk, and the UI re-renders from a re-read of that file, never from the
  in-memory draft.
- A display-only "law lives in source" section for gate rules that are hardcoded constants in
  `.mjs` source (§1 category B) — shown with their `file:line` so nobody mistakes them for
  config, rendered in unproven grey.

K9 **is not**:
- An editor for `public/plan.json`. Plan/contract data (acceptance cases, `outOfScope`,
  `dependsOn`, `fm`) is per-change work-order content owned by the plan/Contracts plane (K4
  renders it; C2/H2 author it). Rules is the *organisational* ruleset, not the work orders.
- An editor for `.claude/settings.json`. The hook wiring (which gate fires on which tool event)
  is rendered read-only; a tab that can silently unbind its own enforcement is a foot-gun, not
  a feature.
- A rule *runner*. The tab never executes a gate; it shows the command (house law: plain
  language + the command). Running commands is the Agents tab's job (K6).
- A rules store. There is **no localStorage copy of any rule, ever** — unlike Design (K5),
  whose record is its own new data, every K9 datum already lives in a repo file; caching it
  browser-side would be exactly the parallel copy the K9 law bans.

## §1 — The ruleset inventory, by source inspection (what the gates actually consume)

This section is the spec's foundation: every row below was verified against the source at the
cited line. The gates read two kinds of rule input — **category A: runtime-read artifacts**
(editable files a gate opens when it runs) and **category B: hardcoded law** (constants in
`.mjs` source; changing them is a code change, not a config edit).

### Category A — runtime-read rule artifacts (render + edit)

| artifact | consumed by | evidence | consuming command |
|---|---|---|---|
| `eslint.config.js` — `readabilityRules` thresholds (`eslint.config.js:11-25`), BLOCK tier via `asError` on glob `src/ide/**/*.ts` (`:29-32`, `:72-90`) | ESLint itself; parity + behaviour locked by `tools/novakai/verify/standards-parity.test.mjs` | `package.json:67` `"lint": "eslint src tools"` | `npm run lint` |
| `docs/CODING_STANDARDS.md` — the rule table (`:21-34`), tier model (`:8-16`) | `standards-parity.test.mjs` parses the doc table and imports the live config; asserts name parity (`:62`), value parity (`:65-72`), tier parity (`:74-84`), the ratchet invariant (`:89`) and real ESLint severities (`:93-109`) | in `spec:test:all` (`package.json:25`); `gate-parity.test.mjs` asserts CI runs that one suite verbatim | `npm run spec:test:all` |
| `docs/novakai/curation-allowlist.txt` | symbol-completeness gate | `tools/novakai/verify/exports-coverage.mjs:42`; wired `package.json:14` | `npm run novakai:exports` |
| `docs/novakai/edge-advisory-allowlist.txt` | edge-verification gate (A5) | `tools/novakai/verify/edge-verify.mjs:279` | `npm run novakai:edges` |
| `docs/novakai/status-ban-allowlist.txt` | prose-status ban audit | `package.json:60` (`roadmap.mjs --audit-tree docs --allow …`) | `npm run novakai:roadmap:audit` |
| `docs/novakai/tooling-curation-allowlist.txt` | tooling self-map gate (I1) | `tools/novakai/verify/tooling-coverage.mjs:37` | `npm run novakai:tooling:verify` |

**Editable in K9 v1: exactly the six files above.** The K11 pair is the flagship (it is the
"organisational ruleset enforced on each contract" — BLOCK-tier lint fails the CI every
contract's PR runs); the four allowlists are the audited-exception rules the map gates consume.

### Category A′ — runtime-read, rendered but **not** editable in v1

| artifact | consumed by | why render-only |
|---|---|---|
| `docs/novakai/roadmap.json`, `ide-roadmap.json`, `mvp-roadmap.json`, `audit/audit-roadmap.json` — file/grep/cmd/manual predicates | `tools/novakai/status/roadmap.mjs:138-175` (`runCheck`), scripts at `package.json:53,58,59` and `novakai:audit` | Definitions of done-ness, edited rarely and under test lock (`roadmap.test.mjs` pins roadmap.json to zero missing items); an in-tab edit can break the build in ways the tab cannot foresee. Rendered with predicates expanded; **OPEN (Chris ruling): promote to editable in a later slice?** |
| `.claude/settings.json` — the hooks block (which gate binds to which tool event) | the Claude Code harness | Self-disarming risk (§0). Rendered as a wiring table, read-only. |
| `.github/workflows/spec-gate.yml` — the CI enforcement wiring: which gates run on every PR (`npm run spec:test:all` at `:31`, `npm run lint` at `:37`, the map gates below them) | GitHub Actions | Same reasoning as the hooks block — this is the surface that enforces the ruleset on each contract's PR; editing it in-tab is self-disarming. Rendered as a step list, read-only. |

### Category B — hardcoded law (display-only, with `file:line`)

| rule | where it lives |
|---|---|
| turn-gate batching threshold `THRESHOLD = 4` | `tools/novakai/gates/turn-gate.mjs:125` |
| contract-spawn sentinel + near-miss regexes | `tools/novakai/gates/contract-gate.mjs:48-52` |
| map-linter flat-map floor `FLAT_FAIL_MIN_NODES = 8` (no config file at all) | `tools/novakai/verify/novakai-lint.mjs:19` |
| verify-change verdict fold (PASS / PASS_UNPROVEN / FAIL, `--strict`) | `tools/novakai/contract/verify-change.mjs:99-105` |
| contract slice-completeness gate (exit 4 on undeclared callee) | `tools/novakai/contract/contract.mjs:140-161` |
| prose-status `BANNED` regexes | `tools/novakai/status/roadmap.mjs:54-59` |

Each is rendered as one row — rule, the cited source lines, `file:line` — under the heading
"law lives in source; changing it is a code change". Unproven grey (§8). The tab reads these
**from the real `.mjs` text at render time** (same `?raw` read path as everything else) and
renders the cited line-range slice of that text verbatim — no per-rule value extractors for
read-only rows; the sliced source IS the display. Quoting them any other way would be a
hand-copied parallel value, which is the drift the K9 law exists to kill.

### The K9 trap this inventory exposes

`docs/CODING_STANDARDS.md` is **not** the source of truth for thresholds —
`eslint.config.js:11-25` is; the doc is a parity-checked mirror (the build fails if they
disagree). A Rules tab that let you edit the doc table alone would manufacture drift the
moment you clicked save. Therefore the K11 pair is edited as **one unit**: a single structured
model writes both files in lockstep (§4), mirroring exactly what `standards-parity.test.mjs`
enforces.

## §2 — Render form: the rules document

One scrollable document (same certificate-document spirit as Contracts, K4), four sections in
this order:

1. **Coding standards (K11)** — the flagship card. A grid of the ten rules: rule name, ESLint
   id (mono), threshold (or "—"), tier chips `WARN` / `BLOCK (src/ide)`. Everything shown is
   parsed from the real pair at render time — thresholds and ids from `eslint.config.js`,
   labels from the doc's rule table (§3, §6) — never a table typed into the tab's source.
   Beneath the grid, the consuming commands: `npm run lint` · `npm run spec:test:all`.
2. **Audited exceptions (the allowlists)** — four cards, one per file. Each renders the real
   lines (`symbol-or-edge  # reason` format), its consumer path, and its consuming command.
3. **Done-ness predicates (roadmaps)** — read-only. Per roadmap file: item id, title, and its
   checks rendered as `kind · target` rows (grep pattern, file path, cmd line, manual note).
4. **Law in source** — the category B table (§1), read-only, grey.

Grammar: plain language first, tech one click deep (manifest §2 `:86`) — each card leads with
one plain sentence ("these thresholds fail the build for new IDE code"), the `file:line` and
raw content behind a disclosure. Titles literal-descriptive, mono+sans only, 9px radius,
squared chips — house typography and depth law throughout.

## §3 — Read path: the file on disk is the only source

- **First render:** `import.meta.glob` with `{ query: '?raw', import: 'default' }` over the
  pinned artifact paths (all category A/A′/B files). Root-relative to the Vite project root,
  so the dev server streams THE repo files; nothing is copied into the tab's source or any
  store. (In a production build these would be baked at build time — irrelevant in practice:
  the IDE's own direction is dev-mode serving, the same Vite process the K2 PTY probe bridges;
  `PROBES.md` probe-terminal.) Freshness honesty: this bootstrap read resolves through Vite's
  dev-server module graph, which may serve a cached transform until HMR invalidates it — so
  pre-connect renders are as fresh as the module graph, not guaranteed byte-fresh against
  out-of-band edits. Byte-fresh reads are a post-connect property (next bullet).
- **After the tab has a repo handle** (first save, §4): reads switch to the File System Access
  handle (`getFileHandle(...).getFile().text()`), which is uncached and byte-fresh — covering
  out-of-band edits too. The `?raw` path is only ever the pre-handle bootstrap.
- **Re-read on every rules-page entry** (the shell rebuilds pages on route entry — SPEC_SHELL
  §5); no rule text survives in module state between entries. (Pre-connect, "re-read" means
  re-resolving through the module graph per the freshness note above; post-connect it is a
  true disk read.)

## §4 — Edit UX and write path

### Edit UX — two forms, per artifact kind

- **Structured grid for the K11 pair** (the only structured editor in v1). The user edits a
  threshold number or nothing else — rule names, ids, and tier structure are not editable in
  the grid (adding/removing a rule or moving a glob is a code-shaped change; raw editing and
  the parity test cover it). One edit produces **two** file writes in lockstep:
  - `eslint.config.js` — anchored replace on the rule's value inside the `readabilityRules`
    literal (`:11-25`). Three anchor forms, matching the three shapes the real config uses:
    array form — the rule id string through its severity (e.g.
    `"sonarjs/cognitive-complexity": ["warn", `) with the number that follows; object-`max`
    form (`max-lines-per-function`, `max-lines`: `["warn", { max: N, … }]`) — the `max:` key
    scoped to that rule's entry (from its id string to the entry's closing bracket); and
    object-`min` form (`id-length`: `["warn", { min: N, … }]`) — the `min:` key, same
    scoping. Each anchor must match **exactly once** within its scope or the save is refused.
  - `docs/CODING_STANDARDS.md` — anchored replace of the same rule's Threshold cell in the
    rule-table row (`:21-34`), same exactly-once discipline.
  Both anchors are validated up-front, before either write; if either fails (file drifted
  from the shape this spec pinned), nothing is written and the file is shown raw. The two
  disk writes themselves are per-file (FSA has no cross-file transaction): if the second
  write throws after the first landed, the both-files re-read that follows every save (§5)
  renders the card in a **parity-broken** state naming `npm run spec:test:all` — and that CI
  parity test, not the tab, is the enforcement backstop for the pair.
  <!-- ponytail: anchored text surgery, not a JS/AST rewriter — the parity test in CI is the
       backstop if surgery and reality ever disagree; upgrade to AST editing only if rules
       become structural, not numeric. -->
- **Raw editor for the allowlists.** The artifact IS the UI: a mono textarea of the real
  lines. Validation before write mirrors **what each consumer actually parses** — the four
  files are not one format, and the tab must not invent a stricter rule than the gate reads:
  - `curation-allowlist.txt`: non-comment lines are `<path>#<symbol>` **or** a bare
    `<symbol>` — the consumer accepts both (`exports-coverage.mjs:102-107` routes bare lines
    to `allowBare`) — optionally followed by `# reason`.
  - `status-ban-allowlist.txt`: `<path>` optionally followed by `# reason`, per its header.
  - `edge-advisory-allowlist.txt`: bare `<from>-><to>` lines (its consumer `edge-verify.mjs`
    and its own writer at `edge-verify.mjs:323` emit bare keys; reasons live in comment
    blocks, not inline).
  - `tooling-curation-allowlist.txt`: one `tools/**` path per line, comments allowed.

### Write path — File System Access API, behind one seam

- Probe-proven: `PROBES.md` probe-files PASS (write to real disk from the browser, verified on
  disk).
- **First save anywhere:** `showDirectoryPicker()` once for the repo root. Guard at the trust
  boundary: the tab reads `package.json` through the picked handle and refuses the connection
  unless `name` matches this repo — a write into the wrong directory is worse than no write.
- Thereafter: per-file `getFileHandle(path)` → `createWritable()` → write → close. The handle
  lives for the session only (no persisted handles in v1).
- **After every save: the tab re-reads BOTH files of a paired write (or the single file
  otherwise) through the handle and re-renders from the re-read bytes.** What you see after
  save is what the gate will read, proven by a fresh read — never the draft you typed.
- All disk access goes through one module-local seam, `RulesDisk` (§6). **K7 ordering,
  stated honestly:** K7 (Files, repo scoping) and K9 are parallel Round-2 lanes; merge order
  is not guaranteed despite the roadmap listing K7 first. The seam is the contract either
  way — at K9 build time, if K7's repo handle is already on `main`, `RulesDisk` consumes it
  and the tab-local picker above is **never built**; if not, the picker ships and K7 later
  replaces it behind the same interface. The pages, model, and proof chain are identical in
  both worlds.

## §5 — How an edit provably reaches the gate

Four links, each verifiable, no trust required:

1. **Same path.** The file the tab writes is byte-for-byte the path the gate opens — §1's
   table ties every artifact to the consuming line of gate source. There is no intermediate
   store to drift in.
2. **Re-read render.** Post-save UI state comes from a fresh read of the file (§4), so the
   screen shows disk truth, not intent.
3. **The command on the card.** Every card carries its consuming command (§1 last column).
   The human (or an agent in the K6 terminal) runs it; the gate's own output is the verdict.
   The tab never simulates that verdict — no green anywhere in this tab (§8).
4. **CI backstop.** The parity test (`standards-parity.test.mjs`, in `spec:test:all` — the
   suite `gate-parity.test.mjs` pins CI to) fails the build if the K11 pair ever disagrees —
   including a disagreement introduced through this tab. The tab's lockstep write (§4) is
   designed to satisfy the same invariant the test enforces; the test remains the enforcement.

Acceptance pins links 1 and 4 end-to-end (§10, checks 6-7): a scripted edit through the tab's
own **model** lands on disk such that the real consuming command, run against that tree,
reports the new value. Stated honestly: those checks exercise the pure model + node `fs`, not
`RulesDisk` — the FSA write path's native picker cannot be scripted in CI, so it rests on the
probe (`PROBES.md` probe-files PASS) and on `RulesDisk` staying thin (~90 lines, §6) so the
CI-unreachable surface is minimal.

## §6 — Module breakdown

| file | responsibility | rough size |
|---|---|---|
| `src/ide/rules.ts` | `initRules` factory; page assembly; section cards; edit/save flow wiring | ~200 lines |
| `src/ide/rules-model.ts` | pure: the artifact registry (§1 as data — path, consumer, command, category); K11 parse (extract the ten thresholds/tiers from real config text); anchored-replace writers for the pair; allowlist line validation | ~180 lines |
| `src/ide/rules-disk.ts` | the `RulesDisk` seam: `?raw` bootstrap reads; FSA connect (with repo guard), read, write | ~90 lines |
| `src/ide/rules.css` | the tab's styles, imported by `rules.ts` (Round-2 lane law: per-tab CSS file; `css/styles.css` is frozen for this lane) | ~120 lines |

Every `.ts` file ships a sibling `.novakai.mmd` fragment (scaffolded via
`tools/buildspec/scaffold.mjs --init`) so the symbol-completeness gate stays green, and every
file is under `src/ide/**` — K11 BLOCK tier applies in full to the three `.ts` modules (the
lint glob is `src/ide/**/*.ts`, `eslint.config.js:77`; `rules.css` is not lint surface).

**Public API** (house shape — same as `initDesign`, SPEC_DESIGN §2):

```ts
// rules.ts
export function initRules(ctx: AppContext): RulesApi;

export interface RulesApi {
  render(): HTMLElement;   // the shell calls this on route entry; fresh reads each time
}

// rules-model.ts (pure, no DOM, no disk)
export interface RuleArtifact {
  path: string;                    // repo-relative, THE file the gate reads
  title: string;
  category: 'editable' | 'render-only' | 'law-in-source';
  consumer: string;                // gate source path:line, rendered on the card
  command: string;                 // the consuming command, rendered on the card
}
export interface StandardsRule {
  label: string;                   // "Cognitive complexity" — from the doc table's Rule cell
  eslintId: string;                // "sonarjs/cognitive-complexity" — from the config
  threshold: number | null;        // null = threshold-free rule — from the config
}
// thresholds/ids from configText (the source of truth); labels from docText's
// rule table (the human-readable mirror). If the two files' rule-id sets
// disagree, parseStandards returns an error value and the card renders the
// parity-broken state (§4) with both files raw — never a partial grid.
export function parseStandards(
  configText: string, docText: string,
): StandardsRule[] | { error: string };
export function writeThreshold(
  configText: string, docText: string, eslintId: string, value: number,
): { configText: string; docText: string } | { error: string };  // exactly-once anchors or refuse
export type AllowlistKind = 'curation' | 'edge-advisory' | 'status-ban' | 'tooling-curation';
export function validateAllowlist(text: string, kind: AllowlistKind): string | null;
// per-kind line check (§4); error message or null

// rules-disk.ts
export interface RulesDisk {
  read(path: string): Promise<string>;
  connect(): Promise<string | null>;   // directory picker + repo guard; error message or null
  write(path: string, text: string): Promise<void>;  // throws before connect()
  connected(): boolean;
}
```

## §7 — Wiring

Identical pattern to K5 (SPEC_DESIGN §4, already merged): `main.ts` builds the page module and
passes its render function into the shell as a plain init dep —

```ts
const rules = initRules(ctx);
initShell(ctx, { …existing deps…, renderRules: rules.render });
```

The seam PR owns this diff plus the `pages.ts` empty-row removal (`src/main.ts`, `shell.ts`,
`pages.ts` are frozen for this lane); post-seam, this lane fills the `initRules` stub inside
its own `src/ide/rules*` files only. No `ctx.hooks` entry — there is no cycle to break; the
shell→page call is one-way (SPEC_DESIGN §4's `initNodes` precedent). No state in `ctx.state`:
the rules live on disk; the only module state is the session's directory handle inside
`RulesDisk`.

The shell's rules empty state (placeholder line 2 `npm run novakai:contract reads these · K9`,
SPEC_SHELL §7 — a wrong command for this tab's actual scope, see §0) simply disappears with
the seam: the row is replaced by the real page, so no pages.ts string edit is ever needed from
this lane.

## §8 — Two-actor colour law compliance (KEY_DECISIONS §3.2)

| element | hue (law name, KEY_DECISIONS §3.2) | tree token `rules.css` uses | why |
|---|---|---|---|
| rule values, paths, commands, raw file text | neutral text tones | `--ink` / `--ink-dim` | facts on a page, no claim being made |
| focused card / field, edit affordances | periwinkle #7c8cff (the human) | `var(--accent)` | the human's cursor — selection and judgment are the human's |
| dirty (edited, not yet saved) chip on a card | amber #d9a066 (attested/pending) | `var(--accent-2)` | a pending state: typed but not yet on disk |
| category B "law in source" section | unproven grey #565f6e | `var(--ink-faint)` | displayed claims about source constants, not machine-proven here |
| **teal** #4fe0cd (machine-proven) | **never** | `--edge-sel` banned | the tab makes no machine-proven claim — it renders files and defers proof to the gate commands |
| **green** #5fd0a0 (verdict) | **never** | no tree var exists; the reserved name `--proven` and the hex are both banned | green is a VERDICT; verdicts come from running the gate (K6/CLI), which this tab never does |

The law names (`--proven`, `--attested`, `--unproven`) are the manifest/KEY_DECISIONS
vocabulary; the **tree tokens** are the variables that actually exist
(`src/core/config/config.ts:146-149`), and their hexes vary per theme — so `rules.css` uses
`var(--…)` tokens only, never hex literals, and enforcement greps var names (§10 check 8).

Motion law: the single house easing `cubic-bezier(.22,1,.36,1)`, 120/240ms tiers only,
keyboard-instant honoured, zero idle animation. No new hues, no capsules, one radius.

## §9 — What K9 explicitly does NOT do (deferred, not designed away)

- No editing of roadmap predicate JSONs (rendered read-only; OPEN ruling in §1 A′).
- No editing of `.claude/settings.json`, `public/plan.json`, the map, or anything in §1-B.
- No gate execution, no rendered verdicts, no green.
- No persisted directory handles (IndexedDB handle persistence is a K7 concern).
- No rule history/versioning — git is the history.
- No cross-repo ruleset (R4: per-repo everything; the loaded repo is this repo until K7).
- No `ide-roadmap.json` predicate hardening from this lane (file frozen for this lane;
  hardened predicates below are handed to the orchestrator with the build PR).

## §10 — Acceptance criteria (each greppable/runnable)

1. `docs/ide-vision/SPEC_RULES.md` exists (ide-roadmap K9 check 1).
2. `git grep -n "export function initRules" src/ide/rules.ts` is non-empty, and
   `grep -n "initRules" src/main.ts` is non-empty (ide-roadmap K9 check 2; wiring by seam PR).
3. `npm run lint` exits 0 — all `src/ide/rules*` files pass K11 at BLOCK severity.
4. `npm run typecheck` exits 0.
5. **No parallel copy:** `git grep -nE "localStorage|sessionStorage" src/ide/rules.ts src/ide/rules-model.ts src/ide/rules-disk.ts` returns nothing, and no rule value or rule table appears as a literal in `src/ide/rules*.ts` — thresholds render only via `parseStandards` over real file text (verified by check 6's node test using the repo's real `eslint.config.js` as input).
6. **Model proof (node test, `src/ide/rules-model.test.ts` or tooling-side equivalent):**
   `parseStandards(<real eslint.config.js text>, <real CODING_STANDARDS.md text>)` returns
   exactly the ten rules with the values at `eslint.config.js:11-25` and the labels from the
   doc table; `writeThreshold` on the real pair — exercised on all three anchor forms (an
   array rule, an object-`max` rule, and the object-`min` rule `id-length`) — produces texts
   where (a) the new value parses back, (b) the doc
   table row shows the same value, (c) an anchor-broken input is refused with no partial
   output, and (d) a mismatched rule-id set returns the error value.
7. **Gate-consumes-the-edit proof:** a node test applies `writeThreshold` to the real repo
   pair (e.g. `max-params` 4→3), writes the result to a temp file, then runs **real ESLint**
   (`new ESLint({ overrideConfigFile: <temp config>, cwd: ROOT })`) over a fixture snippet
   with 4 parameters: violation reported with the edited config, none with the original.
   Builder note: the temp config must resolve its plugin imports (`typescript-eslint`,
   `eslint-plugin-sonarjs`) against the repo's `node_modules` — write it inside the repo tree
   (e.g. under a gitignored scratch path) and pass `cwd: ROOT`, the same pattern
   `standards-parity.test.mjs:93-109` uses; a config in an OS temp dir fails ESM resolution.
   The gate consumed the edit; nothing simulated. Pair-parity of the same output is already
   proven by check 6(b) via `parseStandards` (the repo's `standards-parity.test.mjs` is
   hard-pinned to ROOT and cannot be pointed at a temp tree — it stays what it is: the CI
   backstop on the real pair, §5 link 4).
8. **Colour law:** `grep -nE -- "--proven|--attested|--edge-sel|#4fe0cd|#5fd0a0"
   src/ide/rules.css` returns nothing — var names as well as hexes, since teal reaches
   component CSS as `var(--edge-sel)`, never a hex literal (SPEC_DESIGN acceptance 6
   precedent, extended with both banned hexes).
9. **Playwright journey (real Chromium, J1-style):** open `#rules` → the K11 grid shows the
   ten rules with values equal to the repo's live `eslint.config.js` (test reads the file
   itself and compares) → the four allowlist cards render the real file lines → category B
   rows show `file:line` cites. (This journey is read-only: the FSA write path is not
   CI-scriptable — the native picker needs a user gesture — and is NOT covered by any
   automated check; it rests on `PROBES.md` probe-files PASS and the thin-seam argument, §5.)
10. `npm run novakai:ship` green from this worktree (fragments for all new files; map gate
    stays complete), and `npm run novakai:ide` shows K9's non-manual checks passing.

Hardened predicates proposed for `ide-roadmap.json` (orchestrator applies; file frozen for
this lane): grep `src/ide/rules.ts` for `export function initRules`; file
`src/ide/rules.novakai.mmd`; grep `src/ide/rules-model.ts` for `readabilityRules`-anchor
parsing (`parseStandards`); cmd: the check-6 node test file.
