/**
 * @fileoverview Driver Agent State Machine
 * @description A finite-state machine that simulates a single driver's
 *              behaviour on the Eco-Ride platform. The agent "possesses" a
 *              real driver who went online through the Driver App and mimics
 *              realistic movement patterns using Google Maps routes.
 *
 * State transitions:
 * ```
 * IDLE ──(assignment)──▸ PICKUP ──(arrival)──▸ WAITING
 *   ▴                                            │
 *   │                                       (OTP verified)
 *   │                                            ▾
 *   └──(payment)── AWAITING_PAYMENT ◂── TRIP ◂───┘
 * ```
 * @module simulator/services/DriverAgent
 */

import polylineCodec from "@googlemaps/polyline-codec";
import * as turf from "@turf/turf";
import axios from "axios";
import { db, rtdb } from "../config/firebase.js";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Possible operational states of a {@link DriverAgent}.
 *
 * | Mode               | Behaviour                                 |
 * |--------------------|-------------------------------------------|
 * | `IDLE`             | Roaming at 25–30 km/h looking for fares    |
 * | `PICKUP`           | Driving to pickup at 40–50 km/h            |
 * | `WAITING`          | At pickup, waiting for OTP verification    |
 * | `TRIP`             | Transporting passenger at 40–50 km/h       |
 * | `AWAITING_PAYMENT` | At drop-off, waiting for payment           |
 */
export type DriverMode = "IDLE" | "PICKUP" | "TRIP" | "WAITING" | "AWAITING_PAYMENT";

/** A geographic coordinate pair. */
export interface Coordinate {
  /** Latitude in decimal degrees. */
  lat: number;
  /** Longitude in decimal degrees. */
  lng: number;
}

/** Incoming ride assignment data received from the RTDB listener. */
export interface RideAssignment {
  /** Firestore ride document ID. */
  rideId: string;
  /** UID of the rider who requested the ride. */
  riderId: string;
  /** Pickup location. */
  pickup: Coordinate;
  /** Drop-off location. */
  drop: Coordinate;
}

/** Shape of the driver record stored in the RTDB `drivers-online` node. */
export interface DriverData {
  lat: number;
  lng: number;
  /** Compass heading in degrees (0–360). */
  heading: number;
  status: "AVAILABLE" | "BUSY";
  vehicleType: string;
  /** Unix epoch timestamp of the last position update. */
  lastUpdated: number;
}

/** A point along a fetched route, with cumulative distance from origin. */
interface RoutePoint extends Coordinate {
  /** Cumulative distance from the route origin, in metres. */
  distanceFromStart: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/** Roaming radius in km — IDLE drivers wander within this distance of their position. */
const ROAMING_RADIUS_KM = 1.5;

/** Speed ranges (km/h) per driver mode. A random value is selected within the range. */
const SPEED_CONFIG = {
  IDLE: { max: 30, min: 25 },
  PICKUP: { max: 50, min: 40 },
  TRIP: { max: 50, min: 40 },
};

/** How close (metres) the agent must be to a destination to count as "arrived". */
const ARRIVAL_THRESHOLD_M = 20;

/** Minimum movement (metres) before an RTDB position update is written. */
const MIN_UPDATE_DISTANCE_M = 10;

/** @deprecated Superseded by the OTP-based waiting flow. */
const _PICKUP_WAIT_TIME_MS = 5000;

/** Google Maps Directions API key — falls back to straight-line routes when absent. */
const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "";

// ═══════════════════════════════════════════════════════════════════════════════
// DRIVER AGENT CLASS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulates a single driver's behaviour on the Eco-Ride platform.
 *
 * The agent is a finite-state machine driven by a global tick loop
 * (see {@link SimulationEngine}). On each tick it advances the driver
 * along a Google Maps route and writes updated positions to RTDB.
 *
 * @example
 * const agent = new DriverAgent("drv_001", { lat: 11.02, lng: 76.96 });
 * await agent.start(); // enters IDLE mode
 * await agent.handleRideAssignment(assignment); // transitions to PICKUP
 */
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

