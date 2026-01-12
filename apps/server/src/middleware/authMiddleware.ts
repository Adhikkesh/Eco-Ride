import type { NextFunction, Request, Response } from "express";
import status from "http-status";
import { auth } from "../config/firebase.js";

export const verifyToken = async (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer")) {
    return res.status(status.UNAUTHORIZED).json({ message: "Unauthorized: No token provided" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(status.UNAUTHORIZED).json({ message: "No token present" });
  }

  try {
    const decodeToken = await auth.verifyIdToken(token);
    req.user = decodeToken;
    next();
  } catch (err) {
    console.error("Error verifying token:", err);
    return res.status(status.UNAUTHORIZED).json({ message: "Forbidden: Invalid token" });
  }
};
