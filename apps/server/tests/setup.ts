/**
 * Vitest Setup File
 *
 * This file runs before each test file and sets up the testing environment.
 * It configures environment variables for testing.
 *
 * @author Eco-Ride Team
 * @date 2026-02-03
 */

// Mock environment variables for testing
process.env.GOOGLE_API_KEY = "test-google-api-key";
process.env.STRIPE_SECRET_KEY = "sk_test_mock_key";
process.env.NODE_ENV = "test";

// Suppress console output during tests unless DEBUG is set
if (!process.env.DEBUG) {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
}
