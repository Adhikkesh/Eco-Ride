/**
 * Vitest Setup File for Simulator
 *
 * Configures mock environment variables and suppresses console output.
 */

// Mock environment variables
process.env.GOOGLE_MAPS_API_KEY = "test-google-maps-api-key";
process.env.FIREBASE_CREDENTIAL_PATH = "/mock/path/to/creds.json";
process.env.FIREBASE_DATABASE_URL = "https://mock-project.firebaseio.com";
process.env.NODE_ENV = "test";

// Suppress console output during tests
if (!process.env.DEBUG) {
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
}
