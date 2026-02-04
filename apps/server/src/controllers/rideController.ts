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
 *              Creates ride record in Firestore and notifies matched driver via RTDB.
 * @route POST /ride/request
 * @param {Object} req.body - Ride request parameters
 * @param {string} req.body.riderId - The rider's unique identifier
 * @param {number} req.body.pickupLat - Pickup location latitude
 * @param {number} req.body.pickupLng - Pickup location longitude
 * @param {number} req.body.dropLat - Drop-off location latitude
 * @param {number} req.body.dropLng - Drop-off location longitude
 * @param {number} [req.body.fare] - Pre-calculated fare (optional)
 * @returns {Object} JSON response with matched driver details, ride ID, OTP, and ETA
 */
export const requestRide = async (req: Request, res: Response) => {
  try {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, fare } = req.body;

    // Validate required fields
    if (!riderId || !pickupLat || !pickupLng || !dropLat || !dropLng) {
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

    console.log("=== RIDE REQUEST DEBUG ===");
    console.log("Total drivers online:", Object.keys(driversData).length);

    // Keep expanding radius until we find drivers or hit max radius
    while (matchingDrivers.length === 0 && currentRadius <= maxRadius) {
      console.log(`Searching within ${currentRadius}km radius...`);

      for (const [driverId, locationData] of Object.entries(driversData)) {
        const driver = locationData as DriverLocation;

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
    // Note: For production, consider using transactions for race condition handling
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
          // Update status to RESERVED
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
    // Fetch driver name from Firestore BEFORE creating the ride
    let driverName = "Unknown Driver";
    try {
      const userDoc = await db.collection("users").doc(assignedDriver.driverId).get();
      if (userDoc.exists) {
        driverName = userDoc.data()?.name || "Unknown Driver";
      }
    } catch (err) {
      console.error("Error fetching driver name:", err);
    }

    const rideData = {
      createdAt: FieldValue.serverTimestamp(),
      driverId: assignedDriver.driverId,
      driverName,
      drop: { lat: dropLat, lng: dropLng },
      fare: fare || null,
      matchedAt: FieldValue.serverTimestamp(),
      otp: Math.floor(1000 + Math.random() * 9000).toString(), // Generate 4-digit OTP
      pickup: { lat: pickupLat, lng: pickupLng },
      riderId,
      status: "MATCHED",
    };

    const rideRef = await db.collection("rides").add(rideData);

    // ---------------------------------------------------------
    // STEP 4.1: WRITE RIDE ASSIGNMENT TO RTDB FOR DRIVER
    // ---------------------------------------------------------
    // This allows the driver to listen in real-time for assigned rides
    const assignedRideData = {
      drop: { lat: dropLat, lng: dropLng },
      pickup: { lat: pickupLat, lng: pickupLng },
      rideId: rideRef.id,
      riderId,
      timestamp: Date.now(),
    };

    await rtdb.ref(`rides-assigned/${assignedDriver.driverId}`).set(assignedRideData);
    console.log(`Ride assignment published to RTDB for driver: ${assignedDriver.driverId}`);

    // ---------------------------------------------------------
    // STEP 5: RETURN SUCCESS RESPONSE
    // ---------------------------------------------------------

    // Estimate ETA based on distance (rough estimate: 2 min per km)
    const etaMinutes = Math.ceil(assignedDriver.distance * 2);

    return res.status(200).json({
      distance: Math.round(assignedDriver.distance * 1000), // in meters
      driverId: assignedDriver.driverId,
      driverLocation: {
        lat: assignedDriver.lat,
        lng: assignedDriver.lng,
      },
      driverName,
      eta: `${etaMinutes} min`,
      message: "Driver matched successfully!",
      otp: rideData.otp, // Return OTP to rider
      rideId: rideRef.id,
      success: true,
    });
  } catch (error) {
    console.error("Ride Request Error:", error);
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

    // 2. Notify Driver (Remove assignment) & Make Driver Available
    if (driverId) {
      await rtdb.ref(`rides-assigned/${driverId}`).remove();
      await rtdb.ref(`drivers-online/${driverId}`).update({
        status: "AVAILABLE",
      });
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

    // 2. Free up the driver
    if (driverId) {
      await rtdb.ref(`rides-assigned/${driverId}`).remove();
      await rtdb.ref(`drivers-online/${driverId}`).update({ status: "AVAILABLE" });
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
      .where("status", "in", ["MATCHED", "IN_PROGRESS"])
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
