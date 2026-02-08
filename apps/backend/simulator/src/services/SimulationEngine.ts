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

export class SimulationEngine {
  private agents: Map<string, DriverAgent> = new Map();
  private tickInterval: NodeJS.Timeout | null = null;
  private lastTickTime: number = Date.now();
  private isRunning: boolean = false;

  // Track assignment listeners per driver
  private assignmentListeners: Map<string, () => void> = new Map();

  constructor() {
    console.log("═══════════════════════════════════════════════════════════════");
    console.log("  🚗 Eco-Ride Reactive Driver Simulator");
    console.log("═══════════════════════════════════════════════════════════════");
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Initialize and start the simulation engine
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
   * Stop the simulation engine
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
   * Get current status
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
   * Listen for drivers coming online/offline
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
    driversRef.on("child_changed", (snapshot) => {
      const driverId = snapshot.key;
      if (!driverId) return;

      const data = snapshot.val();
      if (!data) return;

      // Only sync if the update came from the driver app (not our simulator)
      // We can detect this by checking if lastUpdated is significantly different
      // For now, we'll skip syncing to avoid feedback loops
      // The agent's position is authoritative while simulator is running
    });

    console.log("  ✓ Listening on /drivers-online");
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // AGENT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Create a new agent for an online driver
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
    if (typeof data.lat !== "number" || typeof data.lng !== "number") {
      console.log(`  ⚠️  Skipping ${driverId}: missing lat/lng (driver may be initializing)`);
      return;
    }

    // Create initial position from RTDB data
    const initialPosition: Coordinate = {
      lat: data.lat,
      lng: data.lng,
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
   * Remove an agent when driver goes offline - also clean up RTDB data
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

    // Clean up any pending ride assignment for this driver
    await this.cleanupDriverRTDB(driverId);
  }

  /**
   * Clean up RTDB data when driver goes offline
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
   * Listen for ride assignments for a specific driver
   */
  private listenForRideAssignment(driverId: string, agent: DriverAgent): void {
    const assignmentRef = rtdb.ref(`rides-assigned/${driverId}`);

    const callback = async (snapshot: import("firebase-admin/database").DataSnapshot) => {
      const data = snapshot.val();

      if (data) {
        // New ride assignment
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
    };

    assignmentRef.on("value", callback);

    // Store unsubscribe function
    this.assignmentListeners.set(driverId, () => {
      assignmentRef.off("value", callback);
    });

    console.log(`  ✓ Listening for assignments on /rides-assigned/${driverId}`);
  }

  /**
   * Check if there's already a pending assignment when driver comes online
   */
  private async checkExistingAssignment(driverId: string, agent: DriverAgent): Promise<void> {
    try {
      const snapshot = await rtdb.ref(`rides-assigned/${driverId}`).get();
      const data = snapshot.val();

      if (data?.rideId) {
        console.log(`  📋 Found existing assignment for ${driverId}: ${data.rideId}`);

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
   * Start the global tick loop that moves all agents
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
   * Log current simulation status
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

      const line = `  │ ${modeIcon} ${driverId}: ${state.mode.padEnd(7)} @ (${state.position.lat.toFixed(4)}, ${state.position.lng.toFixed(4)})`;
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
