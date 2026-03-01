/**
 * Unit Tests for Green Points Calculation Utility
 *
 * Tests the calculateGreenPoints function which computes eco-rewards
 * based on vehicle type, passenger capacity, and trip distance.
 *
 * Formula: GreenPoints = ((E_benchmark - (E_vehicle / N_passengers)) * Distance) / 10
 */

import { describe, expect, it } from "vitest";
import {
  calculateGreenPoints,
  E_BENCHMARK,
  EMISSION_FACTORS,
  type VehicleType,
} from "../../src/utils/greenPoints.js";

// ─── Constants ────────────────────────────────────────────────────────────────

describe("Green Points Constants", () => {
  it("should have E_BENCHMARK set to 150 g/km", () => {
    expect(E_BENCHMARK).toBe(150);
  });

  it("should have emission factors for all vehicle types", () => {
    expect(EMISSION_FACTORS).toHaveProperty("PETROL");
    expect(EMISSION_FACTORS).toHaveProperty("DIESEL");
    expect(EMISSION_FACTORS).toHaveProperty("HYBRID");
    expect(EMISSION_FACTORS).toHaveProperty("ELECTRIC");
  });

  it("should rank emissions: ELECTRIC < HYBRID < DIESEL < PETROL", () => {
    expect(EMISSION_FACTORS.ELECTRIC).toBeLessThan(EMISSION_FACTORS.HYBRID);
    expect(EMISSION_FACTORS.HYBRID).toBeLessThan(EMISSION_FACTORS.DIESEL);
    expect(EMISSION_FACTORS.DIESEL).toBeLessThan(EMISSION_FACTORS.PETROL);
  });

  it("should have zero emissions for ELECTRIC", () => {
    expect(EMISSION_FACTORS.ELECTRIC).toBe(0);
  });
});

// ─── calculateGreenPoints ────────────────────────────────────────────────────

describe("calculateGreenPoints", () => {
  // ── Electric vehicles ─────────────────────────────────────────────────────
  describe("Electric vehicles", () => {
    it("should give maximum points for ELECTRIC (zero emissions)", () => {
      // ((150 - 0/1) * 10) / 10 = 150
      const points = calculateGreenPoints("ELECTRIC", 1, 10);
      expect(points).toBe(150);
    });

    it("should scale linearly with distance for ELECTRIC", () => {
      const p5 = calculateGreenPoints("ELECTRIC", 1, 5);
      const p10 = calculateGreenPoints("ELECTRIC", 1, 10);
      expect(p10).toBe(p5 * 2);
    });
  });

  // ── Petrol vehicles ───────────────────────────────────────────────────────
  describe("Petrol vehicles", () => {
    it("should give zero points for solo PETROL (matches benchmark)", () => {
      // ((150 - 150/1) * 10) / 10 = 0
      const points = calculateGreenPoints("PETROL", 1, 10);
      expect(points).toBe(0);
    });

    it("should give positive points for pooled PETROL", () => {
      // ((150 - 150/2) * 10) / 10 = 75
      const points = calculateGreenPoints("PETROL", 2, 10);
      expect(points).toBe(75);
    });

    it("should increase points with more passengers for PETROL", () => {
      const p2 = calculateGreenPoints("PETROL", 2, 10);
      const p4 = calculateGreenPoints("PETROL", 4, 10);
      expect(p4).toBeGreaterThan(p2);
    });
  });

  // ── Hybrid vehicles ───────────────────────────────────────────────────────
  describe("Hybrid vehicles", () => {
    it("should give moderate points for solo HYBRID", () => {
      // ((150 - 70/1) * 10) / 10 = 80
      const points = calculateGreenPoints("HYBRID", 1, 10);
      expect(points).toBe(80);
    });
  });

  // ── Diesel vehicles ───────────────────────────────────────────────────────
  describe("Diesel vehicles", () => {
    it("should give small points for solo DIESEL", () => {
      // ((150 - 130/1) * 10) / 10 = 20
      const points = calculateGreenPoints("DIESEL", 1, 10);
      expect(points).toBe(20);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────────────
  describe("Edge cases", () => {
    it("should return 0 for zero distance", () => {
      const points = calculateGreenPoints("ELECTRIC", 1, 0);
      expect(points).toBe(0);
    });

    it("should never return negative points", () => {
      // Even if emissions per passenger exceed benchmark (shouldn't happen
      // with our factors, but testing the Math.max(0, ...) guard)
      const points = calculateGreenPoints("PETROL", 1, 10);
      expect(points).toBeGreaterThanOrEqual(0);
    });

    it("should treat passengerCapacity < 1 as 1", () => {
      const withZero = calculateGreenPoints("ELECTRIC", 0, 10);
      const withOne = calculateGreenPoints("ELECTRIC", 1, 10);
      expect(withZero).toBe(withOne);
    });

    it("should treat negative passengerCapacity as 1", () => {
      const withNeg = calculateGreenPoints("ELECTRIC", -5, 10);
      const withOne = calculateGreenPoints("ELECTRIC", 1, 10);
      expect(withNeg).toBe(withOne);
    });

    it("should return an integer (rounded)", () => {
      // Use values that might produce a non-integer
      const points = calculateGreenPoints("HYBRID", 3, 7);
      expect(Number.isInteger(points)).toBe(true);
    });

    it("should handle unknown vehicle type by defaulting to PETROL", () => {
      const unknown = calculateGreenPoints("UNKNOWN" as VehicleType, 1, 10);
      const petrol = calculateGreenPoints("PETROL", 1, 10);
      expect(unknown).toBe(petrol);
    });

    it("should handle very large distances", () => {
      const points = calculateGreenPoints("ELECTRIC", 1, 1000);
      expect(points).toBe(15000);
    });

    it("should handle very large passenger counts", () => {
      const points = calculateGreenPoints("PETROL", 100, 10);
      // ((150 - 150/100) * 10) / 10 = 148.5 → 149 rounded
      expect(points).toBe(149);
    });
  });
});
