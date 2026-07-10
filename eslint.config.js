// Flat ESLint config for K11 (coding standards), whole-repo end state: ONE
// error-severity rule set covers every code file — the WARN entry ramp was
// retired in whole-repo session 4 once the last WARN surface (src/main.ts)
// was burned to zero. docs/CODING_STANDARDS.md documents the rules and the
// parity test (tools/novakai/verify/standards-parity.test.mjs) fails the
// build if the doc and this config ever disagree.
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

const readabilityRules = {
  "complexity": ["error", 10],
  "max-depth": ["error", 4],
  "max-lines-per-function": [
    "error",
    { max: 20, skipBlankLines: true, skipComments: true },
  ],
  "max-lines": ["error", { max: 500, skipBlankLines: true, skipComments: true }],
  "max-statements": ["error", 12],
  "max-statements-per-line": ["error", { max: 1 }],
  "max-params": ["error", 4],
  "max-len": ["error", { code: 120, ignoreUrls: true }],
  "id-length": [
    "error",
    { min: 3, exceptions: ["_", "e", "i", "j", "k", "x", "y", "z", "dx", "dy", "el", "id"] },
  ],
  "sonarjs/no-identical-functions": "error",
  "sonarjs/no-collapsible-if": "error",
  "sonarjs/no-duplicate-string": "error",
  "sonarjs/prefer-immediate-return": "error",
};

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
  // Every TypeScript file — app src/**, tests/**, root harness *.ts.
  {
    files: ["src/**/*.ts", "tests/**/*.ts", "*.ts"],
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
  // Every plain-JS module — novakai tooling, test harness .mjs, root *.mjs/*.js.
  {
    files: ["tools/**/*.mjs", "tests/**/*.mjs", "*.mjs", "*.js"],
    languageOptions: {
      sourceType: "module",
      ecmaVersion: "latest",
    },
    plugins: {
      sonarjs,
    },
    rules: readabilityRules,
  },
];
