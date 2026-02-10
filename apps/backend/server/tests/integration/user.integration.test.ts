/**
 * Integration Tests – User Endpoints
 *
 * Tests user creation (rider/driver) and driver status endpoints
 * through the full Express HTTP stack using SuperTest.
 */

import { afterEach, describe, expect, it } from "vitest";
import { AUTH_HEADER, request } from "./helpers.js";
import { resetAllMocks, setMockDoc, setMockUser } from "./setup.js";

describe("User Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  // ── POST /api/v1/user ──────────────────────────────────────
  describe("POST /api/v1/user", () => {
    it("should create a rider successfully (201)", async () => {
      const res = await request.post("/api/v1/user").set("Authorization", AUTH_HEADER).send({
        name: "Test Rider",
        phone_number: "+919876543210",
        role: "rider",
      });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("User created successfully");
      expect(res.body.data.role).toBe("rider");
      expect(res.body.data.uid).toBe("test-user-uid-123");
    });

    it("should create a driver with all required fields (201)", async () => {
      const res = await request.post("/api/v1/user").set("Authorization", AUTH_HEADER).send({
        is_ev: true,
        license_url: "https://example.com/license.pdf",
        model: "Tata Nexon EV",
        name: "Test Driver",
        phone_number: "+919876543210",
        plate_number: "KA01AB1234",
        pollution_expiry: "2027-01-01",
        role: "driver",
      });

      expect(res.status).toBe(201);
      expect(res.body.message).toBe("User created successfully");
      expect(res.body.data.role).toBe("driver");
    });

    it("should reject request with missing name (400)", async () => {
      const res = await request.post("/api/v1/user").set("Authorization", AUTH_HEADER).send({
        phone_number: "+919876543210",
        role: "rider",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("name");
    });

    it("should reject request with missing role (400)", async () => {
      const res = await request.post("/api/v1/user").set("Authorization", AUTH_HEADER).send({
        name: "Test User",
        phone_number: "+919876543210",
      });

      expect(res.status).toBe(400);
    });

    it("should reject driver with missing license_url (400)", async () => {
      const res = await request.post("/api/v1/user").set("Authorization", AUTH_HEADER).send({
        model: "Tata Nexon",
        name: "Test Driver",
        phone_number: "+919876543210",
        plate_number: "KA01AB1234",
        // license_url missing
        pollution_expiry: "2027-01-01",
        role: "driver",
      });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Driver requires");
    });

    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);

      const res = await request.post("/api/v1/user").set("Authorization", AUTH_HEADER).send({
        name: "Test Rider",
        phone_number: "+919876543210",
        role: "rider",
      });

      expect(res.status).toBe(401);
    });
  });

  // ── GET /api/v1/user/driver-status ─────────────────────────
  describe("GET /api/v1/user/driver-status", () => {
    it("should return kyc_verified status for existing driver", async () => {
      setMockDoc(true, { kyc_verified: true });

      const res = await request.get("/api/v1/user/driver-status").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.kyc_verified).toBe(true);
    });

    it("should return kyc_verified: false for non-existent driver profile", async () => {
      setMockDoc(false);

      const res = await request.get("/api/v1/user/driver-status").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.kyc_verified).toBe(false);
    });

    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);

      const res = await request.get("/api/v1/user/driver-status").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(401);
    });
  });
});
