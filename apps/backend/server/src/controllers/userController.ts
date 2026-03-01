/**
 * @fileoverview User Controller
 * @description Handles user management operations including user creation and driver status.
 *              Supports both rider and driver registration with appropriate profile creation.
 *              Manages Firestore collections: users, driver_profile, and vehicle.
 * @module controllers/userController
 */

import type { RequestHandler } from "express";
import { FieldValue } from "firebase-admin/firestore";
import status from "http-status";
import { db } from "../config/firebase.js";

/**
 * Request body interface for user creation endpoint.
 * @interface CreateUserBody
 * @property {string} name - User's display name
 * @property {string} phone_number - User's phone number
 * @property {"driver"|"rider"} role - User's role in the platform
 * @property {string} [kyc_url] - Driver's KYC document URL (driver only)
 * @property {string} [license_url] - Driver's license document URL (driver only)
 * @property {string} [plate_number] - Vehicle plate number (driver only)
 * @property {string} [model] - Vehicle model name (driver only)
 * @property {boolean} [is_ev] - Whether vehicle is electric (driver only)
 * @property {string} [pollution_expiry] - Pollution certificate expiry date ISO string (driver only)
 */
interface CreateUserBody {
  name: string;
  phone_number: string;
  role: "driver" | "rider";
  kyc_url?: string;
  license_url?: string;
  plate_number?: string;
  model?: string;
  is_ev?: boolean;
  vehicle_type?: "PETROL" | "DIESEL" | "HYBRID" | "ELECTRIC";
  passenger_capacity?: number;
  pollution_expiry?: string;
}

/**
 * Create User Controller
 * @description Creates a new user account with role-specific profile data.
 *              For drivers, also creates driver_profile and vehicle documents.
 *              Uses Firestore batch writes for atomic operations.
 * @route POST /user/create
 * @access Authenticated users (Firebase token required)
 * @param {CreateUserBody} req.body - User registration data
 * @returns {Object} JSON response with created user data
 */
export const CreateUserController: RequestHandler<object, object, CreateUserBody> = async (
  req,
  res,
) => {
  const {
    name,
    phone_number,
    role,
    kyc_url,
    license_url,
    plate_number,
    model,
    is_ev,
    vehicle_type,
    passenger_capacity,
    pollution_expiry,
  } = req.body;
  const firebaseUser = req.user;

  if (!firebaseUser) {
    return res
      .status(status.UNAUTHORIZED)
      .json({ message: "Unauthorized: User not authenticated" });
  }

  if (!name || !role || !phone_number) {
    return res
      .status(status.BAD_REQUEST)
      .json({ message: "Bad Request: name, phone_number, and role are required" });
  }

  // Validate driver-specific fields
  if (role === "driver") {
    if (!license_url || !plate_number || !model || pollution_expiry === undefined) {
      return res.status(status.BAD_REQUEST).json({
        message:
          "Bad Request: Driver requires license_url, plate_number, model, and pollution_expiry",
      });
    }
  }

  try {
    const batch = db.batch();
    const uid = firebaseUser.uid;
    const now = FieldValue.serverTimestamp();

    // 1. Create USERS document (includes auth info directly)
    const userRef = db.collection("users").doc(uid);
    batch.set(
      userRef,
      {
        created_at: now,
        email: firebaseUser.email || null,
        fcm_token: null,
        green_points: 0,
        is_onboarded: true, // Mark as onboarded on backend creation
        last_login: now,
        name,
        phone_number,
        role,
        saved_locations: null,
        trust_score: 0.0,
        uid,
      },
      { merge: true },
    ); // Use merge to preserve other fields

    // 2. If driver, create DRIVER_PROFILE and VEHICLE documents
    if (role === "driver") {
      // Create DRIVER_PROFILE
      const driverProfileRef = db.collection("driver_profile").doc(uid);
      batch.set(driverProfileRef, {
        current_location: null,
        driver_uid: uid,
        is_online: false,
        kyc_url: kyc_url || null,
        kyc_verified: false,
        license_url: license_url || null,
        rating: 0,
        rating_count: 0,
        wallet_balance: 0.0,
      });

      // Create VEHICLE
      const vehicleRef = db.collection("vehicle").doc(plate_number!);
      batch.set(vehicleRef, {
        driver_uid: uid,
        is_ev: is_ev || false,
        model,
        passenger_capacity: passenger_capacity || 4,
        plate_number,
        pollution_expiry: pollution_expiry ? new Date(pollution_expiry) : null,
        vehicle_type: vehicle_type || "PETROL",
      });
    }

    // Commit all writes as a batch
    await batch.commit();

    res.status(status.CREATED).json({
      data: {
        email: firebaseUser.email,
        name,
        role,
        uid,
      },
      message: "User created successfully",
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(status.INTERNAL_SERVER_ERROR).json({
      error: error instanceof Error ? error.message : "Unknown error",
      message: "Failed to create user",
    });
  }
};

/**
 * Get Driver Status Controller
 * @description Retrieves the KYC verification status for the authenticated driver.
 *              Returns false if driver profile doesn't exist.
 * @route GET /user/driver-status
 * @access Authenticated users (drivers)
 * @returns {Object} JSON response with kyc_verified boolean
 */
export const GetDriverStatusController: RequestHandler = async (req, res) => {
  const firebaseUser = req.user;

  if (!firebaseUser) {
    return res.status(status.UNAUTHORIZED).json({ message: "Unauthorized" });
  }

  try {
    const driverProfileDoc = await db.collection("driver_profile").doc(firebaseUser.uid).get();

    if (!driverProfileDoc.exists) {
      return res.status(status.OK).json({ kyc_verified: false });
    }

    const data = driverProfileDoc.data();
    return res.status(status.OK).json({
      kyc_verified: data?.kyc_verified || false,
    });
  } catch (error) {
    console.error("Error fetching driver status:", error);
    return res.status(status.INTERNAL_SERVER_ERROR).json({ message: "Internal Server Error" });
  }
};
