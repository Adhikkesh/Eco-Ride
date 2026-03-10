/**
 * Dynamic En-Route Pooling Engine
 *
 * Implements the 6-step logic pipeline for inserting a new ride request
 * (Rider B) into an active, ongoing trip (Rider A is already in the car).
 *
 * Pipeline:
 *   Step 1 — Active Route Corridor (Spatial Filter):
 *            Generate a forward-looking 1 km polyline buffer around the
 *            driver's remaining navigation path.
 *
 *   Step 2 — Intercept Query (Point-in-Polygon):
 *            Check if Rider B's pickup AND drop-off fall within the buffer.
 *
 *   Step 3 — Downstream Verification (Vector Alignment):
 *            Ensure drop-off is structurally "ahead" of pickup on the
 *            polyline to prevent severe backtracking.
 *
 *   Step 4 — Feasibility Math (Detour Cost):
 *            ΔT = T(new_route) − T(original_route).  Must be ≤ 5 min.
 *
 *   Step 5 — Rule Execution:
 *            ΔT ≤ MAX_DETOUR_MINUTES AND Available_Seats > 0.
 *
 *   Step 6 — Driver Dispatch (handled by WebSocket service):
 *            Push a high-priority payload; on acceptance, run micro-TSP
 *            to reorder waypoints optimally.
 */

import { MATCHING_CONFIG } from "../config/matchingConfig.js";
import {
  generatePolylineBuffer,
  haversineKm,
  isDropoffDownstream,
  isPointWithinPolylineCorridor,
  type LatLng,
  pointInPolygon,
} from "./geoUtils.js";
import type { Coordinates, RoutePoint } from "./matchingEngine.js";
import { optimizeRoute } from "./matchingEngine.js";

// ============================================================================
// Types
// ============================================================================

/** A driver's active trip state, persisted in RTDB under `active-trips/{driverId}` */
export interface ActiveTrip {
  driverId: string;
  /** Ordered polyline of the remaining navigation route (driver → waypoints → final drop) */
  remainingRoute: LatLng[];
  /** Currently boarded riders */
  riders: PooledRider[];
  /** Total seats in vehicle (excluding driver) */
  maxSeats: number;
  /** Seats already occupied */
  occupiedSeats: number;
  /** Estimated arrival at final destination (epoch ms) */
  estimatedArrivalMs: number;
  /** Original total trip time in minutes (without the new rider) */
  originalTripMinutes: number;
}

export interface PooledRider {
  riderId: string;
  rideId: string;
  pickup: LatLng;
  dropoff: LatLng;
  status: "WAITING_PICKUP" | "IN_CAR" | "DROPPED";
}

/** Incoming pool request from a new rider */
export interface PoolRequest {
  riderId: string;
  pickup: LatLng;
  dropoff: LatLng;
  /** Optional pre-computed fare estimate */
  fare?: number;
}

/** Result of the pooling pipeline for a single driver */
export interface PoolEvaluation {
  driverId: string;
  eligible: boolean;
  /** Which step rejected (0 = all passed) */
  rejectedAtStep: number;
  reason: string;
  /** Marginal detour cost (minutes) — only set if pipeline reaches Step 4 */
  deltaT?: number;
  /** Re-optimised waypoint order — only set if eligible */
  optimizedRoute?: RoutePoint[];
  /** Distance from rider pickup to nearest point on route (km) */
  pickupProximityKm?: number;
}

/** WebSocket payload schema sent to driver's dashboard upon match */
export interface PoolOfferPayload {
  type: "POOL_OFFER";
  priority: "HIGH";
  offerId: string;
  driverId: string;
  rideId: string;
  rider: {
    riderId: string;
    pickupLocation: LatLng;
    dropoffLocation: LatLng;
    pickupAddress?: string;
    dropoffAddress?: string;
  };
  detour: {
    deltaTMinutes: number;
    additionalDistanceKm: number;
    /** Optimised waypoint order after insertion */
    newWaypoints: RoutePoint[];
  };
  vehicle: {
    currentOccupancy: number;
    maxSeats: number;
  };
  fare: {
    riderFareEstimate: number;
    driverEarningsBoost: number;
  };
  /** Seconds the driver has to respond */
  timeoutSeconds: number;
  /** ISO-8601 timestamp when offer expires */
  expiresAt: string;
  /** ISO-8601 timestamp of offer creation */
  createdAt: string;
}

// ============================================================================
// Configuration (pooling-specific thresholds)
// ============================================================================

const POOL_CONFIG = {
  /** Average city speed for time estimates (km/h) */
  AVG_SPEED_KMH: MATCHING_CONFIG.AVERAGE_SPEED_KMH,
  /** Polyline buffer radius in km */
  BUFFER_RADIUS_KM: 1.0,
  /** Max allowed marginal detour (minutes) */
  MAX_DELTA_T_MINUTES: 5,
  /** Driver offer timeout (seconds) */
  OFFER_TIMEOUT_S: 15,
} as const;

// ============================================================================
// Helper: travel-time estimation
// ============================================================================

