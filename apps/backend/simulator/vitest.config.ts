/**
 * Vitest Configuration for Eco-Ride Simulator
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts"],
      include: ["src/**/*.ts"],
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
    },
    environment: "node",
    globals: true,
    include: ["tests/**/*.test.ts"],
    reporters: ["verbose"],
    setupFiles: ["./tests/setup.ts"],
    testTimeout: 10000,
  },
});
