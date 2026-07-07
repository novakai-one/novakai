# K11 — Coding standards: documented, linted, enforced (build plan)

> **Status of this file: PLAN ONLY.** Nothing here is built. Do NOT write
> `docs/CODING_STANDARDS.md` or edit `eslint.config.js` from this document until the plan
> clears its audits. This is the buildable spec; the deliverables ship in a later PR.

## 0. What K11 is (and what already exists — do not recreate)

Chris's ruling (2026-07-07): human-readable coding standards are **mandatory and
machine-enforced** — sonar-level rules including cyclomatic/cognitive complexity, max file
length, max function length. Every rule carries an enforcement **tier — BLOCK (fails CI) or
WARN (reports only)** — the doc (`docs/CODING_STANDARDS.md`) and the lint config **may never
disagree**, and it lands before/alongside K3 so all new IDE code arrives under it.

**The baseline already exists — extend it, do not rebuild it.** `eslint.config.js` (M6
readability work) already wires `eslint-plugin-sonarjs` + typescript-eslint with:
`sonarjs/cognitive-complexity 15`, `max-lines-per-function 60`, `max-depth 4`, `max-params 4`,
`id-length min 2`, and four threshold-free sonarjs rules — **all `warn`, and `npm run lint`
(= `eslint src tools`) is NOT in CI.** Verified now: `npm run lint` → `exit 0`, `2009
warnings, 0 errors`. Largest existing files: `src/panel/unfold/unfold.ts` 2639 lines,
`src/panel/planner/planner.ts` 875, `src/io/layout.ts` 548.

**K11 delivers exactly four gaps and nothing more:** (1) the standards doc; (2) `max-lines`
(file length — absent from the config); (3) the BLOCK/WARN tier split; (4) CI enforcement +
a doc↔config parity test. No new dependencies, no custom lint tooling — eslint + one small
`node --test` parity file.

## 1. The tier model (the one design decision everything else follows)

**Uniform thresholds, escalating severity.** Every rule keeps ONE threshold value across the
whole repo; only the *severity* changes by location. This makes the doc↔config parity check
trivial (one value per rule) and encodes the ratchet Chris asked for.

| Location (glob) | Severity | Tier | Rationale |
|---|---|---|---|
| `src/**/*.ts` (existing app) | `warn` | **WARN** | 2009 pre-existing violations; breaking the build on legacy is not the ask — "existing code may enter at WARN and ratchet" |
| `tools/**/*.mjs` (dev tooling) | `warn` | **WARN** | dev-time tooling, same treatment as legacy src |
| `src/ide/**/*.ts` (NEW K3+ IDE code) | `error` | **BLOCK** | "all new IDE code arrives under the standards" — new shell/page modules land here and fail CI on any violation |

**Mechanism = eslint flat-config override order.** A `src/ide/**/*.ts` config block placed
*after* the `src/**/*.ts` block re-declares the same rule set at `error`; flat config's
last-match-wins makes IDE files BLOCK while every other src file stays WARN. `error` makes
`eslint` exit non-zero → CI fails. `warn` never fails a build. That is the entire BLOCK/WARN
split — no plugin, no custom severity engine.

