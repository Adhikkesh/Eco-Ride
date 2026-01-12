import type { RequestHandler } from "express";
import status from "http-status";

/**
 * Verify Token Controller
 * Validates the Firebase ID token and returns user information.
 * This endpoint is used by the frontend to check if a user has a valid session.
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
