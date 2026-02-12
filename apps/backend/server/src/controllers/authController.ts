/**
 * @fileoverview Authentication Controller
 * @description Provides token verification endpoints for the Eco-Ride platform.
 *              Works in conjunction with the `verifyToken` middleware which validates
 *              Firebase ID tokens before requests reach these handlers.
 * @module controllers/authController
 */

import type { RequestHandler } from "express";
import status from "http-status";

/**
 * Validates the caller's Firebase ID token and returns their profile.
 *
 * This controller is always preceded by the `verifyToken` middleware, so if
 * execution reaches it the token is already verified. It extracts key user
 * fields (email, name, picture, uid) from the decoded token and returns them
 * to the frontend, which uses the response to bootstrap the session.
 *
 * @param _req - Express request with `user` populated by `verifyToken` middleware.
 * @param res - Express response.
 * @returns JSON containing the user profile and a `valid` flag.
 * @throws Returns 401 if the decoded token is unexpectedly missing.
 */
export const VerifyTokenController: RequestHandler = (_req, res) => {
  // If we reach here, the token was valid (verified by middleware)
  const user = _req.user;

  if (!user) {
    return res.status(status.UNAUTHORIZED).json({
      message: "No valid token provided",
      valid: false,
    });
  }

  res.status(status.OK).json({
    user: {
      email: user.email,
      emailVerified: user.email_verified,
      name: user.name,
      picture: user.picture,
      uid: user.uid,
    },
    valid: true,
  });
};
