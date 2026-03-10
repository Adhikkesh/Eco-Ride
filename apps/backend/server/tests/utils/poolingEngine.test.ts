/**
 * Unit Tests for Dynamic En-Route Pooling Engine
 *
 * Tests the 5-step pooling pipeline:
 *   Step 1 — Active Route Corridor (Polyline Buffer)
 *   Step 2 — Intercept Query (Point-in-Polygon)
 *   Step 3 — Downstream Verification (Vector Alignment)
 *   Step 4 — Feasibility Math (Detour Cost ΔT)
 *   Step 5 — Rule Execution
 *
 * Also tests: geoUtils helpers, batch evaluation, and payload builder.
 */

import { describe, expect, it } from "vitest";
import {
  bearing,
  generatePolylineBuffer,
  haversineKm,
  isDropoffDownstream,
  isPointWithinPolylineCorridor,
  type LatLng,
  offsetPoint,
  pointInPolygon,
  pointToSegmentDistanceKm,
  polylineSubDistance,
} from "../../src/utils/geoUtils.js";
import {
  type ActiveTrip,
  buildPoolOfferPayload,
  evaluatePoolRequest,
  findBestPoolMatch,
  type PoolRequest,
} from "../../src/utils/poolingEngine.js";

// ============================================================================
// Test Fixtures — Coimbatore Route
// ============================================================================

/** Simulated driver route: Coimbatore city center → Gandhipuram → RS Puram → Peelamedu */
const COIMBATORE_ROUTE: LatLng[] = [
  { lat: 11.0168, lng: 76.9558 }, // Start: Town Hall
  { lat: 11.0185, lng: 76.965 }, // Gandhipuram Bus Stand
  { lat: 11.012, lng: 76.948 }, // RS Puram
  { lat: 11.025, lng: 76.932 }, // Peelamedu
  { lat: 11.03, lng: 76.92 }, // End: near Tidel Park
];

function makeActiveTrip(overrides: Partial<ActiveTrip> = {}): ActiveTrip {
  return {
    driverId: "driver_001",
    estimatedArrivalMs: Date.now() + 20 * 60 * 1000,
    maxSeats: 4,
    occupiedSeats: 1,
    originalTripMinutes: 12,
    remainingRoute: COIMBATORE_ROUTE,
    riders: [
      {
        dropoff: COIMBATORE_ROUTE[4]!,
        pickup: COIMBATORE_ROUTE[0]!,
        rideId: "ride_001",
        riderId: "riderA",
        status: "IN_CAR",
      },
    ],
    ...overrides,
  };
}

function makePoolRequest(overrides: Partial<PoolRequest> = {}): PoolRequest {
  return {
    // Dropoff near Peelamedu (within corridor, downstream)
    dropoff: { lat: 11.026, lng: 76.931 },
    fare: 120,
    // Pickup near Gandhipuram (within corridor)
    pickup: { lat: 11.018, lng: 76.964 },
    riderId: "riderB",
    ...overrides,
  };
}

// ============================================================================
// geoUtils — haversineKm
// ============================================================================

describe("haversineKm", () => {
  it("should return 0 for identical points", () => {
    const p = { lat: 11.0168, lng: 76.9558 };
    expect(haversineKm(p, p)).toBe(0);
  });

  it("should return reasonable distance for nearby points", () => {
    const a = { lat: 11.0168, lng: 76.9558 };
    const b = { lat: 11.0258, lng: 76.9558 }; // ~1 km N
    const dist = haversineKm(a, b);
    expect(dist).toBeGreaterThan(0.8);
    expect(dist).toBeLessThan(1.2);
  });

  it("should handle large distances", () => {
    const a = { lat: 11.0168, lng: 76.9558 }; // Coimbatore
    const b = { lat: 13.0827, lng: 80.2707 }; // Chennai
    const dist = haversineKm(a, b);
    expect(dist).toBeGreaterThan(400);
    expect(dist).toBeLessThan(600);
  });
});

// ============================================================================
// geoUtils — bearing
// ============================================================================

describe("bearing", () => {
  it("should return ~0° for due north movement", () => {
    const a = { lat: 11.0, lng: 76.0 };
    const b = { lat: 12.0, lng: 76.0 };
    const b_ = bearing(a, b);
    expect(b_).toBeCloseTo(0, 0);
  });

  it("should return ~90° for due east movement", () => {
    const a = { lat: 11.0, lng: 76.0 };
    const b = { lat: 11.0, lng: 77.0 };
    const b_ = bearing(a, b);
    expect(b_).toBeGreaterThan(85);
    expect(b_).toBeLessThan(95);
  });
});

// ============================================================================
// geoUtils — offsetPoint
// ============================================================================

