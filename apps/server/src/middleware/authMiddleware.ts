/**
 * @fileoverview Authentication Middleware
 * @description Provides JWT token verification middleware for protected routes.
 *              Validates Firebase ID tokens and attaches decoded user data to requests.
 * @module middleware/authMiddleware
 */

import type { NextFunction, Request, Response } from "express";
import status from "http-status";
import { auth } from "../config/firebase.js";

/**
 * Verify Token Middleware
 * @description Validates Firebase ID token from Authorization header.
 *              Extracts Bearer token, verifies with Firebase Auth, and attaches
 *              decoded user information to req.user for downstream handlers.
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next function
 * @returns {Response|void} Returns 401 Unauthorized if token is invalid/missing
 */
export const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  // Extract Authorization header
  const authHeader = req.headers.authorization;

  // Check for Bearer token format
  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(status.UNAUTHORIZED).json({ message: "Unauthorized: No token provided" });
  }

  // Extract token from "Bearer <token>" format
  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(status.UNAUTHORIZED).json({ message: "No token present" });
  }

  try {
    // Verify token with Firebase Auth and decode payload
    const decodeToken = await auth.verifyIdToken(token);
    // Attach decoded user to request for use in route handlers
    req.user = decodeToken;
    next();
  } catch (err) {
    console.error("Error verifying token:", err);
    return res.status(status.UNAUTHORIZED).json({ message: "Forbidden: Invalid token" });
  }
};
