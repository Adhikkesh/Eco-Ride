/**
 * Pre-Trip Matching Engine
 *
 * Implements a 4-phase driver matching algorithm:
 * Phase 1: Spatial Indexing (Geohash)
 * Phase 2: Vector Alignment (Cosine Similarity)
 * Phase 3: Detour Feasibility
 * Phase 4: Global Optimization (Weighted Cost Function)
 */

import * as geofire from "geofire-common";
import { MATCHING_CONFIG } from "../config/matchingConfig.js";

// ============================================================================
// Types
// ============================================================================

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface RoutePoint {
  lat: number;
  lng: number;
  type: "PICKUP" | "DROP";
  riderId: string;
  order?: number; // Sequence order
}

export interface DriverLocation {
  lat: number;
  lng: number;
  heading: number; // 0-360 degrees, direction driver is facing/moving
  status: "AVAILABLE" | "BUSY" | "RESERVED" | "ON_TRIP";
  lastUpdated: number;
  vehicleType?: string;
  geohash?: string;
  destination?: Coordinates; // For pooled rides, driver's current destination
  currentPassengers?: number;
  maxPassengers?: number;
  pooledRides?: string[]; // Array of rideIds currently being served
}

export interface DriverCandidate {
  driverId: string;
  location: DriverLocation;
  distance: number; // km from pickup
  cosineSimilarity?: number;
  detourMinutes?: number;
  cost?: number;
  isPooled?: boolean; // True if driver is already ON_TRIP
}

export interface RideRequest {
  origin: Coordinates;
  destination: Coordinates;
}

export interface MatchResult {
  driver: DriverCandidate | null;
  phase: number; // Which phase found the match (or failed)
  candidatesPerPhase: number[]; // Count at each phase
  message: string;
}

// ============================================================================
// Route Optimization (TSP-Lite)
// ============================================================================

/**
 * Optimize the sequence of stops (pickups/drops) using a Greedy TSP approach.
 * Constraints:
 * 1. Start at Driver Location.
 * 2. Pickup for Rider X must occur before Drop for Rider X.
 * 3. Minimize total travel distance.
 */
export function optimizeRoute(
  startLocation: Coordinates,
  pendingWaypoints: RoutePoint[],
): RoutePoint[] {
  const optimized: RoutePoint[] = [];
  const remaining = [...pendingWaypoints];
  let currentLocation = startLocation;

  // Track which riders have been picked up
  const _pickedUpRiders = new Set<string>();

  // If a waypoint is a DROP, check if its corresponding PICKUP has been visited
  // However, for riders already in the car, we assume they are "picked up" effectively.
  // The input `pendingWaypoints` should only contain:
  // - PICKUPS that haven't happened yet
  // - DROPS for everyone (both in-car and pending-pickup)

  // NOTE: The caller must ensure that for any DROP in "remaining" where the rider is NOT yet picked up,
  // the corresponding PICKUP is also in "remaining".

  while (remaining.length > 0) {
    let bestIdx = -1;
    let minDistance = Infinity;

    for (let i = 0; i < remaining.length; i++) {
      const wp = remaining[i];
      if (!wp) continue;

      // Constraint check: Can we visit this waypoint?
      if (wp.type === "DROP") {
        // Find if there is a pending pickup for this rider in the remaining list
        const pendingPickupIndex = remaining.findIndex(
          (p) => p && p.riderId === wp.riderId && p.type === "PICKUP",
        );

        // If pickup IS in remaining list, we cannot drop yet
        if (pendingPickupIndex !== -1) {
          continue;
        }
      }

      // Calculate distance
      const dist = geofire.distanceBetween(
        [currentLocation.lat, currentLocation.lng],
        [wp.lat, wp.lng],
      );

      if (dist < minDistance) {
        minDistance = dist;
        bestIdx = i;
      }
    }

    if (bestIdx !== -1) {
      const nextStop = remaining[bestIdx];
      if (nextStop) {
        // Add to optimized route
        optimized.push({ ...nextStop, order: optimized.length + 1 });

        // Update state
        currentLocation = { lat: nextStop.lat, lng: nextStop.lng };
        remaining.splice(bestIdx, 1);
      }
    } else {
      // Should not happen if data is valid, but break to prevent infinite loop
      console.error(
        "Optimization stuck: remaining points cannot be visited due to constraints",
        remaining,
      );
      // Append remaining in arbitrary order as fallback
      remaining.forEach((wp) => {
        if (wp) optimized.push({ ...wp, order: optimized.length + 1 });
      });
      break;
    }
  }

  return optimized;
}

