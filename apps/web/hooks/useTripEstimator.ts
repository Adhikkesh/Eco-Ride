/**
 * @fileoverview Trip Estimator Hook
 * @description React hook that fetches fare estimates from the Eco-Ride backend.
 *              Wraps the `/ride/estimate` API call and manages loading, error, and
 *              result state for the consumer component.
 * @module hooks/useTripEstimator
 */

import { useState } from "react";
import { backendUrl } from "@/config";
import { auth } from "@/lib/firebase";

/**
 * Shape of a fare estimate returned by the backend.
 *
 * @interface TripEstimate
 */
export interface TripEstimate {
  /** Estimated fare in the specified currency. */
  fare: number;
  /** Solo (non-pooled) fare for comparison. */
  solo_fare?: number;
  /** ISO 4217 currency code (e.g. `"INR"`). */
  currency: string;
  /** Estimated time of arrival in minutes. */
  eta_min: number;
  /** Route distance formatted as a string (e.g. `"12.3"`). */
  distance_km: string;
  /** Estimated CO₂ savings compared to a solo ICE vehicle, in grams. */
  co2_saved_g: number;
  /** Per-rider share of CO₂ savings (for pooled rides). */
  co2_saved_per_rider_g?: number;
  /** Encoded polyline string for rendering the route on a map. */
  polyline: string;
  /** Whether this estimate is for a pooled ride. */
  is_pooled?: boolean;
  /** Pool discount percentage (e.g. 25 for 25%). */
  pool_discount_pct?: number;
  /** Savings amount from pooling. */
  pool_savings?: number;
  /** Number of current passengers. */
  passenger_count?: number;
  /** Green points that will be awarded. */
  green_points?: number;
  /** Optional raw distance/duration values from the routing API. */
  details?: {
    /** Route duration in seconds. */
    duration_s: number;
    /** Route distance in metres. */
    distance_m: number;
  };
}

/**
 * Fetches and manages trip fare estimates.
 *
 * Provides `getEstimate` to call the backend and `clearEstimate` to reset state.
 * All state (`loading`, `error`, `estimate`) is managed internally and exposed
 * to the consumer.
 *
 * @returns An object containing `{ getEstimate, clearEstimate, loading, error, estimate }`.
 *
 * @example
 * const { getEstimate, estimate, loading } = useTripEstimator();
 * await getEstimate({ lat: 11.02, lng: 76.96 }, { lat: 11.03, lng: 76.97 });
 * console.log(estimate?.fare);
 */
export const useTripEstimator = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<TripEstimate | null>(null);

  /**
   * Fetches a fare estimate for a given pickup/drop pair.
   *
   * @param pickup - Pickup coordinates.
   * @param drop - Drop-off coordinates.
   * @param isPooled - Whether to calculate pooled ride fare.
   * @returns The estimate data, or `undefined` on failure.
   * @throws Sets `error` state with a human-readable message on failure.
   */
  const getEstimate = async (
    pickup: { lat: number; lng: number },
    drop: { lat: number; lng: number },
    isPooled: boolean = false,
  ) => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error("User not authenticated");
      }

      const response = await fetch(`${backendUrl}/ride/estimate`, {
        body: JSON.stringify({ drop, isPooled, pickup }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || "Failed to get estimate");
      }

      setEstimate(data);
      return data;
    } catch (err) {
      console.error("Estimation failed:", err);
      setError(err instanceof Error ? err.message : "Failed to calculate fare");
      setEstimate(null);
    } finally {
      setLoading(false);
    }
  };

  /** Resets the estimate and error state back to `null`. */
  const clearEstimate = () => {
    setEstimate(null);
    setError(null);
  };

  return { clearEstimate, error, estimate, getEstimate, loading };
};
