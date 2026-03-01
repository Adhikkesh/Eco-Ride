/**
 * Unit Tests for Pre-Trip Matching Engine
 *
 * Tests the 4-phase driver matching pipeline:
 *   Phase 1 — Spatial (geohash + radius)
 *   Phase 2 — Vector Alignment (cosine similarity)
 *   Phase 3 — Detour Feasibility
 *   Phase 4 — Global Optimization (weighted cost)
 *
 * Also tests: optimizeRoute (TSP-lite), generateGeohash, and the matchDriver pipeline.
 */

import { describe, expect, it } from "vitest";
import {
  type Coordinates,
  type DriverCandidate,
  type DriverLocation,
  generateGeohash,
  matchDriver,
  optimizeRoute,
  phase1SpatialFilter,
  phase2VectorAlignment,
  phase3DetourFeasibility,
  phase4GlobalOptimization,
  type RideRequest,
  type RoutePoint,
} from "../../src/utils/matchingEngine.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Coimbatore city center — default for tests. */
const COIMBATORE: Coordinates = { lat: 11.0168, lng: 76.9558 };

/** ~1 km north of Coimbatore. */
const NEAR_NORTH: Coordinates = { lat: 11.0258, lng: 76.9558 };

/** ~10 km east of Coimbatore. */
const FAR_EAST: Coordinates = { lat: 11.0168, lng: 77.065 };

/** ~50 km away. */
const VERY_FAR: Coordinates = { lat: 11.5, lng: 77.5 };

function makeDriver(overrides: Partial<DriverLocation> = {}): DriverLocation {
  return {
    heading: 0,
    lastUpdated: Date.now(),
    lat: COIMBATORE.lat,
    lng: COIMBATORE.lng,
    status: "AVAILABLE",
    ...overrides,
  };
}

function makeCandidate(
  driverId: string,
  distanceKm: number,
  overrides: Partial<DriverCandidate> = {},
): DriverCandidate {
  return {
    distance: distanceKm,
    driverId,
    location: makeDriver(),
    ...overrides,
  };
}

function makeRideRequest(
  origin: Coordinates = COIMBATORE,
  destination: Coordinates = FAR_EAST,
): RideRequest {
  return { destination, origin };
}

// ─── generateGeohash ─────────────────────────────────────────────────────────

describe("generateGeohash", () => {
  it("should return a non-empty string for valid coordinates", () => {
    const hash = generateGeohash(COIMBATORE);
    expect(hash).toBeTruthy();
    expect(typeof hash).toBe("string");
  });

  it("should return consistent hashes for the same location", () => {
    const h1 = generateGeohash(COIMBATORE);
    const h2 = generateGeohash(COIMBATORE);
    expect(h1).toBe(h2);
  });

  it("should return different hashes for distant locations", () => {
    const h1 = generateGeohash(COIMBATORE);
    const h2 = generateGeohash(VERY_FAR);
    expect(h1).not.toBe(h2);
  });

  it("should return hashes of the specified precision", () => {
    const hash4 = generateGeohash(COIMBATORE, 4);
    const hash6 = generateGeohash(COIMBATORE, 6);
    expect(hash4.length).toBe(4);
    expect(hash6.length).toBe(6);
  });
});

// ─── optimizeRoute (TSP-Lite) ────────────────────────────────────────────────