function travelTimeMinutes(distanceKm: number): number {
  return (distanceKm / POOL_CONFIG.AVG_SPEED_KMH) * 60;
}

/**
 * Compute total travel time (minutes) for a sequence of waypoints
 * starting from `start`.
 */
function routeTravelTime(start: LatLng, waypoints: LatLng[]): number {
  let total = 0;
  let current = start;
  for (const wp of waypoints) {
    total += travelTimeMinutes(haversineKm(current, wp));
    current = wp;
  }
  return total;
}

// ============================================================================
// Core Pipeline
// ============================================================================

/**
 * Evaluate whether a new pool request can be inserted into an active trip.
 *
 * Runs all 5 algorithmic steps synchronously (no I/O).
 * Step 6 (driver dispatch) is delegated to the caller / WebSocket service.
 */
export function evaluatePoolRequest(trip: ActiveTrip, request: PoolRequest): PoolEvaluation {
  const base: Omit<PoolEvaluation, "eligible" | "rejectedAtStep" | "reason"> = {
    driverId: trip.driverId,
  };

  const route = trip.remainingRoute;

  // ── Pre-check: enough seats? ──────────────────────────────────────────
  const availableSeats = trip.maxSeats - trip.occupiedSeats;
  if (availableSeats <= 0) {
    return { ...base, eligible: false, reason: "No available seats", rejectedAtStep: 5 };
  }

  // ── Step 1: Active Route Corridor (Polyline Buffer) ───────────────────
  // Generate a 1 km buffer polygon around the driver's remaining route.
  if (route.length < 2) {
    return {
      ...base,
      eligible: false,
      reason: "Driver route has fewer than 2 points — cannot generate corridor",
      rejectedAtStep: 1,
    };
  }

  const bufferPolygon = generatePolylineBuffer(route, POOL_CONFIG.BUFFER_RADIUS_KM);

  // ── Step 2: Intercept Query (Point-in-Polygon) ───────────────────────
  // Both pickup AND drop-off must lie within the corridor.
  // We use dual-check: first the fast segment-distance check, then PIP
  // for the final decision (handles edge cases at buffer boundaries).
  const pickupInCorridor =
    isPointWithinPolylineCorridor(request.pickup, route, POOL_CONFIG.BUFFER_RADIUS_KM) ||
    pointInPolygon(request.pickup, bufferPolygon);

  if (!pickupInCorridor) {
    return {
      ...base,
      eligible: false,
      pickupProximityKm: minDistToPolyline(request.pickup, route),
      reason: "Rider pickup is outside the 1 km active route corridor",
      rejectedAtStep: 2,
    };
  }

  const dropoffInCorridor =
    isPointWithinPolylineCorridor(request.dropoff, route, POOL_CONFIG.BUFFER_RADIUS_KM) ||
    pointInPolygon(request.dropoff, bufferPolygon);

  if (!dropoffInCorridor) {
    return {
      ...base,
      eligible: false,
      pickupProximityKm: minDistToPolyline(request.pickup, route),
      reason: "Rider drop-off is outside the 1 km active route corridor",
      rejectedAtStep: 2,
    };
  }

  // ── Step 3: Downstream Verification (Vector Alignment) ───────────────
  // Drop-off must be structurally ahead of pickup on the polyline.
  if (!isDropoffDownstream(request.pickup, request.dropoff, route)) {
    return {
      ...base,
      eligible: false,
      reason: "Drop-off is upstream of pickup — would require severe backtracking",
      rejectedAtStep: 3,
    };
  }

  // ── Step 4: Feasibility Math (Detour Cost ΔT) ────────────────────────
  //
  // Original route time: T(original_route)  — time for remaining route
  // New route time:      T(new_route)       — time after inserting pickup+dropoff
  // ΔT = T(new_route) − T(original_route)
  //
  const driverCurrentPos: LatLng = route[0]!;

  // T(original_route): sum of distances along remaining polyline
  const originalTimeMin = trip.originalTripMinutes;

  // Build the new waypoint set: existing drops + new pickup + new drop
  // Then run micro-TSP to find optimal order.
  const existingWaypoints = buildExistingWaypoints(trip);
  const newWaypoints: RoutePoint[] = [
    ...existingWaypoints,
    {
      lat: request.pickup.lat,
      lng: request.pickup.lng,
      riderId: request.riderId,
      type: "PICKUP",
    },
    {
      lat: request.dropoff.lat,
      lng: request.dropoff.lng,
      riderId: request.riderId,
      type: "DROP",
    },
  ];

  const optimized = optimizeRoute(
    { lat: driverCurrentPos.lat, lng: driverCurrentPos.lng } as Coordinates,
    newWaypoints,
  );

  // T(new_route)
  const newRoutePoints: LatLng[] = optimized.map((wp) => ({ lat: wp.lat, lng: wp.lng }));
  const newTimeMin = routeTravelTime(driverCurrentPos, newRoutePoints);

  const deltaT = newTimeMin - originalTimeMin;

  // ── Step 5: Rule Execution ────────────────────────────────────────────
  if (deltaT > POOL_CONFIG.MAX_DELTA_T_MINUTES) {
    return {
      ...base,
      deltaT,
      eligible: false,
      pickupProximityKm: minDistToPolyline(request.pickup, route),
      reason: `Detour cost ΔT=${deltaT.toFixed(1)} min exceeds limit of ${POOL_CONFIG.MAX_DELTA_T_MINUTES} min`,
      rejectedAtStep: 4,
    };
  }

  // All checks passed
  return {
    ...base,
    deltaT,
    eligible: true,
    optimizedRoute: optimized,
    pickupProximityKm: minDistToPolyline(request.pickup, route),
    reason: "Pool match validated — all 5 steps passed",
    rejectedAtStep: 0,
  };
}

