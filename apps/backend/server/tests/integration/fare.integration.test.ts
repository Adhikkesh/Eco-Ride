/**
 * Integration Tests – Fare Estimate Endpoint
 */

import type { Express } from "express";
import supertest from "supertest";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { resetAllMocks } from "./setup.js";

let request: supertest.SuperTest<supertest.Test>;

beforeAll(async () => {
  const { app } = await import("../../src/app.js");
  request = supertest(app as Express);
});

describe("Fare Integration Tests", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.GOOGLE_API_KEY = "test-google-api-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetAllMocks();
  });

  describe("POST /api/v1/ride/estimate", () => {
    it("should return 400 when coordinates are missing", async () => {
      const res = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ pickup: { lat: 12.97 } });
      expect(res.status).toBe(400);
    });

    it("should return 500 when GOOGLE_API_KEY is missing", async () => {
      const key = process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      const res = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ drop: SAMPLE_DROP, pickup: SAMPLE_PICKUP });
      expect(res.status).toBe(500);
      process.env.GOOGLE_API_KEY = key;
    });

    it("should return fare estimate on success", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          routes: [
            {
              distanceMeters: 15000,
              duration: "1200s",
              polyline: { encodedPolyline: "mock_polyline_string" },
            },
          ],
        }),
        ok: true,
      }) as any;
      const res = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ drop: SAMPLE_DROP, pickup: SAMPLE_PICKUP });
      expect(res.status).toBe(200);
      expect(res.body.fare).toBeGreaterThan(0);
    });

    it("should apply pool discount for pooled rides", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          routes: [{ distanceMeters: 15000, duration: "1200s", polyline: {} }],
        }),
        ok: true,
      }) as any;
      const res1 = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ drop: SAMPLE_DROP, isPooled: false, pickup: SAMPLE_PICKUP });
      const res2 = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ drop: SAMPLE_DROP, isPooled: true, pickup: SAMPLE_PICKUP });
      expect(res2.body.fare).toBeLessThan(res1.body.fare);
    });

    it("should return 404 when no route is found", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => ({ routes: [] }),
        ok: true,
      }) as any;
      const res = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ drop: SAMPLE_DROP, pickup: SAMPLE_PICKUP });
      expect(res.status).toBe(404);
    });
  });
});
