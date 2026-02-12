/**
 * Integration Tests – Health Check & GetMe Endpoints
 */

import type { Express } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ── vi.mock with async factory ──
// This allows us to use the shared mock objects from setup.ts
// without issues regarding variable hoisting.
vi.mock("../../src/config/firebase.js", async () => {
  const setup = await import("./setup.js");
  return {
    auth: setup.mockAuth,
    db: setup.mockDb,
    rtdb: setup.mockRtdb,
    storage: {},
  };
});

vi.mock("stripe", async () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      paymentIntents: {
        create: vi.fn(async () => ({
          client_secret: "pi_mock_secret",
          id: "pi_mock_id",
        })),
      },
    })),
  };
});

import { AUTH_HEADER } from "./helpers.js";
// ── Import helpers ──
import { resetAllMocks, setMockUser } from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  // Dynamic import to ensure mocks are applied first
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("Health & Index Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  describe("GET /api/v1/health", () => {
    it("should return 200 with health check message", async () => {
      const res = await request.get("/api/v1/health");
      expect(res.status).toBe(200);
      expect(res.body.msg).toContain("Hello There");
    });

    it("should respond with JSON content type", async () => {
      const res = await request.get("/api/v1/health");
      expect(res.headers["content-type"]).toMatch(/json/);
    });
  });

  describe("GET /api/v1/getme", () => {
    it("should return 200 with user data when authenticated", async () => {
      // Ensure default mock user is set
      setMockUser({
        email: "test@ecoride.com",
        email_verified: true,
        name: "Test User",
        picture: "https://example.com/photo.jpg",
        uid: "test-user-uid-123",
      });

      const res = await request.get("/api/v1/getme").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.data).toBeTruthy();
      expect(res.body.data.uid).toBe("test-user-uid-123");
      expect(res.body.data.email).toBe("test@ecoride.com");
    });

    it("should return 401 when no auth header is sent", async () => {
      const res = await request.get("/api/v1/getme");
      expect(res.status).toBe(401);
    });

    it("should return 401 when user is not found (mock token verification fails)", async () => {
      setMockUser(null);
      const res = await request.get("/api/v1/getme").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(401);
    });
  });
});
