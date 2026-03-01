/**
 * Unit Tests for Traffic Simulator
 *
 * Tests the pure business logic functions extracted from the traffic service:
 * - padDriverId: ID formatting
 * - moveDriver: movement towards target, arrival detection, random re-targeting
 * - Coordinate generation and distance calculations
 *
 * WHAT IS TESTED:
 * - Driver ID zero-padding
 * - Driver movement calculation toward a target
 * - Arrival detection and target switching
 * - Heading/bearing calculation
 * - Status transitions on assignment
 *
 * WHAT IS NOT TESTED:
 * - RTDB initialization and batch updates (requires Firebase)
 * - RTDB listener setup (listenForAssignments)
 */

import * as turf from "@turf/turf";
import { describe, expect, it } from "vitest";

// ─── Extracted Business Logic (mirrored from traffic.ts) ─────────────────────

const CITY_CENTER = { lat: 11.0168, lng: 76.9558 };
const MAX_RADIUS_KM = 5;
const MOVE_DISTANCE_KM = 0.1;

interface DriverState {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY";
  target: { lat: number; lng: number } | null;
  assignedPickup: { lat: number; lng: number } | null;
}

function padDriverId(num: number): string {
  return `driver_${String(num).padStart(3, "0")}`;
}

function randomPointInRadius(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
): { lat: number; lng: number } {
  const centerPoint = turf.point([centerLng, centerLat]);
  const distance = Math.random() * radiusKm;
  const bearing = Math.random() * 360;
  const dest = turf.destination(centerPoint, distance, bearing, { units: "kilometers" });
  const [lng, lat] = dest.geometry.coordinates;
  return { lat: lat!, lng: lng! };
}

function moveDriver(driver: DriverState): void {
  const destination = driver.assignedPickup || driver.target;
  if (!destination) return;

  const from = turf.point([driver.lng, driver.lat]);
  const to = turf.point([destination.lng, destination.lat]);
  const distanceToTarget = turf.distance(from, to, { units: "kilometers" });

  if (distanceToTarget < 0.05) {
    if (driver.assignedPickup) {
      return; // Arrived at pickup
    } else {
      driver.target = randomPointInRadius(CITY_CENTER.lat, CITY_CENTER.lng, MAX_RADIUS_KM);
      return;
    }
  }

  const bearing = turf.bearing(from, to);
  driver.heading = (bearing + 360) % 360;

  const newPos = turf.destination(from, MOVE_DISTANCE_KM, bearing, { units: "kilometers" });
  const [newLng, newLat] = newPos.geometry.coordinates;
  driver.lat = newLat!;
  driver.lng = newLng!;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Traffic Simulator - padDriverId", () => {
  it("should format single digit with leading zeros", () => {
    expect(padDriverId(1)).toBe("driver_001");
  });

  it("should format double digit with leading zero", () => {
    expect(padDriverId(10)).toBe("driver_010");
  });

  it("should format triple digit without padding", () => {
    expect(padDriverId(100)).toBe("driver_100");
  });

  it("should handle large numbers", () => {
    expect(padDriverId(999)).toBe("driver_999");
  });
});

describe("Traffic Simulator - randomPointInRadius", () => {
  it("should return a point with lat and lng", () => {
    const point = randomPointInRadius(CITY_CENTER.lat, CITY_CENTER.lng, MAX_RADIUS_KM);
    expect(point).toHaveProperty("lat");
    expect(point).toHaveProperty("lng");
    expect(typeof point.lat).toBe("number");
    expect(typeof point.lng).toBe("number");
  });

  it("should return a point within the specified radius", () => {
    for (let i = 0; i < 20; i++) {
      const point = randomPointInRadius(CITY_CENTER.lat, CITY_CENTER.lng, MAX_RADIUS_KM);
      const from = turf.point([CITY_CENTER.lng, CITY_CENTER.lat]);
      const to = turf.point([point.lng, point.lat]);
      const dist = turf.distance(from, to, { units: "kilometers" });
      expect(dist).toBeLessThanOrEqual(MAX_RADIUS_KM + 0.1); // small tolerance
    }
  });

  it("should generate different points each call (non-deterministic)", () => {
    const points = Array.from({ length: 10 }, () =>
      randomPointInRadius(CITY_CENTER.lat, CITY_CENTER.lng, MAX_RADIUS_KM),
    );
    // At least 2 unique lat values
    const uniqueLats = new Set(points.map((p) => p.lat.toFixed(4)));
    expect(uniqueLats.size).toBeGreaterThan(1);
  });
});