// ============================================================================
// Phase 1: Spatial Indexing (Geohash)
// ============================================================================

/**
 * Generate geohash for coordinates at specified precision
 */
export function generateGeohash(
  coords: Coordinates,
  precision: number = MATCHING_CONFIG.GEOHASH_PRECISION,
): string {
  return geofire.geohashForLocation([coords.lat, coords.lng], precision);
}

/**
 * Get neighboring geohash cells (8 neighbors + center)
 */
export function getNeighborGeohashes(geohash: string): string[] {
  const _neighbors = geofire.geohashQueryBounds(
    [
      parseFloat(geofire.geohashForLocation([0, 0], 1)), // Placeholder
      parseFloat(geofire.geohashForLocation([0, 0], 1)),
    ],
    MATCHING_CONFIG.MAX_PICKUP_RADIUS_KM * 1000,
  );

  // Alternative: Generate neighbors manually
  const _chars = "0123456789bcdefghjkmnpqrstuvwxyz";
  const neighbors9: string[] = [geohash];

  // For precision 6, we'll filter by actual distance instead
  return neighbors9;
}

/**
 * Phase 1: Filter drivers within geohash radius
 * Returns drivers within MAX_PICKUP_RADIUS_KM of pickup location
 * Now includes ON_TRIP drivers with available capacity for pooling
 * Pooling requires: pickup within tolerance AND destination within tolerance
 */
