/**
 * @fileoverview Ride Controller
 * @description Handles all ride-related operations for the Eco-Ride platform.
 *              Includes ride request, matching with nearby drivers, ride lifecycle
 *              management (start, cancel, complete), and active ride queries.
 *              Uses geolocation-based driver matching with expanding radius search.
 * @module controllers/rideController
 */

import type { Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import * as geofire from "geofire-common";
import { db, rtdb } from "../config/firebase.js";

/**
 * Interface representing a driver's real-time location data.
 * Stored in Firebase Realtime Database under 'drivers-online' node.
 * @interface DriverLocation
 * @property {number} lat - Driver's current latitude
 * @property {number} lng - Driver's current longitude
 * @property {number} heading - Direction the driver is facing (degrees)
 * @property {"AVAILABLE"|"BUSY"|"RESERVED"} status - Driver's current availability
 * @property {number} lastUpdated - Timestamp of last location update
 * @property {string} [vehicleType] - Type of vehicle (optional)
 * @property {string} [geohash] - Geohash for location-based queries (optional)
 */
interface DriverLocation {
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY" | "RESERVED";
  lastUpdated: number;
  vehicleType?: string;
  geohash?: string;
}

/**
 * Interface for matched driver information.
 * Used during the driver matching process.
 * @interface DriverMatch
 * @property {string} driverId - Unique identifier of the driver
 * @property {number} lat - Driver's latitude at time of match
 * @property {number} lng - Driver's longitude at time of match
 * @property {number} distance - Distance from pickup location in kilometers
 * @property {string} status - Driver's status at time of match
 */
interface DriverMatch {
  driverId: string;
  lat: number;
  lng: number;
  distance: number;
  status: string;
}

/**
 * Request Ride Controller
 * @description Handles new ride requests from riders. Implements an expanding radius
 *              search algorithm to find the nearest available driver within 100km.
 *              Creates ride record in Firestore with PENDING_ACCEPTANCE status.
 *              Driver must accept/decline before ride proceeds.
 * @route POST /ride/request
 * @param {Object} req.body - Ride request parameters
 * @param {string} req.body.riderId - The rider's unique identifier
 * @param {number} req.body.pickupLat - Pickup location latitude
 * @param {number} req.body.pickupLng - Pickup location longitude
 * @param {number} req.body.dropLat - Drop-off location latitude
 * @param {number} req.body.dropLng - Drop-off location longitude
 * @param {number} [req.body.fare] - Pre-calculated fare (optional)
 * @param {string[]} [req.body.declinedDrivers] - Drivers who already declined (for re-matching)
 * @returns {Object} JSON response with matched driver details, ride ID, and ETA
 */
export const requestRide = async (req: Request, res: Response) => {
  try {
    const {
      riderId,
      pickupLat,
      pickupLng,
      dropLat,
      dropLng,
      fare,
      declinedDrivers = [],
    } = req.body;

    // Validate required fields
    // Changed ! check to undefined check to allow coordinates that are 0
    if (
      riderId === undefined ||
      pickupLat === undefined ||
      pickupLng === undefined ||
      dropLat === undefined ||
      dropLng === undefined
    ) {
      return res.status(400).json({
        message: "Missing required fields: riderId, pickupLat, pickupLng, dropLat, dropLng",
        success: false,
      });
    }

    const center: [number, number] = [pickupLat, pickupLng];
    const radiusIncrement = 5; // 5km increments
    const maxRadius = 100; // Maximum search radius to prevent infinite loops

    // ---------------------------------------------------------
    // STEP 1: FETCH ALL ONLINE DRIVERS FROM RTDB
    // ---------------------------------------------------------
    const driversSnapshot = await rtdb.ref("drivers-online").once("value");
    const driversData = driversSnapshot.val();

    if (!driversData) {
      return res.status(404).json({
        message: "No drivers are currently online",
        success: false,
      });
    }

    // ---------------------------------------------------------
    // STEP 2: FILTER BY DISTANCE AND STATUS (WITH EXPANDING RADIUS)
    // ---------------------------------------------------------
    const matchingDrivers: DriverMatch[] = [];
    let currentRadius = radiusIncrement;
    const declinedSet = new Set(declinedDrivers as string[]);
    const now = Date.now();
    const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes threshold for stale location updates

    console.log("=== RIDE REQUEST DEBUG ===");
    console.log("Total drivers online:", Object.keys(driversData).length);
    console.log("Declined drivers:", declinedDrivers);

    // Keep expanding radius until we find drivers or hit max radius
    while (matchingDrivers.length === 0 && currentRadius <= maxRadius) {
      console.log(`Searching within ${currentRadius}km radius...`);

      for (const [driverId, locationData] of Object.entries(driversData)) {
        try {
          const driver = locationData as DriverLocation;

          // Skip drivers with missing location data
          if (driver.lat === undefined || driver.lng === undefined) {
            console.log(`  -> Skipping ${driverId}: missing location data`);
            continue;
          }

          // Filter out stale drivers (older than 5 mins)
          if (!driver.lastUpdated || now - driver.lastUpdated > STALE_THRESHOLD) {
            console.log(`  -> Skipping ${driverId}: stale location update`);
            continue;
          }

          // Skip declined drivers
          if (declinedSet.has(driverId)) {
            console.log(`  -> Skipping ${driverId}: previously declined`);
            continue;
          }

          console.log(
            `Driver ${driverId}: status=${driver.status}, lat=${driver.lat}, lng=${driver.lng}`,
          );

          // Only consider AVAILABLE drivers
          if (driver.status !== "AVAILABLE") {
            console.log(`  -> Skipping: status is ${driver.status}, not AVAILABLE`);
            continue;
          }

          // Calculate distance from pickup location
          const distanceInKm = geofire.distanceBetween([driver.lat, driver.lng], center);
          console.log(`  -> Distance: ${distanceInKm.toFixed(2)} km`);

          if (distanceInKm <= currentRadius) {
            matchingDrivers.push({
              distance: distanceInKm,
              driverId,
              lat: driver.lat,
              lng: driver.lng,
              status: driver.status,
            });
            console.log(`  -> ADDED to matching drivers`);
          } else {
            console.log(`  -> Skipping: outside ${currentRadius}km radius`);
          }
        } catch (driverErr) {
          // Isolate errors per driver to prevent one malformed entry from crashing the whole request
          console.error(`Error processing driver ${driverId}:`, driverErr);
        }
      }

      if (matchingDrivers.length === 0) {
        console.log(`No drivers found within ${currentRadius}km, expanding radius...`);
        currentRadius += radiusIncrement;
      }
    }

    // Sort by distance (nearest first)
    matchingDrivers.sort((a, b) => a.distance - b.distance);

    console.log(`Final search radius: ${currentRadius}km`);
    console.log("Matching drivers count:", matchingDrivers.length);

    if (matchingDrivers.length === 0) {
      return res.status(404).json({
        message: `No available drivers found within ${maxRadius}km of your location`,
        success: false,
      });
    }

    // ---------------------------------------------------------
    // STEP 3: RESERVE THE NEAREST DRIVER (Direct Update)
    // ---------------------------------------------------------
    let assignedDriver: DriverMatch | null = null;

    for (const driver of matchingDrivers) {
      console.log(`Attempting to reserve driver: ${driver.driverId}`);
      const driverRef = rtdb.ref(`drivers-online/${driver.driverId}`);

      try {
        // Re-check current status before updating
        const snapshot = await driverRef.once("value");
        const currentData = snapshot.val() as DriverLocation | null;

        console.log(`Current data for ${driver.driverId}:`, currentData);

        if (currentData && currentData.status === "AVAILABLE") {
          // Update status to RESERVED (pending acceptance)
          await driverRef.update({ status: "RESERVED" });
          assignedDriver = driver;
          console.log(`Successfully reserved driver: ${driver.driverId}`);
          break;
        } else {
          console.log(`Driver ${driver.driverId} not available, status: ${currentData?.status}`);
        }
      } catch (err) {
        console.error(`Error reserving driver ${driver.driverId}:`, err);
      }
    }

    if (!assignedDriver) {
      return res.status(409).json({
        message: "All nearby drivers are currently busy. Please try again.",
        success: false,
      });
    }

    // ---------------------------------------------------------
    // STEP 4: CREATE RIDE DOCUMENT IN FIRESTORE
    // ---------------------------------------------------------
    let driverName = "Unknown Driver";
    let driverRating = 0;
    let driverRatingCount = 0;
    let riderName = "Unknown Rider";
    let riderPhone = "No Phone";

    try {
      const [driverDoc, driverProfileDoc, riderDoc] = await Promise.all([
        db.collection("users").doc(assignedDriver.driverId).get(),
        db.collection("driver_profile").doc(assignedDriver.driverId).get(),
        db.collection("users").doc(riderId).get(),
      ]);

      if (driverDoc.exists) {
        driverName = driverDoc.data()?.name || "Unknown Driver";
      }

      if (driverProfileDoc.exists) {
        const profileData = driverProfileDoc.data();
        driverRating = profileData?.rating || 0;
        driverRatingCount = profileData?.rating_count || 0;
      }

      if (riderDoc.exists) {
        riderName = riderDoc.data()?.name || "Unknown Rider";
        riderPhone = riderDoc.data()?.phone_number || "No Phone";
      }
    } catch (err) {
      console.error("Error fetching user details:", err);
    }

    // Create ride with PENDING_ACCEPTANCE status - driver must accept first
    const rideData = {
      createdAt: FieldValue.serverTimestamp(),
      declinedDrivers: declinedDrivers || [],
      driverId: assignedDriver.driverId,
      driverName,
      drop: { lat: dropLat, lng: dropLng },
      fare: fare || null,
      otp: Math.floor(1000 + Math.random() * 9000).toString(), // Generate 4-digit OTP (hidden until 100m)
      otpRevealed: false, // OTP is not revealed until driver is within 100m
      pickup: { lat: pickupLat, lng: pickupLng },
      riderId,
      riderName,
      riderPhone,
      status: "PENDING_ACCEPTANCE", // NEW: Driver must accept before proceeding
    };

    const rideRef = await db.collection("rides").add(rideData);

    // ---------------------------------------------------------
    // STEP 4.1: WRITE TO PENDING RIDES IN RTDB FOR DRIVER TO ACCEPT/DECLINE
    // ---------------------------------------------------------
    const pendingRideData = {
      drop: { lat: dropLat, lng: dropLng },
      fare: fare || null,
      pickup: { lat: pickupLat, lng: pickupLng },
      rideId: rideRef.id,
      riderId,
      riderName,
      riderPhone,
      status: "PENDING_ACCEPTANCE",
      timestamp: Date.now(),
    };

    // Write to rides-pending (driver listens here for acceptance prompt)
    await rtdb.ref(`rides-pending/${assignedDriver.driverId}`).set(pendingRideData);
    console.log(`Pending ride published to RTDB for driver: ${assignedDriver.driverId}`);

    // Also write to rides node for rider to track status
    await rtdb.ref(`rides/${rideRef.id}`).set({
      driverId: assignedDriver.driverId,
      driverLocation: { lat: assignedDriver.lat, lng: assignedDriver.lng },
      status: "PENDING_ACCEPTANCE",
    });

    // ---------------------------------------------------------
    // STEP 5: RETURN SUCCESS RESPONSE
    // ---------------------------------------------------------
    const etaMinutes = Math.ceil(assignedDriver.distance * 2);

    return res.status(200).json({
      distance: Math.round(assignedDriver.distance * 1000),
      driverId: assignedDriver.driverId,
      driverLocation: {
        lat: assignedDriver.lat,
        lng: assignedDriver.lng,
      },
      driverName,
      driverRating,
      driverRatingCount,
      eta: `${etaMinutes} min`,
      message: "Waiting for driver to accept the ride",
      otp: rideData.otp, // Return OTP so rider can see it immediately
      rideId: rideRef.id,
      status: "PENDING_ACCEPTANCE",
      success: true,
    });
  } catch (error) {
    console.error("Ride Request Error Stack:", error instanceof Error ? error.stack : error);
    return res.status(500).json({
      message: "Internal server error while processing ride request",
      success: false,
    });
  }
};

/**
 * Cancel Ride Controller
 * @description Cancels an active ride request. Updates ride status in Firestore,
 *              removes driver assignment from RTDB, and sets driver back to AVAILABLE.
 * @route POST /ride/cancel
 * @param {Object} req.body - Request body
 * @param {string} req.body.rideId - The unique identifier of the ride to cancel
 * @returns {Object} JSON response with cancellation status
 */
export const cancelRide = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;

    if (!rideId) {
      return res.status(400).json({
        message: "Missing rideId",
        success: false,
      });
    }

    // Get ride details
    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({
        message: "Ride not found",
        success: false,
      });
    }

    const rideData = rideDoc.data();
    const driverId = rideData?.driverId;

    // 1. Update Firestore status
    await rideRef.update({
      cancelledAt: FieldValue.serverTimestamp(),
      status: "CANCELLED",
    });

    // 2. Notify Driver (Remove assignment/pending) & Make Driver Available
    if (driverId) {
      await Promise.all([
        rtdb.ref(`rides-assigned/${driverId}`).remove(),
        rtdb.ref(`rides-pending/${driverId}`).remove(),
        rtdb.ref(`drivers-online/${driverId}`).update({
          status: "AVAILABLE",
        }),
      ]);
    }

    return res.status(200).json({
      message: "Ride cancelled successfully",
      success: true,
    });
  } catch (error) {
    console.error("Cancel Ride Error:", error);
    return res.status(500).json({
      message: "Internal server error while cancelling ride",
      success: false,
    });
  }
};

