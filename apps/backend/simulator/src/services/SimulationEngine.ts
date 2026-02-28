/**
 * SimulationEngine.ts
 *
 * The central orchestrator for the Eco-Ride driver simulation.
 * This engine does NOT create drivers - it only "possesses" drivers
 * who manually go online via the Driver App.
 *
 * Responsibilities:
 * 1. Listen to `drivers-online` for driver presence (child_added/child_removed)
 * 2. Listen to `rides-assigned/{driverId}` for ride assignments
 * 3. Run a global tick loop to move all active agents
 */

import { rtdb } from "../config/firebase.js";
import { type Coordinate, DriverAgent, type RideAssignment } from "./DriverAgent.js";

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

// Tick interval in milliseconds
const TICK_INTERVAL_MS = 1000;

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Central coordinator for the driver simulation.
 *
 * The engine maintains a map of active {@link DriverAgent} instances and
 * drives the simulation forward with a 1-second tick loop. It is designed
 * to be started once at process boot and shut down on `SIGINT`/`SIGTERM`.
 */
export class SimulationEngine {
  private agents: Map<string, DriverAgent> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;
  private lastTickTime: number = Date.now();
  private isRunning: boolean = false;

  // Track assignment listeners per driver
  private assignmentListeners: Map<string, () => void> = new Map();
  // Track which rideIds we've already dispatched to agents (prevents re-pickup on data updates)
  private processedRideIds: Map<string, Set<string>> = new Map();

