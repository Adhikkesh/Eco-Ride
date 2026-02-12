/**
 * @fileoverview Legacy Traffic Simulator
 * @description A simple traffic simulation that places a fixed number of
 *              drivers on the map and moves them toward random waypoints at
 *              regular intervals. Drivers redirect to assigned pickup locations
 *              when a ride is dispatched via RTDB.
 *
 *              This module predates the {@link SimulationEngine} /
 *              {@link DriverAgent} architecture and is retained as a
 *              lightweight alternative for scenarios that don't require
 *              full state-machine behavior.
 * @module simulator/services/traffic
 */

import * as turf from "@turf/turf";
import { rtdb } from "../config/firebase.js";

/** Number of simulated drivers managed by this module. */
const DRIVER_COUNT = 20;

/** Interval between position updates in milliseconds. */
const UPDATE_INTERVAL_MS = 3000;

/** Distance each driver moves per tick, in kilometres (~100 m). */
const MOVE_DISTANCE_KM = 0.1;

/** Geographic center point used to constrain driver positions (Coimbatore). */
const CITY_CENTER = {
  lat: 11.0168,
  lng: 76.9558,
};

/** Maximum roaming radius from the city center, in kilometres. */
const MAX_RADIUS_KM = 5;

/**
 * Internal state for a single simulated driver.
 *
 * @interface DriverState
 */
interface DriverState {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY";
  target: { lat: number; lng: number } | null;
  assignedPickup: { lat: number; lng: number } | null;
}

/** In-memory store of all simulated driver states, keyed by driver ID. */
const drivers: Map<string, DriverState> = new Map();

/**
 * Formats a numeric index into a zero-padded driver ID string.
 *
 * @param num - 1-based driver number.
 * @returns An ID like `driver_001`.
 */
function padDriverId(num: number): string {
  return `driver_${String(num).padStart(3, "0")}`;
}

/**
 * Generates a random geographic point within a given radius of a center.
 *
 * Uses Turf.js `destination()` with a random bearing and distance to ensure
 * points remain within the specified radius without drift.
 *
 * @param centerLat - Latitude of the center point.
 * @param centerLng - Longitude of the center point.
 * @param radiusKm - Maximum distance from center in kilometres.
 * @returns A coordinate pair `{ lat, lng }`.
 */
function randomPointInRadius(
  centerLat: number,
  centerLng: number,
  radiusKm: number,
): { lat: number; lng: number } {
  const centerPoint = turf.point([centerLng, centerLat]);
  // Random distance from 0 to radiusKm
  const distance = Math.random() * radiusKm;
  // Random bearing 0-360
  const bearing = Math.random() * 360;
  const dest = turf.destination(centerPoint, distance, bearing, { units: "kilometers" });
  const [lng, lat] = dest.geometry.coordinates;
  return { lat, lng };
}

/**
 * Initialises all simulated drivers in RTDB with random positions.
 *
 * Each driver is placed within {@link MAX_RADIUS_KM} of the city center and
 * given a random waypoint target. Corresponding entries are created under
 * `drivers-online/` in the Realtime Database.
 */
export async function initializeDriversOnRTDB(): Promise<void> {
  console.log("🚗 Initializing drivers on RTDB...");

  for (let i = 1; i <= DRIVER_COUNT; i++) {
    const driverId = padDriverId(i);
    const initialPos = randomPointInRadius(CITY_CENTER.lat, CITY_CENTER.lng, MAX_RADIUS_KM);

    const driverState: DriverState = {
      assignedPickup: null,
      heading: Math.random() * 360,
      id: driverId,
      lat: initialPos.lat,
      lng: initialPos.lng,
      status: "AVAILABLE",
      target: randomPointInRadius(CITY_CENTER.lat, CITY_CENTER.lng, MAX_RADIUS_KM),
    };

    drivers.set(driverId, driverState);

    // Push to RTDB
    await rtdb.ref(`drivers-online/${driverId}`).set({
      heading: driverState.heading,
      lastUpdated: Date.now(),
      lat: driverState.lat,
      lng: driverState.lng,
      status: driverState.status,
      vehicleType: "CAR",
    });

    console.log(
      `  ✓ ${driverId} placed at (${driverState.lat.toFixed(4)}, ${driverState.lng.toFixed(4)})`,
    );
  }

  console.log("✅ All drivers initialized on RTDB.");
}

