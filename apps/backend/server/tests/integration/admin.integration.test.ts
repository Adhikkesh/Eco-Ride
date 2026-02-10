/**
 * Integration Tests – Admin Endpoints
 *
 * Tests admin-only endpoints (unverified drivers, driver verification)
 * through the full Express HTTP stack. Verifies RBAC enforcement.
 */

import { afterEach, describe, expect, it } from "vitest";
import { ADMIN_UID, AUTH_HEADER, request } from "./helpers.js";
import { resetAllMocks, setMockDoc, setMockQuerySnapshot, setMockUser } from "./setup.js";

describe("Admin Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  // ── GET /api/v1/admin/drivers/unverified ───────────────────
  describe("GET /api/v1/admin/drivers/unverified", () => {
    it("should return 403 for non-admin user", async () => {
      // Default mock user is NOT admin
      const res = await request
        .get("/api/v1/admin/drivers/unverified")
        .set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Admin only");
    });

    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);

      const res = await request
        .get("/api/v1/admin/drivers/unverified")
        .set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(401);
    });

    it("should return unverified drivers for admin user", async () => {
      setMockUser({ email: "admin@ecoride.com", uid: ADMIN_UID });

      // Mock the Firestore query for driver_profile where kyc_verified == false
      setMockQuerySnapshot([
        {
          data: {
            driver_uid: "driver-uid-1",
            kyc_url: "https://example.com/kyc.pdf",
            kyc_verified: false,
            license_url: "https://example.com/license.pdf",
          },
          id: "driver-uid-1",
        },
      ]);

      // The controller also fetches user info and vehicle info
      setMockDoc(true, {
        email: "driver@test.com",
        name: "Pending Driver",
        phone_number: "+919876543210",
      });

      const res = await request
        .get("/api/v1/admin/drivers/unverified")
        .set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
      expect(res.body.message).toContain("Unverified drivers");
    });

    it("should return empty array when no unverified drivers", async () => {
      setMockUser({ email: "admin@ecoride.com", uid: ADMIN_UID });
      setMockQuerySnapshot([]);

      const res = await request
        .get("/api/v1/admin/drivers/unverified")
        .set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([]);
    });
  });

  // ── POST /api/v1/admin/drivers/verify ──────────────────────
  describe("POST /api/v1/admin/drivers/verify", () => {
    it("should return 403 for non-admin user", async () => {
      const res = await request
        .post("/api/v1/admin/drivers/verify")
        .set("Authorization", AUTH_HEADER)
        .send({ driver_uid: "driver-1", verified: true });

      expect(res.status).toBe(403);
      expect(res.body.message).toContain("Admin only");
    });

    it("should return 400 when driver_uid is missing", async () => {
      setMockUser({ email: "admin@ecoride.com", uid: ADMIN_UID });

      const res = await request
        .post("/api/v1/admin/drivers/verify")
        .set("Authorization", AUTH_HEADER)
        .send({ verified: true });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("driver_uid");
    });

    it("should return 404 when driver profile does not exist", async () => {
      setMockUser({ email: "admin@ecoride.com", uid: ADMIN_UID });
      setMockDoc(false);

      const res = await request
        .post("/api/v1/admin/drivers/verify")
        .set("Authorization", AUTH_HEADER)
        .send({ driver_uid: "nonexistent-driver", verified: true });

      expect(res.status).toBe(404);
    });

    it("should verify driver successfully", async () => {
      setMockUser({ email: "admin@ecoride.com", uid: ADMIN_UID });
      setMockDoc(true, { driver_uid: "driver-1", kyc_verified: false });

      const res = await request
        .post("/api/v1/admin/drivers/verify")
        .set("Authorization", AUTH_HEADER)
        .send({ driver_uid: "driver-1", verified: true });

      expect(res.status).toBe(200);
      expect(res.body.data.verified).toBe(true);
      expect(res.body.message).toContain("verified successfully");
    });

    it("should decline driver verification", async () => {
      setMockUser({ email: "admin@ecoride.com", uid: ADMIN_UID });
      setMockDoc(true, { driver_uid: "driver-1", kyc_verified: false });

      const res = await request
        .post("/api/v1/admin/drivers/verify")
        .set("Authorization", AUTH_HEADER)
        .send({ driver_uid: "driver-1", verified: false });

      expect(res.status).toBe(200);
      expect(res.body.data.verified).toBe(false);
      expect(res.body.message).toContain("declined");
    });
  });
});
