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
import { calculateGreenPoints, type VehicleType } from "../utils/greenPoints.js";
import { type DriverLocation, matchDriver, optimizeRoute } from "../utils/matchingEngine.js";

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

    const pickupLocation = { lat: pickupLat, lng: pickupLng };
    const dropLocation = { lat: dropLat, lng: dropLng };

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
    // STEP 2: CONVERT DATA AND EXECUTE INTELLIGENT MATCHING PIPELINE
    // ---------------------------------------------------------
    // Convert object to Map for the matching engine
    const driversMap = new Map<string, DriverLocation>();
    for (const [key, value] of Object.entries(driversData)) {
      driversMap.set(key, value as DriverLocation);
    }

    console.log("=== RIDE REQUEST DEBUG ===");
    console.log("Total drivers online:", driversMap.size);
    console.log(`Starting matching for rider ${riderId}`);

    const matchResult = matchDriver(driversMap, {
      destination: dropLocation,
      origin: pickupLocation,
    });

    console.log("Matching result:", matchResult.message);
    console.log("Candidates per phase:", matchResult.candidatesPerPhase);

    if (!matchResult.driver) {
      return res.status(404).json({
        debug: {
          candidatesPerPhase: matchResult.candidatesPerPhase,
        },
        message: matchResult.message || "No suitable drivers found",
        success: false,
      });
    }

    const assignedDriverCandidate = matchResult.driver;
    const isPooledRide = assignedDriverCandidate.isPooled ?? false;

    // ---------------------------------------------------------
    // STEP 3: RESERVE OR JOIN THE SELECTED DRIVER
    // ---------------------------------------------------------
    // For pooled rides, we update passenger count instead of changing status
    let successfulReservation = false;

    console.log(
      `Attempting to ${isPooledRide ? "join pooled ride with" : "reserve"} driver: ${assignedDriverCandidate.driverId}`,
    );
    const driverRef = rtdb.ref(`drivers-online/${assignedDriverCandidate.driverId}`);

    try {
      const snapshot = await driverRef.once("value");
      const currentData = snapshot.val() as DriverLocation | null;

      if (isPooledRide) {
        // Pooled ride: driver should be ON_TRIP with capacity
        if (currentData && currentData.status === "ON_TRIP") {
          const currentPassengers = currentData.currentPassengers ?? 1;
          const maxPassengers = currentData.maxPassengers ?? 4;

          if (currentPassengers < maxPassengers) {
            // Add new passenger to pooled ride
            await driverRef.update({
              currentPassengers: currentPassengers + 1,
            });
            successfulReservation = true;
            console.log(
              `Successfully joined pooled ride: ${assignedDriverCandidate.driverId} (passengers: ${currentPassengers + 1})`,
            );
          } else {
            console.log(`Driver ${assignedDriverCandidate.driverId} at capacity`);
          }
        }
      } else {
        // Fresh ride: driver should be AVAILABLE
        if (currentData && currentData.status === "AVAILABLE") {
          // Update status to ON_TRIP (not RESERVED, since we're starting the trip flow)
          await driverRef.update({
            currentPassengers: 1,
            destination: { lat: dropLat, lng: dropLng },
            status: "ON_TRIP",
          });
          successfulReservation = true;
          console.log(`Successfully reserved driver: ${assignedDriverCandidate.driverId}`);
        } else {
          console.log(
            `Driver ${assignedDriverCandidate.driverId} no longer available, status: ${currentData?.status}`,
          );
        }
      }
    } catch (err) {
      console.error(`Error reserving driver ${assignedDriverCandidate.driverId}:`, err);
    }

    if (!successfulReservation) {
      return res.status(409).json({
        message: isPooledRide
          ? "The pooled ride is no longer available. Please try again."
          : "The matched driver became unavailable. Please try again.",
        success: false,
      });
    }

    // ---------------------------------------------------------
    // STEP 4: CREATE RIDE DOCUMENT IN FIRESTORE
    // ---------------------------------------------------------
    let driverName = "Unknown Driver";
    try {
      const userDoc = await db.collection("users").doc(assignedDriverCandidate.driverId).get();
      if (userDoc.exists) {
        driverName = userDoc.data()?.name || "Unknown Driver";
      }
    } catch (err) {
      console.error("Error fetching driver name:", err);
    }

    // Fetch rider name for OTP display
    let riderName = "Rider";
    try {
      const riderDoc = await db.collection("users").doc(riderId).get();
      if (riderDoc.exists) {
        riderName = riderDoc.data()?.name || "Rider";
      }
    } catch (err) {
      console.error("Error fetching rider name:", err);
    }

    const rideData = {
      createdAt: FieldValue.serverTimestamp(),
      driverId: assignedDriverCandidate.driverId,
      driverName,
      drop: { lat: dropLat, lng: dropLng },
      fare: fare || null,
      isPooled: isPooledRide,
      matchedAt: FieldValue.serverTimestamp(),
      matchingMetadata: {
        cost: assignedDriverCandidate.cost,
        detourMinutes: assignedDriverCandidate.detourMinutes,
        isPooled: isPooledRide,
        phase: matchResult.phase,
        pickUpDist: assignedDriverCandidate.distance,
      },
      otp: Math.floor(1000 + Math.random() * 9000).toString(),
      pickup: { lat: pickupLat, lng: pickupLng },
      riderId,
      status: "MATCHED",
    };

    const rideRef = await db.collection("rides").add(rideData);

    // ---------------------------------------------------------
    // STEP 4.1: WRITE/UPDATE RIDE ASSIGNMENT TO RTDB FOR DRIVER
    // ---------------------------------------------------------
    // ---------------------------------------------------------
    // STEP 4.1: WRITE/UPDATE RIDE ASSIGNMENT TO RTDB FOR DRIVER
    // ---------------------------------------------------------

    // Import optimization utility (ensure this import exists at top of file)
    // import { optimizeRoute, type RoutePoint } from "../utils/matchingEngine.js";

    let waypoints: any[] = [];
    let scheduledRiders = [];

    if (isPooledRide) {
      // For pooled rides, get existing assignments and optimize
      const existingAssignment = await rtdb
        .ref(`rides-assigned/${assignedDriverCandidate.driverId}`)
        .once("value");
      const existingData = existingAssignment.val();

      let pooledRiders = [];
      if (existingData) {
        if (Array.isArray(existingData.riders)) {
          pooledRiders = existingData.riders;
        } else if (existingData.rideId) {
          pooledRiders = [
            {
              drop: existingData.drop,
              pickup: existingData.pickup,
              rideId: existingData.rideId,
              riderId: existingData.riderId,
            },
          ];
        }
      }

      // Add new rider
      pooledRiders.push({
        drop: { lat: dropLat, lng: dropLng },
        pickup: { lat: pickupLat, lng: pickupLng },
        rideId: rideRef.id,
        riderId,
        riderName,
      });
      scheduledRiders = pooledRiders;

      // Construct pending waypoints for optimization
      const pendingWaypoints: any[] = []; // Using any to avoid import issues for now, strictly RoutePoint

      // 1. Fetch status of ALL riders in the pool to decide if we need to PICKUP or just DROP
      // We need to know who is already on board.
      for (const rider of pooledRiders) {
        // Fetch ride doc status
        const rDoc = await db.collection("rides").doc(rider.rideId).get();
        const rStatus = rDoc.exists ? rDoc.data()?.status : "MATCHED";

        if (rStatus === "MATCHED" || rStatus === "SEARCHING") {
          // Needs pickup
          pendingWaypoints.push({
            lat: rider.pickup.lat,
            lng: rider.pickup.lng,
            riderId: rider.riderId,
            type: "PICKUP",
          });
        }

        // Everyone needs drop (unless COMPLETED, but they shouldn't be in the active pool then)
        if (rStatus !== "COMPLETED" && rStatus !== "CANCELLED") {
          pendingWaypoints.push({
            lat: rider.drop.lat,
            lng: rider.drop.lng,
            riderId: rider.riderId,
            type: "DROP",
          });
        }
      }

      // Optimize route starting from driver's current location
      // Using top-level import for optimizeRoute
      waypoints = optimizeRoute(
        { lat: assignedDriverCandidate.location.lat, lng: assignedDriverCandidate.location.lng },
        pendingWaypoints,
      );

      await rtdb.ref(`rides-assigned/${assignedDriverCandidate.driverId}`).update({
        isPooled: true,
        riders: pooledRiders,
        timestamp: Date.now(),
        waypoints: waypoints,
      });
      console.log(
        `Updated pooled assignment for driver ${assignedDriverCandidate.driverId} with ${waypoints.length} stops`,
      );
    } else {
      // Fresh ride: simple 2-stop route
      scheduledRiders = [
        {
          drop: { lat: dropLat, lng: dropLng },
          pickup: { lat: pickupLat, lng: pickupLng },
          rideId: rideRef.id,
          riderId,
          riderName,
        },
      ];

      waypoints = [
        { lat: pickupLat, lng: pickupLng, order: 1, riderId, type: "PICKUP" },
        { lat: dropLat, lng: dropLng, order: 2, riderId, type: "DROP" },
      ];

      const assignedRideData = {
        drop: { lat: dropLat, lng: dropLng },
        isPooled: false,
        pickup: { lat: pickupLat, lng: pickupLng },
        rideId: rideRef.id,
        riderId,
        riders: scheduledRiders, // consistent structure
        route: {
          drop: { lat: dropLat, lng: dropLng },
          pickup: { lat: pickupLat, lng: pickupLng },
        },
        timestamp: Date.now(),
        waypoints,
      };

      await rtdb.ref(`rides-assigned/${assignedDriverCandidate.driverId}`).set(assignedRideData);
      console.log(
        `Ride assignment published to RTDB for driver: ${assignedDriverCandidate.driverId}`,
      );
    }

    // ---------------------------------------------------------
    // STEP 5: RETURN SUCCESS RESPONSE
    // ---------------------------------------------------------

    // Estimate ETA based on distance (rough estimate: 2 min per km)
    // Or use the more accurate calculation from matching engine if available
    const etaMinutes = Math.ceil(assignedDriverCandidate.distance * 2);

    return res.status(200).json({
      distance: Math.round(assignedDriverCandidate.distance * 1000), // in meters
      driverId: assignedDriverCandidate.driverId,
      driverLocation: {
        heading: assignedDriverCandidate.location.heading,
        lat: assignedDriverCandidate.location.lat,
        lng: assignedDriverCandidate.location.lng,
      },
      driverName,
      eta: `${etaMinutes} min`,
      isPooled: isPooledRide,
      message: isPooledRide ? "Joined pooled ride!" : "Driver matched successfully!",
      otp: rideData.otp,
      rideId: rideRef.id,
      // Return route points for frontend display
      route: {
        driverLocation: {
          lat: assignedDriverCandidate.location.lat,
          lng: assignedDriverCandidate.location.lng,
        },
        drop: { lat: dropLat, lng: dropLng },
        pickup: { lat: pickupLat, lng: pickupLng },
      },
      success: true,
    });
  } catch (error) {
    console.error("Ride Request Error:", error);
    // Log stack trace if available
    if (error instanceof Error) {
      console.error("Stack trace:", error.stack);
    }
    return res.status(500).json({
      // Include error details in development mode only (optional, but good for debugging now)
      error: error instanceof Error ? error.message : "Unknown error",
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
 *              Now supports pooled rides - completes all pooled rides together.
 * @route POST /ride/complete
 * @param {Object} req.body - Request body
 * @param {string} req.body.rideId - The unique identifier of the primary ride
 * @param {string[]} [req.body.pooledRideIds] - Optional array of additional pooled ride IDs
 * @returns {Object} JSON response with completion status
 */
export const completeRide = async (req: Request, res: Response) => {
  try {
    const { rideId, pooledRideIds } = req.body;
    if (!rideId) return res.status(400).json({ message: "Missing rideId", success: false });

    // Collect all ride IDs to complete (main + pooled, deduplicated)
    const allRideIds: string[] = [rideId];
    if (pooledRideIds && Array.isArray(pooledRideIds)) {
      pooledRideIds.forEach((id: string) => {
        if (id && typeof id === "string" && id !== rideId && !allRideIds.includes(id)) {
          allRideIds.push(id);
        }
      });
    }

    console.log(`Completing ${allRideIds.length} ride(s):`, allRideIds);

    // Get the primary ride to extract driver info
    const primaryRideRef = db.collection("rides").doc(rideId);
    const primaryRideDoc = await primaryRideRef.get();

    if (!primaryRideDoc.exists) {
      return res.status(404).json({ message: "Primary ride not found", success: false });
    }

    const primaryRideData = primaryRideDoc.data();
    const driverId = primaryRideData?.driverId;

    // Track total green points awarded across all rides
    let totalGreenPointsAwarded = 0;
    const completedRides: string[] = [];
    const failedRides: string[] = [];

    // Process each ride
    for (const currentRideId of allRideIds) {
      try {
        const rideRef = db.collection("rides").doc(currentRideId);
        const rideDoc = await rideRef.get();

        if (!rideDoc.exists) {
          console.warn(`Ride ${currentRideId} not found, skipping`);
          failedRides.push(currentRideId);
          continue;
        }

        const rideData = rideDoc.data();
        const riderId = rideData?.riderId;
        const pickup = rideData?.pickup;
        const drop = rideData?.drop;

        // 1. Update Ride Status in Firestore
        await rideRef.update({
          completedAt: FieldValue.serverTimestamp(),
          status: "COMPLETED",
        });

        // 2. Sync to RTDB for frontend listener (triggers payment modal for this rider)
        await rtdb.ref(`rides/${currentRideId}`).update({
          status: "COMPLETED",
        });

        completedRides.push(currentRideId);

        // 3. Calculate and award green points for this ride
        if (driverId && riderId && pickup && drop) {
          try {
            // Calculate trip distance
            const distanceKm = geofire.distanceBetween(
              [pickup.lat, pickup.lng],
              [drop.lat, drop.lng],
            );

            // Fetch driver's vehicle info (only once for first ride, reuse for pooled)
            let vehicleType: VehicleType = "PETROL";
            let passengerCapacity = 4;

            if (currentRideId === rideId) {
              // Fetch vehicle info for primary ride
              const vehicleSnapshot = await db
                .collection("vehicle")
                .where("driver_uid", "==", driverId)
                .limit(1)
                .get();

              if (!vehicleSnapshot.empty) {
                const vehicleData = vehicleSnapshot.docs[0]?.data();
                if (vehicleData) {
                  vehicleType = (vehicleData.vehicle_type as VehicleType) || "PETROL";
                  passengerCapacity = vehicleData.passenger_capacity || 4;
                }
              }
            }

            // Calculate green points (pooled rides get bonus for sharing)
            const basePoints = calculateGreenPoints(vehicleType, passengerCapacity, distanceKm);
            const poolingBonus = allRideIds.length > 1 ? Math.ceil(basePoints * 0.2) : 0; // 20% bonus for pooling
            const greenPointsForRide = basePoints + poolingBonus;

            // Award points to both rider and driver
            if (greenPointsForRide > 0) {
              const batch = db.batch();
              batch.update(db.collection("users").doc(riderId), {
                green_points: FieldValue.increment(greenPointsForRide),
              });
              // Driver only gets points once (on primary ride) to avoid double-counting
              if (currentRideId === rideId) {
                batch.update(db.collection("users").doc(driverId), {
                  green_points: FieldValue.increment(greenPointsForRide),
                });
              }
              await batch.commit();

              totalGreenPointsAwarded += greenPointsForRide;
              console.log(
                `Green points awarded: ${greenPointsForRide} to rider ${riderId}${currentRideId === rideId ? ` and driver ${driverId}` : ""}`,
              );
            }
          } catch (gpError) {
            // Log error but don't fail the ride completion
            console.error(
              `Error calculating/awarding green points for ride ${currentRideId}:`,
              gpError,
            );
          }
        }
      } catch (rideError) {
        console.error(`Error completing ride ${currentRideId}:`, rideError);
        failedRides.push(currentRideId);
      }
    }

    // 4. Free up the driver (only after all rides are processed)
    if (driverId) {
      await rtdb.ref(`rides-assigned/${driverId}`).remove();
      await rtdb.ref(`drivers-online/${driverId}`).update({ status: "AVAILABLE" });
    }

    return res.status(200).json({
      completedRides,
      failedRides,
      greenPointsAwarded: totalGreenPointsAwarded,
      message: `Completed ${completedRides.length} ride(s)${failedRides.length > 0 ? `, ${failedRides.length} failed` : ""}`,
      success: true,
    });
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