> **K3 sequencing dependency — the glob and the shell directory are ONE decision, landed in
> the same PR.** K3's shell/page modules (`initShell`, the 7 tab factories) MUST land under
> `src/ide/**` so they inherit BLOCK. This is not advisory: the BLOCK glob in `eslint.config.js`
> and the directory K3 chooses cannot be decided independently, or a later directory pick
> silently voids enforcement (files land outside `src/ide/**` → BLOCK never applies → new IDE
> code enters at WARN, defeating K11). Therefore:
>
> - **The K3 spec (`docs/ide-vision/SPEC_SHELL.md`) MUST carry this cross-reference line
>   verbatim:** *"All new IDE shell/page modules live under `src/ide/**` — this path is bound
>   by K11's BLOCK glob (`eslint.config.js`); moving it requires moving the glob and the
>   `docs/CODING_STANDARDS.md` tier table in the same PR."* The K11 build PR adds this line to
>   `SPEC_SHELL.md` (or, if K3 lands first, K11 verifies it is present).
> - **Hardened predicate (see §6):** a check that fails if `src/ide/` exists on disk but the
>   config lacks the `src/ide` block — so once K3 creates the directory, a missing/renamed
>   BLOCK glob is caught, not silently tolerated. (The reverse — config has the block but the
>   severity is wrong due to override order — is already covered by §4's behavioural assertion.)
>
> If K3 genuinely needs a different directory, the glob and the doc's tier table move with it
> in the same PR — the parity test forces the doc to match, and the cross-reference line keeps
> the two specs from drifting apart.

## 2. `docs/CODING_STANDARDS.md` — content outline (build this doc, do not write it yet)

The doc is the human-readable half of the contract; the parity test (§4) guarantees it never
drifts from `eslint.config.js`. Required structure:

1. **Intent (1 short para).** Standards are mandatory and machine-enforced; this doc and
   `eslint.config.js` are kept in lockstep by
   `tools/novakai/verify/standards-parity.test.mjs` — change one, change the other in the
   same PR or CI goes red. (No status prose — intent only, per the CLAUDE.md ban.)

2. **The tier model.** Reproduce the §1 table in prose: WARN = existing `src/` + `tools/`
   (reports only, exit 0); **BLOCK** = new IDE code under `src/ide/**` (fails CI). State the
   ratchet: existing code enters at WARN; new IDE code is held to BLOCK; a WARN rule graduates
   to BLOCK for a directory by adding its glob to the error block.

3. **The rule table** — the load-bearing, machine-parsed section. Exact columns
   `| Rule | ESLint id | Threshold | Tier |`, one row per enforced rule. The parity test reads
   this table, so the ESLint id and Threshold cells must match `eslint.config.js` verbatim:

   | Rule | ESLint id | Threshold | Tier |
   |---|---|---|---|
   | Cognitive **complexity** | `sonarjs/cognitive-complexity` | `15` | WARN (src, tools) · BLOCK (src/ide) |
   | Max function length | `max-lines-per-function` | `60` | WARN · BLOCK (src/ide) |
   | Max file length | `max-lines` | `500` | WARN · BLOCK (src/ide) |
   | Max nesting depth | `max-depth` | `4` | WARN · BLOCK (src/ide) |
   | Max parameters | `max-params` | `4` | WARN · BLOCK (src/ide) |
   | Min identifier length | `id-length` | `2` | WARN · BLOCK (src/ide) |
   | No identical functions | `sonarjs/no-identical-functions` | — | WARN · BLOCK (src/ide) |
   | No collapsible if | `sonarjs/no-collapsible-if` | — | WARN · BLOCK (src/ide) |
   | No duplicate string literal | `sonarjs/no-duplicate-string` | — | WARN · BLOCK (src/ide) |
   | Prefer immediate return | `sonarjs/prefer-immediate-return` | — | WARN · BLOCK (src/ide) |

   The words **"complexity"** and **BLOCK/WARN** appear per the K11 predicates (they grep for
   them). "—" marks threshold-free rules (the parity test does value-parity only on the
   numeric rows, name-parity on all rows — see §4).

4. **How it is enforced.** `npm run lint` (= `eslint src tools`) runs in CI job
   `buildspec-tests`; eslint exits non-zero on any `error` (BLOCK) violation and zero on
   warnings. The parity test runs inside `spec:test:all` (same job).

5. **How to change a standard.** Edit the rule table row AND `eslint.config.js` in the same
   PR. The parity test fails on any divergence — that is the "may never disagree" guarantee,
   made mechanical.

## 3. `eslint.config.js` — exact changes (plan; do not edit yet)

Minimal diff, extend the existing shape:

- **Add `max-lines` to `readabilityRules`** (the file-length gap):
  `"max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }]`.
  **Value 500 is defensible:** it warns 2 existing src files (unfold, planner); layout.ts
  (548 raw lines) falls under 500 once blanks/comments are skipped — legitimately over-long
  files are correctly flagged at WARN, non-breaking — while holding new IDE modules to a
  focused ceiling. `skipBlankLines/skipComments` match the existing
  `max-lines-per-function` options for consistency.

- **Add a severity-lift helper** (one small pure function, keep it in the config file):
  ```js
  const asError = (rules) => Object.fromEntries(
    Object.entries(rules).map(([id, v]) =>
      [id, Array.isArray(v) ? ["error", ...v.slice(1)] : "error"])
  );
  ```
  This derives the BLOCK block from the single WARN source of truth, so the two tiers can
  never carry different thresholds (the parity test also asserts this — belt and braces).

- **Add a fourth config block, AFTER the existing `src/**/*.ts` block:**
  ```js
  {
    files: ["src/ide/**/*.ts"],
    languageOptions: { parser: tseslint.parser, parserOptions: { sourceType: "module" } },
    plugins: { "@typescript-eslint": tseslint.plugin, sonarjs },
    rules: asError(readabilityRules),
  }
  ```
  Last-match-wins ⇒ `src/ide/**` files are BLOCK, all other `src/**` stay WARN, `tools/**`
  stay WARN. No other block changes.

- **`readabilityRules` stays the WARN source of truth.** The `tools/**/*.mjs` block is
  untouched (stays WARN). The comment header's "All rules are configured at 'warn' only"
  line is updated to note the `src/ide/**` BLOCK override.

`// ponytail:` note to leave in the config: *"src/ide/** is the only BLOCK glob; move it here
if K3's IDE code lands elsewhere — the parity test forces the doc to follow."*

## 4. Doc↔config no-disagree enforcement — `standards-parity.test.mjs`

**The simplest machine check that fails on divergence.** New file:
`tools/novakai/verify/standards-parity.test.mjs` (sits beside the existing
`gate-parity.test.mjs` — same folder, same `node --test` convention). It:

1. `import`s the root `eslint.config.js` (ESM default export = the flat-config array) and
   pulls the rule map from the `src/**/*.ts` block (WARN source of truth) and the
   `src/ide/**/*.ts` block (BLOCK).
2. Reads `docs/CODING_STANDARDS.md`, parses the `| Rule | ESLint id | Threshold | Tier |`
   table into `{ eslintId → { threshold, tier } }`.
3. Asserts, and fails (non-zero) on any mismatch:
   - **Name parity:** the set of ESLint ids in the doc table === the set in the config's
     WARN block (no rule documented-but-unenforced or enforced-but-undocumented).
   - **Value parity:** for every numeric-threshold rule (`cognitive-complexity` 15,
     `max-lines-per-function` 60, `max-lines` 500, `max-depth` 4, `max-params` 4,
     `id-length` 2), the doc's Threshold cell === the config's threshold.
   - **Tier parity:** every rule's WARN-block severity is `warn` and its BLOCK-block
     (`src/ide`) severity is `error`, and the doc's Tier cell names both tiers — i.e. the doc
     tells the truth about the split.
   - **Ratchet invariant:** the BLOCK block's threshold for each rule === the WARN block's
     (severity differs, values do not).
   - **BLOCK *behaviour* (not declared config) — the load-bearing assertion.** Flat-config
     severity is **order-dependent**: last matching block wins. A builder who places the
     `src/ide/**` block *before* the `src/**/*.ts` block silently degrades BLOCK back to WARN,
     and every declared-severity check above still passes (the block *exists*, it just doesn't
     win). So the test must prove the severity ESLint *actually reports* for a `src/ide` file,
     using the already-installed `eslint` package's programmatic API. Load the root config with
     `new ESLint({ overrideConfigFile: "eslint.config.js" })`, then `lintText` a **synthetic
     violating source** attributed to a `src/ide/` path — the simplest is a function longer
     than `max-lines-per-function` (61+ body lines), e.g.:
     ```js
     const src = `export function x() {\n${"  const a = 1;\n".repeat(70)}}\n`;
     const [res] = await eslint.lintText(src, { filePath: "src/ide/_synthetic.ts" });
     const hit = res.messages.find(m => m.ruleId === "max-lines-per-function");
     assert.equal(hit.severity, 2); // 2 = error = BLOCK actually in force
     ```
     (`calculateConfigForFile("src/ide/x.ts")` is the alternative — it returns the resolved
     rule map after override-order is applied, so `rules["max-lines-per-function"][0] === 2`
     is equivalent. Prefer `lintText` — it proves the *reported* severity end to end, not just
     the resolved config.) This makes the BLOCK enforcement proof **computed**, closing the
     order-dependence gap that a declared-config check cannot see. Do the mirror assertion for
     a `src/x.ts` synthetic path → severity `1` (WARN), so a config that accidentally makes
     *everything* BLOCK also fails.

   **Where each threshold lives (one interpretation per rule — the config carries three value
   shapes; the parser must read the right slot):**
   - bare number — `sonarjs/cognitive-complexity` (`15`), `max-depth` (`4`), `max-params`
     (`4`): the threshold is `ruleValue[1]` directly (`["warn", 15]` → `15`).
   - `{ max: N }` — `max-lines-per-function` (`60`), `max-lines` (`500`): the threshold is
     `ruleValue[1].max`.
   - `{ min: N, exceptions: [...] }` — `id-length` (`2`): the threshold is `ruleValue[1].min`.
   The four threshold-free sonarjs rows (`no-identical-functions`, `no-collapsible-if`,
   `no-duplicate-string`, `prefer-immediate-return`) get name+tier parity only, no value parity.

Ponytail: no fixtures, no framework — one `node:test` file with `assert` + the in-process
`eslint` API (already a dependency), ~80 lines. It IS the check the non-trivial parsing +
order-dependence logic leaves behind (per the "one runnable check" rule), and it replaces the
manual BLOCK-probe drill that §7 used to carry.

> **Considered alternative (for Chris — non-blocking).** The more novakai-idiomatic design is
> *generate the rule table from the config* (`docs/CODING_STANDARDS.md`'s table becomes a
> generated section) and gate freshness with `git diff --exit-code`, exactly like
> `novakai:bundle` regenerates the map. That makes drift structurally impossible rather than
> test-caught. It was **not** chosen here only because the parity-test approach lands in one
> PR without a new generator + npm script + CI diff-check; the behavioural assertion above
> gives the same "cannot silently disagree" guarantee for this PR's scope. Flag for a later
> ratchet if the doc grows beyond one table.

**Register it in `spec:test:all`** (package.json): append
`tools/novakai/verify/standards-parity.test.mjs` to the `node --test ...` argument list. This
puts it in CI (buildspec-tests consumes `spec:test:all` verbatim) and in
`novakai:verify:full`. `gate-parity.test.mjs` will pass unchanged (it guards CI test-list
parity, not lint). `npm run lint` script itself is unchanged (`eslint src tools`).

## 5. CI wiring — exact job/step

**Job `buildspec-tests` in `.github/workflows/spec-gate.yml`** — the JS/TS quality job (no
browser). Add one step after `- run: npm run typecheck`:

```yaml
      # K11 — coding standards: eslint exits non-zero on BLOCK-tier (error)
      # violations in new IDE code (src/ide/**); WARN-tier legacy passes.
      - run: npm run lint
```

- This is the whole CI enforcement: `eslint src tools` exits 1 on any `error`-severity
  (BLOCK) finding, 0 on warnings. Safe to add today (currently exit 0). The doc↔config parity
  test rides in via `spec:test:all` (already the first step of this job) — no extra step.
- **Not** added to the `novakai-drift` or `app-e2e` jobs (wrong tier). **Not** folded into
  `novakai:verify:full` as a separate line — parity is already there through `spec:test:all`;
  the lint step is CI-job-level, matching how `typecheck`/`test:src` sit as their own steps.

## 6. Hardened K11 predicates (write into `docs/novakai/ide-roadmap.json`, same PR)

The K11 `checks` array is deliberately coarse today; hardening it is the explicit act the
`ide-roadmap.json` header sanctions ("each build phase hardens its own predicates in the PR
that builds it"). Replace K11's `checks` with:

```json
"checks": [
  { "kind": "file",  "path": "docs/CODING_STANDARDS.md" },
  { "kind": "grep",  "path": "docs/CODING_STANDARDS.md", "pattern": "complexity" },
  { "kind": "grep",  "path": "docs/CODING_STANDARDS.md", "pattern": "(BLOCK|WARN)" },
  { "kind": "grep",  "path": "docs/CODING_STANDARDS.md", "pattern": "max-lines" },
  { "kind": "grep",  "path": "eslint.config.js",         "pattern": "max-lines" },
  { "kind": "grep",  "path": "eslint.config.js",         "pattern": "src/ide" },
  { "kind": "grep",  "path": "docs/ide-vision/SPEC_SHELL.md", "pattern": "src/ide" },
  { "kind": "grep",  "path": "package.json",             "pattern": "standards-parity.test.mjs" },
  { "kind": "grep",  "path": ".github/workflows/spec-gate.yml", "pattern": "npm run lint" },
  { "kind": "cmd",   "run": "node -e \"const fs=require('fs'); if (fs.existsSync('src/ide') && !fs.readFileSync('eslint.config.js','utf8').includes('src/ide')) { console.error('src/ide exists but eslint.config.js lacks the BLOCK glob'); process.exit(1); }\"" },
  { "kind": "cmd",   "run": "node --test tools/novakai/verify/standards-parity.test.mjs" }
]
```

What each new predicate proves: `max-lines` in the doc AND the config = the file-length gap is
closed and documented; `src/ide` in the config = the BLOCK tier split exists; `src/ide` in
`SPEC_SHELL.md` = the K3 spec carries the directory-binding cross-reference (§1), so the two
specs cannot drift on where IDE code lives; the **directory-binding cmd** fails if the
`src/ide/` directory exists on disk while the config lacks its BLOCK glob — closing the "K3
lands code outside the enforced glob and enforcement silently voids" hole (the inverse,
wrong-severity-via-override-order, is caught behaviourally by §4); the parity test registered +
passing = doc↔config cannot disagree; `npm run lint` in the workflow = CI enforces BLOCK. (The
old `grep package.json "lint"` predicate is dropped — the workflow-grep and parity-cmd are
stronger and the `"lint"` script string is unchanged anyway.)

## 7. Verify table (every claim = a runnable command + expected output)

Run from repo root after the build lands.

| Claim | Command | Expect |
|---|---|---|
| Standards doc exists, states complexity + tiers | `grep -Ec 'complexity\|BLOCK\|WARN' docs/CODING_STANDARDS.md` | `>= 3` |
| Doc documents file length | `grep -c 'max-lines' docs/CODING_STANDARDS.md` | `>= 1` |
| Config has file-length rule | `grep -c '"max-lines"' eslint.config.js` | `1` |
| Config has the BLOCK (src/ide) block | `grep -c 'src/ide' eslint.config.js` | `>= 1` |
| Legacy stays WARN (build not broken) | `npm run lint; echo $?` | `0` (warnings only, no errors) |
| **New IDE code is BLOCK — proven by the test, not by hand** | `node --test tools/novakai/verify/standards-parity.test.mjs` | pass — its behavioural case lints a synthetic `src/ide/*.ts` violation via the `eslint` API and asserts reported severity `2` (BLOCK actually in force, order-independent) |
| Doc↔config parity holds | `node --test tools/novakai/verify/standards-parity.test.mjs` | pass, exit 0 |
| Parity catches divergence | temporarily change `max-lines` 500→400 in the config only, run the test | fails naming the value mismatch; restore → pass |
| Parity catches BLOCK degraded to WARN | temporarily move the `src/ide/**` block *above* `src/**/*.ts` in the config, run the test | fails on the behavioural assertion (reported severity `1`, not `2`); restore → pass |
| K3 spec carries the directory binding | `grep -c 'src/ide' docs/ide-vision/SPEC_SHELL.md` | `>= 1` |
| Directory-binding predicate holds | `npm run --silent novakai:ide` (runs the `src/ide`-exists-vs-glob cmd) | passes; would fail only if `src/ide/` exists while the config drops its BLOCK glob |
| Parity test is in CI suite | `grep -c 'standards-parity.test.mjs' package.json` | `1` |
| CI enforces lint | `grep -c 'npm run lint' .github/workflows/spec-gate.yml` | `1` |
| K11 predicates hardened + green | `npm run --silent novakai:ide` | `K11 [BUILT]` (11/11) |
| No status prose crept in | `npm run novakai:roadmap:audit` | exit 0 |
| Map still true (no src/ change) | `npm run novakai:onboard` | ends `Onboarding ready.` |

## 8. Edit loci (exact file list — nothing more)

| File | Change |
|---|---|
| `docs/CODING_STANDARDS.md` | **NEW** — the standards doc, structure per §2 |
| `eslint.config.js` | add `max-lines` to `readabilityRules`; add `asError` helper; add the `src/ide/**/*.ts` BLOCK block; update the header comment (§3) |
| `tools/novakai/verify/standards-parity.test.mjs` | **NEW** — the doc↔config parity test (§4) |
| `package.json` | append the parity test to `spec:test:all`'s `node --test` list (§4). `lint` script unchanged |
| `.github/workflows/spec-gate.yml` | add `- run: npm run lint` to job `buildspec-tests` (§5) |
| `docs/ide-vision/SPEC_SHELL.md` | add the directory-binding cross-reference line (§1) — or, if K3 lands first, verify it is present |
| `docs/novakai/ide-roadmap.json` | replace K11 `checks` with the hardened set (§6) |

Out of scope (not touched): any `src/` file (no app code changes — the `src/ide/` glob is
inert until K3 creates that directory), `novakai:verify:full` (parity rides in via
`spec:test:all`), the `novakai-drift`/`app-e2e` CI jobs.

At session end, re-sync per protocol: `npm run novakai:ship` (no-op for the map — no `src/`
touched) and add a command-anchored K11 entry to `docs/novakai/SESSION_HANDOFF.md` (this is a
close-out step, not an edit locus of the K11 mechanism).

## 9. Build order

1. `eslint.config.js` (max-lines + asError + src/ide block).
2. `docs/CODING_STANDARDS.md` (rule table mirrors the config exactly).
3. `standards-parity.test.mjs` — run it; it fails until doc and config agree, then green.
   Includes the behavioural BLOCK assertion (lints a synthetic `src/ide/*.ts` violation via
   the `eslint` API, asserts reported severity `2`) — this is the computed enforcement proof.
4. Register in `spec:test:all`; add the CI lint step. Add the directory-binding
   cross-reference line to `docs/ide-vision/SPEC_SHELL.md` (§1).
5. Harden `ide-roadmap.json` K11 checks; confirm `npm run novakai:ide` → `K11 [BUILT]` (11/11).
6. Run the §7 verify table end to end, incl. the two negative drills (config-value divergence
   and BLOCK-degraded-to-WARN via block reorder) — both now caught by the test, no manual
   probe file needed. Optional builder smoke-step: drop a violating `src/ide/_probe.ts`, run
   `npm run lint`, confirm exit `1`, delete it — a sanity check, not part of the gate.
