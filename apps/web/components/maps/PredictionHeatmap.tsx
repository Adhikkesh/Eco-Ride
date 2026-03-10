"use client";

import { useGoogleMap } from "@react-google-maps/api";
import { useCallback, useEffect, useRef, useState } from "react";
import { backendUrl } from "@/config";

interface HeatmapCell {
  lat: number;
  lng: number;
  demand_score: number;
  demand_level: string;
  surge_multiplier: number;
}

interface PredictionHeatmapProps {
  token: string;
  centerLat?: number;
  centerLng?: number;
  radiusKm?: number;
  gridSize?: number;
}

const DEMAND_COLORS: Record<string, string> = {
  low: "#22c55e",
  medium: "#eab308",
  high: "#f97316",
  very_high: "#ef4444",
};

const DEMAND_OPACITY: Record<string, number> = {
  low: 0.15,
  medium: 0.25,
  high: 0.35,
  very_high: 0.45,
};

export default function PredictionHeatmap({
  token,
  centerLat = 12.9716,
  centerLng = 77.5946,
  radiusKm = 10,
  gridSize = 6,
}: PredictionHeatmapProps) {
  const map = useGoogleMap();
  const [cells, setCells] = useState<HeatmapCell[]>([]);
  // Store native google.maps.Circle instances so we can remove them reliably
  const nativeCirclesRef = useRef<google.maps.Circle[]>([]);

  const fetchHeatmap = useCallback(async () => {
    if (!token) return;
    try {
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay() === 0 ? 6 : now.getDay() - 1;

      const res = await fetch(
        `${backendUrl}/predict/demand-heatmap?lat=${centerLat}&lng=${centerLng}&radius=${radiusKm}&grid=${gridSize}&hour=${hour}&day=${day}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        }
      );
      if (res.ok) {
        const data = await res.json();
        setCells(data.cells || []);
      }
    } catch (err) {
      console.warn("Heatmap fetch failed:", err);
    }
  }, [token, centerLat, centerLng, radiusKm, gridSize]);

  useEffect(() => {
    fetchHeatmap();
    const interval = setInterval(fetchHeatmap, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchHeatmap]);

  // Draw circles natively on the Google Map and clean them up on unmount
  useEffect(() => {
    if (!map || cells.length === 0) return;

    // Remove any previously drawn circles first
    nativeCirclesRef.current.forEach((c) => c.setMap(null));
    nativeCirclesRef.current = [];

    const circleRadius = (radiusKm * 1000 * 2) / (gridSize * 2);

    // Create new native circles
    const newCircles = cells.map((cell) => {
      return new google.maps.Circle({
        map,
        center: { lat: cell.lat, lng: cell.lng },
        radius: circleRadius,
        fillColor: DEMAND_COLORS[cell.demand_level] || "#22c55e",
        fillOpacity: DEMAND_OPACITY[cell.demand_level] || 0.15,
        strokeColor: DEMAND_COLORS[cell.demand_level] || "#22c55e",
        strokeOpacity: 0.4,
        strokeWeight: 1,
        clickable: false,
        zIndex: 1,
      });
    });

    nativeCirclesRef.current = newCircles;

    // Cleanup: remove all circles from the map when this effect re-runs or component unmounts
    return () => {
      newCircles.forEach((c) => c.setMap(null));
      nativeCirclesRef.current = [];
    };
  }, [map, cells, radiusKm, gridSize]);

  // Nothing to render in React — circles are drawn directly on the map
  return null;
}