/**
 * Arrive At Pickup Controller
 * @description Driver marks themselves as arrived at the pickup location.
 *              Starts a 5-minute auto-cancellation timer.
 * @route POST /ride/arrive
 */
export const arriveAtPickup = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;
    const driverId = req.user?.uid;

    if (!rideId) return res.status(400).json({ message: "Missing rideId", success: false });
    if (!driverId) return res.status(401).json({ message: "Unauthorized", success: false });

    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({ message: "Ride not found", success: false });
    }

    const rideData = rideDoc.data();
    if (rideData?.driverId !== driverId) {
      return res.status(403).json({ message: "Not authorized", success: false });
    }

    if (rideData?.status !== "MATCHED") {
      return res.status(400).json({
        message: `Already in status: ${rideData?.status}`,
        success: false,
      });
    }

    const arrivedAt = Date.now();
    await rideRef.update({
      arrivedAt: FieldValue.serverTimestamp(),
      status: "ARRIVED",
    });

    // Update RTDB - ensure arrivedAt is a number (timestamp)
    const updates = {
      [`rides/${rideId}/status`]: "ARRIVED",
      [`rides/${rideId}/arrivedAt`]: arrivedAt,
      [`rides-assigned/${driverId}/status`]: "ARRIVED",
      [`rides-assigned/${driverId}/arrivedAt`]: arrivedAt,
    };
    await rtdb.ref().update(updates);

    // Schedule auto-cancellation after 5 minutes
    setTimeout(
      async () => {
        try {
          const currentDoc = await rideRef.get();
          if (currentDoc.exists && currentDoc.data()?.status === "ARRIVED") {
            console.log(`Auto-cancelling ride ${rideId} due to 5-min timeout`);

            await rideRef.update({
              cancelledAt: FieldValue.serverTimestamp(),
              cancelReason: "TIMEOUT",
              status: "CANCELLED",
            });

            // Sync to RTDB
            await Promise.all([
              rtdb.ref(`rides/${rideId}`).update({
                cancelReason: "TIMEOUT",
                status: "CANCELLED",
              }),
              rtdb.ref(`rides-assigned/${driverId}`).remove(),
              rtdb.ref(`drivers-online/${driverId}`).update({ status: "AVAILABLE" }),
            ]);
          }
        } catch (err) {
          console.error(`Error in auto-cancellation for ride ${rideId}:`, err);
        }
      },
      5 * 60 * 1000,
    ); // 5 minutes

    return res.status(200).json({ message: "Arrival marked successfully", success: true });
  } catch (error) {
    console.error("Arrive At Pickup Error:", error);
    return res.status(500).json({ message: "Error marking arrival", success: false });
  }
};

