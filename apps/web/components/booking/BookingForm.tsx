"use client";

import {
  FaCar,
  FaClock,
  FaFlagCheckered,
  FaLeaf,
  FaMapMarkerAlt,
  FaRoute,
  FaSearchLocation,
} from "react-icons/fa";
import type { TripEstimate } from "@/hooks/useTripEstimator";

interface BookingFormProps {
  pickup: { lat: number; lng: number } | null;
  drop: { lat: number; lng: number } | null;
  onSelectPickupMode: () => void;
  onSelectDropMode: () => void;
  onGetEstimate: () => void;
  estimate: TripEstimate | null;
  loading: boolean;
  onConfirmRide: () => void;
  selectionMode: "none" | "pickup" | "drop";
}

export default function BookingForm({
  pickup,
  drop,
  onSelectPickupMode,
  onSelectDropMode,
  onGetEstimate,
  estimate,
  loading,
  onConfirmRide,
  selectionMode,
}: BookingFormProps): JSX.Element {
  return (
    <div
      style={{
        backdropFilter: "blur(12px)",
        background: "rgba(30, 41, 59, 0.8)",
        border: "1px solid rgba(71, 85, 105, 0.5)",
        borderRadius: "24px",
        boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
        color: "white",
        display: "flex",
        flexDirection: "column",
        gap: "20px",
        padding: "24px",
      }}
    >
      <div style={{ alignItems: "center", display: "flex", gap: "12px", marginBottom: "8px" }}>
        <div
          style={{
            alignItems: "center",
            background: "linear-gradient(135deg, #22c55e, #10b981)",
            borderRadius: "12px",
            boxShadow: "0 10px 25px -5px rgba(34, 197, 94, 0.3)",
            display: "flex",
            height: "48px",
            justifyContent: "center",
            width: "48px",
          }}
        >
          <FaCar style={{ color: "white", fontSize: "24px" }} />
        </div>
        <div>
          <h2 style={{ fontSize: "20px", fontWeight: "bold", margin: 0 }}>Book Eco-Ride</h2>
          <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>
            Sustainable travel made easy
          </p>
        </div>
      </div>

      {/* Location Selectors */}
      <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
        {/* Pickup */}
        <button
          type="button"
          onClick={onSelectPickupMode}
          style={{
            alignItems: "center",
            background:
              selectionMode === "pickup" ? "rgba(59, 130, 246, 0.2)" : "rgba(15, 23, 42, 0.5)",
            border: `1px solid ${selectionMode === "pickup" ? "#3b82f6" : "rgba(71, 85, 105, 0.5)"}`,
            borderRadius: "16px",
            cursor: "pointer",
            display: "flex",
            gap: "12px",
            padding: "16px",
            textAlign: "left",
            transition: "all 0.2s",
            width: "100%",
          }}
        >
          <div style={{ color: "#3b82f6" }}>
            <FaMapMarkerAlt />
          </div>
          <div style={{ flex: 1 }}>
            <span
              style={{ color: "#94a3b8", display: "block", fontSize: "12px", marginBottom: "4px" }}
            >
              Pickup Location
            </span>
            <div style={{ color: pickup ? "white" : "#64748b", fontWeight: 500 }}>
              {pickup
                ? `${pickup.lat.toFixed(4)}, ${pickup.lng.toFixed(4)}`
                : "Tap to select on map"}
            </div>
          </div>
          {selectionMode === "pickup" && <FaSearchLocation className="animate-pulse" />}
        </button>

        {/* Drop */}
        <button
          type="button"
          onClick={onSelectDropMode}
          style={{
            alignItems: "center",
            background:
              selectionMode === "drop" ? "rgba(239, 68, 68, 0.2)" : "rgba(15, 23, 42, 0.5)",
            border: `1px solid ${selectionMode === "drop" ? "#ef4444" : "rgba(71, 85, 105, 0.5)"}`,
            borderRadius: "16px",
            cursor: "pointer",
            display: "flex",
            gap: "12px",
            padding: "16px",
            textAlign: "left",
            transition: "all 0.2s",
            width: "100%",
          }}
        >
          <div style={{ color: "#ef4444" }}>
            <FaFlagCheckered />
          </div>
          <div style={{ flex: 1 }}>
            <span
              style={{ color: "#94a3b8", display: "block", fontSize: "12px", marginBottom: "4px" }}
            >
              Destination
            </span>
            <div style={{ color: drop ? "white" : "#64748b", fontWeight: 500 }}>
              {drop ? `${drop.lat.toFixed(4)}, ${drop.lng.toFixed(4)}` : "Tap to select on map"}
            </div>
          </div>
          {selectionMode === "drop" && <FaSearchLocation className="animate-pulse" />}
        </button>
      </div>

      {/* Estimate Button/Result */}
      {estimate ? (
        <div
          style={{
            background: "rgba(34, 197, 94, 0.1)",
            border: "1px solid rgba(34, 197, 94, 0.3)",
            borderRadius: "16px",
            padding: "16px",
          }}
        >
          <div
            style={{
              alignItems: "flex-end",
              display: "flex",
              justifyContent: "space-between",
              marginBottom: "12px",
            }}
          >
            <div>
              <div style={{ color: "#94a3b8", fontSize: "14px" }}>Total Fare</div>
              <div style={{ color: "#22c55e", fontSize: "28px", fontWeight: "bold" }}>
                ₹{estimate.fare}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ alignItems: "center", color: "#cbd5e1", display: "flex", gap: "6px" }}>
                <FaClock /> {estimate.eta_min} mins
              </div>
              <div
                style={{
                  alignItems: "center",
                  color: "#cbd5e1",
                  display: "flex",
                  gap: "6px",
                  marginTop: "4px",
                }}
              >
                <FaRoute /> {estimate.distance_km} km
              </div>
            </div>
          </div>

          <div
            style={{
              alignItems: "center",
              background: "rgba(34, 197, 94, 0.2)",
              borderRadius: "12px",
              display: "flex",
              gap: "12px",
              padding: "12px",
            }}
          >
            <FaLeaf style={{ color: "#22c55e", fontSize: "20px" }} />
            <div>
              <div style={{ color: "white", fontWeight: "600" }}>Green Choice!</div>
              <div style={{ color: "#bbf7d0", fontSize: "12px" }}>
                You're saving {estimate.co2_saved_g}g of CO2
              </div>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={onGetEstimate}
          disabled={!pickup || !drop || loading}
          style={{
            alignItems: "center",
            background:
              !pickup || !drop
                ? "rgba(71, 85, 105, 0.5)"
                : "linear-gradient(90deg, #3b82f6, #2563eb)",
            border: "none",
            borderRadius: "16px",
            boxShadow: !pickup || !drop ? "none" : "0 10px 25px -5px rgba(59, 130, 246, 0.4)",
            color: !pickup || !drop ? "#94a3b8" : "white",
            cursor: !pickup || !drop || loading ? "not-allowed" : "pointer",
            display: "flex",
            fontSize: "16px",
            fontWeight: "bold",
            gap: "10px",
            justifyContent: "center",
            padding: "16px",
            transition: "all 0.2s",
          }}
        >
          {loading ? "Calculating..." : "Get Price Estimate"}
        </button>
      )}

      {/* Confirm Button */}
      {estimate && (
        <button
          type="button"
          onClick={onConfirmRide}
          style={{
            alignItems: "center",
            animation: "pulse 2s infinite",
            background: "linear-gradient(90deg, #22c55e, #10b981)",
            border: "none",
            borderRadius: "16px",
            boxShadow: "0 10px 25px -5px rgba(34, 197, 94, 0.4)",
            color: "white",
            cursor: "pointer",
            display: "flex",
            fontSize: "18px",
            fontWeight: "bold",
            gap: "10px",
            justifyContent: "center",
            padding: "16px",
            transition: "all 0.2s",
          }}
        >
          Confirm Eco-Ride
        </button>
      )}
    </div>
  );
}
