import js from "@eslint/js"
import tseslint from "typescript-eslint"
import reactHooks from "eslint-plugin-react-hooks"
import prettier from "eslint-config-prettier"
import globals from "globals"

export default tseslint.config(
  {
    ignores: ["dist/**", "coverage/**", "docs/**", "examples/**", "node_modules/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Mirror tsconfig: allow intentionally-unused `_`-prefixed args/vars.
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
    },
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      // Lock in the naming conventions the codebase already follows. Wire/API
      // fields are snake_case by contract, so object/type properties and
      // destructured names are exempt (they mirror server payloads verbatim).
      "@typescript-eslint/naming-convention": [
        "error",
        { selector: "default", format: ["camelCase"], leadingUnderscore: "allow" },
        {
          selector: "variable",
          format: ["camelCase", "UPPER_CASE", "PascalCase"],
          leadingUnderscore: "allow",
        },
        { selector: "function", format: ["camelCase", "PascalCase"] },
        // PascalCase allowed for geometry params (canvas W/H, math notation).
        { selector: "parameter", format: ["camelCase", "PascalCase"], leadingUnderscore: "allow" },
        { selector: "typeLike", format: ["PascalCase"] },
        { selector: "enumMember", format: ["PascalCase", "UPPER_CASE"] },
        // snake_case wire fields, index signatures, and quoted keys: skip format checks.
        { selector: ["objectLiteralProperty", "typeProperty"], format: null },
        { selector: "property", modifiers: ["requiresQuotes"], format: null },
      ],
    },
  },
  {
    files: ["test/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      // Tests deliberately cast through `unknown` to build fakes.
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // Must stay LAST: disables any ESLint rule that would fight Prettier.
  prettier,
)
