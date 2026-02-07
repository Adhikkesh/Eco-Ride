/**
 * DriverAgent.ts
 *
 * A state machine for simulating driver behavior in the Eco-Ride platform.
 * The agent "possesses" real drivers who go online via the Driver App
 * and simulates realistic movement patterns.
 *
 * States:
 * - IDLE: Roaming around looking for passengers (25-30 km/h)
 * - PICKUP: Heading to pickup location (40-50 km/h)
 * - TRIP: Transporting passenger to drop location (40-50 km/h)
 * - WAITING: At pickup location, waiting for passenger to board
 */

import polylineCodec from "@googlemaps/polyline-codec";
import * as turf from "@turf/turf";
import axios from "axios";
import { db, rtdb } from "../config/firebase.js";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

export type DriverMode = "IDLE" | "PICKUP" | "TRIP" | "WAITING";

export interface Coordinate {
  lat: number;
  lng: number;
}

export interface RideAssignment {
  rideId: string;
  riderId: string;
  pickup: Coordinate;
  drop: Coordinate;
}

export interface DriverData {
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY";
  vehicleType: string;
  lastUpdated: number;
}

interface RoutePoint extends Coordinate {
  distanceFromStart: number; // in meters
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

// Roaming radius for IDLE mode (km) - drivers roam within this radius of their current position
const ROAMING_RADIUS_KM = 1.5;

// Speed configurations (km/h)
const SPEED_CONFIG = {
  IDLE: { max: 30, min: 25 }, // Cruising speed
  PICKUP: { max: 50, min: 40 }, // Rush to pickup
  TRIP: { max: 50, min: 40 }, // Normal trip speed
};

// Distance threshold for arrival (meters)
const ARRIVAL_THRESHOLD_M = 20;

// Minimum movement to trigger RTDB update (meters)
const MIN_UPDATE_DISTANCE_M = 10;

// Waiting time at pickup (ms)
const PICKUP_WAIT_TIME_MS = 5000;

// Google Maps API
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVER AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

export class DriverAgent {
  public readonly driverId: string;

  private mode: DriverMode = "IDLE";
  private currentPosition: Coordinate;
  private heading: number = 0;
  private isRunning: boolean = false;

  // Route state
  private routePoints: RoutePoint[] = [];
  private routeTotalDistance: number = 0;
  private distanceTraveled: number = 0;

  // Current assignment
  private currentAssignment: RideAssignment | null = null;

  // Last position written to DB (for throttling)
  private lastWrittenPosition: Coordinate | null = null;

  // Speed (meters per second)
  private currentSpeed: number = 0;

  // Waiting state
  private waitStartTime: number | null = null;

