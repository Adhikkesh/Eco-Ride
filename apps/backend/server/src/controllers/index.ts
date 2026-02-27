/**
 * @fileoverview Index Controller
 * @description Contains general-purpose API endpoints for health checks and user information.
 *              These endpoints are used for monitoring and basic user data retrieval.
 * @module controllers/index
 */

import type { RequestHandler } from "express";
import status from "http-status";

/**
 * Health Check Controller
 * @description Simple endpoint to verify the API server is running and responsive.
 *              Returns a success message with HTTP 200 status.
 * @route GET /health
 * @returns {Object} JSON response with health check message
 */
export const HealthCheckController: RequestHandler = (_req, res) => {
  res.status(status.OK).json({ msg: `Hello There ${status["200_MESSAGE"]}` });
};

/**
 * Get Me Controller
 * @description Returns the authenticated user's information from the Firebase token.
 *              Returns null if no user is authenticated.
 * @route GET /me
 * @access Authenticated users
 * @returns {Object} JSON response with user data from Firebase auth token
 */
export const GetMeController: RequestHandler = (req, res) => {
  res
    .status(status.OK)
    .json({ data: req.user ? req.user : null, msg: `Hello There ${status["200_MESSAGE"]}` });
};
