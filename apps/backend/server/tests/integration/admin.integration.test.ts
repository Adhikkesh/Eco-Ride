/**
 * Integration Tests – Admin Endpoints
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

import { ADMIN_UID, AUTH_HEADER } from "./helpers.js";
import { resetAllMocks, setMockDoc, setMockQuerySnapshot, setMockUser } from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("Admin Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  describe("GET /api/v1/admin/drivers/unverified", () => {
    it("should return 403 for non-admin user", async () => {
      // Default mock user is NOT admin
      const res = await request
        .get("/api/v1/admin/drivers/unverified")
        .set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(403);
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
      setMockQuerySnapshot([
        {
          data: {
            driver_uid: "driver-uid-1",
            kyc_url: "url",
            kyc_verified: false,
            license_url: "url",
          },
          id: "driver-uid-1",
        },
      ]);
      setMockDoc(true, {
        email: "driver@test.com",
        name: "Pending Driver",
        phone_number: "+919876543210",
      });

      const res = await request
        .get("/api/v1/admin/drivers/unverified")
        .set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBe(1);
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

  describe("POST /api/v1/admin/drivers/verify", () => {
    it("should return 403 for non-admin user", async () => {
      const res = await request
        .post("/api/v1/admin/drivers/verify")
        .set("Authorization", AUTH_HEADER)
        .send({ driver_uid: "driver-1", verified: true });
      expect(res.status).toBe(403);
    });

    it("should return 400 when driver_uid is missing", async () => {
      setMockUser({ email: "admin@ecoride.com", uid: ADMIN_UID });

      const res = await request
        .post("/api/v1/admin/drivers/verify")
        .set("Authorization", AUTH_HEADER)
        .send({ verified: true });

      expect(res.status).toBe(400);
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
    });
  });
});
