/**
 * Integration Tests – User Endpoints
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
import { resetAllMocks, setMockDoc, setMockUser } from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("User Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

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
    });

    it("should reject request with missing name (400)", async () => {
      const res = await request.post("/api/v1/user").set("Authorization", AUTH_HEADER).send({
        phone_number: "+919876543210",
        role: "rider",
      });

      expect(res.status).toBe(400);
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
        pollution_expiry: "2027-01-01",
        role: "driver",
      });

      expect(res.status).toBe(400);
    });

    it("should return 401 when token verification fails", async () => {
      setMockUser(null);

      const res = await request
        .post("/api/v1/user")
        .set("Authorization", AUTH_HEADER) // Header present but token invalid
        .send({
          name: "Test Rider",
          phone_number: "+919876543210",
          role: "rider",
        });

      expect(res.status).toBe(401);
    });
  });

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
  });
});