  constructor(
    driverId: string,
    initialPosition: Coordinate,
    _vehicleType: string = "CAR", // Stored for future vehicle-specific behavior
  ) {
    this.driverId = driverId;
    this.currentPosition = { ...initialPosition };
    this.heading = Math.random() * 360;

    console.log(
      `  🤖 Agent created for ${driverId} at (${initialPosition.lat.toFixed(4)}, ${initialPosition.lng.toFixed(4)})`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Start the agent - begins IDLE mode
   */
  async start(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;
    this.mode = "IDLE";

    console.log(`  ▶️  Agent ${this.driverId} started in IDLE mode`);

    // Start roaming
    await this.startIdleMode();
  }

  /**
   * Stop the agent - cleanup
   */
  stop(): void {
    this.isRunning = false;
    this.routePoints = [];
    this.currentAssignment = null;

    console.log(`  ⏹️  Agent ${this.driverId} stopped`);
  }

  /**
   * Handle ride assignment - triggers PICKUP mode
   */
  async handleRideAssignment(assignment: RideAssignment): Promise<void> {
    if (!this.isRunning) return;

    console.log(`  🎯 ${this.driverId} received ride ${assignment.rideId}`);
    console.log(
      `     Pickup: (${assignment.pickup.lat.toFixed(4)}, ${assignment.pickup.lng.toFixed(4)})`,
    );
    console.log(
      `     Drop: (${assignment.drop.lat.toFixed(4)}, ${assignment.drop.lng.toFixed(4)})`,
    );

    this.currentAssignment = assignment;
    await this.startPickupMode();
  }

  /**
   * Called every tick (1 second) - moves the agent
   */
  async tick(deltaTimeMs: number): Promise<void> {
    if (!this.isRunning) return;

    switch (this.mode) {
      case "IDLE":
        await this.tickIdle(deltaTimeMs);
        break;
      case "PICKUP":
        await this.tickPickup(deltaTimeMs);
        break;
      case "WAITING":
        await this.tickWaiting();
        break;
      case "TRIP":
        await this.tickTrip(deltaTimeMs);
        break;
    }
  }

  /**
   * Sync position from external source (e.g., RTDB update)
   */
  syncPosition(position: Coordinate): void {
    this.currentPosition = { ...position };
  }

  /**
   * Get current state for debugging
   */
  getState(): { mode: DriverMode; position: Coordinate; heading: number } {
    return {
      heading: this.heading,
      mode: this.mode,
      position: { ...this.currentPosition },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MODE HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Start IDLE mode - pick random destination and roam
   */
  private async startIdleMode(): Promise<void> {
    this.mode = "IDLE";
    this.currentAssignment = null;

    // Update RTDB status to AVAILABLE
    await this.updateRTDB("AVAILABLE");

    // Pick random destination within roaming radius
    const destination = this.getRandomPointInRadius(this.currentPosition, ROAMING_RADIUS_KM);

    // Fetch route
    await this.fetchRoute(this.currentPosition, destination);

    // Set cruising speed
    this.setSpeedForMode("IDLE");

    console.log(
      `  🚗 ${this.driverId} roaming to (${destination.lat.toFixed(4)}, ${destination.lng.toFixed(4)})`,
    );
  }

  /**
   * Start PICKUP mode - head to pickup location
   */
  private async startPickupMode(): Promise<void> {
    if (!this.currentAssignment) return;

    this.mode = "PICKUP";

    // Update RTDB status to BUSY
    await this.updateRTDB("BUSY");

    // Fetch route to pickup
    await this.fetchRoute(this.currentPosition, this.currentAssignment.pickup);

    // Set faster speed
    this.setSpeedForMode("PICKUP");

    console.log(`  🏃 ${this.driverId} heading to pickup`);
  }

  /**
   * Start WAITING mode - wait for passenger boarding
   */
  private async startWaitingMode(): Promise<void> {
    this.mode = "WAITING";
    this.waitStartTime = Date.now();

    console.log(`  ⏳ ${this.driverId} waiting for passenger...`);
  }

  /**
   * Start TRIP mode - transport passenger to drop
   */
  private async startTripMode(): Promise<void> {
    if (!this.currentAssignment) return;

    this.mode = "TRIP";

    // Update Firestore ride status to STARTED
    await this.updateRideStatus("STARTED");

    // Fetch route to drop location
    await this.fetchRoute(this.currentPosition, this.currentAssignment.drop);

    // Set normal trip speed
    this.setSpeedForMode("TRIP");

    console.log(`  🚀 ${this.driverId} trip started to drop location`);
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TICK HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Tick for IDLE mode
   */
  private async tickIdle(deltaTimeMs: number): Promise<void> {
    const moved = await this.moveAlongRoute(deltaTimeMs);

    // If reached destination, pick new random point relative to current position
    if (!moved || this.isRouteComplete()) {
      const destination = this.getRandomPointInRadius(
        this.currentPosition, // Roam around current position, not fixed city center
        ROAMING_RADIUS_KM,
      );
      await this.fetchRoute(this.currentPosition, destination);
    }

    // Update RTDB (throttled)
    await this.maybeUpdateRTDB();
  }

  /**
   * Tick for PICKUP mode
   */
  private async tickPickup(deltaTimeMs: number): Promise<void> {
    if (!this.currentAssignment) {
      await this.startIdleMode();
      return;
    }

    await this.moveAlongRoute(deltaTimeMs);

    // Check if arrived at pickup
    const distanceToPickup = this.distanceTo(this.currentAssignment.pickup);

    if (distanceToPickup <= ARRIVAL_THRESHOLD_M) {
      console.log(`  📍 ${this.driverId} arrived at pickup!`);
      await this.startWaitingMode();
      return;
    }

    // If route complete but not arrived (edge case), regenerate route
    if (this.isRouteComplete()) {
      await this.fetchRoute(this.currentPosition, this.currentAssignment.pickup);
    }

    // Update RTDB (throttled)
    await this.maybeUpdateRTDB();
  }

  /**
   * Tick for WAITING mode
   */
  private async tickWaiting(): Promise<void> {
    if (!this.waitStartTime) {
      this.waitStartTime = Date.now();
    }

    const waitDuration = Date.now() - this.waitStartTime;

    if (waitDuration >= PICKUP_WAIT_TIME_MS) {
      console.log(`  ✅ ${this.driverId} passenger boarded!`);
      this.waitStartTime = null;
      await this.startTripMode();
    }
  }

  /**
   * Tick for TRIP mode
   */
  private async tickTrip(deltaTimeMs: number): Promise<void> {
    if (!this.currentAssignment) {
      await this.startIdleMode();
      return;
    }

    await this.moveAlongRoute(deltaTimeMs);

    // Check if arrived at drop
    const distanceToDrop = this.distanceTo(this.currentAssignment.drop);

    if (distanceToDrop <= ARRIVAL_THRESHOLD_M) {
      console.log(`  🏁 ${this.driverId} arrived at drop location!`);
      await this.completeTrip();
      return;
    }

    // If route complete but not arrived (edge case), regenerate route
    if (this.isRouteComplete()) {
      await this.fetchRoute(this.currentPosition, this.currentAssignment.drop);
    }

    // Update RTDB (throttled)
    await this.maybeUpdateRTDB();
  }

  /**
   * Complete the trip - update Firestore and clean up RTDB
   */
  private async completeTrip(): Promise<void> {
    if (!this.currentAssignment) return;

    const rideId = this.currentAssignment.rideId;
    const riderId = this.currentAssignment.riderId;

    console.log(`  🧹 ${this.driverId} cleaning up ride ${rideId}...`);

    // 1. Update Firestore ride status to COMPLETED with completedAt timestamp
    await this.updateRideStatus("COMPLETED");

    // 2. Clean up RTDB - remove all ride-related data
    await this.cleanupRTDB(rideId, riderId);

    console.log(`  ✨ ${this.driverId} completed ride ${rideId}`);

    // 3. Return to IDLE mode (this will set status back to AVAILABLE)
    await this.startIdleMode();
  }

  /**
   * Clean up all RTDB data after ride completion
   */
  private async cleanupRTDB(rideId: string, _riderId: string): Promise<void> {
    try {
      // Remove ride assignment for this driver
      await rtdb.ref(`rides-assigned/${this.driverId}`).remove();
      console.log(`    ✓ Removed /rides-assigned/${this.driverId}`);

      // Remove ride status from /rides/{rideId}
      await rtdb.ref(`rides/${rideId}`).remove();
      console.log(`    ✓ Removed /rides/${rideId}`);

      // Note: /drivers-online/{driverId} is NOT removed - driver stays online
      // but status will be updated to AVAILABLE when startIdleMode() is called
    } catch (error) {
      console.error(`  ❌ RTDB cleanup failed for ride ${rideId}:`, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MOVEMENT & ROUTING
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Fetch route from Google Maps Directions API
   */
  private async fetchRoute(origin: Coordinate, destination: Coordinate): Promise<void> {
    try {
      if (!GOOGLE_MAPS_API_KEY) {
        console.warn(`  ⚠️  No Google Maps API key, using straight line for ${this.driverId}`);
        this.useStraightLineRoute(origin, destination);
        return;
      }

      const response = await axios.get("https://maps.googleapis.com/maps/api/directions/json", {
        params: {
          destination: `${destination.lat},${destination.lng}`,
          key: GOOGLE_MAPS_API_KEY,
          mode: "driving",
          origin: `${origin.lat},${origin.lng}`,
        },
        timeout: 5000,
      });

      if (response.data.status !== "OK" || !response.data.routes?.[0]?.overview_polyline?.points) {
        console.warn(`  ⚠️  Google Maps failed for ${this.driverId}, using fallback`);
        this.useStraightLineRoute(origin, destination);
        return;
      }

      // Decode polyline
      const encodedPolyline = response.data.routes[0].overview_polyline.points;
      const decodedPath = polylineCodec.decode(encodedPolyline);

      // Convert to RoutePoints with cumulative distance
      this.routePoints = [];
      let cumulativeDistance = 0;

      for (let i = 0; i < decodedPath.length; i++) {
        const [lat, lng] = decodedPath[i];

        if (i > 0) {
          const prevPoint = this.routePoints[i - 1];
          const segmentDistance = this.haversineDistance(
            { lat: prevPoint.lat, lng: prevPoint.lng },
            { lat, lng },
          );
          cumulativeDistance += segmentDistance;
        }

        this.routePoints.push({
          distanceFromStart: cumulativeDistance,
          lat,
          lng,
        });
      }

      this.routeTotalDistance = cumulativeDistance;
      this.distanceTraveled = 0;
    } catch (error) {
      console.warn(
        `  ⚠️  Route fetch error for ${this.driverId}:`,
        error instanceof Error ? error.message : error,
      );
      this.useStraightLineRoute(origin, destination);
    }
  }

  /**
   * Fallback: Create a straight line route with interpolated points
   */
  private useStraightLineRoute(origin: Coordinate, destination: Coordinate): void {
    const totalDistance = this.haversineDistance(origin, destination);
    const numPoints = Math.max(10, Math.ceil(totalDistance / 50)); // Point every ~50m

    this.routePoints = [];

    for (let i = 0; i <= numPoints; i++) {
      const fraction = i / numPoints;
      const lat = origin.lat + (destination.lat - origin.lat) * fraction;
      const lng = origin.lng + (destination.lng - origin.lng) * fraction;

      this.routePoints.push({
        distanceFromStart: totalDistance * fraction,
        lat,
        lng,
      });
    }

    this.routeTotalDistance = totalDistance;
    this.distanceTraveled = 0;
  }

  /**
   * Move along the current route using turf.along for smooth interpolation
   */
  private async moveAlongRoute(deltaTimeMs: number): Promise<boolean> {
    if (this.routePoints.length < 2) return false;

    // Calculate distance to move this tick
    const deltaTimeSeconds = deltaTimeMs / 1000;
    const moveDistance = this.currentSpeed * deltaTimeSeconds;

    this.distanceTraveled += moveDistance;

    // Clamp to route length
    if (this.distanceTraveled >= this.routeTotalDistance) {
      this.distanceTraveled = this.routeTotalDistance;

      // Snap to final position
      const lastPoint = this.routePoints[this.routePoints.length - 1];
      this.currentPosition = { lat: lastPoint.lat, lng: lastPoint.lng };

      return false; // Route complete
    }

    // Create LineString from route points
    const lineCoords = this.routePoints.map((p) => [p.lng, p.lat]);
    const line = turf.lineString(lineCoords);

    // Get point along the line at current distance
    const pointAlong = turf.along(line, this.distanceTraveled / 1000, { units: "kilometers" });
    const [newLng, newLat] = pointAlong.geometry.coordinates;

    // Calculate heading based on movement direction
    const oldPos = turf.point([this.currentPosition.lng, this.currentPosition.lat]);
    const newPos = turf.point([newLng, newLat]);
    this.heading = (turf.bearing(oldPos, newPos) + 360) % 360;

    // Update position
    this.currentPosition = { lat: newLat, lng: newLng };

    return true;
  }

  /**
   * Check if route is complete
   */
  private isRouteComplete(): boolean {
    return this.distanceTraveled >= this.routeTotalDistance;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DATABASE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Update RTDB with current position (with throttling)
   */
  private async maybeUpdateRTDB(): Promise<void> {
    if (this.lastWrittenPosition) {
      const distanceMoved = this.haversineDistance(this.lastWrittenPosition, this.currentPosition);

      if (distanceMoved < MIN_UPDATE_DISTANCE_M) {
        return; // Skip update - haven't moved enough
      }
    }

    await this.updateRTDB(this.mode === "IDLE" ? "AVAILABLE" : "BUSY");
    this.lastWrittenPosition = { ...this.currentPosition };
  }

  /**
   * Force update RTDB with current position
   */
  private async updateRTDB(status: "AVAILABLE" | "BUSY"): Promise<void> {
    try {
      await rtdb.ref(`drivers-online/${this.driverId}`).update({
        heading: this.heading,
        lastUpdated: Date.now(),
        lat: this.currentPosition.lat,
        lng: this.currentPosition.lng,
        status,
      });
    } catch (error) {
      console.error(`  ❌ RTDB update failed for ${this.driverId}:`, error);
    }
  }

  /**
   * Update ride status in Firestore (Rides table)
   * Schema fields: status, startedAt, completedAt
   */
  private async updateRideStatus(status: "STARTED" | "COMPLETED"): Promise<void> {
    if (!this.currentAssignment) return;

    try {
      const updateData: Record<string, unknown> = {
        status,
      };

      if (status === "STARTED") {
        updateData.startedAt = new Date();
      }

      if (status === "COMPLETED") {
        updateData.completedAt = new Date();
      }

      await db.collection("Rides").doc(this.currentAssignment.rideId).update(updateData);

      console.log(`  📝 Ride ${this.currentAssignment.rideId} status: ${status}`);
    } catch (error) {
      console.error(`  ❌ Firestore update failed:`, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Set speed based on current mode (with randomization for organic feel)
   */
  private setSpeedForMode(mode: "IDLE" | "PICKUP" | "TRIP"): void {
    const config = SPEED_CONFIG[mode];
    const speedKmh = config.min + Math.random() * (config.max - config.min);
    this.currentSpeed = (speedKmh * 1000) / 3600; // Convert to m/s
  }

  /**
   * Get random point within radius of center
   */
  private getRandomPointInRadius(center: Coordinate, radiusKm: number): Coordinate {
    const centerPoint = turf.point([center.lng, center.lat]);
    const distance = Math.random() * radiusKm;
    const bearing = Math.random() * 360;
    const dest = turf.destination(centerPoint, distance, bearing, { units: "kilometers" });
    const [lng, lat] = dest.geometry.coordinates;
    return { lat, lng };
  }

  /**
   * Calculate distance to a point in meters
   */
  private distanceTo(target: Coordinate): number {
    return this.haversineDistance(this.currentPosition, target);
  }

  /**
   * Haversine distance in meters
   */
  private haversineDistance(from: Coordinate, to: Coordinate): number {
    const fromPoint = turf.point([from.lng, from.lat]);
    const toPoint = turf.point([to.lng, to.lat]);
    return turf.distance(fromPoint, toPoint, { units: "meters" });
  }
}