/**
 * Start Ride Controller
 * @description Initiates a matched ride after OTP verification by the driver.
 *              Validates the OTP provided by rider and updates ride status to IN_PROGRESS.
 *              Syncs status to both Firestore and RTDB for real-time updates.
 * @route POST /ride/start
 * @param {Object} req.body - Request body
 * @param {string} req.body.rideId - The unique identifier of the ride
 * @param {string} req.body.otp - The 4-digit OTP provided by the rider
 * @returns {Object} JSON response with ride start status
 */
export const startRide = async (req: Request, res: Response) => {
  try {
    const { rideId, otp } = req.body;
    if (!rideId) return res.status(400).json({ message: "Missing rideId", success: false });
    if (!otp) return res.status(400).json({ message: "Missing OTP", success: false });

    // Validate OTP
    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({ message: "Ride not found", success: false });
    }

    const rideData = rideDoc.data();
    if (rideData?.otp !== otp) {
      return res.status(400).json({ message: "Invalid OTP", success: false });
    }

    // Allow starting if status is MATCHED (accepted) or ARRIVED (reached pickup)
    if (rideData?.status !== "MATCHED" && rideData?.status !== "ARRIVED") {
      return res.status(400).json({
        message: `Cannot start ride with status: ${rideData?.status}`,
        success: false,
      });
    }

    await rideRef.update({
      startedAt: FieldValue.serverTimestamp(),
      status: "IN_PROGRESS",
    });

    // Sync to RTDB for frontend listener
    await rtdb.ref(`rides/${rideId}`).update({
      status: "IN_PROGRESS",
    });

    // Also update the driver's assignment record so they know the status on reload
    if (rideData?.driverId) {
      await rtdb.ref(`rides-assigned/${rideData.driverId}`).update({
        status: "IN_PROGRESS",
      });
    }

    return res.status(200).json({ message: "Ride started", success: true });
  } catch (error) {
    console.error("Start Ride Error:", error);
    return res.status(500).json({ message: "Error starting ride", success: false });
  }
};

