/**
 * Integration Tests – Health Check & GetMe Endpoints
 *
 * Tests the public health check and authenticated GetMe endpoints
 * through the full Express HTTP stack using SuperTest.
 */

import { afterEach, describe, expect, it } from "vitest";
import { AUTH_HEADER, request } from "./helpers.js";
import { resetAllMocks, setMockUser } from "./setup.js";

describe("Health & Index Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  // ── GET /api/v1/health ─────────────────────────────────────
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

  // ── GET /api/v1/getme ──────────────────────────────────────
  describe("GET /api/v1/getme", () => {
    it("should return 200 with user data when authenticated", async () => {
      const res = await request.get("/api/v1/getme").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeTruthy();
      expect(res.body.data.uid).toBe("test-user-uid-123");
      expect(res.body.data.email).toBe("test@ecoride.com");
    });

    it("should return null data when user is not set", async () => {
      setMockUser(null);

      const res = await request.get("/api/v1/getme").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeNull();
    });
  });
});
