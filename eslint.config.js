// Flat ESLint config for the M6 readability refactor baselines, extended by
// K11 (coding standards): all existing src/** + tools/** stay "warn" only —
// existing code must not break the build — but src/ide/** (new K3+ IDE code)
// re-declares the same rules at "error" (BLOCK), enforced in CI via `npm run
// lint`. docs/CODING_STANDARDS.md documents this tier split and the parity
// test (tools/novakai/verify/standards-parity.test.mjs) fails the build if
// the doc and this config ever disagree.
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

const readabilityRules = {
  "complexity": ["warn", 10],
  "max-depth": ["warn", 4],
  "max-lines-per-function": [
    "warn",
    { max: 20, skipBlankLines: true, skipComments: true },
  ],
  "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
  "max-statements": ["warn", 12],
  "max-statements-per-line": ["warn", { max: 1 }],
  "max-params": ["warn", 4],
  "max-len": ["warn", { code: 120, ignoreUrls: true }],
  "id-length": [
    "warn",
    { min: 3, exceptions: ["_", "e", "i", "j", "k", "x", "y", "dx", "dy", "el", "id"] },
  ],
  "sonarjs/no-identical-functions": "warn",
  "sonarjs/no-collapsible-if": "warn",
  "sonarjs/no-duplicate-string": "warn",
  "sonarjs/prefer-immediate-return": "warn",
};

// ponytail: src/ide/** is the only BLOCK glob; move it here if K3's IDE code
// lands elsewhere — the parity test forces the doc to follow.
const asError = (rules) => Object.fromEntries(
  Object.entries(rules).map(([id, value]) =>
    [id, Array.isArray(value) ? ["error", ...value.slice(1)] : "error"])
);

export default [
  // The EXCLUSION LEDGER — the ONLY paths outside enforcement, each with a
  // reason. Pinned by standards-parity.test.mjs (config == doc); adding an
  // entry here without the doc row fails CI.
  {
    ignores: [
      "dist/**", // generated build output
      "node_modules/**", // dependencies
      ".readability/**", // generated refactor baselines
      "coverage/**", // generated coverage output
      "**/*.json", // data, not code
      "**/*.mmd", // map/diagram data, not code
      "**/*.d.ts", // type declarations, no executable code
      "tools/buildspec/__fixtures__/**", // fixture DATA: deliberately-shaped sample source the pipeline tests parse
    ],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      // No `project` set on purpose — keeps linting fast by avoiding
      // type-checked rules/parsing.
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      sonarjs,
    },
    rules: readabilityRules,
  },
  {
    files: ["tools/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
    plugins: {
      sonarjs,
    },
    rules: readabilityRules,
  },
  // Whole-repo ratchet, session 1: tests enter at WARN (session-2 burndown).
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      sonarjs,
    },
    rules: readabilityRules,
  },
  {
    files: ["tests/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
    plugins: {
      sonarjs,
    },
    rules: readabilityRules,
  },
  // K11 BLOCK tier — new IDE code (K3+) plus every directory already burned
  // down to zero warnings (the ratchet: clean dirs are promoted here so they
  // can never regress). Placed AFTER the src/**/*.ts block on purpose: flat
  // config's last-match-wins makes these files "error" (fail CI) while every
  // other src/** file stays "warn". Order is load-bearing — do not move this
  // block earlier.
  {
    files: [
      "src/ide/**/*.ts",
      "src/core/context/**/*.ts",
      "src/core/history/**/*.ts",
      "src/core/diff/**/*.ts",
      "src/core/camera/**/*.ts",
      "src/core/config/**/*.ts",
      "src/core/frontmatter/**/*.ts",
      "src/core/persistence/**/*.ts",
      "src/core/plan/**/*.ts",
      "src/core/seed/**/*.ts",
      "src/core/state/**/*.ts",
      "src/core/validate/**/*.ts",
      "src/core/viewspec/**/*.ts",
      "src/interaction/**/*.ts",
      "src/io/**/*.ts",
      "src/panel/**/*.ts",
      "src/render/**/*.ts",
    ],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      sonarjs,
    },
    rules: asError(readabilityRules),
  },
  // K11 BLOCK tier — the novakai tooling, burned down to zero warnings in the
  // wave-5 ratchet. Same last-match-wins placement rule as the src block above.
  {
    files: ["tools/**/*.mjs"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
    plugins: {
      sonarjs,
    },
    rules: asError(readabilityRules),
  },
  // K11 BLOCK tier — the root harness (build/test/bridge config), burned to
  // zero in whole-repo session 1. Root-level globs only (no slash = repo root).
  {
    files: ["*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      sonarjs,
    },
    rules: asError(readabilityRules),
  },
  {
    files: ["*.mjs", "*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
    plugins: {
      sonarjs,
    },
    rules: asError(readabilityRules),
  },
  // max-lines carve-outs: two files exceed 500 effective lines; splitting them
  // is design work, not burndown (mirrors the src/main.ts skip). max-lines
  // stays WARN for exactly these files — every other rule remains BLOCK via
  // the tools error block above (last-match-wins overrides only max-lines).
  {
    files: [
      "tools/novakai/audit/audit-run.mjs",
      "tools/novakai/contract/loop-e2e.test.mjs",
    ],
    rules: {
      "max-lines": ["warn", { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
];
