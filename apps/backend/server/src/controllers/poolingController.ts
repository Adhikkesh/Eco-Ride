/**
 * Pooling Controller
 *
 * HTTP endpoints for the Dynamic En-Route Pooling system.
 *
 * POST /pool/request   — Rider submits a pool ride request
 * GET  /pool/status    — Check pooling eligibility for coordinates
 * POST /pool/accept    — Driver accepts a pool offer (fallback for non-WS)
 * POST /pool/decline   — Driver declines a pool offer (fallback for non-WS)
 */

import type { Request, Response } from "express";
import { FieldValue } from "firebase-admin/firestore";
import { db, rtdb } from "../config/firebase.js";
import { dispatchPoolOffer, isDriverConnected } from "../services/websocketService.js";
import type { LatLng } from "../utils/geoUtils.js";
import { optimizeRoute } from "../utils/matchingEngine.js";
import {
  type ActiveTrip,
  buildPoolOfferPayload,
  findBestPoolMatch,
  type PoolRequest,
} from "../utils/poolingEngine.js";

// ============================================================================
// POST /pool/request — New pooled ride request
// ============================================================================

/**
 * Rider submits a pool request.
 *
 * Flow:
 * 1. Validate inputs
 * 2. Fetch all active trips from RTDB (`active-trips/`)
 * 3. Run the 5-step pooling pipeline against each trip
 * 4. Pick best match (lowest ΔT)
 * 5. Dispatch WebSocket offer to driver (15 s timeout)
 * 6. If accepted → create ride doc, update trip state
 * 7. If declined/timeout → try next best, or fall back to solo matching
 */
