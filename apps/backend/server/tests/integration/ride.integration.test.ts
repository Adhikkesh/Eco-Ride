/**
 * Integration Tests – Ride Endpoints
 *
 * Tests ride lifecycle endpoints (request, accept, decline, start, cancel,
 * complete, active, OTP) through the full Express HTTP stack.
 */

import { afterEach, describe, expect, it } from "vitest";
import { AUTH_HEADER, request, SAMPLE_DROP, SAMPLE_PICKUP } from "./helpers.js";
import {
  mockDb,
  mockRtdbRef,
  resetAllMocks,
  setMockDoc,
  setMockQuerySnapshot,
  setMockRtdbData,
  setMockUser,
} from "./setup.js";

describe("Ride Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  // ── POST /api/v1/ride/request ──────────────────────────────
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
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("riderId");
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
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("coordinates");
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
      expect(res.body.success).toBe(false);
    });

    it("should successfully request a ride when drivers are available", async () => {
      // Mock RTDB: first call returns drivers, subsequent calls return individual driver
      const driversData = {
        "driver-1": {
          heading: 0,
          lastUpdated: Date.now(),
          lat: SAMPLE_PICKUP.lat + 0.01, // ~1km away
          lng: SAMPLE_PICKUP.lng + 0.01,
          status: "AVAILABLE",
        },
      };

      // Mock RTDB ref calls
      mockRtdbRef.once
        .mockResolvedValueOnce({ val: () => driversData }) // drivers-online
        .mockResolvedValueOnce({
          val: () => ({
            heading: 0,
            lastUpdated: Date.now(),
            lat: SAMPLE_PICKUP.lat + 0.01,
            lng: SAMPLE_PICKUP.lng + 0.01,
            status: "AVAILABLE",
          }),
        }); // individual driver re-check

      // Mock Firestore doc for driver name lookup
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
      expect(res.body.rideId).toBeDefined();
      expect(res.body.driverId).toBe("driver-1");
      expect(res.body.status).toBe("PENDING_ACCEPTANCE");
    });
  });

  // ── POST /api/v1/ride/cancel ───────────────────────────────
  describe("POST /api/v1/ride/cancel", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/cancel")
        .set("Authorization", AUTH_HEADER)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 404 when ride does not exist", async () => {
      setMockDoc(false);

      const res = await request
        .post("/api/v1/ride/cancel")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "nonexistent-ride" });

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should cancel ride successfully", async () => {
      setMockDoc(true, { driverId: "driver-1" });

      const res = await request
        .post("/api/v1/ride/cancel")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("cancelled");
    });
  });

  // ── POST /api/v1/ride/start ────────────────────────────────
  describe("POST /api/v1/ride/start", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/start")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "1234" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 when OTP is missing", async () => {
      const res = await request
        .post("/api/v1/ride/start")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 400 for invalid OTP", async () => {
      setMockDoc(true, { driverId: "driver-1", otp: "1234" });

      const res = await request
        .post("/api/v1/ride/start")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "9999", rideId: "ride-123" });

      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Invalid OTP");
    });

    it("should start ride with correct OTP", async () => {
      setMockDoc(true, { driverId: "driver-1", otp: "5678" });

      const res = await request
        .post("/api/v1/ride/start")
        .set("Authorization", AUTH_HEADER)
        .send({ otp: "5678", rideId: "ride-123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Ride started");
    });
  });

  // ── POST /api/v1/ride/complete ─────────────────────────────
  describe("POST /api/v1/ride/complete", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/complete")
        .set("Authorization", AUTH_HEADER)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should complete ride successfully", async () => {
      setMockDoc(true, { driverId: "driver-1" });

      const res = await request
        .post("/api/v1/ride/complete")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Ride completed");
    });
  });

  // ── GET /api/v1/ride/active ────────────────────────────────
  describe("GET /api/v1/ride/active", () => {
    it("should return 404 when no active ride exists", async () => {
      setMockQuerySnapshot([]);

      const res = await request.get("/api/v1/ride/active").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);

      const res = await request.get("/api/v1/ride/active").set("Authorization", AUTH_HEADER);

      expect(res.status).toBe(401);
    });
  });

  // ── POST /api/v1/ride/accept ───────────────────────────────
  describe("POST /api/v1/ride/accept", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/accept")
        .set("Authorization", AUTH_HEADER)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
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
      expect(res.body.success).toBe(false);
    });

    it("should accept ride successfully when driver matches", async () => {
      setMockDoc(true, {
        driverId: "test-user-uid-123",
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
      expect(res.body.message).toContain("accepted");
    });
  });

  // ── POST /api/v1/ride/decline ──────────────────────────────
  describe("POST /api/v1/ride/decline", () => {
    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/decline")
        .set("Authorization", AUTH_HEADER)
        .send({});

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it("should return 403 when driver is not assigned to this ride", async () => {
      setMockDoc(true, {
        driverId: "other-driver",
        status: "PENDING_ACCEPTANCE",
      });

      const res = await request
        .post("/api/v1/ride/decline")
        .set("Authorization", AUTH_HEADER)
        .send({ rideId: "ride-123" });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
    });
  });
});
