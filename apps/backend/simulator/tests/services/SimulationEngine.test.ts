/**
 * Unit Tests for SimulationEngine
 *
 * Tests the orchestrator's status reporting and agent lifecycle.
 * Firebase is fully mocked since the engine manages RTDB listeners.
 *
 * WHAT IS TESTED:
 * - Engine status (running, activeAgents)
 * - getStatus() structure
 *
 * WHAT IS NOT TESTED:
 * - RTDB listeners (listenForDriverPresence, listenForRideAssignment)
 * - Tick loop (requires timers)
 * - Full start/stop lifecycle (requires Firebase init)
 */

import { describe, expect, it, vi } from "vitest";

// ─── Mock Firebase ────────────────────────────────────────────────────────────

vi.mock("../../src/config/firebase.js", () => ({
  db: {
    collection: vi.fn().mockReturnValue({
      doc: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({ exists: false }),
      }),
    }),
  },
  rtdb: {
    ref: vi.fn().mockReturnValue({
      off: vi.fn(),
      on: vi.fn(),
      once: vi.fn().mockResolvedValue({ val: () => null }),
      remove: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      update: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("axios", () => ({
  default: { get: vi.fn().mockRejectedValue(new Error("No API in tests")) },
}));

import { SimulationEngine } from "../../src/services/SimulationEngine.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("SimulationEngine", () => {
  describe("constructor", () => {
    it("should create a new SimulationEngine instance", () => {
      const engine = new SimulationEngine();
      expect(engine).toBeDefined();
    });
  });

  describe("getStatus", () => {
    it("should return status object with required fields", () => {
      const engine = new SimulationEngine();
      const status = engine.getStatus();

      expect(status).toHaveProperty("running");
      expect(status).toHaveProperty("activeAgents");
      expect(status).toHaveProperty("agents");
    });

    it("should start as not running with 0 agents", () => {
      const engine = new SimulationEngine();
      const status = engine.getStatus();

      expect(status.running).toBe(false);
      expect(status.activeAgents).toBe(0);
      expect(status.agents).toEqual([]);
    });

    it("should have agents as an array", () => {
      const engine = new SimulationEngine();
      const status = engine.getStatus();
      expect(Array.isArray(status.agents)).toBe(true);
    });
  });

  describe("stop (before start)", () => {
    it("should not throw when called before start", () => {
      const engine = new SimulationEngine();
      expect(() => engine.stop()).not.toThrow();
    });

    it("should remain not running after stop", () => {
      const engine = new SimulationEngine();
      engine.stop();
      expect(engine.getStatus().running).toBe(false);
    });
  });
});
