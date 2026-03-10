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
      setMockDoc(true, { driverId: "driver-1", otp: "5678", status: "MATCHED" });
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

    it("should accept pooled second rider when driver is already on a trip", async () => {
      // Second rider's Firestore ride document
      setMockDoc(true, {
        driverId: "test-user-uid-123",
        driverName: "Test Driver",
        drop: SAMPLE_DROP,
        pickup: SAMPLE_PICKUP,
        riderId: "rider-2",
        riderName: "Rider Two",
        riderPhone: "555-0002",
        status: "PENDING_ACCEPTANCE",
      });

      // First call to RTDB once("value"): rides-assigned — driver already has a first ride
      mockRtdbRef.once.mockResolvedValueOnce({
        val: () => ({
          drop: { lat: 12.5, lng: 77.5 },
          pickup: { lat: 12.0, lng: 77.0 },
          rideId: "first-ride-id",
          riderId: "rider-1",
          riderName: "Rider One",
          riderPhone: "555-0001",
          status: "IN_PROGRESS",
          timestamp: Date.now() - 60000,
        }),
      });

      // Second call to RTDB once("value"): drivers-online — driver is BUSY (on trip)
      mockRtdbRef.once.mockResolvedValueOnce({
        val: () => ({
          heading: 0,
          lastUpdated: Date.now(),
          lat: 12.3,
          lng: 77.3,
          status: "BUSY",
        }),
      });

      const res = await request
        .post("/api/v1/ride/accept")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "second-ride-id" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 422 when second rides drop/pickup coords are missing", async () => {
      setMockDoc(true, {
        driverId: "test-user-uid-123",
        riderId: "rider-2",
        status: "PENDING_ACCEPTANCE",
        // intentionally missing drop / pickup
      });

      // No RTDB mock needed — acceptRide returns 422 before any RTDB read

      const res = await request
        .post("/api/v1/ride/accept")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "second-ride-id" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
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

    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);
      const res = await request
        .post("/api/v1/ride/decline")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(401);
    });
  });

  // ─── POST /ride/arrive ─────────────────────────────────────────────────────

  describe("POST /api/v1/ride/arrive", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/arrive")
        .set("Authorization", AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);
      const res = await request
        .post("/api/v1/ride/arrive")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(401);
    });

    it("should return 404 when ride does not exist", async () => {
      setMockDoc(false);
      const res = await request
        .post("/api/v1/ride/arrive")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "nonexistent-ride" });
      expect(res.status).toBe(404);
    });

    it("should return 403 when driver is not authorized for this ride", async () => {
      setMockDoc(true, {
        driverId: "another-driver",
        status: "MATCHED",
      });
      const res = await request
        .post("/api/v1/ride/arrive")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(403);
    });

    it("should return 400 when ride is not in MATCHED status", async () => {
      setMockDoc(true, {
        driverId: "test-user-uid-123",
        status: "IN_PROGRESS",
      });
      const res = await request
        .post("/api/v1/ride/arrive")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(400);
    });

    it("should mark arrival successfully when driver matches", async () => {
      setMockDoc(true, {
        driverId: "test-user-uid-123",
        status: "MATCHED",
      });
      const res = await request
        .post("/api/v1/ride/arrive")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Arrival marked");
    });
  });

  // ─── GET /ride/otp/:rideId ─────────────────────────────────────────────────

  describe("GET /api/v1/ride/otp/:rideId", () => {
    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);
      const res = await request.get("/api/v1/ride/otp/ride-123").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(401);
    });

    it("should return 404 when ride does not exist", async () => {
      setMockDoc(false);
      const res = await request.get("/api/v1/ride/otp/ride-123").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it("should return 403 when user is not rider or driver of the ride", async () => {
      setMockDoc(true, {
        driverId: "other-driver",
        otp: "1234",
        riderId: "other-rider",
        status: "MATCHED",
      });
      const res = await request.get("/api/v1/ride/otp/ride-123").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(403);
    });

    it("should return 400 when ride status is not MATCHED or ARRIVED", async () => {
      setMockDoc(true, {
        driverId: "test-user-uid-123",
        otp: "1234",
        riderId: "test-user-uid-123",
        status: "IN_PROGRESS",
      });
      const res = await request.get("/api/v1/ride/otp/ride-123").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(400);
    });

    it("should return OTP when rider is authorized and driver arrived", async () => {
      setMockDoc(true, {
        driverId: "driver-1",
        otp: "5678",
        pickup: { lat: 12.97, lng: 77.59 },
        riderId: "test-user-uid-123",
        status: "ARRIVED",
      });
      // Mock RTDB for driver location (close to pickup)
      setMockRtdbData({ lat: 12.97, lng: 77.59 });
      const res = await request.get("/api/v1/ride/otp/ride-123").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.otpAvailable).toBe(true);
      expect(res.body.otp).toBe("5678");
    });

    it("should not reveal OTP to rider when driver is far away (MATCHED status)", async () => {
      setMockDoc(true, {
        driverId: "driver-1",
        otp: "5678",
        pickup: { lat: 12.97, lng: 77.59 },
        riderId: "test-user-uid-123",
        status: "MATCHED",
      });
      // Mock RTDB for driver location (far from pickup)
      setMockRtdbData({ lat: 13.0, lng: 77.6 });
      const res = await request.get("/api/v1/ride/otp/ride-123").set("Authorization", AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.otpAvailable).toBe(false);
    });
  });

  // ─── POST /ride/verify-otp/:rideId ─────────────────────────────────────────

  describe("POST /api/v1/ride/verify-otp/:rideId", () => {
    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);
      const res = await request
        .post("/api/v1/ride/verify-otp/ride-123")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "1234" });
      expect(res.status).toBe(401);
    });

    it("should return 400 when OTP is missing", async () => {
      const res = await request
        .post("/api/v1/ride/verify-otp/ride-123")
        .set("Authorization", AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should return 404 when ride does not exist", async () => {
      setMockDoc(false);
      const res = await request
        .post("/api/v1/ride/verify-otp/ride-123")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "1234" });
      expect(res.status).toBe(404);
    });

    it("should return 400 when ride status is not MATCHED or ARRIVED", async () => {
      setMockDoc(true, { otp: "1234", status: "IN_PROGRESS" });
      const res = await request
        .post("/api/v1/ride/verify-otp/ride-123")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "1234" });
      expect(res.status).toBe(400);
    });

    it("should return 400 when OTP is incorrect", async () => {
      setMockDoc(true, { otp: "1234", status: "MATCHED" });
      const res = await request
        .post("/api/v1/ride/verify-otp/ride-123")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "9999" });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Invalid OTP");
    });

    it("should verify OTP successfully with correct code", async () => {
      setMockDoc(true, { otp: "5678", status: "ARRIVED" });
      const res = await request
        .post("/api/v1/ride/verify-otp/ride-123")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "5678" });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("OTP verified successfully");
    });
  });

  // ─── Auth guard tests for all endpoints ────────────────────────────────────

  describe("Authentication guards", () => {
    it("should return 401 for POST /ride/request without auth", async () => {
      const res = await request.post("/api/v1/ride/request").send({});
      expect(res.status).toBe(401);
    });

    it("should return 401 for POST /ride/cancel without auth", async () => {
      const res = await request.post("/api/v1/ride/cancel").send({});
      expect(res.status).toBe(401);
    });

    it("should return 401 for POST /ride/start without auth", async () => {
      const res = await request.post("/api/v1/ride/start").send({});
      expect(res.status).toBe(401);
    });

    it("should return 401 for POST /ride/complete without auth", async () => {
      const res = await request.post("/api/v1/ride/complete").send({});
      expect(res.status).toBe(401);
    });

    it("should return 401 for POST /ride/accept without auth", async () => {
      const res = await request.post("/api/v1/ride/accept").send({});
      expect(res.status).toBe(401);
    });

    it("should return 401 for POST /ride/arrive without auth", async () => {
      const res = await request.post("/api/v1/ride/arrive").send({});
      expect(res.status).toBe(401);
    });

    it("should return 401 for GET /ride/active without auth", async () => {
      const res = await request.get("/api/v1/ride/active");
      expect(res.status).toBe(401);
    });

    it("should return 401 for GET /ride/otp/:rideId without auth", async () => {
      const res = await request.get("/api/v1/ride/otp/ride-123");
      expect(res.status).toBe(401);
    });

    it("should return 401 for POST /ride/verify-otp/:rideId without auth", async () => {
      const res = await request.post("/api/v1/ride/verify-otp/ride-123").send({});
      expect(res.status).toBe(401);
    });
  });
});
