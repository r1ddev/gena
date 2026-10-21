import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      // Keep thresholds on deterministic accounting rules;
      // database adapters and framework route handlers are covered by smoke tests.
      include: ["src/domain/accounting.ts"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
