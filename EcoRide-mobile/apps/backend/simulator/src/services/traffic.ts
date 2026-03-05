import * as turf from "@turf/turf";
import { rtdb } from "../config/firebase.js";

const DRIVER_COUNT = 20;
const UPDATE_INTERVAL_MS = 3000;
const MOVE_DISTANCE_KM = 0.1; // ~100 meters

// Coimbatore city center
const CITY_CENTER = {
  lat: 11.0168,
  lng: 76.9558,
};
const MAX_RADIUS_KM = 5;

interface DriverState {
  id: string;
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY";
  target: { lat: number; lng: number } | null;
  assignedPickup: { lat: number; lng: number } | null;
}

const drivers: Map<string, DriverState> = new Map();

function padDriverId(num: number): string {
  return `driver_${String(num).padStart(3, "0")}`;
}

/**
 * Generate a random point within the specified radius of the city center.
 * This prevents "drifting" by always picking targets relative to the city center.
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
 * Initialize all 20 drivers with random positions within 5km of city center
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
 * Move a driver towards their target by ~100m
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
 * Start the traffic simulation loop - updates every 3 seconds
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
 * Listen for ride assignments and reroute drivers to pickup locations
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