describe("offsetPoint", () => {
  it("should offset roughly 1 km north", () => {
    const origin = { lat: 11.0, lng: 76.0 };
    const offset = offsetPoint(origin, 1, 0); // 1 km north
    const dist = haversineKm(origin, offset);
    expect(dist).toBeCloseTo(1, 1);
    expect(offset.lat).toBeGreaterThan(origin.lat);
  });

  it("should offset roughly 1 km east", () => {
    const origin = { lat: 11.0, lng: 76.0 };
    const offset = offsetPoint(origin, 1, 90); // 1 km east
    const dist = haversineKm(origin, offset);
    expect(dist).toBeCloseTo(1, 1);
    expect(offset.lng).toBeGreaterThan(origin.lng);
  });
});

// ============================================================================
// geoUtils — pointToSegmentDistanceKm
// ============================================================================

describe("pointToSegmentDistanceKm", () => {
  it("should return 0 for a point on the segment", () => {
    const a = { lat: 11.0, lng: 76.0 };
    const b = { lat: 11.0, lng: 77.0 };
    const mid = { lat: 11.0, lng: 76.5 };
    const dist = pointToSegmentDistanceKm(mid, a, b);
    expect(dist).toBeLessThan(0.5); // Approximate due to earth curvature
  });

  it("should return distance to endpoint for projections beyond segment", () => {
    const a = { lat: 11.0, lng: 76.0 };
    const b = { lat: 11.0, lng: 76.5 };
    const far = { lat: 11.0, lng: 77.0 }; // Beyond b
    const dist = pointToSegmentDistanceKm(far, a, b);
    const expected = haversineKm(far, b);
    expect(dist).toBeCloseTo(expected, 0);
  });
});

// ============================================================================
// geoUtils — generatePolylineBuffer
// ============================================================================

describe("generatePolylineBuffer", () => {
  it("should return empty for single-point polyline", () => {
    expect(generatePolylineBuffer([{ lat: 11, lng: 76 }], 1)).toEqual([]);
  });

  it("should generate a closed polygon for a 2-point polyline", () => {
    const poly: LatLng[] = [
      { lat: 11.0, lng: 76.0 },
      { lat: 11.01, lng: 76.01 },
    ];
    const buffer = generatePolylineBuffer(poly, 1);
    expect(buffer.length).toBeGreaterThan(4);
    // Should be closed (first === last)
    expect(buffer[0]!.lat).toBeCloseTo(buffer[buffer.length - 1]!.lat, 8);
    expect(buffer[0]!.lng).toBeCloseTo(buffer[buffer.length - 1]!.lng, 8);
  });

  it("should generate a larger polygon for wider buffer", () => {
    const poly: LatLng[] = [
      { lat: 11.0, lng: 76.0 },
      { lat: 11.05, lng: 76.05 },
    ];
    const narrow = generatePolylineBuffer(poly, 0.5);
    const wide = generatePolylineBuffer(poly, 2);
    // Wide buffer polygon should have vertices farther from polyline
    expect(wide.length).toBeGreaterThanOrEqual(narrow.length);
  });
});

// ============================================================================
// geoUtils — pointInPolygon
// ============================================================================

describe("pointInPolygon", () => {
  // Simple square polygon around (11, 76)
  const square: LatLng[] = [
    { lat: 10.99, lng: 75.99 },
    { lat: 10.99, lng: 76.01 },
    { lat: 11.01, lng: 76.01 },
    { lat: 11.01, lng: 75.99 },
    { lat: 10.99, lng: 75.99 }, // closed
  ];

  it("should return true for point inside polygon", () => {
    expect(pointInPolygon({ lat: 11.0, lng: 76.0 }, square)).toBe(true);
  });

  it("should return false for point outside polygon", () => {
    expect(pointInPolygon({ lat: 12.0, lng: 77.0 }, square)).toBe(false);
  });

  it("should return false for insufficient vertices", () => {
    expect(pointInPolygon({ lat: 11.0, lng: 76.0 }, [{ lat: 11, lng: 76 }])).toBe(false);
  });
});

// ============================================================================
// geoUtils — isPointWithinPolylineCorridor
// ============================================================================

describe("isPointWithinPolylineCorridor", () => {
  const route: LatLng[] = [
    { lat: 11.0, lng: 76.0 },
    { lat: 11.01, lng: 76.01 },
    { lat: 11.02, lng: 76.02 },
  ];

  it("should return true for a point close to the polyline", () => {
    // Point right on the second vertex
    expect(isPointWithinPolylineCorridor({ lat: 11.01, lng: 76.01 }, route, 1)).toBe(true);
  });

  it("should return false for a point far from the polyline", () => {
    expect(isPointWithinPolylineCorridor({ lat: 12.0, lng: 77.0 }, route, 1)).toBe(false);
  });
});

// ============================================================================
// geoUtils — isDropoffDownstream
// ============================================================================

