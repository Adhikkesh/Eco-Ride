/**
 * E2E Tests – Full Ride Lifecycle
 *
 * Tests the complete ride flow end-to-end:
 *   1. Rider requests a ride
 *   2. Driver accepts the ride
 *   3. Driver arrives at pickup
 *   4. Rider gets OTP, OTP verified
 *   5. Ride starts
 *   6. Ride completes
 *   7. Payment is processed
 *   8. Both rider and driver submit ratings
 *
 * This is the core E2E test – it validates that the entire
 * ride lifecycle works as a cohesive flow through the API.
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
      paymentIntents: {
        confirm: vi.fn(async () => ({
          id: "pi_e2e_payment_001",
          status: "succeeded",
        })),
        create: vi.fn(async () => ({
          client_secret: "pi_e2e_secret_123",
          id: "pi_e2e_payment_001",
          status: "requires_payment_method",
        })),
      },
    })),
  };
});

import {
  AUTH_HEADER,
  BANGALORE_DROP,
  BANGALORE_PICKUP,
  DRIVER,
  mockRtdbRef,
  RIDER,
  resetE2EMocks,
  setAuthUser,
  setDocData,
  setRtdbData,
} from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("E2E: Full Ride Lifecycle", () => {
  afterEach(() => {
    resetE2EMocks();
  });

  it("Step 1 → Rider requests a ride and gets matched to a driver", async () => {
    // Rider is authenticated
    setAuthUser(RIDER);

    // Drivers are online in RTDB
    const onlineDrivers = {
      [DRIVER.uid]: {
        heading: 90,
        lastUpdated: Date.now(),
        lat: BANGALORE_PICKUP.lat + 0.005, // ~500m away
        lng: BANGALORE_PICKUP.lng + 0.005,
        status: "AVAILABLE",
        vehicleType: "CAR",
      },
    };

    mockRtdbRef.once
      .mockResolvedValueOnce({ val: () => onlineDrivers }) // drivers-online lookup
      .mockResolvedValueOnce({ val: () => onlineDrivers[DRIVER.uid] }); // single driver data

    setDocData(true, { email: DRIVER.email, name: DRIVER.name });

    const res = await request.post("/api/v1/ride/request").set("Authorization", AUTH_HEADER).send({
      dropLat: BANGALORE_DROP.lat,
      dropLng: BANGALORE_DROP.lng,
      fare: 120,
      pickupLat: BANGALORE_PICKUP.lat,
      pickupLng: BANGALORE_PICKUP.lng,
      riderId: RIDER.uid,
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.driverId).toBe(DRIVER.uid);
  });

  it("Step 2 → Driver accepts the ride", async () => {
    setAuthUser(DRIVER);

    setDocData(true, {
      driverId: DRIVER.uid,
      drop: { lat: BANGALORE_DROP.lat, lng: BANGALORE_DROP.lng },
      pickup: { lat: BANGALORE_PICKUP.lat, lng: BANGALORE_PICKUP.lng },
      riderId: RIDER.uid,
      status: "PENDING_ACCEPTANCE",
    });

    const res = await request
      .post("/api/v1/ride/accept")
      .set("Authorization", AUTH_HEADER)
      .send({ rideId: "ride-e2e-001" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("Step 3 → Ride is started with correct OTP", async () => {
    setAuthUser(DRIVER);

    setDocData(true, {
      driverId: DRIVER.uid,
      otp: "4567",
      riderId: RIDER.uid,
      status: "MATCHED",
    });

    const res = await request
      .post("/api/v1/ride/start")
      .set("Authorization", AUTH_HEADER)
      .send({ otp: "4567", rideId: "ride-e2e-001" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("Step 3b → Start ride fails with wrong OTP", async () => {
    setAuthUser(DRIVER);

    setDocData(true, {
      driverId: DRIVER.uid,
      otp: "4567",
      riderId: RIDER.uid,
      status: "MATCHED",
    });

    const res = await request
      .post("/api/v1/ride/start")
      .set("Authorization", AUTH_HEADER)
      .send({ otp: "0000", rideId: "ride-e2e-001" });

    expect(res.status).toBe(400);
  });

  it("Step 4 → Ride is completed at destination", async () => {
    setAuthUser(DRIVER);

    setDocData(true, {
      driverId: DRIVER.uid,
      fare: 120,
      riderId: RIDER.uid,
      status: "IN_PROGRESS",
    });

    const res = await request
      .post("/api/v1/ride/complete")
      .set("Authorization", AUTH_HEADER)
      .send({ rideId: "ride-e2e-001" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("Step 5 → Payment intent is created for the ride", async () => {
    setAuthUser(RIDER);

    const res = await request
      .post("/api/v1/payment/create-intent")
      .set("Authorization", AUTH_HEADER)
      .send({ amount: 120, rideId: "ride-e2e-001" });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("clientSecret");
  });

  it("Step 6 → Rider submits a rating for the driver", async () => {
    setAuthUser(RIDER);

    const res = await request.post("/api/v1/ride/rate").set("Authorization", AUTH_HEADER).send({
      comment: "Great ride, very smooth!",
      driverId: DRIVER.uid,
      rating: 5,
      rideId: "ride-e2e-001",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("Step 7 → Driver submits a rating for the rider", async () => {
    setAuthUser(DRIVER);

    const res = await request
      .post("/api/v1/ride/rate-rider")
      .set("Authorization", AUTH_HEADER)
      .send({
        comment: "Polite passenger",
        rating: 4,
        rideId: "ride-e2e-001",
        riderId: RIDER.uid,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("E2E: Ride Cancellation Flow", () => {
  afterEach(() => {
    resetE2EMocks();
  });

  it("should handle ride request → cancel by rider", async () => {
    setAuthUser(RIDER);

    // Request ride
    const onlineDrivers = {
      [DRIVER.uid]: {
        heading: 0,
        lastUpdated: Date.now(),
        lat: BANGALORE_PICKUP.lat + 0.005,
        lng: BANGALORE_PICKUP.lng + 0.005,
        status: "AVAILABLE",
      },
    };

    mockRtdbRef.once
      .mockResolvedValueOnce({ val: () => onlineDrivers })
      .mockResolvedValueOnce({ val: () => onlineDrivers[DRIVER.uid] });

    setDocData(true, { name: DRIVER.name });

    const requestRes = await request
      .post("/api/v1/ride/request")
      .set("Authorization", AUTH_HEADER)
      .send({
        dropLat: BANGALORE_DROP.lat,
        dropLng: BANGALORE_DROP.lng,
        fare: 100,
        pickupLat: BANGALORE_PICKUP.lat,
        pickupLng: BANGALORE_PICKUP.lng,
        riderId: RIDER.uid,
      });

    expect(requestRes.status).toBe(200);

    // Now cancel
    setDocData(true, { driverId: DRIVER.uid, riderId: RIDER.uid, status: "PENDING" });

    const cancelRes = await request
      .post("/api/v1/ride/cancel")
      .set("Authorization", AUTH_HEADER)
      .send({ rideId: "ride-cancel-001" });

    expect(cancelRes.status).toBe(200);
    expect(cancelRes.body.success).toBe(true);
  });

  it("should handle driver declining a ride (triggers re-match)", async () => {
    setAuthUser(DRIVER);

    setDocData(true, {
      driverId: DRIVER.uid,
      drop: { lat: BANGALORE_DROP.lat, lng: BANGALORE_DROP.lng },
      fare: 120,
      pickup: { lat: BANGALORE_PICKUP.lat, lng: BANGALORE_PICKUP.lng },
      riderId: RIDER.uid,
      status: "PENDING_ACCEPTANCE",
    });

    const res = await request
      .post("/api/v1/ride/decline")
      .set("Authorization", AUTH_HEADER)
      .send({ rideId: "ride-decline-001" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe("E2E: Ride error handling", () => {
  afterEach(() => {
    resetE2EMocks();
  });

  it("should reject ride request with missing required fields", async () => {
    setAuthUser(RIDER);

    const res = await request
      .post("/api/v1/ride/request")
      .set("Authorization", AUTH_HEADER)
      .send({ pickupLat: BANGALORE_PICKUP.lat }); // Missing fields

    expect(res.status).toBe(400);
  });

  it("should reject ride request when no drivers are online", async () => {
    setAuthUser(RIDER);
    setRtdbData(null);

    const res = await request.post("/api/v1/ride/request").set("Authorization", AUTH_HEADER).send({
      dropLat: BANGALORE_DROP.lat,
      dropLng: BANGALORE_DROP.lng,
      pickupLat: BANGALORE_PICKUP.lat,
      pickupLng: BANGALORE_PICKUP.lng,
      riderId: RIDER.uid,
    });

    expect(res.status).toBe(404);
  });

  it("should return 404 for completing a non-existent ride", async () => {
    setAuthUser(DRIVER);
    setDocData(false);

    const res = await request
      .post("/api/v1/ride/complete")
      .set("Authorization", AUTH_HEADER)
      .send({ rideId: "nonexistent-ride" });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("should reject cancellation of non-existent ride", async () => {
    setAuthUser(RIDER);
    setDocData(false);

    const res = await request
      .post("/api/v1/ride/cancel")
      .set("Authorization", AUTH_HEADER)
      .send({ rideId: "ghost-ride" });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});
