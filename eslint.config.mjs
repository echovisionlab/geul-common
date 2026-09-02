import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig(
  tseslint.configs.recommended,
  {
    ignores: [
      "**/*.{mjs,cjs,js,d.ts,d.mts}",
      "coverage",
      "dist",
      "vitest.config.ts",
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: process.cwd(),
        project: ["./tsconfig.json"],
      },
    },
  },
);