export const requestPoolRide = async (req: Request, res: Response) => {
  try {
    const { riderId, pickupLat, pickupLng, dropLat, dropLng, fare, pickupName, dropName } =
      req.body;

    // ── Validate ──────────────────────────────────────────────
    if (!riderId) {
      return res.status(400).json({ message: "Missing required field: riderId", success: false });
    }

    const pickup: LatLng = {
      lat: Number(pickupLat),
      lng: Number(pickupLng),
    };
    const dropoff: LatLng = {
      lat: Number(dropLat),
      lng: Number(dropLng),
    };

    if (
      !Number.isFinite(pickup.lat) ||
      !Number.isFinite(pickup.lng) ||
      !Number.isFinite(dropoff.lat) ||
      !Number.isFinite(dropoff.lng)
    ) {
      return res.status(400).json({
        message: "Invalid coordinates: pickupLat, pickupLng, dropLat, dropLng must be numbers",
        success: false,
      });
    }

    const poolReq: PoolRequest = {
      dropoff,
      fare: fare ? Number(fare) : undefined,
      pickup,
      riderId,
    };

    // ── Fetch active trips ────────────────────────────────────
    const snapshot = await rtdb.ref("active-trips").once("value");
    const tripsData = snapshot.val();

    if (!tripsData || typeof tripsData !== "object") {
      return res.status(404).json({
        message: "No active trips available for pooling. Try a regular ride.",
        success: false,
      });
    }

    const activeTrips: ActiveTrip[] = [];
    for (const [driverId, raw] of Object.entries(tripsData)) {
      const trip = raw as Record<string, unknown>;
      if (
        !trip.remainingRoute ||
        !Array.isArray(trip.remainingRoute) ||
        (trip.remainingRoute as unknown[]).length < 2
      ) {
        continue;
      }

      activeTrips.push({
        driverId,
        estimatedArrivalMs: Number(trip.estimatedArrivalMs) || 0,
        maxSeats: Number(trip.maxSeats) || 4,
        occupiedSeats: Number(trip.occupiedSeats) || 1,
        originalTripMinutes: Number(trip.originalTripMinutes) || 0,
        remainingRoute: trip.remainingRoute as LatLng[],
        riders: (trip.riders as ActiveTrip["riders"]) ?? [],
      });
    }

    if (activeTrips.length === 0) {
      return res.status(404).json({
        message: "No active trips with valid routes found for pooling.",
        success: false,
      });
    }

    // ── Evaluate all trips ────────────────────────────────────
    const ranked = findBestPoolMatch(activeTrips, poolReq);
    const eligible = ranked.filter((e) => e.eligible);

    if (eligible.length === 0) {
      // Return diagnostics for debugging
      const topRejection = ranked[0];
      return res.status(404).json({
        diagnostics: topRejection
          ? {
              closestDriver: topRejection.driverId,
              deltaT: topRejection.deltaT,
              pickupProximityKm: topRejection.pickupProximityKm,
              reason: topRejection.reason,
              rejectedAtStep: topRejection.rejectedAtStep,
            }
          : null,
        message: "No eligible pool matches found.",
        success: false,
      });
    }

    // ── Try dispatching to drivers in ranked order ─────────────
    for (const match of eligible) {
      const trip = activeTrips.find((t) => t.driverId === match.driverId);
      if (!trip) continue;

      // Create a provisional ride document
      const rideData = {
        deltaT: match.deltaT,
        driverId: match.driverId,
        drop: { lat: dropoff.lat, lng: dropoff.lng },
        dropName: dropName || "Destination",
        fare: fare || null,
        isPooled: true,
        pickup: { lat: pickup.lat, lng: pickup.lng },
        pickupName: pickupName || "Pickup",
        riderId,
        status: "POOL_OFFERED",
        timestamp: FieldValue.serverTimestamp(),
      };

      const rideRef = await db.collection("rides").add(rideData);

      // Build and dispatch WebSocket payload
      const payload = buildPoolOfferPayload(match, poolReq, rideRef.id, trip);

      // Check if driver is connected via WebSocket
      if (!isDriverConnected(match.driverId)) {
        // Fall back to RTDB-based pending ride (existing flow)
        await rtdb.ref(`rides-pending/${match.driverId}`).set({
          deltaT: match.deltaT,
          drop: { lat: dropoff.lat, lng: dropoff.lng },
          fare: fare || null,
          isPooled: true,
          pickup: { lat: pickup.lat, lng: pickup.lng },
          rideId: rideRef.id,
          riderId,
          status: "PENDING_ACCEPTANCE",
          timestamp: Date.now(),
        });

        await rideRef.update({ status: "PENDING_ACCEPTANCE" });

        return res.status(200).json({
          deltaT: match.deltaT,
          driverId: match.driverId,
          message: "Pool offer sent to driver (via RTDB fallback)",
          optimizedRoute: match.optimizedRoute,
          rideId: rideRef.id,
          success: true,
        });
      }

      // Dispatch via WebSocket with 15s timeout
      const accepted = await dispatchPoolOffer(payload);

      if (accepted) {
        // ── Driver accepted — finalize ──────────────────────
        await rideRef.update({ status: "ACCEPTED" });

        // Update active-trip state
        const updatedRiders = [
          ...trip.riders,
          {
            dropoff,
            pickup,
            rideId: rideRef.id,
            riderId,
            status: "WAITING_PICKUP",
          },
        ];

        await rtdb.ref(`active-trips/${match.driverId}`).update({
          occupiedSeats: trip.occupiedSeats + 1,
          remainingRoute: match.optimizedRoute
            ? match.optimizedRoute.map((wp) => ({ lat: wp.lat, lng: wp.lng }))
            : trip.remainingRoute,
          riders: updatedRiders,
        });

        // Notify rider via RTDB
        await rtdb.ref(`rides/${rideRef.id}`).set({
          driverId: match.driverId,
          isPooled: true,
          optimizedRoute: match.optimizedRoute,
          status: "ACCEPTED",
        });

        return res.status(200).json({
          deltaT: match.deltaT,
          driverId: match.driverId,
          message: "Pool ride accepted by driver!",
          optimizedRoute: match.optimizedRoute,
          payload, // Include full payload for debugging
          rideId: rideRef.id,
          success: true,
        });
      }

      // Driver declined/timed out — clean up and try next
      await rideRef.update({ status: "POOL_DECLINED" });
      console.log(`[Pool] Driver ${match.driverId} declined/timed out, trying next…`);
    }

    // All eligible drivers declined
    return res.status(404).json({
      message: "All eligible drivers declined the pool offer. Try a regular ride.",
      success: false,
      triedDrivers: eligible.length,
    });
  } catch (error) {
    console.error("[Pool] Error in requestPoolRide:", error);
    return res.status(500).json({
      message: "Internal server error during pool matching",
      success: false,
    });
  }
};

// ============================================================================
// GET /pool/status — Check poolability for a route
// ============================================================================

/**
 * Quick check: given pickup/dropoff coords, how many active trips
 * could potentially pool this rider?
 */
