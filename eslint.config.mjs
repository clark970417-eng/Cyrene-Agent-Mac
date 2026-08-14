import js from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "cloud-bot/dist/**",
      "cloud-bot/node_modules/**",
      "resources/**",
      "vendor/**",
      "**/.venv/**",
      "**/*.d.ts",
      "**/*.min.js",
      "src/renderer/public/**",
      "cyrene-ropebound-activity/**",
      "skills/**",
      "scripts/**",
      "integrations/**",
      "city-web/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node, ...globals.es2022 },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Electron and optional native integrations intentionally resolve some
      // dependencies lazily at runtime; static imports would change behavior.
      "@typescript-eslint/no-require-imports": "off",
      // Keep legacy regex/string issues visible without blocking the baseline.
      "no-useless-escape": "warn",
      "no-misleading-character-class": "warn",
      "no-irregular-whitespace": "warn",
      "no-control-regex": "warn",
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: { react, "react-hooks": reactHooks },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
    },
    settings: { react: { version: "detect" } },
  },
  prettierConfig,
);
