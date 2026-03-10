"use client";

import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from "chart.js";
import type { ChartData, ChartOptions } from "chart.js";
import { onAuthStateChanged } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Chart } from "react-chartjs-2";
import {
  FaChartLine,
  FaLeaf,
  FaMapMarkedAlt,
  FaMoneyBillWave,
  FaRoute,
} from "react-icons/fa";
import { backendUrl } from "@/config";
import { auth } from "@/lib/firebase";

ChartJS.register(CategoryScale, LinearScale, BarElement, LineElement, PointElement, Title, Tooltip, Legend);

interface ForecastHour {
  hour: number;
  demand_score: number;
  demand_level: string;
  surge_multiplier: number;
}

interface AnalyticsData {
  totalRides: number;
  totalRevenue: number;
  totalCo2Saved: number;
}

export default function AnalyticsDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState("forecast");
  const [token, setToken] = useState<string | null>(null);

  // Data states
  const [forecast, setForecast] = useState<ForecastHour[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/");
        return;
      }
      const t = await user.getIdToken();
      setToken(t);
    });
    return () => unsub();
  }, [router]);

  useEffect(() => {
    if (!token) return;

    const fetchData = async () => {
      setLoading(true);
      try {
        // Fetch 24h forecast
        const fRes = await fetch(`${backendUrl}/predict/forecast-24h`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ day_of_week: new Date().getDay() }),
        });
        if (fRes.ok) {
          const fData = await fRes.json();
          setForecast(fData.forecast || []);
        }

        // Mock Analytics for display (Ideally fetch from actual /admin/analytics endpoint)
        setAnalytics({
          totalRides: 1245,
          totalRevenue: 154200,
          totalCo2Saved: 345000,
        });
      } catch (err) {
        console.error("Failed to fetch analytics data", err);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [token]);

  const chartData: ChartData<"bar" | "line"> = {
    labels: forecast.map((f) => `${f.hour}:00`),
    datasets: [
      {
        type: "bar" as const,
        label: "Predicted Demand Score",
        data: forecast.map((f) => f.demand_score),
        backgroundColor: forecast.map((f) => {
          if (f.demand_level === "very_high") return "rgba(239, 68, 68, 0.8)";
          if (f.demand_level === "high") return "rgba(249, 115, 22, 0.8)";
          if (f.demand_level === "medium") return "rgba(234, 179, 8, 0.8)";
          return "rgba(34, 197, 94, 0.8)";
        }),
        borderRadius: 4,
      },
      {
        type: "line" as const,
        label: "Surge Multiplier",
        data: forecast.map((f) => f.surge_multiplier),
        borderColor: "#4f46e5",
        backgroundColor: "#4f46e5",
        borderWidth: 2,
        tension: 0.4,
      },
    ],
  };

  const chartOptions: ChartOptions<"bar" | "line"> = {
    responsive: true,
    plugins: {
      legend: { position: "top" as const },
      title: { display: false },
    },
    scales: {
      y: { beginAtZero: true, max: 2.0 },
    },
  };

  if (loading) {
    return (
      <div style={{ padding: "40px", textAlign: "center", color: "white" }}>
        Loading Predictive Analytics...
      </div>
    );
  }

  return (
    <div style={{ padding: "32px", maxWidth: "1200px", margin: "0 auto", color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
        <div>
          <h1 style={{ fontSize: "32px", fontWeight: "bold", margin: 0, display: "flex", alignItems: "center", gap: "12px" }}>
            <FaChartLine style={{ color: "#3b82f6" }} /> Predictive Analytics
          </h1>
          <p style={{ color: "#9ca3af", marginTop: "8px" }}>AI-Powered Demand and Sustainability Dashboard</p>
        </div>
        <button
          onClick={() => router.push("/Admin/verification")}
          style={{
            padding: "10px 16px",
            background: "#374151",
            border: "none",
            borderRadius: "8px",
            color: "white",
            cursor: "pointer",
          }}
        >
          Back to Verification
        </button>
      </div>

      {/* KPI Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "24px", marginBottom: "32px" }}>
        <div style={{ background: "#1f2937", padding: "24px", borderRadius: "12px", border: "1px solid #374151" }}>
          <div style={{ color: "#9ca3af", fontSize: "14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <FaRoute /> Total Rides Today
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold" }}>{analytics?.totalRides.toLocaleString()}</div>
        </div>
        <div style={{ background: "#1f2937", padding: "24px", borderRadius: "12px", border: "1px solid #374151" }}>
          <div style={{ color: "#9ca3af", fontSize: "14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <FaMoneyBillWave /> Projected Revenue
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "#10b981" }}>₹{analytics?.totalRevenue.toLocaleString()}</div>
        </div>
        <div style={{ background: "linear-gradient(135deg, #064e3b 0%, #065f46 100%)", padding: "24px", borderRadius: "12px", border: "1px solid #059669" }}>
          <div style={{ color: "#a7f3d0", fontSize: "14px", marginBottom: "8px", display: "flex", alignItems: "center", gap: "8px" }}>
            <FaLeaf /> CO₂ Emissions Saved
          </div>
          <div style={{ fontSize: "28px", fontWeight: "bold", color: "white" }}>
            {((analytics?.totalCo2Saved || 0) / 1000).toFixed(1)} kg
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: "16px", marginBottom: "24px", borderBottom: "1px solid #374151", paddingBottom: "16px" }}>
        <button
          onClick={() => setActiveTab("forecast")}
          style={{
            background: activeTab === "forecast" ? "#3b82f6" : "transparent",
            color: activeTab === "forecast" ? "white" : "#9ca3af",
            border: "none",
            padding: "8px 16px",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          24h Demand Forecast
        </button>
        <button
          onClick={() => setActiveTab("heatmap")}
          style={{
            background: activeTab === "heatmap" ? "#3b82f6" : "transparent",
            color: activeTab === "heatmap" ? "white" : "#9ca3af",
            border: "none",
            padding: "8px 16px",
            borderRadius: "6px",
            cursor: "pointer",
            fontWeight: "bold",
          }}
        >
          City Heatmap
        </button>
      </div>

      {/* Content */}
      <div style={{ background: "#1f2937", padding: "24px", borderRadius: "12px", border: "1px solid #374151" }}>
        {activeTab === "forecast" && (
          <div>
            <h3 style={{ marginBottom: "24px", display: "flex", alignItems: "center", gap: "8px" }}>
              <FaChartLine /> Hourly Demand AI Predictions
            </h3>
            {forecast.length > 0 ? (
              <div style={{ height: "400px" }}>
                <Chart type="bar" data={chartData} options={chartOptions} />
              </div>
            ) : (
              <p>No forecast data available from model.</p>
            )}
          </div>
        )}

        {activeTab === "heatmap" && (
          <div style={{ textAlign: "center", padding: "40px" }}>
            <FaMapMarkedAlt style={{ fontSize: "48px", color: "#4f46e5", marginBottom: "16px" }} />
            <h3>Demand Heatmap View</h3>
            <p style={{ color: "#9ca3af", maxWidth: "500px", margin: "0 auto" }}>
              The demand heatmap has been deployed directly to the Driver App (DriverLiveMap.tsx) to assist with Real-time Driver Pre-positioning. 
              Drivers can now toggle the heatmap to see these LSTM grid predictions overlaid on their live route.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
