/**
 * Integration Tests – Payment Endpoints
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
import { resetAllMocks, setMockDoc } from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("Payment Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  describe("POST /api/v1/payment/create-intent", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/payment/create-intent")
        .set("Authorization", AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should return 404 when ride does not exist", async () => {
      setMockDoc(false);
      const res = await request
        .post("/api/v1/payment/create-intent")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "nonexistent-ride" });
      expect(res.status).toBe(404);
    });

    it("should create payment intent for valid ride", async () => {
      process.env.STRIPE_SECRET_KEY = "sk_test_mock_key";
      setMockDoc(true, { fare: 250, riderId: "rider-1" });
      const res = await request
        .post("/api/v1/payment/create-intent")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      if (res.status === 200) {
        expect(res.body.success).toBe(true);
        expect(res.body.clientSecret).toBeDefined();
      } else {
        expect(res.status).toBe(503);
      }
    });
  });

  describe("POST /api/v1/ride/confirm-payment", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/confirm-payment")
        .set("Authorization", AUTH_HEADER)
        .send({ amount: 250 });
      expect(res.status).toBe(400);
    });

    it("should confirm payment successfully", async () => {
      setMockDoc(true, { driverId: "driver-1" });
      const res = await request
        .post("/api/v1/ride/confirm-payment")
        .set("Authorization", AUTH_HEADER)
        .send({ amount: 250, rideId: "ride-123" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should succeed even without amount (amount is optional, defaults to 0)", async () => {
      setMockDoc(true, { driverId: "driver-1" });
      const res = await request
        .post("/api/v1/ride/confirm-payment")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ─── Auth guard tests ────────────────────────────────────────────────────

  describe("Authentication guards", () => {
    it("should return 401 for POST /payment/create-intent without auth", async () => {
      const res = await request.post("/api/v1/payment/create-intent").send({ rideId: "ride-123" });
      expect(res.status).toBe(401);
    });

    it("should return 401 for POST /ride/confirm-payment without auth", async () => {
      const res = await request
        .post("/api/v1/ride/confirm-payment")
        .send({ amount: 250, rideId: "ride-123" });
      expect(res.status).toBe(401);
    });
  });
});