  // Payment waiting state
  private paymentListenerUnsubscribe: (() => void) | null = null;

  // OTP verification waiting state
  private otpListenerUnsubscribe: (() => void) | null = null;

  // Queued pooled ride assignments to pick up after current trip completes
  private queuedAssignments: RideAssignment[] = [];

  // Multi-passenger tracking for pooled rides
  private activePassengers: Map<string, RideAssignment> = new Map(); // rideId -> assignment for riders currently in vehicle

  // Tracks whether the current TRIP destination is a PICKUP or DROP waypoint
  private currentWaypointType: "PICKUP" | "DROP" = "DROP";

  /**
   * Creates a new DriverAgent.
   *
   * @param driverId - Firebase UID of the driver to control.
   * @param initialPosition - Starting geographic coordinates.
   * @param _vehicleType - Vehicle category (reserved for future use).
   */
  constructor(driverId: string, initialPosition: Coordinate, _vehicleType: string = "CAR") {
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
   * Starts the agent, entering IDLE mode and beginning random roaming.
   * No-ops if the agent is already running.
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
   * Stops the agent and releases all RTDB listeners.
   * The agent will no longer process ticks after this call.
   */
  stop(): void {
    this.isRunning = false;
    this.routePoints = [];
    this.currentAssignment = null;
    this.queuedAssignments = [];
    this.activePassengers.clear();

    // Cleanup OTP listener if active
    if (this.otpListenerUnsubscribe) {
      this.otpListenerUnsubscribe();
      this.otpListenerUnsubscribe = null;
    }

    // Cleanup payment listener if active
    if (this.paymentListenerUnsubscribe) {
      this.paymentListenerUnsubscribe();
      this.paymentListenerUnsubscribe = null;
    }

    console.log(`  ⏹️  Agent ${this.driverId} stopped`);
  }

  /**
   * Processes a new ride assignment, transitioning the agent to PICKUP mode.
   * If the agent is currently on a TRIP or WAITING (pooled scenario), it queues
   * the new assignment but does NOT interrupt the current trip.
   *
   * @param assignment - The ride details including pickup and drop coordinates.
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

    // TSP-LIKE ROUTING: If currently on a TRIP, add to queue and let
    // routeToNearestWaypoint decide the optimal next stop — could be the
    // current drop-off (closer) or the new rider's pickup (closer).
    if (this.mode === "TRIP") {
      console.log(
        `  🔄 ${this.driverId} received pooled ride ${assignment.rideId} mid-trip (${this.activePassengers.size} pax aboard) — re-computing optimal route`,
      );
      this.queuedAssignments.push(assignment);
      await this.routeToNearestWaypoint();
      return;
    }

    // If waiting for OTP or payment, queue — can't leave mid-action.
    // Also queue if already heading to a pickup.
    if (this.mode === "WAITING" || this.mode === "AWAITING_PAYMENT" || this.mode === "PICKUP") {
      console.log(
        `  📌 ${this.driverId} is in ${this.mode} mode — queuing pooled ride ${assignment.rideId}`,
      );
      if (!this.queuedAssignments) {
        this.queuedAssignments = [];
      }
      this.queuedAssignments.push(assignment);
      return;
    }

    this.currentAssignment = assignment;
    await this.startPickupMode();
  }

  /**
   * Advances the agent by one simulation tick.
   *
   * Called by the {@link SimulationEngine} tick loop. Delegates to the
   * appropriate mode-specific handler.
   *
   * @param deltaTimeMs - Elapsed time since the last tick, in milliseconds.
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
      case "AWAITING_PAYMENT":
        // Do nothing - just wait at drop location for payment confirmation
        break;
    }
  }

  /**
   * Overwrites the agent's position with an externally-supplied coordinate.
   *
   * @param position - New position to adopt.
   */
  syncPosition(position: Coordinate): void {
    this.currentPosition = { ...position };
  }

  /**
   * Returns a snapshot of the agent's current state.
   *
   * @returns An object with the current mode, position, heading, and passenger count.
   */
  getState(): { mode: DriverMode; position: Coordinate; heading: number; passengerCount: number } {
    return {
      heading: this.heading,
      mode: this.mode,
      passengerCount: this.activePassengers.size,
      position: { ...this.currentPosition },
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // MODE HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Enters IDLE mode: sets driver to AVAILABLE, picks a random nearby
   * destination, and fetches a route to begin roaming.
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
   * Enters PICKUP mode: marks driver BUSY and routes toward the
   * rider's pickup location at an elevated speed.
   * Also writes the full assignment data to rides-assigned so the
   * driver web UI can display the ride card.
   */
  private async startPickupMode(): Promise<void> {
    if (!this.currentAssignment) return;

    this.mode = "PICKUP";

    // Update RTDB status to BUSY
    await this.updateRTDB("BUSY");

    // Only write a fresh rides-assigned node when no passengers are aboard.
    // During mid-trip pooled pickups the backend's acceptRide already updated
    // rides-assigned with the full riders array — overwriting would lose that.
    if (this.activePassengers.size === 0) {
      try {
        await rtdb.ref(`rides-assigned/${this.driverId}`).set({
          drop: this.currentAssignment.drop,
          pickup: this.currentAssignment.pickup,
          rideId: this.currentAssignment.rideId,
          riderId: this.currentAssignment.riderId,
          status: "MATCHED",
          timestamp: Date.now(),
        });
        console.log(
          `  📝 ${this.driverId} wrote rides-assigned for ride ${this.currentAssignment.rideId}`,
        );
      } catch (err) {
        console.error(`  ❌ Failed to write rides-assigned for pickup:`, err);
      }
    } else {
      // Mid-trip pooled pickup — the backend's acceptRide already wrote the
      // correct riders[] array and set top-level fields. We only update
      // routing-relevant fields without clobbering the status, since the
      // backend already set it correctly for the pooled scenario.
      try {
        const snap = await rtdb.ref(`rides-assigned/${this.driverId}`).once("value");
        const existingData = snap.val();

        // Only update top-level routing fields if backend hasn't already
        // done so (e.g., if the rideId doesn't match the new assignment)
        if (existingData?.rideId !== this.currentAssignment.rideId) {
          await rtdb.ref(`rides-assigned/${this.driverId}`).update({
            drop: this.currentAssignment.drop,
            pickup: this.currentAssignment.pickup,
            rideId: this.currentAssignment.rideId,
            riderId: this.currentAssignment.riderId,
            timestamp: Date.now(),
          });
        }
        console.log(
          `  📝 ${this.driverId} mid-trip pickup: updated routing to ride ${this.currentAssignment.rideId}`,
        );
      } catch (err) {
        console.error(`  ❌ Failed to update rides-assigned for mid-trip pickup:`, err);
      }
    }

    // Also ensure rides/{rideId} exists in RTDB for the rider UI
    try {
      await rtdb.ref(`rides/${this.currentAssignment.rideId}`).update({
        driverId: this.driverId,
        status: "MATCHED",
      });
    } catch (err) {
      console.error(`  ❌ Failed to update rides/${this.currentAssignment.rideId}:`, err);
    }

    // Fetch route to pickup
    await this.fetchRoute(this.currentPosition, this.currentAssignment.pickup);

    // Set faster speed
    this.setSpeedForMode("PICKUP");

    console.log(`  🏃 ${this.driverId} heading to pickup`);
  }

  /**
   * Enters WAITING mode at the pickup location.
   *
   * Sets up an RTDB listener on `rides-assigned/{driverId}` for OTP
   * verification. When the ride status changes to `IN_PROGRESS` (OTP
   * verified), automatically transitions to TRIP mode.
   */
  private async startWaitingMode(): Promise<void> {
    if (!this.currentAssignment) return;

    this.mode = "WAITING";
    this.waitStartTime = Date.now();
    const waitingForRideId = this.currentAssignment.rideId;

    console.log(`  ⏳ ${this.driverId} waiting for OTP verification (ride ${waitingForRideId})...`);

    // Update rides-assigned status to ARRIVED — pool-aware
    try {
      const snap = await rtdb.ref(`rides-assigned/${this.driverId}`).once("value");
      const existingData = snap.val();

      // If there's a riders[] array, update only this rider's status
      if (existingData?.riders && Array.isArray(existingData.riders)) {
        const updatedRiders = existingData.riders.map(
          (r: { rideId: string; [key: string]: unknown }) =>
            r.rideId === waitingForRideId ? { ...r, status: "ARRIVED" } : r,
        );
        await rtdb.ref(`rides-assigned/${this.driverId}`).update({
          arrivedAt: Date.now(),
          riders: updatedRiders,
          status: "ARRIVED",
        });
      } else {
        // Solo ride — safe to set top-level status
        await rtdb.ref(`rides-assigned/${this.driverId}`).update({
          arrivedAt: Date.now(),
          status: "ARRIVED",
        });
      }
      console.log(`  📝 ${this.driverId} RTDB rides-assigned status → ARRIVED`);
    } catch (err) {
      console.error(`  ❌ Failed to update rides-assigned status to ARRIVED:`, err);
    }

    // Listen for ride status change (OTP verified = IN_PROGRESS)
    // Pool-aware: check the specific ride's status in riders[] if present,
    // or check the rides/{rideId} node directly as a more reliable signal.
    const rideStatusRef = rtdb.ref(`rides/${waitingForRideId}`);

    const callback = async (snapshot: import("firebase-admin/database").DataSnapshot) => {
      const data = snapshot.val();

      // When OTP is verified, backend sets rides/{rideId}.status to IN_PROGRESS
      if (data?.status === "IN_PROGRESS") {
        console.log(
          `  ✅ ${this.driverId} OTP verified for ride ${waitingForRideId}, starting trip!`,
        );

        // Cleanup listener
        if (this.otpListenerUnsubscribe) {
          this.otpListenerUnsubscribe();
          this.otpListenerUnsubscribe = null;
        }

        this.waitStartTime = null;
        await this.startTripMode();
      }
    };

    rideStatusRef.on("value", callback);

    // Store unsubscribe function
    this.otpListenerUnsubscribe = () => {
      rideStatusRef.off("value", callback);
    };
  }

  /**
   * Enters TRIP mode: updates ride status to STARTED and routes
   * toward the drop-off location. Tracks this rider as an active passenger.
   */
  private async startTripMode(): Promise<void> {
    if (!this.currentAssignment) return;

    this.mode = "TRIP";

    // Track this rider as an active passenger in the vehicle
    this.activePassengers.set(this.currentAssignment.rideId, { ...this.currentAssignment });

    // Update passenger count in RTDB for driver dashboard
    try {
      await rtdb.ref(`drivers-online/${this.driverId}`).update({
        currentPassengers: this.activePassengers.size,
      });
    } catch (err) {
      console.error(`  ❌ Failed to update passenger count:`, err);
    }

    // Update RTDB rides-assigned status to IN_PROGRESS — pool-aware
    try {
      const snap = await rtdb.ref(`rides-assigned/${this.driverId}`).once("value");
      const existingData = snap.val();

      // If there's a riders[] array, update this specific rider's status
      if (existingData?.riders && Array.isArray(existingData.riders)) {
        const updatedRiders = existingData.riders.map(
          (r: { rideId: string; [key: string]: unknown }) =>
            r.rideId === this.currentAssignment!.rideId ? { ...r, status: "IN_PROGRESS" } : r,
        );
        await rtdb.ref(`rides-assigned/${this.driverId}`).update({
          riders: updatedRiders,
          status: "IN_PROGRESS",
        });
      } else {
        // Solo ride — safe to set top-level status
        await rtdb.ref(`rides-assigned/${this.driverId}`).update({
          status: "IN_PROGRESS",
        });
      }

      // Also update the rides/{rideId} node so the rider UI detects the trip started
      await rtdb.ref(`rides/${this.currentAssignment.rideId}`).update({
        status: "IN_PROGRESS",
      });
      console.log(
        `  📝 ${this.driverId} RTDB rides-assigned status → IN_PROGRESS (ride ${this.currentAssignment.rideId})`,
      );
    } catch (err) {
      console.error(`  ❌ Failed to update rides-assigned status to IN_PROGRESS:`, err);
    }

    // Update Firestore ride status to STARTED
    await this.updateRideStatus("STARTED");

    // Route to the nearest waypoint (drop-off OR queued pickup) using
    // nearest-neighbor heuristic — TSP-like interleaved routing.
    await this.routeToNearestWaypoint();

    console.log(
      `  🚀 ${this.driverId} trip started (${this.activePassengers.size} pax, ${this.queuedAssignments.length} queued) — heading to nearest waypoint`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TICK HANDLERS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Per-tick handler for IDLE mode — moves along the roaming route
   * and picks a new destination when the current one is reached.
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
   * Per-tick handler for PICKUP mode — moves toward the pickup
   * and transitions to WAITING on arrival.
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

    // If route complete but not arrived, check if we're already very close
    // to avoid repeatedly re-fetching routes which causes oscillation
    if (this.isRouteComplete()) {
      // If we're within 500m, just snap to pickup directly instead of re-routing
      if (distanceToPickup <= 500) {
        // Move directly toward pickup without re-fetching route
        this.currentPosition = { ...this.currentAssignment.pickup };
        console.log(`  📍 ${this.driverId} snapped to pickup location (close enough)`);
        await this.startWaitingMode();
        return;
      }
      // Only re-fetch route if we're still far from pickup
      await this.fetchRoute(this.currentPosition, this.currentAssignment.pickup);
    }

    // Update RTDB (throttled)
    await this.maybeUpdateRTDB();
  }

  /**
   * Per-tick handler for WAITING mode.
   *
   * Acts as a fallback timeout (30 s) in case OTP verification is never
   * received. The RTDB listener set in {@link startWaitingMode} handles
   * the normal happy-path transition.
   */
  private async tickWaiting(): Promise<void> {
    // Fallback: if waiting for more than 30 seconds without OTP verification,
    // auto-start the trip to keep simulation running
    if (this.waitStartTime) {
      const waitDuration = Date.now() - this.waitStartTime;
      const FALLBACK_WAIT_TIME_MS = 30000; // 30 seconds

      if (waitDuration >= FALLBACK_WAIT_TIME_MS) {
        console.log(`  ⏰ ${this.driverId} OTP timeout - auto-starting trip after 30s`);

        // Cleanup listener if active
        if (this.otpListenerUnsubscribe) {
          this.otpListenerUnsubscribe();
          this.otpListenerUnsubscribe = null;
        }

        this.waitStartTime = null;
        await this.startTripMode();
      }
    }
  }

  /**
   * Per-tick handler for TRIP mode — moves toward the current waypoint
   * (which may be a PICKUP or DROP) and handles arrival appropriately.
   */
  private async tickTrip(deltaTimeMs: number): Promise<void> {
    if (!this.currentAssignment) {
      await this.startIdleMode();
      return;
    }

    await this.moveAlongRoute(deltaTimeMs);

    // Determine destination based on waypoint type
    const destination =
      this.currentWaypointType === "PICKUP"
        ? this.currentAssignment.pickup
        : this.currentAssignment.drop;

    const distanceToWaypoint = this.distanceTo(destination);

    if (distanceToWaypoint <= ARRIVAL_THRESHOLD_M) {
      if (this.currentWaypointType === "PICKUP") {
        // Arrived at a pooled pickup while other passengers are aboard
        console.log(
          `  📍 ${this.driverId} arrived at pooled pickup for ride ${this.currentAssignment.rideId}!`,
        );
        await this.startWaitingMode();
      } else {
        console.log(`  🏁 ${this.driverId} arrived at drop location!`);
        await this.completeTrip();
      }
      return;
    }

    // If route complete but not arrived, snap if close or re-fetch
    if (this.isRouteComplete()) {
      if (distanceToWaypoint <= 500) {
        this.currentPosition = { ...destination };
        if (this.currentWaypointType === "PICKUP") {
          console.log(`  📍 ${this.driverId} snapped to pooled pickup (close enough)`);
          await this.startWaitingMode();
        } else {
          console.log(`  🏁 ${this.driverId} snapped to drop (close enough)`);
          await this.completeTrip();
        }
        return;
      }
      await this.fetchRoute(this.currentPosition, destination);
    }

    // Update RTDB (throttled)
    await this.maybeUpdateRTDB();
  }

  /**
   * Completes the trip for the current rider: marks the ride as COMPLETED,
   * then checks if there are other active passengers still in the vehicle
   * or queued riders to pick up.
   *
   * - If more passengers are aboard → route to the next nearest drop.
   * - If no passengers but queued rides → pick up next rider.
   * - If nothing left → enter AWAITING_PAYMENT for the last ride.
   */
  private async completeTrip(): Promise<void> {
    if (!this.currentAssignment) return;

    const rideId = this.currentAssignment.rideId;

    // Remove this rider from active passengers
    this.activePassengers.delete(rideId);

    console.log(
      `  🏁 ${this.driverId} dropped off rider ${rideId} (${this.activePassengers.size} pax remaining)`,
    );

    // Update passenger count in RTDB
    try {
      await rtdb.ref(`drivers-online/${this.driverId}`).update({
        currentPassengers: this.activePassengers.size,
      });
    } catch (err) {
      console.error(`  ❌ Failed to update passenger count:`, err);
    }

    // 1. Update Firestore ride status to COMPLETED
    await this.updateRideStatus("COMPLETED");

    // 2. Sync to RTDB rides node
    try {
      await rtdb.ref(`rides/${rideId}`).update({ status: "COMPLETED" });
    } catch (err) {
      console.error(`  ❌ Failed to update rides/${rideId}:`, err);
    }

    // 3. Pool-aware rides-assigned cleanup
    await this.updateRidesAssignedAfterDrop(rideId);

    // ─── MORE WAYPOINTS? (passengers aboard OR queued pickups) ───────────
    if (this.activePassengers.size > 0 || this.queuedAssignments.length > 0) {
      console.log(
        `  🔄 ${this.driverId} has ${this.activePassengers.size} pax + ${this.queuedAssignments.length} queued — routing to nearest waypoint`,
      );
      await this.routeToNearestWaypoint();
      return;
    }

    // ─── LAST RIDER → Wait for payment ───────────────────────────────────
    console.log(`  💳 ${this.driverId} waiting for payment on ride ${rideId}...`);
    this.mode = "AWAITING_PAYMENT";

    const rideRef = rtdb.ref(`rides/${rideId}`);

    const callback = async (snapshot: import("firebase-admin/database").DataSnapshot) => {
      const data = snapshot.val();

      if (!data || data.status === "PAYMENT_CONFIRMED") {
        console.log(`  ✅ ${this.driverId} payment confirmed for ride ${rideId}!`);

        if (this.paymentListenerUnsubscribe) {
          this.paymentListenerUnsubscribe();
          this.paymentListenerUnsubscribe = null;
        }

        await this.cleanupRTDB(rideId, this.currentAssignment?.riderId || "");
        console.log(`  ✨ ${this.driverId} completed ride ${rideId}`);
        await this.startIdleMode();
      }
    };

    rideRef.on("value", callback);
    this.paymentListenerUnsubscribe = () => {
      rideRef.off("value", callback);
    };
  }

  /**
   * TSP-like nearest-neighbor routing: considers BOTH active passenger
   * drop-offs AND queued ride pickups, routes to whichever is closest.
   *
   * This interleaves pickups and drop-offs optimally instead of processing
   * riders sequentially.
   */
  private async routeToNearestWaypoint(): Promise<void> {
    type Waypoint = {
      type: "PICKUP" | "DROP";
      assignment: RideAssignment;
      location: Coordinate;
      distance: number;
    };

    const waypoints: Waypoint[] = [];

    // Add drop-offs for all active passengers currently in the vehicle
    for (const [, assignment] of this.activePassengers) {
      waypoints.push({
        assignment,
        distance: this.distanceTo(assignment.drop),
        location: assignment.drop,
        type: "DROP",
      });
    }

    // Add pickups for all queued assignments waiting to be collected
    for (const assignment of this.queuedAssignments) {
      waypoints.push({
        assignment,
        distance: this.distanceTo(assignment.pickup),
        location: assignment.pickup,
        type: "PICKUP",
      });
    }

    if (waypoints.length === 0) {
      // Nothing left to do — should not normally reach here
      // (completeTrip handles the AWAITING_PAYMENT / IDLE transition)
      await this.startIdleMode();
      return;
    }

    // Nearest-neighbor heuristic: pick the closest waypoint
    waypoints.sort((a, b) => a.distance - b.distance);
    const nearest = waypoints[0];

    this.currentAssignment = nearest.assignment;
    this.currentWaypointType = nearest.type;
    this.mode = "TRIP";

    if (nearest.type === "PICKUP") {
      // Remove from queued assignments since we're heading there now
      this.queuedAssignments = this.queuedAssignments.filter(
        (a) => a.rideId !== nearest.assignment.rideId,
      );
    }

    const destination =
      nearest.type === "PICKUP" ? nearest.assignment.pickup : nearest.assignment.drop;
    await this.fetchRoute(this.currentPosition, destination);
    this.setSpeedForMode("TRIP");

    console.log(
      `  🚀 ${this.driverId} routing to nearest ${nearest.type}: ride ${nearest.assignment.rideId} (${nearest.distance.toFixed(0)}m, ${this.activePassengers.size} pax, ${this.queuedAssignments.length} queued)`,
    );
  }

  /**
   * Updates the rides-assigned RTDB node after a rider is dropped off,
   * removing the completed rider from the riders array while preserving
   * remaining riders.
   */
  private async updateRidesAssignedAfterDrop(completedRideId: string): Promise<void> {
    try {
      const snap = await rtdb.ref(`rides-assigned/${this.driverId}`).once("value");
      const data = snap.val();

      if (!data?.riders || !Array.isArray(data.riders)) return;

      const remaining = data.riders.filter((r: { rideId: string }) => r.rideId !== completedRideId);

      if (remaining.length > 0) {
        const next = remaining[0];
        const waypoints = [
          ...remaining.map((r: { pickup: { lat: number; lng: number }; riderId: string }) => ({
            lat: r.pickup.lat,
            lng: r.pickup.lng,
            riderId: r.riderId,
            type: "PICKUP" as const,
          })),
          ...remaining.map((r: { drop: { lat: number; lng: number }; riderId: string }) => ({
            lat: r.drop.lat,
            lng: r.drop.lng,
            riderId: r.riderId,
            type: "DROP" as const,
          })),
        ];

        await rtdb.ref(`rides-assigned/${this.driverId}`).update({
          drop: next.drop,
          pickup: next.pickup,
          rideId: next.rideId,
          riderId: next.riderId,
          riders: remaining,
          status: "IN_PROGRESS",
          waypoints,
        });
      }
      // If no remaining riders, cleanup happens via cleanupRTDB in the
      // AWAITING_PAYMENT callback.
    } catch (err) {
      console.error(`  ❌ Failed to update rides-assigned after drop:`, err);
    }
  }

  /**
   * Removes ride-related RTDB entries after a ride is fully paid.
   * Only removes the specific ride's data — does NOT wipe the entire
   * rides-assigned node if there are queued pooled rides.
   *
   * @param rideId - Ride document ID to clean up.
   * @param _riderId - Rider UID (currently unused).
   */
  private async cleanupRTDB(rideId: string, _riderId: string): Promise<void> {
    try {
      // Remove ride status from /rides/{rideId}
      await rtdb.ref(`rides/${rideId}`).remove();
      console.log(`    ✓ Removed /rides/${rideId}`);

      // Only remove rides-assigned if there are no queued rides waiting.
      // If there are queued rides, we'll overwrite the node in startPickupMode.
      if (this.queuedAssignments.length === 0) {
        await rtdb.ref(`rides-assigned/${this.driverId}`).remove();
        console.log(`    ✓ Removed /rides-assigned/${this.driverId}`);
      } else {
        console.log(
          `    ⏭️ Skipping rides-assigned cleanup — ${this.queuedAssignments.length} queued ride(s) remaining`,
        );
      }

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
   * Fetches a driving route between two coordinates via the Google Maps
   * Directions API. Falls back to a straight-line interpolation if the
   * API key is missing or the request fails.
   *
   * @param origin - Starting coordinate.
   * @param destination - Ending coordinate.
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
        timeout: 15000,
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
   * Creates a straight-line route with evenly-spaced interpolated points
   * (one every ~50 m). Used as a fallback when the Directions API is unavailable.
   *
   * @param origin - Starting coordinate.
   * @param destination - Ending coordinate.
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
   * Advances the agent's position along the current route.
   *
   * Uses Turf.js `along()` for smooth interpolation along the polyline.
   *
   * @param deltaTimeMs - Elapsed time since the last tick, in milliseconds.
   * @returns `true` if the agent moved, `false` if the route is complete.
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
   * Returns `true` when the agent has traversed the entire loaded route.
   */
  private isRouteComplete(): boolean {
    return this.distanceTraveled >= this.routeTotalDistance;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DATABASE OPERATIONS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Writes the current position to RTDB only if the agent has moved
   * at least {@link MIN_UPDATE_DISTANCE_M} since the last write.
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
   * Unconditionally writes the agent's position and status to RTDB.
   *
   * @param status - The availability status to persist.
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
   * Updates the ride document in Firestore with a new status and
   * the corresponding timestamp (`startedAt` or `completedAt`).
   *
   * @param status - The new ride lifecycle status.
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

      await db.collection("rides").doc(this.currentAssignment.rideId).update(updateData);

      console.log(`  📝 Ride ${this.currentAssignment.rideId} status: ${status}`);
    } catch (error) {
      console.error(`  ❌ Firestore update failed:`, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // UTILITY METHODS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Sets the agent's speed to a random value within the configured
   * range for the given mode, converted from km/h to m/s.
   *
   * @param mode - The mode whose speed range should be used.
   */
  private setSpeedForMode(mode: "IDLE" | "PICKUP" | "TRIP"): void {
    const config = SPEED_CONFIG[mode];
    const speedKmh = config.min + Math.random() * (config.max - config.min);
    this.currentSpeed = (speedKmh * 1000) / 3600; // Convert to m/s
  }

  /**
   * Returns a random point within `radiusKm` of the given center.
   *
   * @param center - Center coordinate.
   * @param radiusKm - Maximum distance from center in kilometres.
   * @returns A random coordinate within the radius.
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
   * Calculates the Haversine distance from the agent's current position to a target.
   *
   * @param target - The target coordinate.
   * @returns Distance in metres.
   */
  private distanceTo(target: Coordinate): number {
    return this.haversineDistance(this.currentPosition, target);
  }

  /**
   * Computes the Haversine (great-circle) distance between two coordinates.
   *
   * @param from - Origin coordinate.
   * @param to - Destination coordinate.
   * @returns Distance in metres.
   */
  private haversineDistance(from: Coordinate, to: Coordinate): number {
    const fromPoint = turf.point([from.lng, from.lat]);
    const toPoint = turf.point([to.lng, to.lat]);
    return turf.distance(fromPoint, toPoint, { units: "meters" });
  }
}