  constructor() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  🚗 Eco-Ride Reactive Driver Simulator");
    console.log("═══════════════════════════════════════════════════════════════");
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Boots the simulation engine.
   *
   * Seeds dummy drivers if needed, starts RTDB listeners for driver
   * presence, ride assignments, and checks for any existing assignments
   * before kicking off the tick loop.
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      console.log("  ⚠️  Engine already running");
      return;
    }

    this.isRunning = true;
    console.log("");
    console.log("📌 PHASE 1: Setting up listeners...");

    // Start listening for driver presence
    this.listenForDriverPresence();

    console.log("");
    console.log("📌 PHASE 2: Starting tick loop...");

    // Start the global tick loop
    this.startTickLoop();

    console.log("");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  ✅ Simulator engine running!");
    console.log("  👂 Listening for drivers to come online...");
    console.log("  🔄 Tick loop: every 1 second");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("");
  }

  /**
   * Gracefully shuts down the simulation.
   *
   * Stops all active agents, detaches RTDB listeners, and clears the
   * tick interval so the process can exit cleanly.
   */
  stop(): void {
    this.isRunning = false;

    // Stop tick loop
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    // Stop all agents
    for (const agent of this.agents.values()) {
      agent.stop();
    }
    this.agents.clear();

    // Remove all assignment listeners
    for (const unsubscribe of this.assignmentListeners.values()) {
      unsubscribe();
    }
    this.assignmentListeners.clear();

    // Detach RTDB listeners
    rtdb.ref("drivers-online").off();

    console.log("  ⏹️  Simulation engine stopped");
  }

  /**
   * Returns a diagnostic summary of all active agents.
   *
   * @returns An object containing the running status, number of active agents, and a list of driver IDs.
   */
  getStatus(): { running: boolean; activeAgents: number; agents: string[] } {
    return {
      activeAgents: this.agents.size,
      agents: Array.from(this.agents.keys()),
      running: this.isRunning,
    };
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // DRIVER PRESENCE LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Subscribes to `drivers-online/` in RTDB.
   *
   * When a driver node appears the engine spawns a new {@link DriverAgent};
   * when a node is removed the engine stops and disposes the agent.
   */
  private listenForDriverPresence(): void {
    const driversRef = rtdb.ref("drivers-online");

    // Listen for new drivers coming online
    driversRef.on("child_added", async (snapshot) => {
      const driverId = snapshot.key;
      if (!driverId) return;

      const data = snapshot.val();
      if (!data) return;

      console.log(`  👋 Driver online: ${driverId}`);

      await this.createAgent(driverId, data);
    });

    // Listen for drivers going offline
    driversRef.on("child_removed", (snapshot) => {
      const driverId = snapshot.key;
      if (!driverId) return;

      console.log(`  👋 Driver offline: ${driverId}`);

      this.removeAgent(driverId);
    });

    // Listen for driver data updates (position sync from app)
    driversRef.on("child_changed", async (snapshot) => {
      const driverId = snapshot.key;
      if (!driverId) return;

      const data = snapshot.val();
      if (!data) return;

      // If this driver was skipped at child_added (e.g. missing lat/lng),
      // try to create the agent now that data may be available.
      if (!this.agents.has(driverId)) {
        console.log(`  🔄 Retrying agent creation for ${driverId} (child_changed)`);
        await this.createAgent(driverId, data);
      }
    });

    console.log("  ✓ Listening on /drivers-online");
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Creates a new {@link DriverAgent} for a driver that just came online.
   *
   * @param driverId - Firebase UID of the driver.
   * @param driverData - Current RTDB snapshot with location and status.
   */
  private async createAgent(
    driverId: string,
    data: {
      lat: number;
      lng: number;
      heading?: number;
      vehicleType?: string;
      status?: string;
    },
  ): Promise<void> {
    // Check if agent already exists
    if (this.agents.has(driverId)) {
      console.log(`  ⚠️  Agent for ${driverId} already exists`);
      return;
    }

    // Validate required position data
    const lat = Number(data.lat);
    const lng = Number(data.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      console.log(
        `  ⚠️  Skipping ${driverId}: missing or invalid lat/lng (driver may be initializing)`,
      );
      return;
    }

    // Create initial position from RTDB data
    const initialPosition: Coordinate = {
      lat,
      lng,
    };

    // Create the agent
    const agent = new DriverAgent(driverId, initialPosition, data.vehicleType || "CAR");

    // Store the agent
    this.agents.set(driverId, agent);

    // Start the agent
    await agent.start();

    // Set up ride assignment listener for this driver
    this.listenForRideAssignment(driverId, agent);

    // Check if there's already a pending assignment
    await this.checkExistingAssignment(driverId, agent);
  }

  /**
   * Stops and removes the agent for a driver that went offline.
   * Also cleans up any associated RTDB data (e.g., pending ride assignments).
   *
   * @param driverId - Firebase UID of the driver.
   */
  private async removeAgent(driverId: string): Promise<void> {
    const agent = this.agents.get(driverId);
    if (agent) {
      agent.stop();
      this.agents.delete(driverId);
    }

    // Remove assignment listener
    const unsubscribe = this.assignmentListeners.get(driverId);
    if (unsubscribe) {
      unsubscribe();
      this.assignmentListeners.delete(driverId);
    }

    // Clear processed ride tracking for this driver
    this.processedRideIds.delete(driverId);

    // Clean up any pending ride assignment for this driver
    await this.cleanupDriverRTDB(driverId);
  }

  /**
   * Cleans up Realtime Database entries associated with a driver who has gone offline.
   * Specifically removes any pending ride assignments and related ride status.
   *
   * @param driverId - Firebase UID of the driver.
   */
  private async cleanupDriverRTDB(driverId: string): Promise<void> {
    try {
      // Check if there's a pending ride assignment
      const assignmentSnap = await rtdb.ref(`rides-assigned/${driverId}`).get();
      const assignmentData = assignmentSnap.val();

      if (assignmentData) {
        if (assignmentData.rideId) {
          // Remove the ride status from /rides/{rideId}
          await rtdb.ref(`rides/${assignmentData.rideId}`).remove();
          console.log(`  🧹 Cleaned up /rides/${assignmentData.rideId}`);
        }

        // Remove the assignment itself
        await rtdb.ref(`rides-assigned/${driverId}`).remove();
        console.log(`  🧹 Cleaned up /rides-assigned/${driverId}`);
      }
      // If no assignment data, don't log anything - nothing to clean

      // Note: /drivers-online/{driverId} is already removed by the driver app going offline
    } catch (error) {
      console.error(`  ❌ Failed to cleanup RTDB for ${driverId}:`, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // RIDE ASSIGNMENT LISTENERS
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Subscribes to `rides-assigned/{driverId}` for every active agent.
   *
   * When an assignment appears the engine forwards it to the relevant
   * agent via {@link DriverAgent.handleRideAssignment}.
   *
   * @param driverId - Firebase UID of the driver.
   * @param agent - The {@link DriverAgent} instance to which assignments will be routed.
   */
  private listenForRideAssignment(driverId: string, agent: DriverAgent): void {
    const assignmentRef = rtdb.ref(`rides-assigned/${driverId}`);

    const callback = async (snapshot: import("firebase-admin/database").DataSnapshot) => {
      const data = snapshot.val();
      if (!data) return;

      // Determine which rideIds are present in this assignment
      const rideIdsInData = new Set<string>();
      if (data.rideId) rideIdsInData.add(data.rideId);
      if (Array.isArray(data.riders)) {
        for (const r of data.riders) {
          if (r.rideId) rideIdsInData.add(r.rideId);
        }
      }

      // Get already-processed rideIds for this driver
      if (!this.processedRideIds.has(driverId)) {
        this.processedRideIds.set(driverId, new Set());
      }
      const processed = this.processedRideIds.get(driverId)!;

      // Find NEW ride(s) that we haven't dispatched yet
      const newRideIds = [...rideIdsInData].filter((id) => !processed.has(id));

      if (newRideIds.length === 0) {
        // No new rides — this is just a status update (ARRIVED, IN_PROGRESS, etc.)
        return;
      }

      // Mark all current rideIds as processed
      for (const id of rideIdsInData) {
        processed.add(id);
      }

      // For pooled rides, route to the NEWEST rider's pickup (the one just added)
      // For single rides, use top-level pickup/drop
      const newestRideId = newRideIds[newRideIds.length - 1];
      let assignmentPickup = { lat: data.pickup.lat, lng: data.pickup.lng };
      let assignmentDrop = { lat: data.drop.lat, lng: data.drop.lng };
      let assignmentRiderId = data.riderId;

      if (Array.isArray(data.riders)) {
        const newestRider = data.riders.find((r: { rideId: string }) => r.rideId === newestRideId);
        if (newestRider) {
          assignmentPickup = { lat: newestRider.pickup.lat, lng: newestRider.pickup.lng };
          assignmentDrop = { lat: newestRider.drop.lat, lng: newestRider.drop.lng };
          assignmentRiderId = newestRider.riderId;
        }
      }

      const assignment: RideAssignment = {
        drop: assignmentDrop,
        pickup: assignmentPickup,
        rideId: newestRideId,
        riderId: assignmentRiderId,
      };

      console.log(
        `  📦 New ride detected for ${driverId}: ${newestRideId} (total: ${rideIdsInData.size})`,
      );
      await agent.handleRideAssignment(assignment);
    };

    assignmentRef.on("value", callback);

    // Store unsubscribe function
    this.assignmentListeners.set(driverId, () => {
      assignmentRef.off("value", callback);
    });

    console.log(`  ✓ Listening for assignments on /rides-assigned/${driverId}`);
  }

  /**
   * Scans `rides-assigned/` for pre-existing assignments when a driver comes online.
   *
   * This handles the case where the simulation engine restarts or a driver
   * reconnects while a ride is already in progress, ensuring agents pick up
   * where they left off.
   *
   * @param driverId - Firebase UID of the driver.
   * @param agent - The {@link DriverAgent} instance to check for existing assignments.
   */
  private async checkExistingAssignment(driverId: string, agent: DriverAgent): Promise<void> {
    try {
      const snapshot = await rtdb.ref(`rides-assigned/${driverId}`).get();
      const data = snapshot.val();

      if (data?.rideId) {
        console.log(`  📋 Found existing assignment for ${driverId}: ${data.rideId}`);

        // Pre-populate processedRideIds so the onValue listener won't re-dispatch these
        if (!this.processedRideIds.has(driverId)) {
          this.processedRideIds.set(driverId, new Set());
        }
        const processed = this.processedRideIds.get(driverId)!;
        processed.add(data.rideId);
        if (Array.isArray(data.riders)) {
          for (const r of data.riders) {
            if (r.rideId) processed.add(r.rideId);
          }
        }

        const assignment: RideAssignment = {
          drop: {
            lat: data.drop.lat,
            lng: data.drop.lng,
          },
          pickup: {
            lat: data.pickup.lat,
            lng: data.pickup.lng,
          },
          rideId: data.rideId,
          riderId: data.riderId,
        };

        await agent.handleRideAssignment(assignment);
      }
    } catch (error) {
      console.error(`  ❌ Error checking existing assignment for ${driverId}:`, error);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // TICK LOOP
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Starts the global tick loop (1 Hz).
   *
   * On each tick, every active agent's {@link DriverAgent.tick} method is
   * called with the elapsed delta time. Agents that throw are logged but
   * do not halt the loop.
   */
  private startTickLoop(): void {
    this.lastTickTime = Date.now();

    this.tickInterval = setInterval(async () => {
      const now = Date.now();
      const deltaTime = now - this.lastTickTime;
      this.lastTickTime = now;

      // Tick all agents in parallel
      const tickPromises: Promise<void>[] = [];

      for (const agent of this.agents.values()) {
        tickPromises.push(agent.tick(deltaTime));
      }

      // Wait for all ticks to complete
      await Promise.allSettled(tickPromises);

      // Log status periodically (every 30 seconds)
      if (now % 30000 < TICK_INTERVAL_MS) {
        this.logStatus();
      }
    }, TICK_INTERVAL_MS);

    console.log(`  ✓ Tick loop started (${TICK_INTERVAL_MS}ms interval)`);
  }

  /**
   * Periodically logs a one-line summary of all agent states for debugging.
   * This method is called by the tick loop at a lower frequency.
   */
  private logStatus(): void {
    if (this.agents.size === 0) {
      console.log("  📊 Status: No active drivers");
      return;
    }

    console.log("");
    console.log("  ┌─────────────────────────────────────────────────────────────┐");
    console.log(`  │ 📊 Active Agents: ${this.agents.size.toString().padEnd(42)}│`);
    console.log("  ├─────────────────────────────────────────────────────────────┤");

    for (const [driverId, agent] of this.agents) {
      const state = agent.getState();
      const modeIcon = {
        AWAITING_PAYMENT: "💳",
        IDLE: "🚗",
        PICKUP: "🏃",
        TRIP: "🚀",
        WAITING: "⏳",
      }[state.mode];

      const paxInfo = state.passengerCount > 0 ? ` [${state.passengerCount} pax]` : "";
      const line = `  │ ${modeIcon} ${driverId}: ${state.mode.padEnd(7)} @ (${state.position.lat.toFixed(4)}, ${state.position.lng.toFixed(4)})${paxInfo}`;
      console.log(`${line.padEnd(66)}│`);
    }

    console.log("  └─────────────────────────────────────────────────────────────┘");
    console.log("");
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLETON EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export const simulationEngine = new SimulationEngine();