/**
 * Complete Ride Controller
 * @description Marks a ride as completed after reaching the destination.
 *              Updates ride status, frees up the driver for new rides,
 *              and syncs completion status to RTDB for frontend listeners.
 * @route POST /ride/complete
 * @param {Object} req.body - Request body
 * @param {string} req.body.rideId - The unique identifier of the ride
 * @returns {Object} JSON response with completion status
 */
export const completeRide = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;
    if (!rideId) return res.status(400).json({ message: "Missing rideId", success: false });

    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) return res.status(404).json({ message: "Ride not found", success: false });

    const driverId = rideDoc.data()?.driverId;

    // 1. Update Ride Status
    await rideRef.update({
      completedAt: FieldValue.serverTimestamp(),
      status: "COMPLETED",
    });

    // 2. Remove ride assignment but keep driver BUSY until payment is confirmed
    // Driver status will be set to AVAILABLE after payment confirmation
    if (driverId) {
      await rtdb.ref(`rides-assigned/${driverId}`).remove();
      // NOTE: Driver stays BUSY until payment is confirmed via confirmPayment
    }

    // 3. Sync to RTDB for frontend listener
    await rtdb.ref(`rides/${rideId}`).update({
      status: "COMPLETED",
    });

    return res.status(200).json({ message: "Ride completed", success: true });
  } catch (error) {
    console.error("Complete Ride Error:", error);
    return res.status(500).json({ message: "Error completing ride", success: false });
  }
};

