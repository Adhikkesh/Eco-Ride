/**
 * @fileoverview API Routes Configuration
 * @description Defines all API endpoints for the Eco-Ride backend.
 *              Organizes routes by feature area: auth, user, rides, payments, and admin.
 *              All protected routes use the verifyToken middleware for authentication.
 * @module routes/index
 */

import express, { type Router } from "express";
import {
  GetUnverifiedDriversController,
  VerifyDriverController,
} from "../controllers/adminController.js";
import { VerifyTokenController } from "../controllers/authController.js";
import { calculateFare } from "../controllers/fareController.js";
import { GetMeController, HealthCheckController } from "../controllers/index.js";
import { confirmPayment, createPaymentIntent } from "../controllers/paymentController.js";
import { SubmitRatingController, SubmitRiderRatingController } from "../controllers/ratingController.js";
import {
  acceptRide,
  arriveAtPickup,
  cancelRide,
  completeRide,
  declineRide,
  getActiveRide,
  getOtp,
  requestRide,
  startRide,
  verifyOtp,
} from "../controllers/rideController.js";
import { getSavedLocations, updateSavedLocation } from "../controllers/savedLocationsController.js";
import { CreateUserController, GetDriverStatusController } from "../controllers/userController.js";
import {
  predictDemand,
  predictForecast24h,
  predictHeatmap,
  predictSurge,
} from "../controllers/predictionController.js";
import { verifyToken } from "../middleware/authMiddleware.js";

/**
 * Express Router instance for API v1 routes.
 * All routes are prefixed with /api/v1 in app.ts.
 * @type {Router}
 */
export const router: Router = express.Router();

// ============================================================================
// Health Check & Authentication Routes
// ============================================================================

/** Health check endpoint - no auth required */
router.get("/health", HealthCheckController);

/** Verify Firebase token and return user info */
router.get("/auth/verify", verifyToken, VerifyTokenController);

/** Get current authenticated user info */
router.get("/getme", verifyToken, GetMeController);

// ============================================================================
// User Routes
// ============================================================================

/** Create new user account (rider or driver) */
router.post("/user", verifyToken, CreateUserController);

/** Get driver KYC verification status */
router.get("/user/driver-status", verifyToken, GetDriverStatusController);

/** Get user's saved locations (home, work, favourite) */
router.get("/user/saved-locations", verifyToken, getSavedLocations);

/** Update a saved location */
router.put("/user/saved-locations", verifyToken, updateSavedLocation);

// ============================================================================
// Ride Routes
// ============================================================================

/** Request a new ride - matches with nearest available driver */
router.post("/ride/request", verifyToken, requestRide);

/** Get current active ride for authenticated user */
router.get("/ride/active", verifyToken, getActiveRide);

/** Driver accepts a pending ride request */
router.post("/ride/accept", verifyToken, acceptRide);

/** Driver declines a pending ride request - triggers re-matching */
router.post("/ride/decline", verifyToken, declineRide);

/** Get OTP for ride (only available when driver is within 100m of pickup) */
router.get("/ride/otp/:rideId", verifyToken, getOtp);

/** Verify OTP for ride */
router.post("/ride/verify-otp/:rideId", verifyToken, verifyOtp);

/** Cancel an active ride request */
router.post("/ride/cancel", verifyToken, cancelRide);

/** Start ride after OTP verification */
router.post("/ride/start", verifyToken, startRide);

/** Complete a ride at destination */
router.post("/ride/complete", verifyToken, completeRide);

/** Mark arrival at pickup location */
router.post("/ride/arrive", verifyToken, arriveAtPickup);

/** Calculate fare estimate for a route */
router.post("/ride/estimate", verifyToken, calculateFare);

/** Submit driver rating and feedback */
router.post("/ride/rate", verifyToken, SubmitRatingController);

/** Submit rider rating by driver */
router.post("/ride/rate-rider", verifyToken, SubmitRiderRatingController);

// ============================================================================
// Payment Routes
// ============================================================================

/** Create Stripe payment intent for ride payment */
router.post("/payment/create-intent", verifyToken, createPaymentIntent);

/** Confirm successful payment and update ride status */
router.post("/ride/confirm-payment", verifyToken, confirmPayment);

// ============================================================================
// Admin Routes
// ============================================================================

/** Get all drivers pending KYC verification (admin only) */
router.get("/admin/drivers/unverified", verifyToken, GetUnverifiedDriversController);

/** Approve or decline driver verification (admin only) */
router.post("/admin/drivers/verify", verifyToken, VerifyDriverController);

// ============================================================================
// Prediction Proxy Routes (Auth optional for now)
// ============================================================================
router.post("/predict/demand", predictDemand);
router.post("/predict/demand-heatmap", predictHeatmap);
router.post("/predict/surge", predictSurge);
router.post("/predict/forecast-24h", predictForecast24h);
