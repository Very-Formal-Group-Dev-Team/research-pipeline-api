import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import nodePlugin from "eslint-plugin-node";

const eslintConfig = defineConfig([
  js.configs.recommended,
  {
    plugins: {
      node: nodePlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        console: "readonly",
        process: "readonly",
      },
    },
    rules: {
      ...nodePlugin.configs.recommended.rules,
      "no-console": "off",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "node/no-missing-require": "off",
      "node/no-unpublished-require": "off",
    },
  },
  globalIgnores([
    "node_modules/**",
    "dist/**",
    "build/**",
    "uploads/**",
  ]),
]);

export default eslintConfig;