/**
 * Get Active Ride Controller
 * @description Retrieves the currently active ride for an authenticated rider.
 *              Returns ride details including driver info, locations, and OTP.
 *              Only returns rides with status MATCHED or IN_PROGRESS.
 * @route GET /ride/active
 * @access Authenticated users (rider)
 * @returns {Object} JSON response with active ride details or 404 if none found
 */
export const getActiveRide = async (req: Request, res: Response) => {
  try {
    // metadata is attached by verifyToken middleware
    const riderId = req.user?.uid;

    if (!riderId) {
      return res.status(401).json({
        message: "Unauthorized",
        success: false,
      });
    }

    const ridesRef = db.collection("rides");
    const snapshot = await ridesRef
      .where("riderId", "==", riderId)
      .where("status", "in", ["PENDING_ACCEPTANCE", "MATCHED", "IN_PROGRESS"])
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({
        message: "No active ride found",
        success: false,
      });
    }

    const rideDoc = snapshot.docs[0];

    if (!rideDoc) {
      return res.status(404).json({
        message: "No active ride found",
        success: false,
      });
    }

    const rideData = rideDoc.data();
    const driverId = rideData.driverId;

    let driverRating = 0;
    let driverRatingCount = 0;

    if (driverId) {
      try {
        const profileDoc = await db.collection("driver_profile").doc(driverId).get();
        if (profileDoc.exists) {
          const profileData = profileDoc.data();
          driverRating = profileData?.rating || 0;
          driverRatingCount = profileData?.rating_count || 0;
        }
      } catch (err) {
        console.error("Error fetching driver rating for active ride:", err);
      }
    }

    // If driverName is missing in Firestore, we can fetch it here safely (Admin SDK)
    let driverName = rideData.driverName;
    if (!driverName && rideData.driverId) {
      try {
        const userDoc = await db.collection("users").doc(rideData.driverId).get();
        if (userDoc.exists) {
          driverName = userDoc.data()?.name || "Unknown Driver";
        }
      } catch (err) {
        console.error("Error fetching driver name in active ride check:", err);
      }
    }

    return res.status(200).json({
      driverId: rideData.driverId,
      driverName: driverName || "Unknown Driver",
      driverPhone: rideData.driverPhone || "No Phone",
      driverRating,
      driverRatingCount,
      drop: rideData.drop,
      otp: rideData.otp, // Include OTP for active rides
      pickup: rideData.pickup,
      rideId: rideDoc.id,
      status: rideData.status,
      success: true,
    });
  } catch (error) {
    console.error("Get Active Ride Error:", error);
    return res.status(500).json({
      message: "Internal server error fetching active ride",
      success: false,
    });
  }
};

