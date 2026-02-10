/**
 * Integration Tests – Auth Endpoints
 *
 * Tests the auth/verify endpoint through the full Express HTTP stack.
 * The verifyToken middleware is mocked, so these tests verify the
 * controller behaviour when req.user is present or absent.
 */

import { afterEach, describe, expect, it } from "vitest";
import { AUTH_HEADER, request } from "./helpers.js";
import { resetAllMocks, setMockUser } from "./setup.js";

describe("Auth Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  // ── GET /api/v1/auth/verify ────────────────────────────────
  describe("GET /api/v1/auth/verify", () => {
    it("should return 200 with valid token and user info", async () => {
      const res = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.uid).toBe("test-user-uid-123");
      expect(res.body.user.email).toBe("test@ecoride.com");
      expect(res.body.user.emailVerified).toBe(true);
      expect(res.body.user.name).toBe("Test User");
      expect(res.body.user.picture).toBe("https://example.com/photo.jpg");
    });

    it("should return 401 when no user is attached (token missing)", async () => {
      setMockUser(null);

      const res = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(401);
      expect(res.body.valid).toBe(false);
      expect(res.body.message).toBe("No valid token provided");
    });

    it("should handle partial user object gracefully", async () => {
      setMockUser({ uid: "partial-uid" });

      const res = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.user.uid).toBe("partial-uid");
      expect(res.body.user.email).toBeUndefined();
    });
  });
});
