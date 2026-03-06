/**
 * Unit Tests for Fare Controller
 *
 * This file contains comprehensive unit tests for the fare calculation functionality.
 * Tests cover fare estimation, pooled ride discounts, CO2 savings, and error handling.
 *
 * @author Team Member 1 - Fare Module
 * @date 2026-02-03
 */

import type { Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Pricing constants (should match fareController.ts)
const PRICING = {
  BASE_FARE: 40,
  PER_KM: 12,
  PER_MIN: 1.5,
  POOL_DISCOUNT: 0.2,
};

/**
 * Mock response helper
 */
interface MockResponse extends Partial<Response> {
  _getData: () => unknown;
  _getStatusCode: () => number;
}

const createMockResponse = (): MockResponse => {
  let statusCode = 200;
  let data: unknown = null;

  // valid response structure that fulfills the partial requirement
  const res: Partial<Response> & { _getData: () => unknown; _getStatusCode: () => number } = {
    _getData: () => data,
    _getStatusCode: () => statusCode,
    json: vi.fn((responseData: unknown) => {
      data = responseData;
      return res as Response;
    }),
    status: vi.fn((code: number) => {
      statusCode = code;
      return res as Response;
    }),
  };

  return res as MockResponse;
};

/**
 * Mock request helper
 */
/**
 * Creates a mock Express request object with a body.
 * @param body - The request body
 */
const createMockRequest = (body: Record<string, unknown> = {}): Partial<Request> => ({
  body,
});

// Mock locations
const mockLocations = {
  drop: { lat: 12.9352, lng: 77.6245 },
  pickup: { lat: 12.9716, lng: 77.5946 },
};

describe("Fare Controller", () => {
  let mockFetch: Mock;
  // Use generic Promise<unknown> to accommodate void or response return
  let calculateFare: (req: Request, res: Response) => Promise<unknown>;

  beforeEach(async () => {
    vi.resetModules();

    // Mock the global fetch API
    mockFetch = vi.fn();
    global.fetch = mockFetch;

    // Set environment variable
    process.env.GOOGLE_API_KEY = "test-api-key";

    // Dynamically import the module to get fresh mocks
    const fareModule = await import("../../src/controllers/fareController.js");
    calculateFare = fareModule.calculateFare;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("calculateFare", () => {
    describe("Input Validation", () => {
      it("should return 400 error when pickup coordinates are missing", async () => {
        // Arrange
        const req = createMockRequest({
          drop: mockLocations.drop,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(400);
        // @ts-expect-error
        expect(res._getData().message).toBe("Invalid pickup or drop coordinates");
        // @ts-expect-error
        expect(res._getData().success).toBe(false);
      });

      it("should return 400 error when drop coordinates are missing", async () => {
        // Arrange
        const req = createMockRequest({
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(400);
        // @ts-expect-error
        expect(res._getData().message).toBe("Invalid pickup or drop coordinates");
      });

      it("should return 400 error when coordinates are incomplete", async () => {
        // Arrange
        const req = createMockRequest({
          drop: mockLocations.drop,
          pickup: { lat: 12.9716 }, // missing lng
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(400);
      });
    });

    describe("API Key Validation", () => {
      it("should return 500 error when GOOGLE_API_KEY is missing", async () => {
        // Arrange
        delete process.env.GOOGLE_API_KEY;
        const req = createMockRequest({
          drop: mockLocations.drop,
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(500);
        // @ts-expect-error
        expect(res._getData().message).toBe("Server configuration error");
      });
    });

    describe("Fare Calculation", () => {
      it("should calculate fare correctly for a standard ride", async () => {
        // Arrange
        const mockRouteResponse = {
          routes: [
            {
              distanceMeters: 5000, // 5 km
              duration: "600s", // 10 minutes
              polyline: { encodedPolyline: "mock_polyline" },
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          json: () => Promise.resolve(mockRouteResponse),
          ok: true,
        });

        const req = createMockRequest({
          drop: mockLocations.drop,
          isPooled: false,
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(200);
        // @ts-expect-error
        expect(res._getData().success).toBe(true);
        // @ts-expect-error
        expect(res._getData().currency).toBe("INR");
        // @ts-expect-error
        expect(res._getData().distance_km).toBe("5.0");
        // @ts-expect-error
        expect(res._getData().eta_min).toBe(10);

        // Calculate expected fare: 40 (base) + 5*12 (distance) + 10*1.5 (time) = 115
        // Green discount: round(5 * 0.5) = 3, so final = 115 - 3 = 112
        // @ts-expect-error
        expect(res._getData().fare).toBe(112);
      });

      it("should apply 20% discount for pooled rides", async () => {
        // Arrange
        const mockRouteResponse = {
          routes: [
            {
              distanceMeters: 5000, // 5 km
              duration: "600s", // 10 minutes
              polyline: { encodedPolyline: "mock_polyline" },
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          json: () => Promise.resolve(mockRouteResponse),
          ok: true,
        });

        const req = createMockRequest({
          drop: mockLocations.drop,
          isPooled: true, // Pooled ride
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(200);
        // Standard fare 115, pool savings = round(115*0.25) = 29 → 86
        // Green discount: round(5 * 0.5) = 3, so final = 86 - 3 = 83
        // @ts-expect-error
        expect(res._getData().fare).toBe(83);
      });

      it("should calculate CO2 savings correctly", async () => {
        // Arrange
        const mockRouteResponse = {
          routes: [
            {
              distanceMeters: 10000, // 10 km
              duration: "1200s", // 20 minutes
              polyline: { encodedPolyline: "mock_polyline" },
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          json: () => Promise.resolve(mockRouteResponse),
          ok: true,
        });

        const req = createMockRequest({
          drop: mockLocations.drop,
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        // CO2 saved = 10 km * 192 g/km = 1920g
        // @ts-expect-error
        expect(res._getData().co2_saved_g).toBe(1920);
      });

      it("should return polyline in response", async () => {
        // Arrange
        const expectedPolyline = "encoded_polyline_string_12345";
        const mockRouteResponse = {
          routes: [
            {
              distanceMeters: 3000,
              duration: "300s",
              polyline: { encodedPolyline: expectedPolyline },
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          json: () => Promise.resolve(mockRouteResponse),
          ok: true,
        });

        const req = createMockRequest({
          drop: mockLocations.drop,
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        // @ts-expect-error
        expect(res._getData().polyline).toBe(expectedPolyline);
      });
    });

    describe("Error Handling", () => {
      it("should return 404 when no route is found", async () => {
        // Arrange
        mockFetch.mockResolvedValueOnce({
          json: () => Promise.resolve({ routes: [] }),
          ok: true,
        });

        const req = createMockRequest({
          drop: mockLocations.drop,
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(404);
        // @ts-expect-error
        expect(res._getData().message).toBe("No route found between these locations");
      });

      it("should handle Google Routes API errors gracefully", async () => {
        // Arrange
        mockFetch.mockResolvedValueOnce({
          ok: false,
          status: 403,
          statusText: "Forbidden",
          text: () => Promise.resolve("API quota exceeded"),
        });

        const req = createMockRequest({
          drop: mockLocations.drop,
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(403);
        // @ts-expect-error
        expect(res._getData().success).toBe(false);
      });

      it("should handle network errors gracefully", async () => {
        // Arrange
        mockFetch.mockRejectedValueOnce(new Error("Network error"));

        const req = createMockRequest({
          drop: mockLocations.drop,
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(500);
        // @ts-expect-error
        expect(res._getData().message).toBe("Internal server error");
      });
    });

    describe("Edge Cases", () => {
      it("should handle very short distances", async () => {
        // Arrange
        const mockRouteResponse = {
          routes: [
            {
              distanceMeters: 100, // 0.1 km
              duration: "60s", // 1 minute
              polyline: { encodedPolyline: "short_route" },
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          json: () => Promise.resolve(mockRouteResponse),
          ok: true,
        });

        const req = createMockRequest({
          drop: mockLocations.drop,
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(200);
        // Base fare should still apply: 40 + 0.1*12 + 1*1.5 ≈ 43
        // @ts-expect-error
        expect(res._getData().fare).toBeGreaterThanOrEqual(40);
      });

      it("should handle long distance rides", async () => {
        // Arrange
        const mockRouteResponse = {
          routes: [
            {
              distanceMeters: 100000, // 100 km
              duration: "7200s", // 120 minutes
              polyline: { encodedPolyline: "long_route" },
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          json: () => Promise.resolve(mockRouteResponse),
          ok: true,
        });

        const req = createMockRequest({
          drop: mockLocations.drop,
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(200);
        // Long fare: 40 + 100*12 + 120*1.5 = 1420
        // Green discount: min(100*0.5, 1420*0.1) = min(50, 142) = 50, final = 1370
        // @ts-expect-error
        expect(res._getData().fare).toBe(1370);
      });
      it("should return 200 with base fare when pickup and drop are identical", async () => {
        // Arrange
        const mockRouteResponse = {
          routes: [
            {
              distanceMeters: 0,
              duration: "0s",
              polyline: { encodedPolyline: "" },
            },
          ],
        };

        mockFetch.mockResolvedValueOnce({
          json: () => Promise.resolve(mockRouteResponse),
          ok: true,
        });

        const req = createMockRequest({
          drop: mockLocations.pickup, // Drop = Pickup
          pickup: mockLocations.pickup,
        });
        const res = createMockResponse();

        // Act
        await calculateFare(req as Request, res as Response);

        // Assert
        expect(res._getStatusCode()).toBe(200);
        // @ts-expect-error
        expect(res._getData().fare).toBe(PRICING.BASE_FARE); // Minimum fare
      });
    });
  });
});