/**
 * Accept Ride Controller
 * @description Driver accepts a pending ride request.
 *              Moves ride from PENDING_ACCEPTANCE to MATCHED status.
 *              Transfers assignment from rides-pending to rides-assigned.
 * @route POST /ride/accept
 * @param {Object} req.body - Request body
 * @param {string} req.body.rideId - The unique identifier of the ride
 * @returns {Object} JSON response with acceptance status
 */
export const acceptRide = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;
    const driverId = req.user?.uid;

    if (!rideId) {
      return res.status(400).json({ message: "Missing rideId", success: false });
    }

    if (!driverId) {
      return res.status(401).json({ message: "Unauthorized", success: false });
    }

    // Get ride details
    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({ message: "Ride not found", success: false });
    }

    const rideData = rideDoc.data();

    // Verify this driver is assigned to this ride
    if (rideData?.driverId !== driverId) {
      return res
        .status(403)
        .json({ message: "Not authorized to accept this ride", success: false });
    }

    // Verify ride is in pending acceptance state
    if (rideData?.status !== "PENDING_ACCEPTANCE") {
      console.warn(
        `Driver ${driverId} tried to accept ride ${rideId} with status: ${rideData?.status}. Cleaning up RTDB.`,
      );
      // Safety Cleanup: Remove from rides-pending if it was somehow left there
      await rtdb.ref(`rides-pending/${driverId}`).remove();

      return res.status(400).json({
        message: `Cannot accept ride with status: ${rideData?.status}`,
        success: false,
      });
    }

    // 0. Fetch driver and rider details if needed
    let driverPhone = "No Phone";
    let riderName = rideData?.riderName || "Unknown Rider";
    let riderPhone = rideData?.riderPhone || "No Phone";

    try {
      const [driverDoc, riderDoc] = await Promise.all([
        db.collection("users").doc(driverId).get(),
        !rideData?.riderName || !rideData?.riderPhone
          ? db.collection("users").doc(rideData?.riderId).get()
          : Promise.resolve(null),
      ]);

      if (driverDoc.exists) {
        driverPhone = driverDoc.data()?.phone_number || "No Phone";
      }

      if (riderDoc && riderDoc.exists) {
        riderName = riderDoc.data()?.name || riderName;
        riderPhone = riderDoc.data()?.phone || riderPhone;
      }
    } catch (err) {
      console.error("Error fetching details for acceptance:", err);
    }

    // 1. Update Firestore ride status to MATCHED
    await rideRef.update({
      driverPhone,
      matchedAt: FieldValue.serverTimestamp(),
      riderName,
      riderPhone,
      status: "MATCHED",
    });

    // 2. Remove from rides-pending and add to rides-assigned
    await rtdb.ref(`rides-pending/${driverId}`).remove();

    const assignedRideData = {
      drop: rideData.drop,
      pickup: rideData.pickup,
      rideId,
      riderId: rideData.riderId,
      riderName,
      riderPhone,
      status: "MATCHED",
      timestamp: Date.now(),
    };
    await rtdb.ref(`rides-assigned/${driverId}`).set(assignedRideData);

    // 3. Update driver status to BUSY
    await rtdb.ref(`drivers-online/${driverId}`).update({ status: "BUSY" });

    // 4. Update rides node for rider tracking
    await rtdb.ref(`rides/${rideId}`).update({
      driverName: rideData?.driverName || "Driver",
      driverPhone,
      status: "MATCHED",
    });

    console.log(`Driver ${driverId} accepted ride ${rideId}`);

    return res.status(200).json({
      message: "Ride accepted successfully",
      rideId,
      success: true,
    });
  } catch (error) {
    console.error("Accept Ride Error:", error);
    return res.status(500).json({ message: "Error accepting ride", success: false });
  }
};

