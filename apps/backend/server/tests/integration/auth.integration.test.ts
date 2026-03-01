/**
 * Integration Tests – Auth Endpoints
 */

import type { Express } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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
import { resetAllMocks, setMockUser } from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("Auth Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  describe("GET /api/v1/auth/verify", () => {
    it("should return 200 with valid token and user info", async () => {
      const res = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.uid).toBe("test-user-uid-123");
    });

    it("should return 401 when token verification fails (mock rejection)", async () => {
      setMockUser(null); // Causes verifyIdToken to reject

      const res = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(401);
      // The body message comes from the catch block in middleware
      expect(res.body.message).toContain("Forbidden");
    });

    it("should handle partial user object gracefully", async () => {
      setMockUser({ uid: "partial-uid" });

      const res = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.user.uid).toBe("partial-uid");
    });

    it("should return 401 when no Authorization header is sent", async () => {
      const res = await request.get("/api/v1/auth/verify");
      expect(res.status).toBe(401);
    });

    it("should return user email in response body when verified", async () => {
      const res = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe("test@ecoride.com");
    });

    it("should respond with JSON content type", async () => {
      const res = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);
      expect(res.headers["content-type"]).toMatch(/json/);
    });
  });
});
