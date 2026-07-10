# Coding standards

Standards are mandatory and machine-enforced across the WHOLE repo. This doc and
`eslint.config.js` are kept in lockstep by `tools/novakai/verify/standards-parity.test.mjs` —
change one, change the other in the same PR or CI goes red.

## The tier model

Every rule keeps ONE threshold value across the whole repo; only the *severity* changes by
location.

- **WARN** — reports only, `npm run lint` exits 0 on warnings. WARN is an entry ramp, never a
  destination: code enters at WARN and ratchets to BLOCK once its area lints clean. Remaining
  WARN surface: `src/**/*.ts` (in practice only `src/main.ts` — every `src/` subdirectory is
  promoted), `tools/**/*.mjs` base tier (fully promoted, see below), and `tests/**/*.ts` +
  `tests/**/*.mjs` (whole-repo session-2 burndown).
- **BLOCK** — fails CI at `error` severity. Covers new K3+ IDE code and every area already
  burned down to zero warnings: `src/ide/**/*.ts`, `src/core/context/**/*.ts`,
  `src/core/history/**/*.ts`, `src/core/diff/**/*.ts`, `src/core/camera/**/*.ts`,
  `src/core/config/**/*.ts`, `src/core/frontmatter/**/*.ts`, `src/core/persistence/**/*.ts`,
  `src/core/plan/**/*.ts`, `src/core/seed/**/*.ts`, `src/core/state/**/*.ts`,
  `src/core/validate/**/*.ts`, `src/core/viewspec/**/*.ts`, `src/interaction/**/*.ts`,
  `src/io/**/*.ts`, `src/panel/**/*.ts`, `src/render/**/*.ts`, the whole novakai tooling
  `tools/**/*.mjs` (wave 5), and the root harness `*.ts` + `*.mjs` + `*.js` (whole-repo
  session 1: `vite.config.ts`, `vite-file-bridge.mjs`, `vite-file-bridge.test.mjs`,
  `playwright.config.ts`, `eslint.config.js`). A WARN area graduates to BLOCK by adding its
  glob to the error block once it lints clean — the ratchet only ever tightens. Two oversized
  tooling files keep `max-lines` (only that rule) at WARN until they are split —
  `tools/novakai/audit/audit-run.mjs` and `tools/novakai/contract/loop-e2e.test.mjs`; splitting
  a 500+-line file is design work, not mechanical burndown (the same reasoning that keeps
  `src/main.ts`, the composition root, at WARN entirely).

## The rule table

| Rule | ESLint id | Threshold | Tier |
|---|---|---|---|
| Cyclomatic **complexity** | `complexity` | `10` | WARN (entry ramp) · BLOCK (promoted) |
| Max function length | `max-lines-per-function` | `20` | WARN · BLOCK (promoted) |
| Max statements per function | `max-statements` | `12` | WARN · BLOCK (promoted) |
| Max statements per line | `max-statements-per-line` | `1` | WARN · BLOCK (promoted) |
| Max line length | `max-len` | `120` | WARN · BLOCK (promoted) |
| Max file length | `max-lines` | `500` | WARN · BLOCK (promoted) |
| Max nesting depth | `max-depth` | `4` | WARN · BLOCK (promoted) |
| Max parameters | `max-params` | `4` | WARN · BLOCK (promoted) |
| Min identifier length | `id-length` | `3` | WARN · BLOCK (promoted) |
| No identical functions | `sonarjs/no-identical-functions` | — | WARN · BLOCK (promoted) |
| No collapsible if | `sonarjs/no-collapsible-if` | — | WARN · BLOCK (promoted) |
| No duplicate string literal | `sonarjs/no-duplicate-string` | — | WARN · BLOCK (promoted) |
| Prefer immediate return | `sonarjs/prefer-immediate-return` | — | WARN · BLOCK (promoted) |

"—" marks threshold-free rules (name + tier parity only, no value parity).

## The exclusion ledger

The ONLY paths outside enforcement. Each entry carries a reason; the parity test pins this
list against `eslint.config.js`'s `ignores` — an unexplained exclusion fails CI.

| Path | Reason |
|---|---|
| `dist/**` | generated build output |
| `node_modules/**` | dependencies |
| `.readability/**` | generated refactor baselines |
| `coverage/**` | generated coverage output |
| `**/*.json` | data, not code |
| `**/*.mmd` | map/diagram data, not code |
| `**/*.d.ts` | type declarations, no executable code |
| `tools/buildspec/__fixtures__/**` | fixture DATA: deliberately-shaped sample source the pipeline tests parse; "fixing" it changes test inputs |

## Contract-anchored exceptions (`eslint-disable`)

An `eslint-disable` comment is sanctioned in exactly ONE situation: a function's signature is
frozen by a verifiable contract artifact (an approved plan, the acceptance corpus, or the
mutation corpus) that calls it positionally — collapsing its parameters would be a contract
change, not a style fix. The comment must name the freezing artifact. Any other use is
lint-dodging and fails the signature guard, which pins the repo-wide registry to exactly these:

| File · function | Rules disabled | Frozen by |
|---|---|---|
| `src/core/state/state.ts` · `frameTransform` | `max-params`, `id-length` | `public/plan.json` change `frame-transform` + its acceptance cases |
| `src/panel/unfold/unfold-camera.ts` · `ufFitXform` | `max-params` | `docs/novakai/acceptance-corpus.plan.json` (`m10:unfold__ufFitXform`) |

Each registry row is also pinned in `tools/novakai/verify/frozen-signatures.json`, and the
signature guard (`tools/novakai/verify/signature-guard.test.mjs`) fails CI if a frozen
function's live signature in `docs/novakai/_bundle.mmd` drifts from the pin — so a cleanup
agent cannot "fix" a contracted signature without deliberately resyncing the contract, the
manifest, and this table in the same change.

## How it is enforced

`npm run lint` (= `eslint .` — the whole repo) runs in CI job `buildspec-tests`; eslint exits
non-zero on any `error` (BLOCK) violation and zero on warnings. The parity test
(`tools/novakai/verify/standards-parity.test.mjs`) and the signature guard run inside
`spec:test:all` (same job).

## How to change a standard

Edit the rule table row AND `eslint.config.js` in the same PR. The parity test fails on any
divergence — that is the "may never disagree" guarantee, made mechanical. The same applies to
the exclusion ledger and the exceptions registry: config, doc, and manifest move together or
CI goes red.
