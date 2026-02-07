/**
 * @fileoverview Express Application Configuration
 * @description Configures and exports the Express application instance.
 *              Sets up middleware (CORS, JSON parsing) and mounts API routes.
 * @module app
 */

import cors from "cors";
import express from "express";
import { router } from "./routes/index.js";

/**
 * Express application instance.
 * Configured with CORS support, JSON body parsing, and API routes.
 * @type {express.Application}
 */
export const app: express.Application = express();

// Enable Cross-Origin Resource Sharing for frontend access
app.use(cors());

// Parse incoming JSON request bodies
app.use(express.json());

// Mount all API routes under /api/v1 prefix
app.use("/api/v1", router);
