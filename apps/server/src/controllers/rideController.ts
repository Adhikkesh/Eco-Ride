// apps/server/src/controllers/rideController.ts
import type { Request, Response } from "express";
import { serverTimestamp } from "firebase/database";
import * as geofire from "geofire-common";
import { db, rtdb } from "../config/firebase.js";

export const requestRide = async (req: Request, res: Response) => {
  try {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng } = req.body;
    const center: [number, number] = [pickupLat, pickupLng];
    const radiusInM = 5000; // 5km search radius

    // ---------------------------------------------------------
    // STEP 1: CALCULATE GEOHASH BOUNDS
    // ---------------------------------------------------------
    // This gives us a set of [start, end] ranges to query efficiently
    const bounds = geofire.geohashQueryBounds(center, radiusInM);

    // ---------------------------------------------------------
    // STEP 2: PARALLEL FIRESTORE QUERIES (INDEXED)
    // ---------------------------------------------------------
    const promises = bounds.map((b) => {
      return db.collection("drivers-online").orderBy("geohash").startAt(b[0]).endAt(b[1]).get();
    });

    // Wait for all queries to finish
    const snapshots = await Promise.all(promises);

    // ---------------------------------------------------------
    // STEP 3: FILTER & SORT (IN MEMORY)
    // ---------------------------------------------------------
    interface DriverMatch {
      data: FirebaseFirestore.DocumentData;
      distance: number;
      driverId: string;
    }

    const matchingDrivers: DriverMatch[] = [];

    for (const snap of snapshots) {
      for (const doc of snap.docs) {
        const d = doc.data();

        // precise distance calculation
        const distanceInKm = geofire.distanceBetween([d.lat, d.lng], center);
        const distanceInM = distanceInKm * 1000;

        if (distanceInM <= radiusInM) {
          matchingDrivers.push({
            data: d,
            distance: distanceInM,
            driverId: doc.id,
          });
        }
      }
    }

    // Sort by Distance (Nearest First)
    // In future: Add factors like Rating or Idle Time here
    matchingDrivers.sort((a, b) => a.distance - b.distance);

    if (matchingDrivers.length === 0) {
      return res.status(404).json({ message: "No drivers found nearby" });
    }

    // ---------------------------------------------------------
    // STEP 4: ATOMIC LOCKING (CRITICAL)
    // ---------------------------------------------------------
    // We try to lock the nearest driver. If they are busy, we try the next.

    let assignedDriverId = null;

    for (const driver of matchingDrivers) {
      const driverId = driver.driverId;
      const statusRef = rtdb.ref(`drivers-status/${driverId}/status`);

      // Attempt Transaction
      const result = await statusRef.transaction((currentStatus) => {
        if (currentStatus === "AVAILABLE") {
          return "RESERVED"; // Lock them!
        }
        return; // Abort if already BUSY or RESERVED
      });

      if (result.committed) {
        assignedDriverId = driverId;
        break; // Stop looking, we found one!
      }
      // If not committed, loop continues to next nearest driver
    }

    if (!assignedDriverId) {
      return res.status(409).json({ message: "All nearby drivers are busy. Please try again." });
    }

    // ---------------------------------------------------------
    // STEP 5: FINALIZE RIDE REQUEST
    // ---------------------------------------------------------

    // Create Ride Doc
    const rideRef = await db.collection("rides").add({
      createdAt: serverTimestamp(),
      driverId: assignedDriverId,
      drop: { lat: dropLat, lng: dropLng },
      fare: 150, // Calculate this dynamically later
      pickup: { lat: pickupLat, lng: pickupLng },
      riderId,
      status: "MATCHED",
    });

    // Send Notification (Mock)
    // await sendPushNotification(assignedDriverId, "New Ride Request!");

    return res.status(200).json({
      driverId: assignedDriverId,
      eta: "5 mins",
      message: "Driver matched successfully",
      rideId: rideRef.id,
      success: true,
    });
  } catch (error) {
    console.error("Ride Request Error:", error);
    res.status(500).json({ error: "Internal Server Error" });
  }
};
