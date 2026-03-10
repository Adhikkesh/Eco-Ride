"use client";

import { Circle } from "@react-google-maps/api";
import { useCallback, useEffect, useState } from "react";
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
  visible?: boolean;
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
  visible = true,
}: PredictionHeatmapProps) {
  const [cells, setCells] = useState<HeatmapCell[]>([]);

  const fetchHeatmap = useCallback(async () => {
    if (!token || !visible) return;
    try {
      const now = new Date();
      const hour = now.getHours();
      const day = now.getDay() === 0 ? 6 : now.getDay() - 1;

      const res = await fetch(
        `${backendUrl}/predict/demand-heatmap?lat=${centerLat}&lng=${centerLng}&radius=${radiusKm}&grid=${gridSize}&hour=${hour}&day=${day}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (res.ok) {
        const data = await res.json();
        setCells(data.cells || []);
      }
    } catch (err) {
      console.warn("Heatmap fetch failed:", err);
    }
  }, [token, centerLat, centerLng, radiusKm, gridSize, visible]);

  useEffect(() => {
    fetchHeatmap();
    const interval = setInterval(fetchHeatmap, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [fetchHeatmap]);

  if (!visible || cells.length === 0) return null;

  const circleRadius = (radiusKm * 1000 * 2) / (gridSize * 2);

  return (
    <>
      {cells.map((cell, i) => (
        <Circle
          key={`demand-${i}`}
          center={{ lat: cell.lat, lng: cell.lng }}
          radius={circleRadius}
          options={{
            fillColor: DEMAND_COLORS[cell.demand_level] || "#22c55e",
            fillOpacity: DEMAND_OPACITY[cell.demand_level] || 0.15,
            strokeColor: DEMAND_COLORS[cell.demand_level] || "#22c55e",
            strokeOpacity: 0.4,
            strokeWeight: 1,
            clickable: false,
            zIndex: 1,
          }}
        />
      ))}
    </>
  );
}