/**
 * Decline Ride Controller
 * @description Driver declines a pending ride request.
 *              Adds driver to declined list and re-matches with another driver.
 * @route POST /ride/decline
 * @param {Object} req.body - Request body
 * @param {string} req.body.rideId - The unique identifier of the ride
 * @returns {Object} JSON response with decline status and re-match info
 */
export const declineRide = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;
    const driverId = req.user?.uid;

    console.log("Decline Ride Request:", { body: req.body, driverId });

    if (!rideId) {
      console.error("Decline Ride Error: Missing rideId");
      return res.status(400).json({ message: "Missing rideId", success: false });
    }

    if (!driverId) {
      return res.status(401).json({ message: "Unauthorized", success: false });
    }

    // Get ride details
    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({ message: "Ride not found", success: false });
    }

    const rideData = rideDoc.data();

    // Verify this driver is assigned to this ride
    if (rideData?.driverId !== driverId) {
      return res
        .status(403)
        .json({ message: "Not authorized to decline this ride", success: false });
    }

    // Verify ride is in pending acceptance state
    if (rideData?.status !== "PENDING_ACCEPTANCE") {
      console.warn(
        `Driver ${driverId} tried to decline ride ${rideId} with status: ${rideData?.status}. Cleaning up RTDB.`,
      );
      // Safety Cleanup: Remove from rides-pending if it was somehow left there
      await rtdb.ref(`rides-pending/${driverId}`).remove();

      return res.status(400).json({
        message: `Cannot decline ride with status: ${rideData?.status}`,
        success: false,
      });
    }

    // 1. Add driver to declined list in Firestore
    const declinedDrivers = rideData.declinedDrivers || [];
    declinedDrivers.push(driverId);

    await rideRef.update({
      declinedDrivers,
      driverId: null,
      driverName: null,
      status: "SEARCHING", // Back to searching for a new driver
    });

    // 2. Remove from rides-pending and reset driver status
    await rtdb.ref(`rides-pending/${driverId}`).remove();
    await rtdb.ref(`drivers-online/${driverId}`).update({ status: "AVAILABLE" });

    // 3. Update rides node for rider tracking
    await rtdb.ref(`rides/${rideId}`).update({
      driverId: null,
      status: "SEARCHING",
    });

    console.log(`Driver ${driverId} declined ride ${rideId}. Re-matching...`);

    // 4. Attempt to re-match with another driver (excluding declined drivers)
    const pickup = rideData.pickup;
    const drop = rideData.drop;
    const center: [number, number] = [pickup.lat, pickup.lng];
    const declinedSet = new Set(declinedDrivers);

    // Fetch online drivers
    const driversSnapshot = await rtdb.ref("drivers-online").once("value");
    const driversData = driversSnapshot.val();

    let newDriver: DriverMatch | null = null;

    if (driversData) {
      const matchingDrivers: DriverMatch[] = [];

      for (const [candidateId, locationData] of Object.entries(driversData)) {
        const driver = locationData as DriverLocation;

        // Skip declined drivers
        if (declinedSet.has(candidateId)) continue;

        // Only AVAILABLE drivers
        if (driver.status !== "AVAILABLE") continue;

        const distanceInKm = geofire.distanceBetween([driver.lat, driver.lng], center);

        if (distanceInKm <= 100) {
          matchingDrivers.push({
            distance: distanceInKm,
            driverId: candidateId,
            lat: driver.lat,
            lng: driver.lng,
            status: driver.status,
          });
        }
      }

      // Sort by distance
      matchingDrivers.sort((a, b) => a.distance - b.distance);

      // Try to reserve the nearest available driver
      for (const driver of matchingDrivers) {
        const driverRef = rtdb.ref(`drivers-online/${driver.driverId}`);
        const snapshot = await driverRef.once("value");
        const currentData = snapshot.val() as DriverLocation | null;

        if (currentData && currentData.status === "AVAILABLE") {
          await driverRef.update({ status: "RESERVED" });
          newDriver = driver;
          break;
        }
      }
    }

    if (newDriver) {
      // Fetch new driver's name
      let newDriverName = "Unknown Driver";
      try {
        const userDoc = await db.collection("users").doc(newDriver.driverId).get();
        if (userDoc.exists) {
          newDriverName = userDoc.data()?.name || "Unknown Driver";
        }
      } catch (err) {
        console.error("Error fetching new driver name:", err);
      }

      // Update ride with new driver
      await rideRef.update({
        driverId: newDriver.driverId,
        driverName: newDriverName,
        status: "PENDING_ACCEPTANCE",
      });

      // Write to new driver's pending rides
      const pendingRideData = {
        drop,
        fare: rideData.fare,
        pickup,
        rideId,
        riderId: rideData.riderId,
        status: "PENDING_ACCEPTANCE",
        timestamp: Date.now(),
      };
      await rtdb.ref(`rides-pending/${newDriver.driverId}`).set(pendingRideData);

      // Update rides node
      await rtdb.ref(`rides/${rideId}`).update({
        driverId: newDriver.driverId,
        driverLocation: { lat: newDriver.lat, lng: newDriver.lng },
        status: "PENDING_ACCEPTANCE",
      });

      console.log(`Re-matched ride ${rideId} to driver ${newDriver.driverId}`);

      return res.status(200).json({
        message: "Ride declined. Re-matched to another driver.",
        newDriverId: newDriver.driverId,
        newDriverName,
        rideId,
        success: true,
      });
    }

    // No other drivers available
    await rideRef.update({ status: "NO_DRIVERS" });
    await rtdb.ref(`rides/${rideId}`).update({ status: "NO_DRIVERS" });

    return res.status(200).json({
      message: "Ride declined. No other drivers available.",
      rideId,
      success: true,
    });
  } catch (error) {
    console.error("Decline Ride Error:", error);
    return res.status(500).json({ message: "Error declining ride", success: false });
  }
};

