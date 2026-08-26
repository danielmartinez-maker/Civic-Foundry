import js from "@eslint/js";
import tseslint from "typescript-eslint";

const typeScriptFiles = ["src/**/*.ts", "tests/**/*.ts"];

export default [
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      ".worktrees/**",
      "test-artifacts/**",
    ],
  },
  {
    files: typeScriptFiles,
    languageOptions: {
      parser: tseslint.parser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      ...js.configs.recommended.rules,
      ...tseslint.configs.recommended.rules,
      "no-undef": "off",
      "no-debugger": "error",
      "no-eval": "error",
      "no-new-func": "error",
      "prefer-const": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
];
