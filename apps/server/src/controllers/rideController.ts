// apps/server/src/controllers/rideController.ts
import type { Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import * as geofire from "geofire-common";
import { db, rtdb } from "../config/firebase.js";

interface DriverLocation {
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY" | "RESERVED";
  lastUpdated: number;
  vehicleType?: string;
  geohash?: string;
}

interface DriverMatch {
  driverId: string;
  lat: number;
  lng: number;
  distance: number;
  status: string;
}

export const requestRide = async (req: Request, res: Response) => {
  try {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng } = req.body;

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
      fare: null, // Will be calculated later
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
