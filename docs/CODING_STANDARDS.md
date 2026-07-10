# Coding standards

Standards are mandatory and machine-enforced across the WHOLE repo. This doc and
`eslint.config.js` are kept in lockstep by `tools/novakai/verify/standards-parity.test.mjs` —
change one, change the other in the same PR or CI goes red.

## The tier model

ONE tier: **BLOCK**. Every rule holds one threshold value at `error` severity across every
code file in the repo. The config is three blocks: the exclusion ledger, one TypeScript
block (`src/**/*.ts`, `tests/**/*.ts`, root `*.ts` — TS parser), and one plain-JS block
(`tools/**/*.mjs`, `tests/**/*.mjs`, root `*.mjs` + `*.js` — espree). Any violation fails
CI: `npm run lint` = `eslint . --max-warnings 0`.

The WARN entry ramp is retired. Code entered at WARN and ratcheted to BLOCK area by area —
the `src/` subdirectories and the novakai tooling in the K11 waves, the root harness in
whole-repo session 1, `tests/**` in session 2, the two oversized tooling files split in
session 3, and finally `src/main.ts` (the composition root, fixed in place) in session 4 —
after which the per-area promoted-glob list collapsed into the whole-glob blocks above.
The parity test asserts no warn-severity rule can reappear anywhere in the config.

## The rule table

| Rule | ESLint id | Threshold | Tier |
|---|---|---|---|
| Cyclomatic **complexity** | `complexity` | `10` | BLOCK (repo-wide) |
| Max function length | `max-lines-per-function` | `20` | BLOCK (repo-wide) |
| Max statements per function | `max-statements` | `12` | BLOCK (repo-wide) |
| Max statements per line | `max-statements-per-line` | `1` | BLOCK (repo-wide) |
| Max line length | `max-len` | `120` | BLOCK (repo-wide) |
| Max file length | `max-lines` | `500` | BLOCK (repo-wide) |
| Max nesting depth | `max-depth` | `4` | BLOCK (repo-wide) |
| Max parameters | `max-params` | `4` | BLOCK (repo-wide) |
| Min identifier length | `id-length` | `3` | BLOCK (repo-wide) |
| No identical functions | `sonarjs/no-identical-functions` | — | BLOCK (repo-wide) |
| No collapsible if | `sonarjs/no-collapsible-if` | — | BLOCK (repo-wide) |
| No duplicate string literal | `sonarjs/no-duplicate-string` | — | BLOCK (repo-wide) |
| Prefer immediate return | `sonarjs/prefer-immediate-return` | — | BLOCK (repo-wide) |

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

`npm run lint` (= `eslint . --max-warnings 0` — the whole repo) runs in CI job
`buildspec-tests`; eslint exits non-zero on ANY violation — every rule is `error`
severity, and the `--max-warnings 0` backstop means even a future warn-severity rule
could not slip through. The parity test
(`tools/novakai/verify/standards-parity.test.mjs`) and the signature guard run inside
`spec:test:all` (same job).

## How to change a standard

Edit the rule table row AND `eslint.config.js` in the same PR. The parity test fails on any
divergence — that is the "may never disagree" guarantee, made mechanical. The same applies to
the exclusion ledger and the exceptions registry: config, doc, and manifest move together or
CI goes red.
