/**
 * E2E Tests – User Onboarding & Authentication Flow
 *
 * Tests the complete user journey:
 *   1. Health check confirms API is available
 *   2. Token verification (auth middleware)
 *   3. Rider creates an account
 *   4. Driver creates an account
 *   5. Admin verifies the driver
 *   6. Driver status is updated
 *   7. Saved locations CRUD
 *   8. Profile access (getme)
 *
 * Validates the full onboarding pipeline across different user roles.
 */

import type { Express } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// ─── Mock Firebase ────────────────────────────────────────────────────────────

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
      paymentIntents: { create: vi.fn(async () => ({ client_secret: "s", id: "id" })) },
    })),
  };
});

import {
  ADMIN,
  AUTH_HEADER,
  DRIVER,
  RIDER,
  resetE2EMocks,
  setAuthUser,
  setDocData,
  setQueryDocs,
} from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("E2E: Health & Auth", () => {
  afterEach(() => {
    resetE2EMocks();
  });

  it("should confirm API is healthy", async () => {
    const res = await request.get("/api/v1/health");
    expect(res.status).toBe(200);
  });

  it("should verify a valid token and return user info", async () => {
    setAuthUser(RIDER);
    const res = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
  });

  it("should reject request without auth header", async () => {
    const res = await request.get("/api/v1/auth/verify");
    expect(res.status).toBe(401);
  });

  it("should reject request with invalid token", async () => {
    const { mockAuth } = await import("./setup.js");
    mockAuth.verifyIdToken.mockRejectedValueOnce(new Error("Invalid token"));

    const res = await request
      .get("/api/v1/auth/verify")
      .set("Authorization", "Bearer invalid-token");

    expect(res.status).toBe(401);
  });

  it("should return user info via getme endpoint", async () => {
    setAuthUser(RIDER);
    setDocData(true, {
      email: RIDER.email,
      name: RIDER.name,
      role: "rider",
      uid: RIDER.uid,
    });

    const res = await request.get("/api/v1/getme").set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
  });
});

describe("E2E: Rider Onboarding", () => {
  afterEach(() => {
    resetE2EMocks();
  });

  it("should create a rider account", async () => {
    setAuthUser(RIDER);

    const res = await request.post("/api/v1/user").set("Authorization", AUTH_HEADER).send({
      email: RIDER.email,
      name: RIDER.name,
      phone_number: "9876543210",
      role: "rider",
    });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("User created successfully");
  });

  it("should fetch rider saved locations (initially empty)", async () => {
    setAuthUser(RIDER);
    setDocData(true, {}); // User doc exists but no saved_locations

    const res = await request.get("/api/v1/user/saved-locations").set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("should save a home location", async () => {
    setAuthUser(RIDER);
    setDocData(true, {}); // Existing but empty locations doc

    const res = await request
      .put("/api/v1/user/saved-locations")
      .set("Authorization", AUTH_HEADER)
      .send({
        location: { lat: 12.9716, lng: 77.5946, name: "123 MG Road, Bangalore" },
        type: "home",
      });

    expect(res.status).toBe(200);
  });

  it("should save a work location", async () => {
    setAuthUser(RIDER);
    setDocData(true, {
      saved_locations: { home: { lat: 12.9716, lng: 77.5946, name: "123 MG Road" } },
    });

    const res = await request
      .put("/api/v1/user/saved-locations")
      .set("Authorization", AUTH_HEADER)
      .send({
        location: { lat: 12.9722, lng: 77.607, name: "456 Brigade Road, Bangalore" },
        type: "work",
      });

    expect(res.status).toBe(200);
  });
});

describe("E2E: Driver Onboarding & Verification", () => {
  afterEach(() => {
    resetE2EMocks();
  });

  it("should create a driver account", async () => {
    setAuthUser(DRIVER);

    const res = await request.post("/api/v1/user").set("Authorization", AUTH_HEADER).send({
      email: DRIVER.email,
      kyc_url: "https://storage.example.com/kyc/driver.pdf",
      license_url: "https://storage.example.com/license/driver.pdf",
      model: "Tesla Model 3",
      name: DRIVER.name,
      passenger_capacity: 4,
      phone_number: "9876543211",
      plate_number: "KA01AB1234",
      pollution_expiry: "2027-12-31",
      role: "driver",
      vehicle_type: "ELECTRIC",
    });

    expect(res.status).toBe(201);
    expect(res.body.message).toBe("User created successfully");
  });

  it("should show driver as unverified initially", async () => {
    setAuthUser(DRIVER);
    setDocData(true, { kyc_verified: false });

    const res = await request.get("/api/v1/user/driver-status").set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.kyc_verified).toBe(false);
  });

  it("admin should see unverified drivers list", async () => {
    setAuthUser(ADMIN);

    setQueryDocs([
      {
        data: {
          email: DRIVER.email,
          kyc_url: "https://storage.example.com/kyc.pdf",
          kyc_verified: false,
          license_url: "https://storage.example.com/license.pdf",
          name: DRIVER.name,
          phone_number: "9876543211",
          vehicle: {
            model: "Tesla Model 3",
            plate_number: "KA01AB1234",
          },
        },
        id: DRIVER.uid,
      },
    ]);

    const res = await request
      .get("/api/v1/admin/drivers/unverified")
      .set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
  });

  it("admin should verify a driver", async () => {
    setAuthUser(ADMIN);
    setDocData(true, { kyc_verified: false });

    const res = await request
      .post("/api/v1/admin/drivers/verify")
      .set("Authorization", AUTH_HEADER)
      .send({
        driver_uid: DRIVER.uid,
        verified: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.data.verified).toBe(true);
  });

  it("driver should now show as verified", async () => {
    setAuthUser(DRIVER);
    setDocData(true, { kyc_verified: true });

    const res = await request.get("/api/v1/user/driver-status").set("Authorization", AUTH_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.kyc_verified).toBe(true);
  });
});

describe("E2E: Fare Estimation Flow", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetE2EMocks();
  });

  it("should calculate fare for a given route", async () => {
    setAuthUser(RIDER);

    globalThis.fetch = vi.fn().mockResolvedValue({
      json: async () => ({
        routes: [
          {
            distanceMeters: 5000,
            duration: "600s",
            polyline: { encodedPolyline: "mock_polyline" },
          },
        ],
      }),
      ok: true,
    }) as any;

    const res = await request
      .post("/api/v1/ride/estimate")
      .set("Authorization", AUTH_HEADER)
      .send({
        drop: { lat: 12.9352, lng: 77.6245 },
        pickup: { lat: 12.9716, lng: 77.5946 },
      });

    // Fare response should have numeric fare
    expect(res.status).toBe(200);
    expect(res.body.fare).toBeGreaterThan(0);
  });

  it("should reject fare calculation with invalid coordinates", async () => {
    setAuthUser(RIDER);

    const res = await request
      .post("/api/v1/ride/estimate")
      .set("Authorization", AUTH_HEADER)
      .send({
        drop: { lat: 12.9352, lng: 77.6245 },
        pickup: { lat: "not-a-number", lng: 77.5946 },
      });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
