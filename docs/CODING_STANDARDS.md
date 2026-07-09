# Coding standards

Standards are mandatory and machine-enforced. This doc and `eslint.config.js` are kept in
lockstep by `tools/novakai/verify/standards-parity.test.mjs` — change one, change the other in
the same PR or CI goes red.

## The tier model

Every rule keeps ONE threshold value across the whole repo; only the *severity* changes by
location.

- **WARN** — `src/**/*.ts` (existing app) and `tools/**/*.mjs` (dev tooling): reports only,
  `npm run lint` exits 0. 2009 pre-existing violations exist; breaking the build on legacy code
  is not the ask. Existing code may enter at WARN and ratchet.
- **BLOCK** — fails CI at `error` severity. Covers new K3+ IDE code and every directory already
  burned down to zero warnings: `src/ide/**/*.ts`, `src/core/context/**/*.ts`,
  `src/core/history/**/*.ts`, `src/core/diff/**/*.ts`, `src/panel/chrome/**/*.ts`. A WARN rule
  graduates to BLOCK for a directory by adding its glob to the error block once the directory
  lints clean — the ratchet only ever tightens.

## The rule table

| Rule | ESLint id | Threshold | Tier |
|---|---|---|---|
| Cyclomatic **complexity** | `complexity` | `10` | WARN (src, tools) · BLOCK (src/ide) |
| Max function length | `max-lines-per-function` | `20` | WARN · BLOCK (src/ide) |
| Max statements per function | `max-statements` | `12` | WARN · BLOCK (src/ide) |
| Max statements per line | `max-statements-per-line` | `1` | WARN · BLOCK (src/ide) |
| Max line length | `max-len` | `120` | WARN · BLOCK (src/ide) |
| Max file length | `max-lines` | `500` | WARN · BLOCK (src/ide) |
| Max nesting depth | `max-depth` | `4` | WARN · BLOCK (src/ide) |
| Max parameters | `max-params` | `4` | WARN · BLOCK (src/ide) |
| Min identifier length | `id-length` | `3` | WARN · BLOCK (src/ide) |
| No identical functions | `sonarjs/no-identical-functions` | — | WARN · BLOCK (src/ide) |
| No collapsible if | `sonarjs/no-collapsible-if` | — | WARN · BLOCK (src/ide) |
| No duplicate string literal | `sonarjs/no-duplicate-string` | — | WARN · BLOCK (src/ide) |
| Prefer immediate return | `sonarjs/prefer-immediate-return` | — | WARN · BLOCK (src/ide) |

"—" marks threshold-free rules (name + tier parity only, no value parity).

## How it is enforced

`npm run lint` (= `eslint src tools`) runs in CI job `buildspec-tests`; eslint exits non-zero on
any `error` (BLOCK) violation and zero on warnings. The parity test
(`tools/novakai/verify/standards-parity.test.mjs`) runs inside `spec:test:all` (same job).

## How to change a standard

Edit the rule table row AND `eslint.config.js` in the same PR. The parity test fails on any
divergence — that is the "may never disagree" guarantee, made mechanical.