/**
 * Get OTP Controller
 * @description Returns the OTP for a ride, but ONLY if driver is within 100m of pickup.
 *              This ensures OTP is shared only when driver is near for pickup verification.
 * @route GET /ride/otp/:rideId
 * @param {string} req.params.rideId - The unique identifier of the ride
 * @returns {Object} JSON response with OTP if within range, or error message
 */
export const getOtp = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.params;
    const userId = req.user?.uid;

    if (!rideId) {
      return res.status(400).json({ message: "Missing rideId", success: false });
    }

    if (!userId) {
      return res.status(401).json({ message: "Unauthorized", success: false });
    }

    // Get ride details
    const rideRef = db.collection("rides").doc(Array.isArray(rideId) ? rideId[0] : rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({ message: "Ride not found", success: false });
    }

    const rideData = rideDoc.data();

    // Verify user is either the rider or driver of this ride
    if (rideData?.riderId !== userId && rideData?.driverId !== userId) {
      return res
        .status(403)
        .json({ message: "Not authorized to access this ride", success: false });
    }

    // Verify ride is in MATCHED status (driver accepted, heading to pickup)
    if (rideData?.status !== "MATCHED") {
      return res.status(400).json({
        message: `OTP not available for ride status: ${rideData?.status}`,
        success: false,
      });
    }

    // Get driver's current location from RTDB
    const driverSnapshot = await rtdb.ref(`drivers-online/${rideData.driverId}`).once("value");
    const driverData = driverSnapshot.val() as DriverLocation | null;

    if (!driverData) {
      return res.status(404).json({ message: "Driver location not found", success: false });
    }

    // Calculate distance between driver and pickup
    const pickup = rideData.pickup;
    const driverPos: [number, number] = [driverData.lat, driverData.lng];
    const pickupPos: [number, number] = [pickup.lat, pickup.lng];
    const distanceInKm = geofire.distanceBetween(driverPos, pickupPos);
    const distanceInMeters = Math.round(distanceInKm * 1000);

    // If requester is the rider, ALWAYS show OTP
    if (rideData.riderId === userId) {
      return res.status(200).json({
        distanceToPickup: distanceInMeters,
        otp: rideData.otp,
        otpAvailable: true,
        success: true,
      });
    }

    // Only reveal OTP to driver if distance is within 100 meters
    if (distanceInMeters > 100) {
      return res.status(200).json({
        distanceToPickup: distanceInMeters,
        message: `Driver is ${distanceInMeters}m away. OTP will be shown when driver is within 100m.`,
        otpAvailable: false,
        success: true,
      });
    }

    // Mark OTP as revealed in Firestore
    if (!rideData.otpRevealed) {
      await rideRef.update({ otpRevealed: true });
    }

    return res.status(200).json({
      distanceToPickup: distanceInMeters,
      message: "Driver is nearby. Share this OTP with the driver.",
      otp: rideData.otp,
      otpAvailable: true,
      success: true,
    });
  } catch (error) {
    console.error("Get OTP Error:", error);
    return res.status(500).json({ message: "Error fetching OTP", success: false });
  }
};