export const checkPoolStatus = async (req: Request, res: Response) => {
  try {
    const { pickupLat, pickupLng, dropLat, dropLng } = req.query;

    const pickup: LatLng = { lat: Number(pickupLat), lng: Number(pickupLng) };
    const dropoff: LatLng = { lat: Number(dropLat), lng: Number(dropLng) };

    if (
      !Number.isFinite(pickup.lat) ||
      !Number.isFinite(pickup.lng) ||
      !Number.isFinite(dropoff.lat) ||
      !Number.isFinite(dropoff.lng)
    ) {
      return res.status(400).json({ message: "Invalid coordinates", success: false });
    }

    const snapshot = await rtdb.ref("active-trips").once("value");
    const tripsData = snapshot.val();

    if (!tripsData) {
      return res.status(200).json({ eligibleTrips: 0, poolAvailable: false, success: true });
    }

    const activeTrips: ActiveTrip[] = [];
    for (const [driverId, raw] of Object.entries(tripsData)) {
      const trip = raw as Record<string, unknown>;
      if (!trip.remainingRoute || !Array.isArray(trip.remainingRoute)) continue;
      activeTrips.push({
        driverId,
        estimatedArrivalMs: Number(trip.estimatedArrivalMs) || 0,
        maxSeats: Number(trip.maxSeats) || 4,
        occupiedSeats: Number(trip.occupiedSeats) || 1,
        originalTripMinutes: Number(trip.originalTripMinutes) || 0,
        remainingRoute: trip.remainingRoute as LatLng[],
        riders: (trip.riders as ActiveTrip["riders"]) ?? [],
      });
    }

    const poolReq: PoolRequest = { dropoff, pickup, riderId: "check" };
    const ranked = findBestPoolMatch(activeTrips, poolReq);
    const eligibleCount = ranked.filter((e) => e.eligible).length;

    return res.status(200).json({
      bestDeltaT: ranked.find((e) => e.eligible)?.deltaT ?? null,
      eligibleTrips: eligibleCount,
      poolAvailable: eligibleCount > 0,
      success: true,
    });
  } catch (error) {
    console.error("[Pool] Error in checkPoolStatus:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
};

// ============================================================================
// POST /pool/accept — Driver accepts pool offer (REST fallback)
// ============================================================================

export const acceptPoolOffer = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;
    const driverId = req.user?.uid;

    if (!rideId) {
      return res.status(400).json({ message: "Missing rideId", success: false });
    }
    if (!driverId) {
      return res.status(401).json({ message: "Unauthorized", success: false });
    }

    // Update ride status
    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({ message: "Ride not found", success: false });
    }

    const rideData = rideDoc.data();

    // Verify this driver is assigned to the ride
    if (rideData?.driverId !== driverId) {
      return res
        .status(403)
        .json({ message: "Not authorized to accept this ride", success: false });
    }

    if (rideData?.status !== "POOL_OFFERED" && rideData?.status !== "PENDING_ACCEPTANCE") {
      return res.status(409).json({
        message: `Ride status is '${rideData?.status}', cannot accept`,
        success: false,
      });
    }

    await rideRef.update({ status: "ACCEPTED" });

    // Update active trip
    const tripSnapshot = await rtdb.ref(`active-trips/${driverId}`).once("value");
    const tripData = tripSnapshot.val() as ActiveTrip | null;

    if (tripData) {
      const updatedRiders = [
        ...(tripData.riders || []),
        {
          dropoff: rideData?.drop,
          pickup: rideData?.pickup,
          rideId,
          riderId: rideData?.riderId,
          status: "WAITING_PICKUP",
        },
      ];

      // Re-run micro-TSP with updated waypoints
      const driverPos = tripData.remainingRoute?.[0];
      if (driverPos) {
        const allWaypoints = updatedRiders
          .filter((r) => r.status !== "DROPPED")
          .flatMap((r) => [
            ...(r.status === "WAITING_PICKUP"
              ? [
                  {
                    lat: r.pickup.lat,
                    lng: r.pickup.lng,
                    riderId: r.riderId,
                    type: "PICKUP" as const,
                  },
                ]
              : []),
            { lat: r.dropoff.lat, lng: r.dropoff.lng, riderId: r.riderId, type: "DROP" as const },
          ]);

        const optimized = optimizeRoute({ lat: driverPos.lat, lng: driverPos.lng }, allWaypoints);

        await rtdb.ref(`active-trips/${driverId}`).update({
          occupiedSeats: (tripData.occupiedSeats || 1) + 1,
          remainingRoute: optimized.map((wp) => ({ lat: wp.lat, lng: wp.lng })),
          riders: updatedRiders,
        });
      }
    }

    // Clear pending ride
    await rtdb.ref(`rides-pending/${driverId}`).remove();

    // Update ride RTDB node for rider tracking
    await rtdb.ref(`rides/${rideId}`).update({ isPooled: true, status: "ACCEPTED" });

    return res.status(200).json({ message: "Pool ride accepted", success: true });
  } catch (error) {
    console.error("[Pool] Error in acceptPoolOffer:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
};

// ============================================================================
// POST /pool/decline — Driver declines pool offer (REST fallback)
// ============================================================================

export const declinePoolOffer = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;
    const driverId = req.user?.uid;

    if (!rideId) {
      return res.status(400).json({ message: "Missing rideId", success: false });
    }
    if (!driverId) {
      return res.status(401).json({ message: "Unauthorized", success: false });
    }

    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({ message: "Ride not found", success: false });
    }

    if (rideDoc.data()?.driverId !== driverId) {
      return res
        .status(403)
        .json({ message: "Not authorized to decline this ride", success: false });
    }

    await rideRef.update({ status: "POOL_DECLINED" });

    // Clear pending ride
    await rtdb.ref(`rides-pending/${driverId}`).remove();
    await rtdb.ref(`rides/${rideId}`).update({ status: "POOL_DECLINED" });

    return res.status(200).json({ message: "Pool offer declined", success: true });
  } catch (error) {
    console.error("[Pool] Error in declinePoolOffer:", error);
    return res.status(500).json({ message: "Internal server error", success: false });
  }
};
