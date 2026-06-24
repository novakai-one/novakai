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
      // Hard gate only: binary, enforceable rules. The size/complexity caps
      // (max-lines, max-lines-per-function, complexity, max-depth) were advisory
      // `warn`s behind a 30-warning budget — not a gate — and were removed.
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