export function phase1SpatialFilter(
  drivers: Map<string, DriverLocation>,
  pickupLocation: Coordinates,
  rideDestination: Coordinates | null = null, // New: destination for pooling checks
  radiusKm: number = MATCHING_CONFIG.MAX_PICKUP_RADIUS_KM,
): DriverCandidate[] {
  const candidates: DriverCandidate[] = [];
  const pickupGeohash = generateGeohash(pickupLocation);
  const poolingEnabled = MATCHING_CONFIG.ENABLE_POOLING;

  console.log(
    `[Phase 1] Pickup geohash: ${pickupGeohash}, radius: ${radiusKm}km, pooling: ${poolingEnabled}`,
  );

  for (const [driverId, location] of drivers) {
    // Check driver availability
    const isAvailable = location.status === "AVAILABLE";
    const isOnTrip = location.status === "ON_TRIP" || location.status === "BUSY";

    // Validate coordinates
    const lat = Number(location.lat);
    const lng = Number(location.lng);

    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      console.warn(`[Phase 1] Driver ${driverId} has invalid coordinates:`, location);
      continue;
    }

    // Skip if not available and not eligible for pooling
    if (!isAvailable && !isOnTrip) {
      continue;
    }

    // For ON_TRIP drivers, check capacity, pooling settings, and destination proximity
    if (isOnTrip) {
      if (!poolingEnabled) {
        continue; // Pooling disabled
      }

      const currentPassengers = location.currentPassengers ?? 1;
      const maxPassengers = location.maxPassengers ?? MATCHING_CONFIG.DEFAULT_MAX_PASSENGERS;

      if (currentPassengers >= MATCHING_CONFIG.MAX_POOLED_RIDERS) {
        console.log(`[Phase 1] Driver ${driverId}: at max pooled riders (${currentPassengers})`);
        continue; // At pooling limit
      }

      if (currentPassengers >= maxPassengers) {
        console.log(
          `[Phase 1] Driver ${driverId}: at vehicle capacity (${currentPassengers}/${maxPassengers})`,
        );
        continue; // Vehicle full
      }

      // Check destination proximity for pooling
      if (rideDestination && location.destination) {
        const destLat = Number(location.destination.lat);
        const destLng = Number(location.destination.lng);

        if (Number.isNaN(destLat) || Number.isNaN(destLng)) {
          console.warn(
            `[Phase 1] Driver ${driverId} has invalid destination coordinates:`,
            location.destination,
          );
          continue;
        }

        const destDistance = geofire.distanceBetween(
          [rideDestination.lat, rideDestination.lng],
          [destLat, destLng],
        );

        if (destDistance > MATCHING_CONFIG.POOLING_DROP_TOLERANCE_KM) {
          console.log(
            `[Phase 1] Driver ${driverId}: destination too far (${destDistance.toFixed(2)}km > ${MATCHING_CONFIG.POOLING_DROP_TOLERANCE_KM}km)`,
          );
          continue; // Destinations not close enough for pooling
        }
        console.log(
          `[Phase 1] Driver ${driverId}: destination nearby (${destDistance.toFixed(2)}km)`,
        );
      }
    }

    // Calculate distance from driver to pickup
    const distance = geofire.distanceBetween([lat, lng], [pickupLocation.lat, pickupLocation.lng]);

    // For pooled rides, use pickup tolerance instead of standard radius
    const effectiveRadius = isOnTrip ? MATCHING_CONFIG.POOLING_PICKUP_TOLERANCE_KM : radiusKm;

    // Check if within radius
    if (distance <= effectiveRadius) {
      candidates.push({
        distance,
        driverId,
        isPooled: isOnTrip,
        location,
      });
      console.log(
        `[Phase 1] Driver ${driverId}: ${isOnTrip ? "POOLED" : "AVAILABLE"}, distance: ${distance.toFixed(2)}km`,
      );
    }
  }

  console.log(`[Phase 1] ${candidates.length} candidates within radius`);
  return candidates;
}

// ============================================================================
// Phase 2: Vector Alignment (Cosine Similarity)
// ============================================================================

/**
 * Calculate unit vector from point A to point B
 */
function calculateDirectionVector(from: Coordinates, to: Coordinates): [number, number] {
  const dx = to.lng - from.lng;
  const dy = to.lat - from.lat;
  const magnitude = Math.sqrt(dx * dx + dy * dy);

  if (magnitude === 0) {
    return [0, 0];
  }

  return [dx / magnitude, dy / magnitude];
}

/**
 * Convert heading angle (degrees) to unit vector
 * Heading: 0 = North, 90 = East, 180 = South, 270 = West
 */
