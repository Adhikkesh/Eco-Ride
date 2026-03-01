/**
 * Integration Tests – Rating Endpoint
 *
 * Tests POST /api/v1/ride/rate endpoint covering:
 * - Missing required fields (rideId, driverId, rating)
 * - Unauthenticated/unauthorized access
 * - Successful rating submission
 * - Rating clamping (out-of-range values)
 * - Optional comment field
 */

import type { Express } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/firebase.js", async () => {
  const setup = await import("./setup.js");

  // Extend mockDb to support runTransaction for rating controller
  const extendedMockDb = {
    ...setup.mockDb,
    runTransaction: vi.fn(async (fn: (t: unknown) => Promise<void>) => {
      const mockTransaction = {
        get: vi.fn(async () => ({
          data: () => ({ rating: 4.0, rating_count: 5 }),
          exists: true,
        })),
        set: vi.fn(),
        update: vi.fn(),
      };
      return fn(mockTransaction);
    }),
  };

  return {
    auth: setup.mockAuth,
    db: extendedMockDb,
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
import { resetAllMocks, setMockUser } from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("Rating Integration Tests", () => {
  afterEach(() => {
    resetAllMocks();
  });

  describe("POST /api/v1/ride/rate", () => {
    it("should return 401 when user is not authenticated", async () => {
      setMockUser(null);
      const res = await request
        .post("/api/v1/ride/rate")
        .set("Authorization", AUTH_HEADER)
        .send({ driverId: "driver-1", rating: 5, rideId: "ride-1" });
      expect(res.status).toBe(401);
    });

    it("should return 400 when rideId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/rate")
        .set("Authorization", AUTH_HEADER)
        .send({ driverId: "driver-1", rating: 5 });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Missing required fields");
    });

    it("should return 400 when driverId is missing", async () => {
      const res = await request
        .post("/api/v1/ride/rate")
        .set("Authorization", AUTH_HEADER)
        .send({ rating: 5, rideId: "ride-1" });
      expect(res.status).toBe(400);
      expect(res.body.message).toContain("Missing required fields");
    });

    it("should return 400 when rating is missing", async () => {
      const res = await request
        .post("/api/v1/ride/rate")
        .set("Authorization", AUTH_HEADER)
        .send({ driverId: "driver-1", rideId: "ride-1" });
      expect(res.status).toBe(400);
    });

    it("should return 400 when all fields are missing", async () => {
      const res = await request
        .post("/api/v1/ride/rate")
        .set("Authorization", AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it("should submit rating successfully with valid data", async () => {
      const res = await request.post("/api/v1/ride/rate").set("Authorization", AUTH_HEADER).send({
        driverId: "driver-1",
        rating: 5,
        rideId: "ride-1",
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toContain("Rating submitted successfully");
    });

    it("should submit rating with optional comment", async () => {
      const res = await request.post("/api/v1/ride/rate").set("Authorization", AUTH_HEADER).send({
        comment: "Great driver, very safe!",
        driverId: "driver-1",
        rating: 4,
        rideId: "ride-1",
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should accept rating of 0 (valid — clamped to 1)", async () => {
      const res = await request.post("/api/v1/ride/rate").set("Authorization", AUTH_HEADER).send({
        driverId: "driver-1",
        rating: 0,
        rideId: "ride-1",
      });
      // rating=0 passes the `rating === undefined` check, so should succeed
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should handle boundary rating value of 1", async () => {
      const res = await request.post("/api/v1/ride/rate").set("Authorization", AUTH_HEADER).send({
        driverId: "driver-1",
        rating: 1,
        rideId: "ride-1",
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should handle high out-of-range rating (clamped to 5)", async () => {
      const res = await request.post("/api/v1/ride/rate").set("Authorization", AUTH_HEADER).send({
        driverId: "driver-1",
        rating: 10,
        rideId: "ride-1",
      });
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should return 401 when no Authorization header is sent", async () => {
      const res = await request
        .post("/api/v1/ride/rate")
        .send({ driverId: "driver-1", rating: 5, rideId: "ride-1" });
      expect(res.status).toBe(401);
    });
  });
});