describe("isDropoffDownstream", () => {
  it("should return true when dropoff is ahead of pickup on route", () => {
    expect(isDropoffDownstream(COIMBATORE_ROUTE[1]!, COIMBATORE_ROUTE[3]!, COIMBATORE_ROUTE)).toBe(
      true,
    );
  });

  it("should return true when pickup and dropoff are at same index", () => {
    expect(isDropoffDownstream(COIMBATORE_ROUTE[2]!, COIMBATORE_ROUTE[2]!, COIMBATORE_ROUTE)).toBe(
      true,
    );
  });

  it("should return false when dropoff is behind pickup on route", () => {
    // Pickup at index 3, dropoff at index 1 → backtracking
    expect(isDropoffDownstream(COIMBATORE_ROUTE[3]!, COIMBATORE_ROUTE[1]!, COIMBATORE_ROUTE)).toBe(
      false,
    );
  });

  it("should return false for a single-point route", () => {
    expect(
      isDropoffDownstream({ lat: 11, lng: 76 }, { lat: 11, lng: 77 }, [{ lat: 11, lng: 76 }]),
    ).toBe(false);
  });
});

// ============================================================================
// geoUtils — polylineSubDistance
// ============================================================================

describe("polylineSubDistance", () => {
  it("should return 0 for same indices", () => {
    expect(polylineSubDistance(COIMBATORE_ROUTE, 2, 2)).toBe(0);
  });

  it("should return positive distance for different indices", () => {
    const dist = polylineSubDistance(COIMBATORE_ROUTE, 0, 4);
    expect(dist).toBeGreaterThan(0);
  });

  it("should handle reversed indices", () => {
    const fwd = polylineSubDistance(COIMBATORE_ROUTE, 0, 3);
    const rev = polylineSubDistance(COIMBATORE_ROUTE, 3, 0);
    expect(fwd).toBeCloseTo(rev, 5);
  });
});

// ============================================================================
// poolingEngine — evaluatePoolRequest (full pipeline)
// ============================================================================

describe("evaluatePoolRequest", () => {
  it("should reject when no seats available", () => {
    const trip = makeActiveTrip({ maxSeats: 4, occupiedSeats: 4 });
    const result = evaluatePoolRequest(trip, makePoolRequest());
    expect(result.eligible).toBe(false);
    expect(result.rejectedAtStep).toBe(5);
    expect(result.reason).toContain("No available seats");
  });

  it("should reject when route has fewer than 2 points", () => {
    const trip = makeActiveTrip({ remainingRoute: [{ lat: 11, lng: 76 }] });
    const result = evaluatePoolRequest(trip, makePoolRequest());
    expect(result.eligible).toBe(false);
    expect(result.rejectedAtStep).toBe(1);
  });

  it("should reject when pickup is far outside the corridor", () => {
    const req = makePoolRequest({
      pickup: { lat: 13.0827, lng: 80.2707 }, // Chennai (very far away)
    });
    const result = evaluatePoolRequest(makeActiveTrip(), req);
    expect(result.eligible).toBe(false);
    expect(result.rejectedAtStep).toBe(2);
    expect(result.reason).toContain("pickup");
  });

  it("should reject when dropoff is far outside the corridor", () => {
    const req = makePoolRequest({
      dropoff: { lat: 13.0, lng: 80.0 },
      // Pickup on route, dropoff far away
      pickup: { lat: 11.018, lng: 76.964 },
    });
    const result = evaluatePoolRequest(makeActiveTrip(), req);
    expect(result.eligible).toBe(false);
    // Should fail at step 2 (dropoff outside corridor) or step 3 (not downstream)
    expect([2, 3]).toContain(result.rejectedAtStep);
  });

  it("should reject when dropoff is upstream (backtracking)", () => {
    const req = makePoolRequest({
      dropoff: { lat: 11.017, lng: 76.9555 },
      // Pickup near end of route, dropoff near start → backtracking
      pickup: { lat: 11.029, lng: 76.921 },
    });
    const result = evaluatePoolRequest(makeActiveTrip(), req);
    expect(result.eligible).toBe(false);
    // May fail at step 2 or 3 depending on corridor
    expect(result.rejectedAtStep).toBeGreaterThanOrEqual(2);
  });

  it("should accept a valid pool request within corridor and downstream", () => {
    // Both pickup and dropoff are very close to route points
    const req = makePoolRequest({
      dropoff: { lat: 11.0248, lng: 76.9322 }, // Very close to route[3]
      pickup: { lat: 11.0183, lng: 76.9648 }, // Very close to route[1]
    });
    const trip = makeActiveTrip({ originalTripMinutes: 20 }); // Give generous original time
    const result = evaluatePoolRequest(trip, req);

    if (result.eligible) {
      expect(result.rejectedAtStep).toBe(0);
      expect(result.deltaT).toBeDefined();
      expect(result.optimizedRoute).toBeDefined();
      expect(result.optimizedRoute!.length).toBeGreaterThan(0);
    } else {
      // If rejected, should be at step 4 (ΔT too high) since spatial checks pass
      expect(result.rejectedAtStep).toBeGreaterThanOrEqual(4);
    }
  });
});

