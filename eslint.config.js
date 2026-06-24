import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores([
    "dist",
    "dist-verify",
    // Dead migration code — superseded by NewSelectionManager. Not gated.
    "src/selection/OldselectionManager",
    "src/managers/selection/z - legacy-selectionManager",
  ]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Size & complexity caps = mechanical proxy for "one responsibility".
      // Set to "warn" first run so existing files surface without blocking.
      // Flip to "error" once the violation list is triaged.
      "max-lines": [
        "warn",
        { max: 200, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "warn",
        { max: 40, skipBlankLines: true, skipComments: true },
      ],
      complexity: ["warn", 8],
      "max-depth": ["warn", 3],
      // Type-safety rule kept hard: tsc already passes clean, so no surprise.
      "@typescript-eslint/no-explicit-any": "error",
      // `_`-prefixed names are intentional placeholders (kept for uniform
      // receive* signatures). Codifies the existing convention project-wide.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
]);
