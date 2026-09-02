import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

function resolveMaxWorkers(
  value: string | undefined,
  fallback: number,
): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export default defineConfig({
  resolve: {
    alias: {
      "@echovisionlab/geul-common": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    environment: "node",
    pool: "forks",
    fileParallelism: true,
    isolate: true,
    maxWorkers: resolveMaxWorkers(process.env.VITEST_COMMON_MAX_WORKERS, 2),
    sequence: {
      concurrent: false,
    },
    include: ["src/**/*.test.ts"],
    exclude: ["coverage/**", "dist/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test/**"],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100,
      },
    },
  },
});
