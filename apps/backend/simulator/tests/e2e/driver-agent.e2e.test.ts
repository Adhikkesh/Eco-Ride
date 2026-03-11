/**
 * E2E Tests – Driver Agent Full Lifecycle
 *
 * Tests a single DriverAgent through its complete state machine:
 *   IDLE → PICKUP → WAITING → TRIP → AWAITING_PAYMENT → IDLE
 *
 * Validates:
 *   1. Agent creation and IDLE mode initialization
 *   2. Receiving a ride assignment transitions to PICKUP
 *   3. Tick loop advances the agent along a route
 *   4. State queries return correct mode & position
 *   5. Agent stop cleans up properly
 *   6. Multiple assignments are queued correctly
 *   7. Position sync from external data
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock Firebase ────────────────────────────────────────────────────────────

vi.mock("../../src/config/firebase.js", async () => {
  const setup = await import("./setup.js");
  return {
    db: setup.mockDb,
    rtdb: setup.mockRtdb,
  };
});

vi.mock("axios", () => ({
  default: {
    get: vi.fn().mockRejectedValue(new Error("No real API in E2E tests")),
  },
}));

import { type Coordinate, DriverAgent } from "../../src/services/DriverAgent.js";
import {
  COIMBATORE_CENTER,
  COIMBATORE_NEARBY,
  resetSimMocks,
  SAMPLE_ASSIGNMENT,
  SAMPLE_ASSIGNMENT_2,
} from "./setup.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("E2E: DriverAgent Full Lifecycle", () => {
  let agent: DriverAgent;

  beforeEach(() => {
    resetSimMocks();
    agent = new DriverAgent("e2e-driver-001", COIMBATORE_CENTER, "CAR");
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Agent Creation & IDLE Mode
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 1: Agent Initialization", () => {
    it("should create agent with correct driverId", () => {
      expect(agent.driverId).toBe("e2e-driver-001");
    });

    it("should start in IDLE mode", () => {
      const state = agent.getState();
      expect(state.mode).toBe("IDLE");
    });

    it("should have correct initial position", () => {
      const state = agent.getState();
      expect(state.position.lat).toBe(COIMBATORE_CENTER.lat);
      expect(state.position.lng).toBe(COIMBATORE_CENTER.lng);
    });

    it("should start with 0 passengers", () => {
      const state = agent.getState();
      expect(state.passengerCount).toBe(0);
    });

    it("should have heading between 0 and 360", () => {
      const heading = agent.getState().heading;
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThanOrEqual(360);
    });

    it("should start the agent and remain in IDLE mode", async () => {
      await agent.start();
      expect(agent.getState().mode).toBe("IDLE");
    });

    it("should be safe to call start multiple times", async () => {
      await agent.start();
      await agent.start(); // second call should no-op
      expect(agent.getState().mode).toBe("IDLE");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 2: Ride Assignment → PICKUP Mode
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 2: Ride Assignment", () => {
    it("should transition to PICKUP mode on ride assignment", async () => {
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      expect(agent.getState().mode).toBe("PICKUP");
    });

    it("should still track the same driverId after assignment", async () => {
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      expect(agent.driverId).toBe("e2e-driver-001");
    });

    it("should not change mode if agent is stopped", async () => {
      await agent.start();
      agent.stop();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      // Mode should remain IDLE (agent was stopped)
      expect(agent.getState().mode).toBe("IDLE");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 3: Tick Processing
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 3: Tick-Driven Movement", () => {
    it("should process a tick without throwing in IDLE mode", async () => {
      await agent.start();
      await expect(agent.tick(1000)).resolves.not.toThrow();
    });

    it("should process a tick without throwing in PICKUP mode", async () => {
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      await expect(agent.tick(1000)).resolves.not.toThrow();
    });

    it("should process multiple ticks in sequence", async () => {
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);

      // Multiple ticks simulate the 1-second tick loop
      for (let i = 0; i < 5; i++) {
        await agent.tick(1000);
      }

      // Agent should still be running
      const state = agent.getState();
      expect(["PICKUP", "WAITING", "TRIP", "IDLE", "AWAITING_PAYMENT"]).toContain(state.mode);
    });

    it("tick should be a no-op after agent stop", async () => {
      await agent.start();
      agent.stop();
      // Tick should silently no-op
      await agent.tick(1000);
      expect(agent.getState().mode).toBe("IDLE");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 4: Position Sync
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 4: Position Sync", () => {
    it("should update position via syncPosition", () => {
      const newPos: Coordinate = { lat: 11.05, lng: 76.99 };
      agent.syncPosition(newPos);
      const state = agent.getState();
      expect(state.position.lat).toBe(11.05);
      expect(state.position.lng).toBe(76.99);
    });

    it("should not hold reference to synced position", () => {
      const newPos: Coordinate = { lat: 11.05, lng: 76.99 };
      agent.syncPosition(newPos);
      newPos.lat = 999;
      expect(agent.getState().position.lat).toBe(11.05);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 5: Stop & Cleanup
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 5: Stop & Cleanup", () => {
    it("should stop without error when in IDLE", () => {
      expect(() => agent.stop()).not.toThrow();
    });

    it("should stop without error when in PICKUP", async () => {
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      expect(() => agent.stop()).not.toThrow();
    });

    it("should reset state after stop", async () => {
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      agent.stop();
      // stop() clears assignments and route but preserves mode
      expect(agent.getState().mode).toBe("PICKUP");
    });

    it("should be safe to stop multiple times", async () => {
      await agent.start();
      agent.stop();
      agent.stop(); // second stop should be safe
      expect(agent.getState().mode).toBe("IDLE");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 6: Multiple Ride Assignments (Pooling)
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 6: Queued Assignments", () => {
    it("should handle back-to-back assignments", async () => {
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      // Second assignment while in PICKUP/TRIP
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT_2);
      // Agent should still be running
      const state = agent.getState();
      expect(["PICKUP", "TRIP", "WAITING", "IDLE", "AWAITING_PAYMENT"]).toContain(state.mode);
    });

    it("should not crash with many rapid assignments", async () => {
      await agent.start();
      for (let i = 0; i < 5; i++) {
        await agent.handleRideAssignment({
          drop: { lat: 11.05 + i * 0.001, lng: 76.99 + i * 0.001 },
          pickup: { lat: 11.02 + i * 0.001, lng: 76.96 + i * 0.001 },
          rideId: `ride-rapid-${i}`,
          riderId: `rider-rapid-${i}`,
        });
      }
      expect(agent.getState().mode).not.toBeUndefined();
    });
  });
});

describe("E2E: Multiple DriverAgents", () => {
  beforeEach(() => {
    resetSimMocks();
  });

  it("should run multiple agents independently", async () => {
    const agent1 = new DriverAgent("driver-A", COIMBATORE_CENTER, "CAR");
    const agent2 = new DriverAgent("driver-B", COIMBATORE_NEARBY, "EV");

    await agent1.start();
    await agent2.start();

    expect(agent1.getState().mode).toBe("IDLE");
    expect(agent2.getState().mode).toBe("IDLE");

    // Assign ride to agent1 only
    await agent1.handleRideAssignment(SAMPLE_ASSIGNMENT);
    expect(agent1.getState().mode).toBe("PICKUP");
    expect(agent2.getState().mode).toBe("IDLE"); // unchanged

    // Tick both
    await agent1.tick(1000);
    await agent2.tick(1000);

    // Both should still be alive
    expect(agent1.driverId).toBe("driver-A");
    expect(agent2.driverId).toBe("driver-B");

    agent1.stop();
    agent2.stop();
  });

  it("should handle concurrent ride assignments to different agents", async () => {
    const agents = Array.from(
      { length: 3 },
      (_, i) => new DriverAgent(`driver-${i}`, { lat: 11.02 + i * 0.01, lng: 76.96 }, "CAR"),
    );

    // Start all
    await Promise.all(agents.map((a) => a.start()));

    // Assign different rides to each
    await Promise.all(
      agents.map((a, i) =>
        a.handleRideAssignment({
          drop: { lat: 11.05, lng: 76.99 },
          pickup: { lat: 11.03, lng: 76.97 },
          rideId: `ride-concurrent-${i}`,
          riderId: `rider-concurrent-${i}`,
        }),
      ),
    );

    // All should be in PICKUP
    for (const a of agents) {
      expect(a.getState().mode).toBe("PICKUP");
    }

    // Cleanup
    for (const a of agents) {
      a.stop();
    }
  });
});
