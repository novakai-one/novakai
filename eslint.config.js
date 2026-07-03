// Flat ESLint config for the M6 readability refactor baselines.
// All rules are configured at "warn" only — existing code must not break the build.
// Intentionally NOT using typescript-eslint's or sonarjs's recommended presets:
// only the rules explicitly listed in the M6 setup work order are enabled.
import tseslint from "typescript-eslint";
import sonarjs from "eslint-plugin-sonarjs";

const readabilityRules = {
  "sonarjs/cognitive-complexity": ["warn", 15],
  "max-depth": ["warn", 4],
  "max-lines-per-function": [
    "warn",
    { max: 60, skipBlankLines: true, skipComments: true },
  ],
  "max-params": ["warn", 4],
  "id-length": ["warn", { min: 2, exceptions: ["i", "j", "k", "x", "y", "_"] }],
  "sonarjs/no-identical-functions": "warn",
  "sonarjs/no-collapsible-if": "warn",
  "sonarjs/no-duplicate-string": "warn",
  "sonarjs/prefer-immediate-return": "warn",
};

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".readability/**",
      "**/*.json",
      "**/*.mmd",
      "coverage/**",
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
];