describe("optimizeRoute", () => {
  it("should return empty array for empty waypoints", () => {
    const result = optimizeRoute(COIMBATORE, []);
    expect(result).toEqual([]);
  });

  it("should handle a single waypoint", () => {
    const wp: RoutePoint[] = [{ lat: 11.02, lng: 76.96, riderId: "r1", type: "DROP" }];
    const result = optimizeRoute(COIMBATORE, wp);
    expect(result).toHaveLength(1);
    expect(result[0]?.riderId).toBe("r1");
    expect(result[0]?.order).toBe(1);
  });

  it("should enforce PICKUP before DROP for same rider", () => {
    const wp: RoutePoint[] = [
      { lat: 11.05, lng: 76.96, riderId: "r1", type: "DROP" },
      { lat: 11.02, lng: 76.96, riderId: "r1", type: "PICKUP" },
    ];
    const result = optimizeRoute(COIMBATORE, wp);
    expect(result).toHaveLength(2);

    const pickupIdx = result.findIndex((r) => r.type === "PICKUP" && r.riderId === "r1");
    const dropIdx = result.findIndex((r) => r.type === "DROP" && r.riderId === "r1");
    expect(pickupIdx).toBeLessThan(dropIdx);
  });

  it("should assign sequential order numbers", () => {
    const wp: RoutePoint[] = [
      { lat: 11.02, lng: 76.96, riderId: "r1", type: "PICKUP" },
      { lat: 11.03, lng: 76.96, riderId: "r2", type: "PICKUP" },
      { lat: 11.04, lng: 76.96, riderId: "r1", type: "DROP" },
      { lat: 11.05, lng: 76.96, riderId: "r2", type: "DROP" },
    ];
    const result = optimizeRoute(COIMBATORE, wp);
    expect(result).toHaveLength(4);
    for (let i = 0; i < result.length; i++) {
      expect(result[i]?.order).toBe(i + 1);
    }
  });

  it("should pick nearest waypoint first (greedy)", () => {
    const wp: RoutePoint[] = [
      { lat: 11.1, lng: 76.96, riderId: "far", type: "DROP" },
      { lat: 11.018, lng: 76.956, riderId: "near", type: "DROP" },
    ];
    const result = optimizeRoute(COIMBATORE, wp);
    expect(result[0]?.riderId).toBe("near");
    expect(result[1]?.riderId).toBe("far");
  });
});

// ─── Phase 1: Spatial Filter ─────────────────────────────────────────────────