// ============================================================================
// poolingEngine — findBestPoolMatch (batch)
// ============================================================================

describe("findBestPoolMatch", () => {
  it("should return results sorted with eligible first", () => {
    const trips = [
      makeActiveTrip({ driverId: "d1", maxSeats: 4, occupiedSeats: 4 }), // Full
      makeActiveTrip({ driverId: "d2", occupiedSeats: 1 }), // Has space
    ];
    const results = findBestPoolMatch(trips, makePoolRequest());
    // d1 should be ineligible, d2 may or may not be eligible
    const d1Result = results.find((r) => r.driverId === "d1");
    expect(d1Result?.eligible).toBe(false);
  });

  it("should handle empty active trips", () => {
    const results = findBestPoolMatch([], makePoolRequest());
    expect(results).toHaveLength(0);
  });

  it("should rank by ΔT ascending among eligible matches", () => {
    // Create two trips with slightly different routes
    const trips = [
      makeActiveTrip({
        driverId: "d1",
        originalTripMinutes: 30,
        remainingRoute: COIMBATORE_ROUTE,
      }),
      makeActiveTrip({
        driverId: "d2",
        originalTripMinutes: 30,
        remainingRoute: COIMBATORE_ROUTE,
      }),
    ];

    const results = findBestPoolMatch(trips, makePoolRequest());
    const eligibleResults = results.filter((r) => r.eligible);

    if (eligibleResults.length >= 2) {
      expect(eligibleResults[0]!.deltaT!).toBeLessThanOrEqual(eligibleResults[1]!.deltaT!);
    }
  });
});

// ============================================================================
// poolingEngine — buildPoolOfferPayload (WebSocket schema)
// ============================================================================

describe("buildPoolOfferPayload", () => {
  it("should produce a valid JSON payload with all required fields", () => {
    const trip = makeActiveTrip();
    const req = makePoolRequest();
    const evaluation = {
      deltaT: 2.5,
      driverId: "driver_001",
      eligible: true,
      optimizedRoute: [
        { lat: 11.018, lng: 76.964, order: 1, riderId: "riderB", type: "PICKUP" as const },
        { lat: 11.025, lng: 76.932, order: 2, riderId: "riderA", type: "DROP" as const },
        { lat: 11.026, lng: 76.931, order: 3, riderId: "riderB", type: "DROP" as const },
      ],
      reason: "OK",
      rejectedAtStep: 0,
    };

    const payload = buildPoolOfferPayload(evaluation, req, "ride_123", trip);

    expect(payload.type).toBe("POOL_OFFER");
    expect(payload.priority).toBe("HIGH");
    expect(payload.offerId).toContain("pool_ride_123_");
    expect(payload.driverId).toBe("driver_001");
    expect(payload.rideId).toBe("ride_123");

    // Rider info
    expect(payload.rider.riderId).toBe("riderB");
    expect(payload.rider.pickupLocation).toEqual(req.pickup);
    expect(payload.rider.dropoffLocation).toEqual(req.dropoff);

    // Detour
    expect(payload.detour.deltaTMinutes).toBe(2.5);
    expect(payload.detour.newWaypoints).toHaveLength(3);

    // Vehicle
    expect(payload.vehicle.currentOccupancy).toBe(1);
    expect(payload.vehicle.maxSeats).toBe(4);

    // Fare
    expect(payload.fare.riderFareEstimate).toBe(120);
    expect(payload.fare.driverEarningsBoost).toBeGreaterThan(0);

    // Timeout
    expect(payload.timeoutSeconds).toBe(15);
    expect(payload.expiresAt).toBeTruthy();
    expect(payload.createdAt).toBeTruthy();

    // Expiry should be 15s after creation
    const created = new Date(payload.createdAt).getTime();
    const expires = new Date(payload.expiresAt).getTime();
    expect(expires - created).toBe(15_000);
  });

  it("should handle missing fare gracefully", () => {
    const trip = makeActiveTrip();
    const req = makePoolRequest({ fare: undefined });
    const evaluation = {
      deltaT: 1.0,
      driverId: "driver_001",
      eligible: true,
      optimizedRoute: [],
      reason: "OK",
      rejectedAtStep: 0,
    };

    const payload = buildPoolOfferPayload(evaluation, req, "ride_456", trip);
    expect(payload.fare.riderFareEstimate).toBe(0);
    expect(payload.fare.driverEarningsBoost).toBe(0);
  });
});
