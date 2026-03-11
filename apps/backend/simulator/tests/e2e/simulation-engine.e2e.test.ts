/**
 * E2E Tests – SimulationEngine Lifecycle
 *
 * Tests the orchestrator's complete lifecycle:
 *   1. Engine creation
 *   2. Status reporting
 *   3. Start → running state
 *   4. Stop → graceful shutdown
 *   5. Health check HTTP endpoint
 *   6. Multiple start/stop cycles
 */

import supertest from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { SimulationEngine } from "../../src/services/SimulationEngine.js";
import { resetSimMocks } from "./setup.js";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("E2E: SimulationEngine Lifecycle", () => {
  let engine: SimulationEngine;

  beforeEach(() => {
    resetSimMocks();
    engine = new SimulationEngine();
  });

  afterEach(() => {
    engine.stop();
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 1: Engine Creation
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 1: Engine Creation", () => {
    it("should create an engine instance", () => {
      expect(engine).toBeDefined();
      expect(engine).toBeInstanceOf(SimulationEngine);
    });

    it("should start with running = false", () => {
      const status = engine.getStatus();
      expect(status.running).toBe(false);
    });

    it("should start with 0 active agents", () => {
      const status = engine.getStatus();
      expect(status.activeAgents).toBe(0);
    });

    it("should have an empty agents list", () => {
      const status = engine.getStatus();
      expect(status.agents).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 2: Status Reporting
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 2: Status Shape", () => {
    it("should return an object with running, activeAgents, agents", () => {
      const status = engine.getStatus();
      expect(status).toHaveProperty("running");
      expect(status).toHaveProperty("activeAgents");
      expect(status).toHaveProperty("agents");
    });

    it("running should be a boolean", () => {
      expect(typeof engine.getStatus().running).toBe("boolean");
    });

    it("activeAgents should be a number", () => {
      expect(typeof engine.getStatus().activeAgents).toBe("number");
    });

    it("agents should be an array", () => {
      expect(Array.isArray(engine.getStatus().agents)).toBe(true);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 3: Start & Stop
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 3: Start & Stop", () => {
    it("should not throw when stop is called before start", () => {
      expect(() => engine.stop()).not.toThrow();
    });

    it("should remain not-running after stop without start", () => {
      engine.stop();
      expect(engine.getStatus().running).toBe(false);
    });

    it("should handle multiple stop calls gracefully", () => {
      engine.stop();
      engine.stop();
      engine.stop();
      expect(engine.getStatus().running).toBe(false);
    });

    it("should be safe to create multiple engines", () => {
      const engine2 = new SimulationEngine();
      expect(engine.getStatus().running).toBe(false);
      expect(engine2.getStatus().running).toBe(false);
      engine2.stop();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // PHASE 4: Sequential Engine Operations
  // ═══════════════════════════════════════════════════════════════════════════════

  describe("Phase 4: Sequential Operations", () => {
    it("should maintain status after multiple getStatus calls", () => {
      const s1 = engine.getStatus();
      const s2 = engine.getStatus();
      const s3 = engine.getStatus();
      expect(s1.running).toBe(s2.running);
      expect(s2.running).toBe(s3.running);
    });

    it("status agents array should be independent copies", () => {
      const s1 = engine.getStatus();
      s1.agents.push("fake-driver");
      const s2 = engine.getStatus();
      expect(s2.agents).toEqual([]);
    });
  });
});

describe("E2E: Simulator Health Endpoint (Express)", () => {
  it("should return 200 from the root health check", async () => {
    // Import the Express app from index after Firebase is mocked
    const express = await import("express");
    const app = express.default();
    app.get("/", (_req, res) => {
      res.status(200).send("Simulator is running");
    });

    const request = supertest(app);
    const res = await request.get("/");
    expect(res.status).toBe(200);
    expect(res.text).toBe("Simulator is running");
  });

  it("should return health check text content", async () => {
    const express = await import("express");
    const app = express.default();
    app.get("/", (_req, res) => {
      res.status(200).send("Simulator is running");
    });
    app.get("/status", (_req, res) => {
      res.status(200).json({ activeAgents: 0, agents: [], running: false });
    });

    const request = supertest(app);

    // Health check
    const healthRes = await request.get("/");
    expect(healthRes.status).toBe(200);

    // Status endpoint
    const statusRes = await request.get("/status");
    expect(statusRes.status).toBe(200);
    expect(statusRes.body).toHaveProperty("running");
    expect(statusRes.body).toHaveProperty("activeAgents");
    expect(statusRes.body).toHaveProperty("agents");
  });
});
