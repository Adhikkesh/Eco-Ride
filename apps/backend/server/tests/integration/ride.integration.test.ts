/**
 * Integration Tests – Ride Endpoints
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

import { AUTH_HEADER, SAMPLE_DROP, SAMPLE_PICKUP } from "./helpers.js";
import {
  mockRtdbRef,
  resetAllMocks,
  setMockDoc,
  setMockQuerySnapshot,
  setMockRtdbData,
  setMockUser,
} from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("Ride Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  describe("POST /api/v1/ride/request", () => {
    it("should return 400 when riderId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/request")
        .set("Authorization", AUTH_HEADER)
        .send({
          dropLat: SAMPLE_DROP.lat,
          dropLng: SAMPLE_DROP.lng,
          pickupLat: SAMPLE_PICKUP.lat,
          pickupLng: SAMPLE_PICKUP.lng,
        });
      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid coordinates", async () => {
      const res = await request
        .post("/api/v1/ride/request")
        .set("Authorization", AUTH_HEADER)
        .send({
          dropLat: SAMPLE_DROP.lat,
          dropLng: SAMPLE_DROP.lng,
          pickupLat: "invalid",
          pickupLng: SAMPLE_PICKUP.lng,
          riderId: "rider-1",
        });
      expect(res.status).toBe(400);
    });

    it("should return 404 when no drivers are online", async () => {
      setMockRtdbData(null);
      const res = await request
        .post("/api/v1/ride/request")
        .set("Authorization", AUTH_HEADER)
        .send({
          dropLat: SAMPLE_DROP.lat,
          dropLng: SAMPLE_DROP.lng,
          pickupLat: SAMPLE_PICKUP.lat,
          pickupLng: SAMPLE_PICKUP.lng,
          riderId: "rider-1",
        });
      expect(res.status).toBe(404);
    });

    it("should successfully request a ride when drivers are available", async () => {
      const driversData = {
        "driver-1": {
          heading: 0,
          lastUpdated: Date.now(),
          lat: SAMPLE_PICKUP.lat + 0.01,
          lng: SAMPLE_PICKUP.lng + 0.01,
          status: "AVAILABLE",
        },
      };

      mockRtdbRef.once.mockResolvedValueOnce({ val: () => driversData }).mockResolvedValueOnce({
        val: () => driversData["driver-1"],
      });

      setMockDoc(true, { name: "Driver One" });

      const res = await request
        .post("/api/v1/ride/request")
        .set("Authorization", AUTH_HEADER)
        .send({
          dropLat: SAMPLE_DROP.lat,
          dropLng: SAMPLE_DROP.lng,
          fare: 250,
          pickupLat: SAMPLE_PICKUP.lat,
          pickupLng: SAMPLE_PICKUP.lng,
          riderId: "rider-1",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.driverId).toBe("driver-1");
    });
  });

  describe("POST /api/v1/ride/cancel", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/cancel")
        .set("Authorization", AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should return 404 when ride does not exist", async () => {
      setMockDoc(false);
      const res = await request
        .post("/api/v1/ride/cancel")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "nonexistent-ride" });
      expect(res.status).toBe(404);
    });

    it("should cancel ride successfully", async () => {
      setMockDoc(true, { driverId: "driver-1" });
      const res = await request
        .post("/api/v1/ride/cancel")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /api/v1/ride/start", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/start")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "1234" });
      expect(res.status).toBe(400);
    });

    it("should return 400 when OTP is missing", async () => {
      const res = await request
        .post("/api/v1/ride/start")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(400);
    });

    it("should return 400 for invalid OTP", async () => {
      setMockDoc(true, { driverId: "driver-1", otp: "1234" });
      const res = await request
        .post("/api/v1/ride/start")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "9999", rideId: "ride-123" });
      expect(res.status).toBe(400);
    });

    it("should start ride with correct OTP", async () => {
      setMockDoc(true, { driverId: "driver-1", otp: "5678" });
      const res = await request
        .post("/api/v1/ride/start")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "5678", rideId: "ride-123" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /api/v1/ride/complete", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/complete")
        .set("Authorization", AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should complete ride successfully", async () => {
      setMockDoc(true, { driverId: "driver-1" });
      const res = await request
        .post("/api/v1/ride/complete")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("GET /api/v1/ride/active", () => {
    it("should return 404 when no active ride exists", async () => {
      setMockQuerySnapshot([]);
      const res = await request.get("/api/v1/ride/active").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);
      const res = await request.get("/api/v1/ride/active").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(401);
    });
  });

  describe("POST /api/v1/ride/accept", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/accept")
        .set("Authorization", AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should return 403 when driver is not assigned to this ride", async () => {
      setMockDoc(true, {
        driverId: "other-driver",
        status: "PENDING_ACCEPTANCE",
      });
      const res = await request
        .post("/api/v1/ride/accept")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(403);
    });

    it("should accept ride successfully when driver matches", async () => {
      setMockDoc(true, {
        driverId: "test-user-uid-123", // Matches current mock user
        drop: SAMPLE_DROP,
        pickup: SAMPLE_PICKUP,
        riderId: "rider-1",
        status: "PENDING_ACCEPTANCE",
      });
      const res = await request
        .post("/api/v1/ride/accept")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("POST /api/v1/ride/decline", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/decline")
        .set("Authorization", AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should return 403 when driver is not assigned", async () => {
      setMockDoc(true, {
        driverId: "other-driver",
        status: "PENDING_ACCEPTANCE",
      });
      const res = await request
        .post("/api/v1/ride/decline")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(403);
    });
  });
});
