import { useState } from "react";
import { backendUrl } from "@/config";
import { auth } from "@/lib/firebase";

export interface TripEstimate {
  fare: number;
  currency: string;
  eta_min: number;
  distance_km: string;
  co2_saved_g: number;
  polyline: string;
  details?: {
    duration_s: number;
    distance_m: number;
  };
}

export const useTripEstimator = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [estimate, setEstimate] = useState<TripEstimate | null>(null);

  const getEstimate = async (
    pickup: { lat: number; lng: number },
    drop: { lat: number; lng: number },
  ) => {
    setLoading(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      if (!token) {
        throw new Error("User not authenticated");
      }

      const response = await fetch(`${backendUrl}/ride/estimate`, {
        body: JSON.stringify({ drop, isPooled: false, pickup }), // Default to not pooled for estimation base
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

  const clearEstimate = () => {
    setEstimate(null);
    setError(null);
  };

  return { clearEstimate, error, estimate, getEstimate, loading };
};
