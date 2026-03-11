/**
 * E2E Tests – Pooling & Prediction Endpoints
 *
 * Tests:
 *   1. Pool ride request flow
 *   2. Pool status check
 *   3. Pool accept / decline
 *   4. Demand prediction endpoints (surge, heatmap, forecast)
 *   5. Cross-cutting error scenarios
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

// Mock axios for prediction service calls
vi.mock("axios", async () => {
  return {
    default: {
      post: vi.fn(async () => ({
        data: {
          heatmap: [
            { demand: 80, lat: 12.97, lng: 77.59 },
            { demand: 60, lat: 12.93, lng: 77.62 },
          ],
          predicted_demand: 75,
          predictions: Array.from({ length: 24 }, (_, i) => ({
            hour: i,
            predicted_demand: 50 + Math.random() * 50,
            surge_multiplier: 1 + Math.random(),
          })),
          surge_multiplier: 1.3,
        },
        status: 200,
      })),
    },
  };
});

import {
  AUTH_HEADER,
  BANGALORE_DROP,
  BANGALORE_PICKUP,
  DRIVER,
  RIDER,
  resetE2EMocks,
  setAuthUser,
  setDocData,
} from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("E2E: Ride Pooling Flow", () => {
  afterEach(() => {
    resetE2EMocks();
  });

  it("should request a pooled ride", async () => {
    setAuthUser(RIDER);

    const res = await request.post("/api/v1/pool/request").set("Authorization", AUTH_HEADER).send({
      dropLat: BANGALORE_DROP.lat,
      dropLng: BANGALORE_DROP.lng,
      pickupLat: BANGALORE_PICKUP.lat,
      pickupLng: BANGALORE_PICKUP.lng,
      riderId: RIDER.uid,
    });

    // Pool request may succeed or return "no pools available"
    expect([200, 404]).toContain(res.status);
  });

  it("should check pool status", async () => {
    setAuthUser(RIDER);

    const res = await request.get("/api/v1/pool/status").set("Authorization", AUTH_HEADER).query({
      dropLat: BANGALORE_DROP.lat,
      dropLng: BANGALORE_DROP.lng,
      pickupLat: BANGALORE_PICKUP.lat,
      pickupLng: BANGALORE_PICKUP.lng,
    });

    expect([200, 404]).toContain(res.status);
  });

  it("should accept a pool offer as driver", async () => {
    setAuthUser(DRIVER);

    setDocData(true, {
      driverId: DRIVER.uid,
      poolOfferId: "pool-offer-001",
      status: "EN_ROUTE",
    });

    const res = await request.post("/api/v1/pool/accept").set("Authorization", AUTH_HEADER).send({
      driverId: DRIVER.uid,
      poolOfferId: "pool-offer-001",
    });

    expect([200, 400, 404]).toContain(res.status);
  });

  it("should decline a pool offer as driver", async () => {
    setAuthUser(DRIVER);

    const res = await request.post("/api/v1/pool/decline").set("Authorization", AUTH_HEADER).send({
      driverId: DRIVER.uid,
      poolOfferId: "pool-offer-001",
    });

    expect([200, 400, 404]).toContain(res.status);
  });
});

describe("E2E: Demand Prediction Endpoints", () => {
  afterEach(() => {
    resetE2EMocks();
  });

  it("should get surge prediction", async () => {
    const res = await request.post("/api/v1/predict/surge").send({
      day_of_week: new Date().getDay(),
      hour: new Date().getHours(),
      lat: BANGALORE_PICKUP.lat,
      lng: BANGALORE_PICKUP.lng,
    });

    expect(res.status).toBe(200);
  });

  it("should get demand prediction", async () => {
    const res = await request.post("/api/v1/predict/demand").send({
      day_of_week: 3,
      hour: 14,
      lat: BANGALORE_PICKUP.lat,
      lng: BANGALORE_PICKUP.lng,
    });

    expect(res.status).toBe(200);
  });

  it("should get demand heatmap", async () => {
    const res = await request.post("/api/v1/predict/demand-heatmap").send({
      lat: BANGALORE_PICKUP.lat,
      lng: BANGALORE_PICKUP.lng,
      radius: 5,
    });

    expect(res.status).toBe(200);
  });

  it("should get 24-hour forecast", async () => {
    const res = await request.post("/api/v1/predict/forecast-24h").send({
      day_of_week: 3,
    });

    expect(res.status).toBe(200);
  });
});

describe("E2E: Cross-cutting Auth Failures", () => {
  afterEach(() => {
    resetE2EMocks();
  });

  it("all protected endpoints should return 401 without auth", async () => {
    const protectedEndpoints = [
      { method: "get" as const, path: "/api/v1/auth/verify" },
      { method: "get" as const, path: "/api/v1/getme" },
      { method: "post" as const, path: "/api/v1/user" },
      { method: "get" as const, path: "/api/v1/user/driver-status" },
      { method: "post" as const, path: "/api/v1/ride/request" },
      { method: "post" as const, path: "/api/v1/ride/accept" },
      { method: "post" as const, path: "/api/v1/ride/cancel" },
      { method: "post" as const, path: "/api/v1/ride/start" },
      { method: "post" as const, path: "/api/v1/ride/complete" },
      { method: "post" as const, path: "/api/v1/payment/create-intent" },
      { method: "post" as const, path: "/api/v1/ride/rate" },
      { method: "post" as const, path: "/api/v1/pool/request" },
    ];

    for (const endpoint of protectedEndpoints) {
      const res = await request[endpoint.method](endpoint.path);
      expect(res.status).toBe(401);
    }
  });

  it("multiple sequential requests should all be authenticated independently", async () => {
    setAuthUser(RIDER);

    // First request should work
    const res1 = await request.get("/api/v1/health");
    expect(res1.status).toBe(200);

    // Auth verify should work
    const res2 = await request.get("/api/v1/auth/verify").set("Authorization", AUTH_HEADER);
    expect(res2.status).toBe(200);

    // Health (no auth needed) should still work
    const res3 = await request.get("/api/v1/health");
    expect(res3.status).toBe(200);
  });
});