function headingToVector(headingDegrees: number): [number, number] {
  const radians = (headingDegrees * Math.PI) / 180;
  // Convert compass heading to cartesian (x=East, y=North)
  return [Math.sin(radians), Math.cos(radians)];
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(v1: [number, number], v2: [number, number]): number {
  const dotProduct = v1[0] * v2[0] + v1[1] * v2[1];
  const mag1 = Math.sqrt(v1[0] * v1[0] + v1[1] * v1[1]);
  const mag2 = Math.sqrt(v2[0] * v2[0] + v2[1] * v2[1]);

  if (mag1 === 0 || mag2 === 0) {
    return 0;
  }

  return dotProduct / (mag1 * mag2);
}

/**
 * Phase 2: Filter drivers by heading alignment with trip direction
 * Only keeps drivers heading in a similar direction to the passenger's trip
 * FALLBACK: Drivers without heading data (heading=0 or undefined) are included with reduced priority
 */
export function phase2VectorAlignment(
  candidates: DriverCandidate[],
  rideRequest: RideRequest,
  minSimilarity: number = MATCHING_CONFIG.MIN_COSINE_SIMILARITY,
): DriverCandidate[] {
  // Calculate passenger trip vector (origin -> destination)
  const tripVector = calculateDirectionVector(rideRequest.origin, rideRequest.destination);

  console.log(`[Phase 2] Trip vector: [${tripVector[0].toFixed(3)}, ${tripVector[1].toFixed(3)}]`);

  const filtered: DriverCandidate[] = [];

  for (const candidate of candidates) {
    const heading = candidate.location.heading;

    // FALLBACK: If driver has no heading data (0 or undefined), include them anyway
    // This ensures AVAILABLE drivers aren't filtered out just because they're stationary
    if (heading === 0 || heading === undefined || heading === null) {
      console.log(
        `[Phase 2] Driver ${candidate.driverId}: no heading data, including with fallback`,
      );
      candidate.cosineSimilarity = 0.5; // Neutral score (will be ranked lower than aligned drivers)
      filtered.push(candidate);
      continue;
    }

    // Convert driver's heading to vector
    const driverVector = headingToVector(heading);

    // Calculate cosine similarity
    const similarity = cosineSimilarity(driverVector, tripVector);
    candidate.cosineSimilarity = similarity;

    console.log(
      `[Phase 2] Driver ${candidate.driverId}: heading=${heading}°, similarity=${similarity.toFixed(3)}`,
    );

    if (similarity >= minSimilarity) {
      filtered.push(candidate);
    }
  }

  console.log(
    `[Phase 2] ${filtered.length}/${candidates.length} candidates passed alignment check`,
  );
  if (filtered.length === 0) {
    console.log("[Phase 2] No aligned drivers, falling back to all candidates");
    return candidates;
  }
  return filtered;
}

// ============================================================================
// Phase 3: Detour Feasibility
// ============================================================================

/**
 * Calculate estimated travel time in minutes
 */
function calculateTravelTimeMinutes(
  distanceKm: number,
  speedKmh: number = MATCHING_CONFIG.AVERAGE_SPEED_KMH,
): number {
  return (distanceKm / speedKmh) * 60;
}

/**
 * Phase 3: Filter drivers by detour feasibility
 * Calculates marginal detour cost and filters out excessive detours
 */
export function phase3DetourFeasibility(
  candidates: DriverCandidate[],
  rideRequest: RideRequest,
  maxDetourMinutes: number = MATCHING_CONFIG.MAX_DETOUR_MINUTES,
): DriverCandidate[] {
  // Direct distance from origin to destination
  const directDistance = geofire.distanceBetween(
    [rideRequest.origin.lat, rideRequest.origin.lng],
    [rideRequest.destination.lat, rideRequest.destination.lng],
  );
  const directTime = calculateTravelTimeMinutes(directDistance);

  console.log(`[Phase 3] Direct trip: ${directDistance.toFixed(2)}km, ${directTime.toFixed(1)}min`);

  const filtered: DriverCandidate[] = [];

  for (const candidate of candidates) {
    // Pooled route: driver -> pickup -> destination
    // Distance = driver-to-pickup + pickup-to-destination
    const pickupDistance = candidate.distance; // Already calculated
    const pooledDistance = pickupDistance + directDistance;
    const _pooledTime = calculateTravelTimeMinutes(pooledDistance);

    // Marginal detour = pooled time - direct time
    // Since driver needs to reach pickup, the detour is the pickup distance
    const detourMinutes = calculateTravelTimeMinutes(pickupDistance);
    candidate.detourMinutes = detourMinutes;

    console.log(
      `[Phase 3] Driver ${candidate.driverId}: pickup=${pickupDistance.toFixed(2)}km, ` +
        `detour=${detourMinutes.toFixed(1)}min`,
    );

    if (detourMinutes <= maxDetourMinutes) {
      // Also check if driver has existing passengers with delay constraints
      if (candidate.location.destination && candidate.location.currentPassengers) {
        // Calculate if new pickup violates existing passenger's max delay
        // For now, we assume no existing passengers in non-pooled scenario
        const existingTripDelay = calculateTravelTimeMinutes(pickupDistance);
        if (existingTripDelay > maxDetourMinutes) {
          console.log(`[Phase 3] Driver ${candidate.driverId}: violates existing passenger delay`);
          continue;
        }
      }
      filtered.push(candidate);
    }
  }

  console.log(
    `[Phase 3] ${filtered.length}/${candidates.length} candidates with detour <= ${maxDetourMinutes}min`,
  );
  return filtered;
}

// ============================================================================
// Phase 4: Global Optimization
// ============================================================================

/**
 * Calculate fuel consumption estimate for a distance
 */
function calculateFuelConsumption(distanceKm: number, vehicleType: string = "PETROL"): number {
  const consumptionConfig = MATCHING_CONFIG.FUEL_CONSUMPTION;
  // Use index signature access with fallback
  const consumptionPer100km = consumptionConfig[vehicleType] ?? consumptionConfig.PETROL ?? 8.0;
  return (distanceKm / 100) * consumptionPer100km;
}

/**
 * Normalize a value to 0-1 range given min and max
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

/**
 * Phase 4: Select optimal driver using weighted cost function
 * C = w1(PickupTime) + w2(Detour) + w3(FuelConsumption)
 */
export function phase4GlobalOptimization(
  candidates: DriverCandidate[],
  _rideRequest: RideRequest,
): DriverCandidate | null {
  if (candidates.length === 0) {
    return null;
  }

  if (candidates.length === 1) {
    // Ensure candidates[0] exists before access (though length check guarantees it)
    const singleCandidate = candidates[0];
    if (singleCandidate) {
      singleCandidate.cost = 0;
      return singleCandidate;
    }
    return null;
  }

  const { WEIGHT_PICKUP_TIME, WEIGHT_DETOUR, WEIGHT_FUEL, EV_BONUS, HYBRID_BONUS } =
    MATCHING_CONFIG;

  // Calculate raw values for all candidates
  const pickupTimes: number[] = [];
  const detours: number[] = [];
  const fuels: number[] = [];

  for (const candidate of candidates) {
    const pickupTime = calculateTravelTimeMinutes(candidate.distance);
    const detour = candidate.detourMinutes ?? 0;
    const fuel = calculateFuelConsumption(
      candidate.distance,
      candidate.location.vehicleType ?? "PETROL",
    );

    pickupTimes.push(pickupTime);
    detours.push(detour);
    fuels.push(fuel);
  }

  // Find min/max for normalization
  const minPickup = Math.min(...pickupTimes);
  const maxPickup = Math.max(...pickupTimes);
  const minDetour = Math.min(...detours);
  const maxDetour = Math.max(...detours);
  const minFuel = Math.min(...fuels);
  const maxFuel = Math.max(...fuels);

  console.log(`[Phase 4] Calculating costs for ${candidates.length} candidates`);

  // Calculate weighted cost for each candidate
  let bestCandidate: DriverCandidate | null = null;
  let bestCost = Infinity;

  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate) continue;

    // Normalize each factor to 0-1
    const normPickup = normalize(pickupTimes[i] ?? 0, minPickup, maxPickup);
    const normDetour = normalize(detours[i] ?? 0, minDetour, maxDetour);
    const normFuel = normalize(fuels[i] ?? 0, minFuel, maxFuel);

    // Calculate base weighted cost
    let cost =
      WEIGHT_PICKUP_TIME * normPickup + WEIGHT_DETOUR * normDetour + WEIGHT_FUEL * normFuel;

    // Apply EV/Hybrid bonus — subtract bonus from cost so low-emission vehicles rank higher
    const vType = (candidate.location.vehicleType ?? "PETROL").toUpperCase();
    let ecoBonus = 0;
    if (vType === "ELECTRIC" || vType === "EV") {
      ecoBonus = EV_BONUS;
    } else if (vType === "HYBRID") {
      ecoBonus = HYBRID_BONUS;
    }
    cost = Math.max(0, cost - ecoBonus);

    candidate.cost = cost;

    console.log(
      `[Phase 4] Driver ${candidate.driverId}: ` +
        `type=${vType}, pickup=${(pickupTimes[i] ?? 0).toFixed(1)}min, detour=${(detours[i] ?? 0).toFixed(1)}min, ` +
        `fuel=${(fuels[i] ?? 0).toFixed(2)}L, ecoBonus=${ecoBonus}, cost=${cost.toFixed(4)}`,
    );

    if (cost < bestCost) {
      bestCost = cost;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate) {
    const candidate = bestCandidate as DriverCandidate;
    console.log(
      `[Phase 4] Selected driver: ${candidate.driverId} with cost ${bestCost.toFixed(4)}`,
    );
    return candidate;
  }

  return bestCandidate;
}

