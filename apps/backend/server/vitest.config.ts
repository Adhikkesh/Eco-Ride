/**
 * Vitest Configuration for Eco-Ride Server
 *
 * This configuration sets up the testing environment for the backend server.
 * It includes TypeScript support, coverage reporting, and test file patterns.
 *
 * @author Eco-Ride Team
 * @date 2026-02-03
 */

import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Coverage configuration
    coverage: {
      // Files to exclude from coverage
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/types/**"],

      // Files to include in coverage
      include: ["src/**/*.ts"],
      // Coverage provider
      provider: "v8",

      // Coverage reporters
      reporter: ["text", "html", "lcov"],

      // Output directory for coverage reports
      reportsDirectory: "./coverage",
    },

    // Use Node.js environment for server-side testing
    environment: "node",
    // Enable globals like describe, it, expect without imports
    globals: true,

    // Test file patterns
    include: ["src/**/*.test.ts", "src/**/*.spec.ts", "tests/**/*.test.ts"],

    // Reporter for test results
    reporters: ["verbose"],

    // Setup files to run before each test file
    setupFiles: ["./tests/setup.ts"],

    // Timeout for tests (in ms)
    testTimeout: 10000,
  },
});