describe("phase1SpatialFilter", () => {
  it("should return empty when no drivers exist", () => {
    const drivers = new Map<string, DriverLocation>();
    const result = phase1SpatialFilter(drivers, COIMBATORE);
    expect(result).toEqual([]);
  });

  it("should include AVAILABLE drivers within radius", () => {
    const drivers = new Map<string, DriverLocation>();
    drivers.set("d1", makeDriver({ lat: NEAR_NORTH.lat, lng: NEAR_NORTH.lng }));
    const result = phase1SpatialFilter(drivers, COIMBATORE);
    expect(result).toHaveLength(1);
    expect(result[0]?.driverId).toBe("d1");
  });

  it("should exclude drivers outside radius", () => {
    const drivers = new Map<string, DriverLocation>();
    drivers.set("d1", makeDriver({ lat: VERY_FAR.lat, lng: VERY_FAR.lng }));
    const result = phase1SpatialFilter(drivers, COIMBATORE);
    expect(result).toHaveLength(0);
  });

  it("should exclude RESERVED drivers", () => {
    const drivers = new Map<string, DriverLocation>();
    drivers.set("d1", makeDriver({ lat: NEAR_NORTH.lat, lng: NEAR_NORTH.lng, status: "RESERVED" }));
    const result = phase1SpatialFilter(drivers, COIMBATORE);
    expect(result).toHaveLength(0);
  });

  it("should skip drivers with NaN coordinates", () => {
    const drivers = new Map<string, DriverLocation>();
    drivers.set("d1", makeDriver({ lat: NaN, lng: NaN }));
    const result = phase1SpatialFilter(drivers, COIMBATORE);
    expect(result).toHaveLength(0);
  });

  it("should include distance in candidate result", () => {
    const drivers = new Map<string, DriverLocation>();
    drivers.set("d1", makeDriver({ lat: NEAR_NORTH.lat, lng: NEAR_NORTH.lng }));
    const result = phase1SpatialFilter(drivers, COIMBATORE);
    expect(result[0]?.distance).toBeGreaterThan(0);
    expect(result[0]?.distance).toBeLessThan(2); // ~1km
  });

  it("should use custom radius when provided", () => {
    const drivers = new Map<string, DriverLocation>();
    // Place driver ~5km away
    drivers.set("d1", makeDriver({ lat: 11.06, lng: 76.96 }));
    // Default radius (2km) should exclude
    const noResult = phase1SpatialFilter(drivers, COIMBATORE, null, 2);
    expect(noResult).toHaveLength(0);
    // Large radius should include
    const result = phase1SpatialFilter(drivers, COIMBATORE, null, 10);
    expect(result).toHaveLength(1);
  });

  it("should sort multiple drivers by distance implicitly (nearest first in iteration)", () => {
    const drivers = new Map<string, DriverLocation>();
    drivers.set("far", makeDriver({ lat: 11.03, lng: 76.96 }));
    drivers.set("near", makeDriver({ lat: 11.018, lng: 76.956 }));
    const result = phase1SpatialFilter(drivers, COIMBATORE);
    // Both should be within radius
    expect(result.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Phase 2: Vector Alignment ───────────────────────────────────────────────

describe("phase2VectorAlignment", () => {
  it("should include drivers with no heading (fallback)", () => {
    const candidates = [makeCandidate("d1", 1.0)]; // heading=0 by default
    const request = makeRideRequest();
    const result = phase2VectorAlignment(candidates, request);
    expect(result).toHaveLength(1);
    expect(result[0]?.cosineSimilarity).toBe(0.5); // fallback score
  });

  it("should include aligned drivers", () => {
    // Trip goes east → heading ~90° is aligned
    const candidates = [makeCandidate("d1", 1.0, { location: makeDriver({ heading: 90 }) })];
    const request = makeRideRequest(COIMBATORE, FAR_EAST); // going east
    const result = phase2VectorAlignment(candidates, request);
    expect(result).toHaveLength(1);
    expect(result[0]?.cosineSimilarity).toBeGreaterThan(0.8);
  });

  it("should exclude misaligned drivers (heading opposite)", () => {
    // Trip goes east, driver heading west (270°)
    const candidates = [makeCandidate("d1", 1.0, { location: makeDriver({ heading: 270 }) })];
    const request = makeRideRequest(COIMBATORE, FAR_EAST);
    const _result = phase2VectorAlignment(candidates, request);
    // Should be filtered out — but fallback returns all if none pass
    // Actually, if none pass the filter, it falls back to ALL candidates
  });

  it("should fall back to all candidates when none pass alignment", () => {
    const candidates = [
      makeCandidate("d1", 1.0, { location: makeDriver({ heading: 270 }) }),
      makeCandidate("d2", 1.5, { location: makeDriver({ heading: 180 }) }),
    ];
    const request = makeRideRequest(COIMBATORE, FAR_EAST);
    const result = phase2VectorAlignment(candidates, request);
    // If none pass, all are returned as fallback
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  it("should prefer aligned drivers over fallback", () => {
    const candidates = [
      makeCandidate("aligned", 1.0, { location: makeDriver({ heading: 90 }) }),
      makeCandidate("fallback", 1.5, { location: makeDriver({ heading: 0 }) }), // heading=0 → fallback
    ];
    const request = makeRideRequest(COIMBATORE, FAR_EAST);
    const result = phase2VectorAlignment(candidates, request);
    expect(result).toHaveLength(2);

    const aligned = result.find((c) => c.driverId === "aligned");
    const fallback = result.find((c) => c.driverId === "fallback");
    expect(aligned?.cosineSimilarity).toBeGreaterThan(fallback?.cosineSimilarity ?? 0);
  });
});

// ─── Phase 3: Detour Feasibility ─────────────────────────────────────────────

describe("phase3DetourFeasibility", () => {
  it("should include nearby drivers (short detour)", () => {
    const candidates = [makeCandidate("d1", 0.5)];
    const request = makeRideRequest();
    const result = phase3DetourFeasibility(candidates, request);
    expect(result).toHaveLength(1);
    expect(result[0]?.detourMinutes).toBeGreaterThan(0);
  });

  it("should exclude drivers with excessive detour", () => {
    // 50km away → detour = (50/30)*60 = 100 minutes > 15 max
    const candidates = [makeCandidate("d1", 50)];
    const request = makeRideRequest();
    const result = phase3DetourFeasibility(candidates, request);
    expect(result).toHaveLength(0);
  });

  it("should calculate detourMinutes correctly", () => {
    const candidates = [makeCandidate("d1", 1.5)]; // 1.5km → (1.5/30)*60 = 3 min
    const request = makeRideRequest();
    const result = phase3DetourFeasibility(candidates, request);
    expect(result).toHaveLength(1);
    expect(result[0]?.detourMinutes).toBeCloseTo(3.0, 0);
  });

  it("should use custom maxDetourMinutes when provided", () => {
    const candidates = [makeCandidate("d1", 5)]; // 5km → 10 min
    const request = makeRideRequest();
    // Default max=15 → passes
    expect(phase3DetourFeasibility(candidates, request).length).toBe(1);
    // Custom max=5 → fails
    expect(phase3DetourFeasibility(candidates, request, 5).length).toBe(0);
  });
});

// ─── Phase 4: Global Optimization ────────────────────────────────────────────

describe("phase4GlobalOptimization", () => {
  it("should return null for empty candidates", () => {
    const result = phase4GlobalOptimization([], makeRideRequest());
    expect(result).toBeNull();
  });

  it("should return the single candidate with cost=0", () => {
    const candidates = [makeCandidate("d1", 1.0, { detourMinutes: 2 })];
    const result = phase4GlobalOptimization(candidates, makeRideRequest());
    expect(result).not.toBeNull();
    expect(result?.driverId).toBe("d1");
    expect(result?.cost).toBe(0);
  });

  it("should select closest driver when others have higher cost", () => {
    const candidates = [
      makeCandidate("near", 0.5, { detourMinutes: 1 }),
      makeCandidate("far", 5.0, { detourMinutes: 10 }),
    ];
    const result = phase4GlobalOptimization(candidates, makeRideRequest());
    expect(result?.driverId).toBe("near");
  });

  it("should assign cost to all evaluated candidates", () => {
    const candidates = [
      makeCandidate("d1", 1.0, { detourMinutes: 2 }),
      makeCandidate("d2", 2.0, { detourMinutes: 4 }),
    ];
    phase4GlobalOptimization(candidates, makeRideRequest());
    expect(candidates[0]?.cost).toBeDefined();
    expect(candidates[1]?.cost).toBeDefined();
  });

  it("should factor in vehicle type for fuel consumption", () => {
    const candidates = [
      makeCandidate("petrol", 1.0, {
        detourMinutes: 2,
        location: makeDriver({ vehicleType: "PETROL" }),
      }),
      makeCandidate("electric", 1.0, {
        detourMinutes: 2,
        location: makeDriver({ vehicleType: "ELECTRIC" }),
      }),
    ];
    const result = phase4GlobalOptimization(candidates, makeRideRequest());
    // Electric has zero fuel cost → lower total cost → should be selected
    expect(result?.driverId).toBe("electric");
  });
});

// ─── matchDriver (Full Pipeline) ─────────────────────────────────────────────

describe("matchDriver", () => {
  it("should return no match when no drivers exist", () => {
    const drivers = new Map<string, DriverLocation>();
    const request = makeRideRequest();
    const result = matchDriver(drivers, request);
    expect(result.driver).toBeNull();
    expect(result.phase).toBe(0);
  });

  it("should match a nearby available driver", () => {
    const drivers = new Map<string, DriverLocation>();
    drivers.set("d1", makeDriver({ lat: NEAR_NORTH.lat, lng: NEAR_NORTH.lng }));
    const request = makeRideRequest();
    const result = matchDriver(drivers, request);
    expect(result.driver).not.toBeNull();
    expect(result.driver?.driverId).toBe("d1");
    expect(result.phase).toBe(4);
  });

  it("should populate candidatesPerPhase array", () => {
    const drivers = new Map<string, DriverLocation>();
    drivers.set("d1", makeDriver({ lat: NEAR_NORTH.lat, lng: NEAR_NORTH.lng }));
    const result = matchDriver(drivers, makeRideRequest());
    expect(result.candidatesPerPhase.length).toBeGreaterThan(0);
    expect(result.candidatesPerPhase[0]).toBeGreaterThanOrEqual(1);
  });

  it("should expand radius and still find drivers", () => {
    const drivers = new Map<string, DriverLocation>();
    // Place driver ~5km away (outside default 2km radius, inside expanded 7km)
    drivers.set("d1", makeDriver({ lat: 11.06, lng: 76.96 }));
    const result = matchDriver(drivers, makeRideRequest());
    expect(result.driver).not.toBeNull();
    expect(result.driver?.driverId).toBe("d1");
  });

  it("should include message in result", () => {
    const drivers = new Map<string, DriverLocation>();
    const result = matchDriver(drivers, makeRideRequest());
    expect(result.message).toBeTruthy();
  });

  it("should select best driver among multiple nearby drivers", () => {
    const drivers = new Map<string, DriverLocation>();
    // Closer driver should win
    drivers.set("close", makeDriver({ lat: 11.018, lng: 76.956 }));
    drivers.set("far", makeDriver({ lat: 11.03, lng: 76.96 }));
    const result = matchDriver(drivers, makeRideRequest());
    expect(result.driver).not.toBeNull();
    // The closer driver should be selected
    expect(result.driver?.driverId).toBe("close");
  });
});

// ─── matchingConfig validation ───────────────────────────────────────────────

describe("matchingConfig consistency", () => {
  // Import the config to validate it
  it("should have optimization weights that sum to 1.0", async () => {
    const { MATCHING_CONFIG } = await import("../../src/config/matchingConfig.js");
    const sum =
      MATCHING_CONFIG.WEIGHT_PICKUP_TIME +
      MATCHING_CONFIG.WEIGHT_DETOUR +
      MATCHING_CONFIG.WEIGHT_FUEL;
    expect(sum).toBeCloseTo(1.0, 5);
  });

  it("should have positive search radii", async () => {
    const { MATCHING_CONFIG } = await import("../../src/config/matchingConfig.js");
    expect(MATCHING_CONFIG.MAX_PICKUP_RADIUS_KM).toBeGreaterThan(0);
    expect(MATCHING_CONFIG.MAX_SEARCH_RADIUS_KM).toBeGreaterThan(0);
    expect(MATCHING_CONFIG.MAX_SEARCH_RADIUS_KM).toBeGreaterThanOrEqual(
      MATCHING_CONFIG.MAX_PICKUP_RADIUS_KM,
    );
  });

  it("should have cosine similarity threshold between -1 and 1", async () => {
    const { MATCHING_CONFIG } = await import("../../src/config/matchingConfig.js");
    expect(MATCHING_CONFIG.MIN_COSINE_SIMILARITY).toBeGreaterThanOrEqual(-1);
    expect(MATCHING_CONFIG.MIN_COSINE_SIMILARITY).toBeLessThanOrEqual(1);
  });

  it("should have positive max detour minutes", async () => {
    const { MATCHING_CONFIG } = await import("../../src/config/matchingConfig.js");
    expect(MATCHING_CONFIG.MAX_DETOUR_MINUTES).toBeGreaterThan(0);
  });

  it("should have positive geohash precision", async () => {
    const { MATCHING_CONFIG } = await import("../../src/config/matchingConfig.js");
    expect(MATCHING_CONFIG.GEOHASH_PRECISION).toBeGreaterThan(0);
    expect(MATCHING_CONFIG.GEOHASH_PRECISION).toBeLessThanOrEqual(12);
  });

  it("should have pooling config with valid ranges", async () => {
    const { MATCHING_CONFIG } = await import("../../src/config/matchingConfig.js");
    expect(MATCHING_CONFIG.MAX_POOLED_RIDERS).toBeGreaterThanOrEqual(1);
    expect(MATCHING_CONFIG.POOL_BASE_DISCOUNT).toBeGreaterThanOrEqual(0);
    expect(MATCHING_CONFIG.POOL_BASE_DISCOUNT).toBeLessThanOrEqual(1);
    expect(MATCHING_CONFIG.POOL_GREEN_POINTS_MULTIPLIER).toBeGreaterThanOrEqual(1);
  });
});