// ============================================================================
// Batch Evaluation — scan multiple active trips
// ============================================================================

/**
 * Evaluate a pool request against ALL active trips and return ranked results.
 * Sorted by ΔT ascending (best match = least detour).
 */
export function findBestPoolMatch(
  activeTrips: ActiveTrip[],
  request: PoolRequest,
): PoolEvaluation[] {
  const results: PoolEvaluation[] = [];

  for (const trip of activeTrips) {
    const evaluation = evaluatePoolRequest(trip, request);
    results.push(evaluation);
  }

  // Sort eligible first, then by ΔT ascending
  return results.sort((a, b) => {
    if (a.eligible && !b.eligible) return -1;
    if (!a.eligible && b.eligible) return 1;
    return (a.deltaT ?? Infinity) - (b.deltaT ?? Infinity);
  });
}

// ============================================================================
// WebSocket Payload Builder
// ============================================================================

/**
 * Build the JSON payload dispatched to the driver's dashboard via WebSocket.
 */
export function buildPoolOfferPayload(
  evaluation: PoolEvaluation,
  request: PoolRequest,
  rideId: string,
  trip: ActiveTrip,
): PoolOfferPayload {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + POOL_CONFIG.OFFER_TIMEOUT_S * 1000);

  const additionalDistanceKm = evaluation.optimizedRoute
    ? routeDistanceKm(
        { lat: trip.remainingRoute[0]!.lat, lng: trip.remainingRoute[0]!.lng },
        evaluation.optimizedRoute.map((wp) => ({ lat: wp.lat, lng: wp.lng })),
      ) -
      routeDistanceKm(
        { lat: trip.remainingRoute[0]!.lat, lng: trip.remainingRoute[0]!.lng },
        trip.remainingRoute.slice(1),
      )
    : 0;

  return {
    createdAt: now.toISOString(),
    detour: {
      additionalDistanceKm: Math.round(additionalDistanceKm * 100) / 100,
      deltaTMinutes: Math.round((evaluation.deltaT ?? 0) * 10) / 10,
      newWaypoints: evaluation.optimizedRoute ?? [],
    },
    driverId: trip.driverId,
    expiresAt: expiresAt.toISOString(),
    fare: {
      driverEarningsBoost: Math.round((request.fare ?? 0) * 0.8 * 100) / 100,
      riderFareEstimate: request.fare ?? 0,
    },
    offerId: `pool_${rideId}_${Date.now()}`,
    priority: "HIGH",
    rideId,
    rider: {
      dropoffLocation: request.dropoff,
      pickupLocation: request.pickup,
      riderId: request.riderId,
    },
    timeoutSeconds: POOL_CONFIG.OFFER_TIMEOUT_S,
    type: "POOL_OFFER",
    vehicle: {
      currentOccupancy: trip.occupiedSeats,
      maxSeats: trip.maxSeats,
    },
  };
}

// ============================================================================
// Internal Helpers
// ============================================================================

/** Minimum distance from a point to any segment of the polyline (km) */
function minDistToPolyline(point: LatLng, polyline: LatLng[]): number {
  let min = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineKm(point, polyline[i]!);
    if (d < min) min = d;
  }
  return min;
}

/** Build RoutePoint[] from existing riders still requiring drop-off */
function buildExistingWaypoints(trip: ActiveTrip): RoutePoint[] {
  const waypoints: RoutePoint[] = [];

  for (const rider of trip.riders) {
    if (rider.status === "WAITING_PICKUP") {
      waypoints.push({
        lat: rider.pickup.lat,
        lng: rider.pickup.lng,
        riderId: rider.riderId,
        type: "PICKUP",
      });
    }
    if (rider.status !== "DROPPED") {
      waypoints.push({
        lat: rider.dropoff.lat,
        lng: rider.dropoff.lng,
        riderId: rider.riderId,
        type: "DROP",
      });
    }
  }

  return waypoints;
}

/** Total distance along a sequence of points starting from `start` */
function routeDistanceKm(start: LatLng, waypoints: LatLng[]): number {
  let total = 0;
  let current = start;
  for (const wp of waypoints) {
    total += haversineKm(current, wp);
    current = wp;
  }
  return total;
}
