/**
 * Integration Tests – Fare Estimate Endpoint
 *
 * Tests the fare calculation endpoint through the full Express HTTP stack.
 * The Google Routes API is mocked via global fetch.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AUTH_HEADER, request, SAMPLE_DROP, SAMPLE_PICKUP } from "./helpers.js";
import { resetAllMocks } from "./setup.js";

describe("Fare Integration Tests", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    // Reset env for each test
    process.env.GOOGLE_API_KEY = "test-google-api-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetAllMocks();
  });

  // ── POST /api/v1/ride/estimate ─────────────────────────────
  describe("POST /api/v1/ride/estimate", () => {
    it("should return 400 when coordinates are missing", async () => {
      const res = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ pickup: { lat: 12.97 } }); // missing lng, drop

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain("Invalid");
    });

    it("should return 500 when GOOGLE_API_KEY is missing", async () => {
      const originalKey = process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const res = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ drop: SAMPLE_DROP, pickup: SAMPLE_PICKUP });

      expect(res.status).toBe(500);
      expect(res.body.success).toBe(false);

      // Restore
      process.env.GOOGLE_API_KEY = originalKey;
    });

    it("should return fare estimate on success", async () => {
      // Mock fetch for Google Routes API
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          routes: [
            {
              distanceMeters: 15000, // 15 km
              duration: "1200s", // 20 minutes
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
      expect(res.body.success).toBe(true);
      expect(res.body.fare).toBeTypeOf("number");
      expect(res.body.fare).toBeGreaterThan(0);
      expect(res.body.distance_km).toBeDefined();
      expect(res.body.eta_min).toBeTypeOf("number");
      expect(res.body.polyline).toBe("mock_polyline_string");
      expect(res.body.co2_saved_g).toBeTypeOf("number");
      expect(res.body.currency).toBe("INR");
    });

    it("should apply pool discount for pooled rides", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        json: async () => ({
          routes: [
            {
              distanceMeters: 15000,
              duration: "1200s",
              polyline: { encodedPolyline: "mock_polyline" },
            },
          ],
        }),
        ok: true,
      }) as any;

      // Non-pooled fare
      const res1 = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ drop: SAMPLE_DROP, isPooled: false, pickup: SAMPLE_PICKUP });

      // Pooled fare
      const res2 = await request
        .post("/api/v1/ride/estimate")
        .set("Authorization", AUTH_HEADER)
        .send({ drop: SAMPLE_DROP, isPooled: true, pickup: SAMPLE_PICKUP });

      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      // Pooled fare should be less than non-pooled (20% discount)
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
      expect(res.body.success).toBe(false);
    });
  });
});