/**
 * Advances a driver toward their current target by approximately 100 m.
 *
 * If the driver is within 50 m of their target and has no ride assignment,
 * a new random target is selected. If the driver has an assigned pickup and
 * reaches it, they stop moving.
 *
 * @param driver - Mutable driver state object to update in place.
 */
function moveDriver(driver: DriverState): void {
  const destination = driver.assignedPickup || driver.target;
  if (!destination) return;

  const from = turf.point([driver.lng, driver.lat]);
  const to = turf.point([destination.lng, destination.lat]);

  const distanceToTarget = turf.distance(from, to, { units: "kilometers" });

  // If close enough to target, pick a new random target (only if not assigned)
  if (distanceToTarget < 0.05) {
    if (driver.assignedPickup) {
      // Arrived at pickup, stay there
      console.log(`  📍 ${driver.id} arrived at pickup location`);
      return;
    } else {
      // Pick new random target within city radius
      driver.target = randomPointInRadius(CITY_CENTER.lat, CITY_CENTER.lng, MAX_RADIUS_KM);
      return;
    }
  }

  // Calculate bearing towards target
  const bearing = turf.bearing(from, to);
  driver.heading = (bearing + 360) % 360;

  // Move towards target
  const newPos = turf.destination(from, MOVE_DISTANCE_KM, bearing, { units: "kilometers" });
  const [newLng, newLat] = newPos.geometry.coordinates;

  driver.lat = newLat;
  driver.lng = newLng;
}

/**
 * Starts the traffic simulation loop.
 *
 * Moves every driver toward their target and batch-updates all positions in
 * RTDB every {@link UPDATE_INTERVAL_MS} milliseconds.
 */
export function startTrafficLoop(): void {
  console.log("🔄 Starting traffic simulation loop...");

  setInterval(async () => {
    const updates: Record<string, object> = {};

    for (const driver of drivers.values()) {
      moveDriver(driver);

      updates[`drivers-online/${driver.id}`] = {
        heading: driver.heading,
        lastUpdated: Date.now(),
        lat: driver.lat,
        lng: driver.lng,
        status: driver.status,
        vehicleType: "CAR",
      };
    }

    // Batch update all drivers
    await rtdb.ref().update(updates);
  }, UPDATE_INTERVAL_MS);
}

/**
 * Starts RTDB listeners that redirect drivers to assigned pickups.
 *
 * For each driver, subscribes to `rides-assigned/{driverId}`. When an
 * assignment appears the driver is marked `BUSY` and their target is set to
 * the pickup location. When the assignment is cleared the driver returns to
 * `AVAILABLE` status and resumes random movement.
 */
export function listenForAssignments(): void {
  console.log("👂 Listening for ride assignments...");

  for (let i = 1; i <= DRIVER_COUNT; i++) {
    const driverId = padDriverId(i);

    rtdb.ref(`rides-assigned/${driverId}`).on("value", (snapshot) => {
      const data = snapshot.val();
      const driver = drivers.get(driverId);

      if (!driver) return;

      if (data?.pickup) {
        console.log(
          `  🎯 ${driverId} assigned to pickup at (${data.pickup.lat}, ${data.pickup.lng})`,
        );
        driver.assignedPickup = { lat: data.pickup.lat, lng: data.pickup.lng };
        driver.status = "BUSY";
      } else {
        // No assignment, resume random movement
        if (driver.assignedPickup) {
          console.log(`  ✓ ${driverId} assignment cleared, resuming random movement`);
        }
        driver.assignedPickup = null;
        driver.status = "AVAILABLE";
        driver.target = randomPointInRadius(CITY_CENTER.lat, CITY_CENTER.lng, MAX_RADIUS_KM);
      }
    });
  }
}