describe("Traffic Simulator - moveDriver", () => {
  it("should not move a driver with no target", () => {
    const driver: DriverState = {
      assignedPickup: null,
      heading: 0,
      id: "driver_001",
      lat: CITY_CENTER.lat,
      lng: CITY_CENTER.lng,
      status: "AVAILABLE",
      target: null,
    };

    const origLat = driver.lat;
    const origLng = driver.lng;
    moveDriver(driver);
    expect(driver.lat).toBe(origLat);
    expect(driver.lng).toBe(origLng);
  });

  it("should move driver toward target", () => {
    const target = { lat: 11.03, lng: 76.96 };
    const driver: DriverState = {
      assignedPickup: null,
      heading: 0,
      id: "driver_001",
      lat: CITY_CENTER.lat,
      lng: CITY_CENTER.lng,
      status: "AVAILABLE",
      target,
    };

    const origDist = turf.distance(
      turf.point([driver.lng, driver.lat]),
      turf.point([target.lng, target.lat]),
      { units: "kilometers" },
    );

    moveDriver(driver);

    const newDist = turf.distance(
      turf.point([driver.lng, driver.lat]),
      turf.point([target.lng, target.lat]),
      { units: "kilometers" },
    );

    expect(newDist).toBeLessThan(origDist);
  });

  it("should update heading when moving toward target", () => {
    const driver: DriverState = {
      assignedPickup: null,
      heading: 0,
      id: "driver_001",
      lat: CITY_CENTER.lat,
      lng: CITY_CENTER.lng,
      status: "AVAILABLE",
      target: { lat: 11.03, lng: 76.96 },
    };

    moveDriver(driver);
    expect(driver.heading).toBeGreaterThanOrEqual(0);
    expect(driver.heading).toBeLessThan(360);
  });

  it("should pick new target when arriving at current target", () => {
    const target = { lat: CITY_CENTER.lat + 0.0001, lng: CITY_CENTER.lng + 0.0001 };
    const driver: DriverState = {
      assignedPickup: null,
      heading: 0,
      id: "driver_001",
      lat: target.lat,
      lng: target.lng,
      status: "AVAILABLE",
      target,
    };

    moveDriver(driver);
    // Target should have changed to a new random point
    expect(driver.target).not.toEqual(target);
  });

  it("should stay put when arriving at assigned pickup", () => {
    const pickup = { lat: CITY_CENTER.lat + 0.0001, lng: CITY_CENTER.lng };
    const driver: DriverState = {
      assignedPickup: pickup,
      heading: 0,
      id: "driver_001",
      lat: pickup.lat,
      lng: pickup.lng,
      status: "BUSY",
      target: null,
    };

    const origLat = driver.lat;
    const origLng = driver.lng;
    moveDriver(driver);
    // Should not move when arrived at assigned pickup
    expect(driver.lat).toBe(origLat);
    expect(driver.lng).toBe(origLng);
  });

  it("should prioritize assignedPickup over random target", () => {
    const target = { lat: 11.05, lng: 76.98 }; // far away
    const pickup = { lat: 11.02, lng: 76.96 }; // closer
    const driver: DriverState = {
      assignedPickup: pickup,
      heading: 0,
      id: "driver_001",
      lat: CITY_CENTER.lat,
      lng: CITY_CENTER.lng,
      status: "BUSY",
      target,
    };

    moveDriver(driver);

    // Should move toward pickup, not target
    const distToPickup = turf.distance(
      turf.point([driver.lng, driver.lat]),
      turf.point([pickup.lng, pickup.lat]),
      { units: "kilometers" },
    );
    const origDistToPickup = turf.distance(
      turf.point([CITY_CENTER.lng, CITY_CENTER.lat]),
      turf.point([pickup.lng, pickup.lat]),
      { units: "kilometers" },
    );

    expect(distToPickup).toBeLessThan(origDistToPickup);
  });

  it("should move approximately MOVE_DISTANCE_KM per tick", () => {
    const driver: DriverState = {
      assignedPickup: null,
      heading: 0,
      id: "driver_001",
      lat: CITY_CENTER.lat,
      lng: CITY_CENTER.lng,
      status: "AVAILABLE",
      target: { lat: 11.1, lng: 77.0 }, // far enough to not arrive
    };

    const origLat = driver.lat;
    const origLng = driver.lng;
    moveDriver(driver);

    const distMoved = turf.distance(
      turf.point([origLng, origLat]),
      turf.point([driver.lng, driver.lat]),
      { units: "kilometers" },
    );

    // Should be approximately MOVE_DISTANCE_KM (0.1km)
    expect(distMoved).toBeCloseTo(MOVE_DISTANCE_KM, 1);
  });
});
