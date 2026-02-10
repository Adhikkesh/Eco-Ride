/**
 * @fileoverview Server Entry Point
 * @description Main entry point for the Eco-Ride backend server.
 *              Handles environment configuration loading and server initialization.
 *              Loads environment variables from root .env file before starting the Express app.
 * @module index
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Get current file path for ES modules (replacement for __dirname in CommonJS).
 * Required because ES modules don't have __dirname by default.
 */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Path to the root .env file.
 * Environment variables are loaded from the monorepo root for consistent configuration.
 */
const envPath = path.join(__dirname, "../../../../.env");
console.log("Loading .env from:", envPath);
dotenv.config({ path: envPath });

// Log environment variable status for debugging
console.log(
  "Environment Check - GOOGLE_API_KEY:",
  process.env.GOOGLE_API_KEY ? "EXISTS" : "MISSING",
);

/**
 * Dynamic import of the Express application.
 * Done after environment variables are loaded to ensure config is available.
 */
const { app } = await import("./app.js");

/**
 * Server port configuration.
 * Defaults to 3001 if PORT environment variable is not set.
 * @constant {number|string}
 */
const PORT = process.env.PORT || 3001;

/**
 * Start the Express server.
 * Listens on configured port and logs startup message.
 */
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
