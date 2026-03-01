/**
 * @fileoverview Rating Controller
 * @description Handles driver rating and feedback submissions.
 *              Updates driver's average rating in driver_profile and stores
 *              detailed feedback in the ratings collection.
 * @module controllers/ratingController
 */

import type { Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import status from "http-status";
import { db } from "../config/firebase.js";

/**
 * Submit Rating Controller
 * @description Submits a new rating for a driver.
 *              Calculates the new average rating and updates the driver's profile.
 *              Stores the detailed feedback record.
 * @route POST /ride/rate
 * @access Authenticated users (Rider)
 */
export const SubmitRatingController = async (req: Request, res: Response) => {
  const { rideId, driverId, rating, comment } = req.body;
  const riderId = req.user?.uid;

  if (!riderId) {
    return res.status(status.UNAUTHORIZED).json({ message: "Unauthorized" });
  }

  if (!rideId || !driverId || rating === undefined) {
    return res.status(status.BAD_REQUEST).json({
      message: "Missing required fields: rideId, driverId, rating",
    });
  }

  // Ensure rating is within 1-5 range
  const starRating = Math.max(1, Math.min(5, Number(rating)));

  try {
    const driverProfileRef = db.collection("driver_profile").doc(driverId);

    // Use a transaction to ensure atomic update of rating and count
    await db.runTransaction(async (transaction) => {
      const driverDoc = await transaction.get(driverProfileRef);

      if (!driverDoc.exists) {
        throw new Error("Driver profile not found");
      }

      const data = driverDoc.data();
      const currentRating = data?.rating || 0;
      const currentCount = data?.rating_count || 0;

      const newCount = currentCount + 1;
      const newRating = (currentRating * currentCount + starRating) / newCount;

      // 1. Update Driver Profile with new average
      transaction.update(driverProfileRef, {
        rating: newRating,
        rating_count: newCount,
      });

      // 2. Create entry in ratings collection
      const ratingRef = db.collection("ratings").doc();
      transaction.set(ratingRef, {
        comment: comment || "",
        createdAt: FieldValue.serverTimestamp(),
        driverId,
        rating: starRating,
        rideId,
        riderId,
      });
    });

    return res.status(status.OK).json({
      message: "Rating submitted successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error submitting rating:", error);
    return res.status(status.INTERNAL_SERVER_ERROR).json({
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to submit rating",
    });
  }
};

/**
 * Submit Rider Rating Controller
 * @description Allows a driver to rate a rider after a completed ride.
 *              Calculates the new average rider rating and updates the user's profile.
 *              Stores the detailed feedback record in rider_ratings collection.
 * @route POST /ride/rate-rider
 * @access Authenticated users (Driver)
 */
export const SubmitRiderRatingController = async (req: Request, res: Response) => {
  const { rideId, riderId, rating, comment } = req.body;
  const driverId = req.user?.uid;

  if (!driverId) {
    return res.status(status.UNAUTHORIZED).json({ message: "Unauthorized" });
  }

  if (!rideId || !riderId || rating === undefined) {
    return res.status(status.BAD_REQUEST).json({
      message: "Missing required fields: rideId, riderId, rating",
    });
  }

  // Ensure rating is within 1-5 range
  const starRating = Math.max(1, Math.min(5, Number(rating)));

  try {
    const riderRef = db.collection("users").doc(riderId);

    // Use a transaction to ensure atomic update of rating and count
    await db.runTransaction(async (transaction) => {
      const riderDoc = await transaction.get(riderRef);

      if (!riderDoc.exists) {
        throw new Error("Rider not found");
      }

      const data = riderDoc.data();
      const currentRating = data?.rider_rating || 0;
      const currentCount = data?.rider_rating_count || 0;

      const newCount = currentCount + 1;
      const newRating = (currentRating * currentCount + starRating) / newCount;

      // Compute trust_score as (avgRating / 5) * 100  → 0-100%
      // e.g., 4.5 avg → 90%, 3.0 avg → 60%
      const trustScore = Math.round((newRating / 5) * 100);

      // 1. Update Rider's user document with new average + trust score
      transaction.update(riderRef, {
        rider_rating: newRating,
        rider_rating_count: newCount,
        trust_score: trustScore,
      });

      // 2. Create entry in rider_ratings collection
      const ratingRef = db.collection("rider_ratings").doc();
      transaction.set(ratingRef, {
        comment: comment || "",
        createdAt: FieldValue.serverTimestamp(),
        driverId,
        rating: starRating,
        rideId,
        riderId,
      });
    });

    return res.status(status.OK).json({
      message: "Rider rating submitted successfully",
      success: true,
    });
  } catch (error) {
    console.error("Error submitting rider rating:", error);
    return res.status(status.INTERNAL_SERVER_ERROR).json({
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to submit rider rating",
    });
  }
};