// ============================================================================
// Main Matching Pipeline
// ============================================================================

/**
 * Execute the full 4-phase matching pipeline
 */
export function matchDriver(
  drivers: Map<string, DriverLocation>,
  rideRequest: RideRequest,
  initialRadius: number = MATCHING_CONFIG.MAX_PICKUP_RADIUS_KM,
): MatchResult {
  const candidatesPerPhase: number[] = [];
  let currentRadius = initialRadius;

  while (currentRadius <= MATCHING_CONFIG.MAX_SEARCH_RADIUS_KM) {
    console.log(`\n=== MATCHING PIPELINE (radius: ${currentRadius}km) ===`);

    // Phase 1: Spatial Indexing (with destination for pooling checks)
    const phase1Candidates = phase1SpatialFilter(
      drivers,
      rideRequest.origin,
      rideRequest.destination,
      currentRadius,
    );
    candidatesPerPhase[0] = phase1Candidates.length;

    if (phase1Candidates.length === 0) {
      console.log(`[Pipeline] No drivers within ${currentRadius}km, expanding...`);
      currentRadius += MATCHING_CONFIG.EXPANDED_RADIUS_INCREMENT_KM;
      continue;
    }

    // Phase 2: Vector Alignment
    const phase2Candidates = phase2VectorAlignment(phase1Candidates, rideRequest);
    candidatesPerPhase[1] = phase2Candidates.length;

    if (phase2Candidates.length === 0) {
      // No drivers heading in the right direction, expand radius
      console.log(`[Pipeline] No aligned drivers, expanding radius...`);
      currentRadius += MATCHING_CONFIG.EXPANDED_RADIUS_INCREMENT_KM;
      continue;
    }

    // Phase 3: Detour Feasibility
    const phase3Candidates = phase3DetourFeasibility(phase2Candidates, rideRequest);
    candidatesPerPhase[2] = phase3Candidates.length;

    if (phase3Candidates.length === 0) {
      // All drivers would require too much detour, expand radius
      console.log(`[Pipeline] No feasible detours, expanding radius...`);
      currentRadius += MATCHING_CONFIG.EXPANDED_RADIUS_INCREMENT_KM;
      continue;
    }

    // Phase 4: Global Optimization
    const selectedDriver = phase4GlobalOptimization(phase3Candidates, rideRequest);
    candidatesPerPhase[3] = selectedDriver ? 1 : 0;

    if (selectedDriver) {
      return {
        candidatesPerPhase,
        driver: selectedDriver,
        message: `Driver ${selectedDriver.driverId} selected with cost ${selectedDriver.cost?.toFixed(4)}`,
        phase: 4,
      };
    }

    // This shouldn't happen if phase 3 had candidates
    currentRadius += MATCHING_CONFIG.EXPANDED_RADIUS_INCREMENT_KM;
  }

  // No match found after expanding to max radius
  return {
    candidatesPerPhase,
    driver: null,
    message: `No available drivers found within ${MATCHING_CONFIG.MAX_SEARCH_RADIUS_KM}km`,
    phase: 0,
  };
}
