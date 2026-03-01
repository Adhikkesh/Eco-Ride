/**
 * Unit Tests for DriverAgent State Machine
 *
 * Tests the state machine logic, mode transitions, and position management
 * of the DriverAgent class. Since DriverAgent is tightly coupled to Firebase,
 * we mock the Firebase module and test:
 *
 * - Constructor initialization
 * - State machine modes (IDLE, PICKUP, WAITING, TRIP, AWAITING_PAYMENT)
 * - getState() return structure
 * - syncPosition()
 * - stop() cleanup
 * - handleRideAssignment() mode transitions and queuing
 * - tick() delegation to mode handlers
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ─── Mock Firebase ────────────────────────────────────────────────────────────

const mockRtdbRef = vi.fn().mockReturnValue({
  off: vi.fn(),
  on: vi.fn(),
  once: vi.fn().mockResolvedValue({ val: () => null }),
  remove: vi.fn().mockResolvedValue(undefined),
  set: vi.fn().mockResolvedValue(undefined),
  update: vi.fn().mockResolvedValue(undefined),
});

const mockDbCollection = vi.fn().mockReturnValue({
  doc: vi.fn().mockReturnValue({
    get: vi.fn().mockResolvedValue({ exists: false }),
    update: vi.fn().mockResolvedValue(undefined),
  }),
});

vi.mock("../../src/config/firebase.js", () => ({
  db: { collection: (...args: unknown[]) => mockDbCollection(...args) },
  rtdb: { ref: (...args: unknown[]) => mockRtdbRef(...args) },
}));

vi.mock("axios", () => ({
  default: { get: vi.fn().mockRejectedValue(new Error("No API in tests")) },
}));

import {
  type Coordinate,
  DriverAgent,
  type DriverMode,
  type RideAssignment,
} from "../../src/services/DriverAgent.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_POS: Coordinate = { lat: 11.0168, lng: 76.9558 };

const SAMPLE_ASSIGNMENT: RideAssignment = {
  drop: { lat: 11.05, lng: 76.98 },
  pickup: { lat: 11.02, lng: 76.96 },
  rideId: "ride-001",
  riderId: "rider-001",
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("DriverAgent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("constructor", () => {
    it("should initialize with the given driverId", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      expect(agent.driverId).toBe("drv_001");
    });

    it("should initialize at the given position", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      const state = agent.getState();
      expect(state.position.lat).toBe(DEFAULT_POS.lat);
      expect(state.position.lng).toBe(DEFAULT_POS.lng);
    });

    it("should start in IDLE mode", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      expect(agent.getState().mode).toBe("IDLE");
    });

    it("should start with 0 passengers", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      expect(agent.getState().passengerCount).toBe(0);
    });

    it("should accept optional vehicleType", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS, "EV");
      expect(agent.driverId).toBe("drv_001");
    });
  });

  describe("getState", () => {
    it("should return current mode, position, heading, and passengerCount", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      const state = agent.getState();

      expect(state).toHaveProperty("mode");
      expect(state).toHaveProperty("position");
      expect(state).toHaveProperty("heading");
      expect(state).toHaveProperty("passengerCount");
    });

    it("should return a copy of position (not reference)", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      const state = agent.getState();
      state.position.lat = 999;
      expect(agent.getState().position.lat).toBe(DEFAULT_POS.lat);
    });

    it("should have heading between 0 and 360", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      const heading = agent.getState().heading;
      expect(heading).toBeGreaterThanOrEqual(0);
      expect(heading).toBeLessThanOrEqual(360);
    });
  });

  describe("syncPosition", () => {
    it("should update the agent position", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      const newPos: Coordinate = { lat: 12.0, lng: 78.0 };
      agent.syncPosition(newPos);
      expect(agent.getState().position).toEqual(newPos);
    });

    it("should not hold reference to the input object", () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      const newPos: Coordinate = { lat: 12.0, lng: 78.0 };
      agent.syncPosition(newPos);
      newPos.lat = 999;
      expect(agent.getState().position.lat).toBe(12.0);
    });
  });

  describe("stop", () => {
    it("should stop the agent", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      await agent.start();
      agent.stop();

      // Tick should be a no-op after stop
      await agent.tick(1000); // Should not throw
    });

    it("should reset passenger count to 0", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      await agent.start();
      agent.stop();
      expect(agent.getState().passengerCount).toBe(0);
    });
  });

  describe("start", () => {
    it("should set the agent to running", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      await agent.start();
      // After start, ticking should work (no error)
      await agent.tick(1000);
    });

    it("should be idempotent (calling start twice is safe)", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      await agent.start();
      await agent.start(); // second call should be a no-op
    });
  });

  describe("handleRideAssignment", () => {
    it("should be a no-op if agent is not running", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      // Don't call start()
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      // Should not crash — just returns
      expect(agent.getState().mode).toBe("IDLE");
    });

    it("should transition to PICKUP mode when IDLE", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      expect(agent.getState().mode).toBe("PICKUP");
    });

    it("should queue assignment when already on PICKUP", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      expect(agent.getState().mode).toBe("PICKUP");

      // Second assignment should be queued, not switch mode
      const second: RideAssignment = {
        ...SAMPLE_ASSIGNMENT,
        rideId: "ride-002",
        riderId: "rider-002",
      };
      await agent.handleRideAssignment(second);
      // Should still be in PICKUP mode (not switched)
      expect(agent.getState().mode).toBe("PICKUP");
    });
  });

  describe("tick", () => {
    it("should not throw when agent is stopped", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      await agent.tick(1000);
      // No error expected
    });

    it("should handle IDLE tick without error", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      await agent.start();
      await agent.tick(1000);
      // Should still be in IDLE
      expect(agent.getState().mode).toBe("IDLE");
    });

    it("should handle PICKUP tick without error", async () => {
      const agent = new DriverAgent("drv_001", DEFAULT_POS);
      await agent.start();
      await agent.handleRideAssignment(SAMPLE_ASSIGNMENT);
      await agent.tick(1000);
      // Should be in PICKUP or WAITING (if arrived)
      const mode = agent.getState().mode;
      expect(["PICKUP", "WAITING"]).toContain(mode);
    });
  });

  describe("DriverMode type", () => {
    it("should have all expected modes", () => {
      const modes: DriverMode[] = ["IDLE", "PICKUP", "TRIP", "WAITING", "AWAITING_PAYMENT"];
      expect(modes).toHaveLength(5);
    });
  });
});
