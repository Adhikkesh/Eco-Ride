"use client";

import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { onValue, ref } from "firebase/database";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaCar, FaLeaf, FaMapMarkerAlt, FaSync, FaUsers } from "react-icons/fa";
import { rtdb } from "@/lib/firebase";
import { darkMapStyles } from "@/lib/mapStyles";

// ---------------------------------------------------------
// Types
// ---------------------------------------------------------
interface DriverLocation {
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY";
  lastUpdated: number;
  vehicleType?: string;
}

interface DriverMarker extends DriverLocation {
  id: string;
  animatedLat?: number;
  animatedLng?: number;
}

// ---------------------------------------------------------
// Styles
// ---------------------------------------------------------
const styles = {
  availableCard: {
    background: "rgba(34, 197, 94, 0.1)",
    border: "1px solid rgba(34, 197, 94, 0.2)",
    borderRadius: "12px",
    padding: "12px",
    textAlign: "center",
  } as React.CSSProperties,
  busyCard: {
    background: "rgba(234, 179, 8, 0.1)",
    border: "1px solid rgba(234, 179, 8, 0.2)",
    borderRadius: "12px",
    padding: "12px",
    textAlign: "center",
  } as React.CSSProperties,
  card: {
    backdropFilter: "blur(12px)",
    background: "rgba(30, 41, 59, 0.8)",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    borderRadius: "24px",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
    padding: "24px",
  } as React.CSSProperties,
  driverItem: {
    alignItems: "center",
    background: "rgba(15, 23, 42, 0.5)",
    borderRadius: "12px",
    display: "flex",
    gap: "12px",
    padding: "12px",
  } as React.CSSProperties,
  headerIcon: {
    alignItems: "center",
    background: "linear-gradient(135deg, #3b82f6, #6366f1)",
    borderRadius: "16px",
    boxShadow: "0 10px 25px -5px rgba(59, 130, 246, 0.3)",
    display: "flex",
    height: "56px",
    justifyContent: "center",
    width: "56px",
  } as React.CSSProperties,
  legendIcon: (color: string) =>
    ({
      alignItems: "center",
      background: `${color}20`,
      borderRadius: "8px",
      display: "flex",
      height: "32px",
      justifyContent: "center",
      width: "32px",
    }) as React.CSSProperties,
  legendItem: {
    alignItems: "center",
    display: "flex",
    gap: "12px",
  } as React.CSSProperties,
  mapCard: {
    backdropFilter: "blur(12px)",
    background: "rgba(30, 41, 59, 0.8)",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    borderRadius: "24px",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
    padding: "16px",
  } as React.CSSProperties,
  page: {
    background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
    minHeight: "100vh",
    padding: "24px",
  } as React.CSSProperties,
  statCard: {
    background: "rgba(15, 23, 42, 0.5)",
    borderRadius: "16px",
    padding: "16px",
    textAlign: "center",
  } as React.CSSProperties,
  statusBadge: (status: "AVAILABLE" | "BUSY") =>
    ({
      background: status === "AVAILABLE" ? "rgba(34, 197, 94, 0.2)" : "rgba(234, 179, 8, 0.2)",
      borderRadius: "8px",
      color: status === "AVAILABLE" ? "#4ade80" : "#facc15",
      fontSize: "12px",
      padding: "4px 8px",
    }) as React.CSSProperties,
  statusDot: (connected: boolean) =>
    ({
      animation: connected ? "pulse 2s infinite" : "none",
      background: connected ? "#22c55e" : "#ef4444",
      borderRadius: "50%",
      height: "12px",
      width: "12px",
    }) as React.CSSProperties,
};

const mapContainerStyle = {
  borderRadius: "20px",
  height: "100%",
  width: "100%",
};

const defaultCenter = {
  lat: 11.0168,
  lng: 76.9558,
};

// ---------------------------------------------------------
// Component
// ---------------------------------------------------------
export default function RiderMap(): React.ReactNode {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    id: "google-map-script",
  });

  const [drivers, setDrivers] = useState<Map<string, DriverMarker>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const mapRef = useRef<google.maps.Map | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!rtdb) return;

    const driversRef = ref(rtdb, "drivers-online");

    const unsubscribe = onValue(
      driversRef,
      (snapshot) => {
        setIsConnected(true);
        setLastUpdate(new Date());

        const data = snapshot.val();
        const newDrivers = new Map<string, DriverMarker>();

        if (data) {
          Object.entries(data).forEach(([driverId, locationData]) => {
            const location = locationData as DriverLocation;
            newDrivers.set(driverId, {
              animatedLat: location.lat,
              animatedLng: location.lng,
              heading: location.heading ?? 0,
              id: driverId,
              lastUpdated: location.lastUpdated,
              lat: location.lat,
              lng: location.lng,
              status: location.status,
              vehicleType: location.vehicleType,
            });
          });
        }

        setDrivers(newDrivers);
      },
      (error) => {
        console.error("Firebase listener error:", error);
        setIsConnected(false);
      },
    );

    return () => {
      unsubscribe();
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const animate = () => {
      setDrivers((prevDrivers) => {
        const updatedDrivers = new Map(prevDrivers);
        let hasChanges = false;

        updatedDrivers.forEach((driver, id) => {
          const targetLat = driver.lat;
          const targetLng = driver.lng;
          const currentLat = driver.animatedLat ?? driver.lat;
          const currentLng = driver.animatedLng ?? driver.lng;

          const lerp = 0.15;
          const newLat = currentLat + (targetLat - currentLat) * lerp;
          const newLng = currentLng + (targetLng - currentLng) * lerp;

          if (
            Math.abs(newLat - currentLat) > 0.000001 ||
            Math.abs(newLng - currentLng) > 0.000001
          ) {
            updatedDrivers.set(id, { ...driver, animatedLat: newLat, animatedLng: newLng });
            hasChanges = true;
          }
        });

        return hasChanges ? updatedDrivers : prevDrivers;
      });

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  if (!isLoaded) {
    return (
      <div
        style={{ ...styles.page, alignItems: "center", display: "flex", justifyContent: "center" }}
      >
        <div
          style={{
            alignItems: "center",
            color: "white",
            display: "flex",
            fontSize: "20px",
            gap: "12px",
          }}
        >
          <div
            style={{
              animation: "spin 1s linear infinite",
              border: "2px solid #3b82f6",
              borderRadius: "50%",
              borderTopColor: "transparent",
              height: "24px",
              width: "24px",
            }}
          />
          Loading Maps...
        </div>
      </div>
    );
  }

  const driverArray = Array.from(drivers.values());
  const availableCount = driverArray.filter((d) => d.status === "AVAILABLE").length;
  const busyCount = driverArray.filter((d) => d.status === "BUSY").length;

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={{ margin: "0 auto 32px", maxWidth: "1200px" }}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "16px" }}>
            <div style={styles.headerIcon}>
              <FaMapMarkerAlt style={{ color: "white", fontSize: "24px" }} />
            </div>
            <div>
              <h1 style={{ color: "white", fontSize: "28px", fontWeight: 700, margin: 0 }}>
                Live Map
              </h1>
              <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>
                Real-time Driver Tracking
              </p>
            </div>
          </div>
          <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
            <div style={styles.statusDot(isConnected)} />
            <span style={{ color: "#e2e8f0", fontSize: "14px", fontWeight: 500 }}>
              {isConnected ? "Live" : "Disconnected"}
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ margin: "0 auto", maxWidth: "1200px" }}>
        <div style={{ display: "grid", gap: "24px", gridTemplateColumns: "3fr 1fr" }}>
          {/* Map Card */}
          <div style={styles.mapCard}>
            <div style={{ borderRadius: "16px", height: "550px", overflow: "hidden" }}>
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
                center={defaultCenter}
                zoom={13}
                onLoad={onLoad}
                onUnmount={onUnmount}
                options={{
                  disableDefaultUI: true,
                  styles: darkMapStyles,
                  zoomControl: true,
                }}
              >
                {driverArray.map((driver) => (
                  <Marker
                    key={driver.id}
                    position={{
                      lat: driver.animatedLat ?? driver.lat,
                      lng: driver.animatedLng ?? driver.lng,
                    }}
                    icon={{
                      anchor: new google.maps.Point(22, 22),
                      scaledSize: new google.maps.Size(45, 45),
                      url: "/car-icon.svg",
                    }}
                    title={`${driver.id.slice(0, 8)}... (${driver.status})`}
                  />
                ))}
              </GoogleMap>
            </div>
          </div>

          {/* Side Panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Stats Card */}
            <div style={styles.card}>
              <div
                style={{ alignItems: "center", display: "flex", gap: "12px", marginBottom: "24px" }}
              >
                <FaUsers style={{ color: "#3b82f6", fontSize: "20px" }} />
                <h2 style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: 0 }}>
                  Drivers
                </h2>
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <div style={styles.statCard as React.CSSProperties}>
                  <p style={{ color: "white", fontSize: "36px", fontWeight: 700, margin: 0 }}>
                    {driverArray.length}
                  </p>
                  <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>Total Online</p>
                </div>

                <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "1fr 1fr" }}>
                  <div style={styles.availableCard as React.CSSProperties}>
                    <p style={{ color: "#4ade80", fontSize: "24px", fontWeight: 700, margin: 0 }}>
                      {availableCount}
                    </p>
                    <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>Available</p>
                  </div>
                  <div style={styles.busyCard as React.CSSProperties}>
                    <p style={{ color: "#facc15", fontSize: "24px", fontWeight: 700, margin: 0 }}>
                      {busyCount}
                    </p>
                    <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>Busy</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Last Update */}
            <div style={styles.card}>
              <div
                style={{ alignItems: "center", display: "flex", gap: "12px", marginBottom: "16px" }}
              >
                <FaSync style={{ color: "#3b82f6" }} />
                <h2 style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: 0 }}>
                  Updates
                </h2>
              </div>
              {lastUpdate && (
                <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>
                  Last sync:{" "}
                  <span style={{ color: "white" }}>{lastUpdate.toLocaleTimeString()}</span>
                </p>
              )}
            </div>

            {/* Legend */}
            <div style={styles.card}>
              <h2 style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: "0 0 16px" }}>
                Legend
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={styles.legendItem}>
                  <div style={styles.legendIcon("#22c55e")}>
                    <FaCar style={{ color: "#4ade80" }} />
                  </div>
                  <span style={{ color: "#cbd5e1", fontSize: "14px" }}>Available Driver</span>
                </div>
                <div style={styles.legendItem}>
                  <div style={styles.legendIcon("#eab308")}>
                    <FaCar style={{ color: "#facc15" }} />
                  </div>
                  <span style={{ color: "#cbd5e1", fontSize: "14px" }}>Busy Driver</span>
                </div>
                <div style={styles.legendItem}>
                  <div style={styles.legendIcon("#3b82f6")}>
                    <FaLeaf style={{ color: "#60a5fa" }} />
                  </div>
                  <span style={{ color: "#cbd5e1", fontSize: "14px" }}>EV Vehicle</span>
                </div>
              </div>
            </div>

            {/* Active Drivers List */}
            {driverArray.length > 0 && (
              <div style={{ ...styles.card, maxHeight: "300px", overflowY: "auto" }}>
                <h2
                  style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: "0 0 16px" }}
                >
                  Active Drivers
                </h2>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {driverArray.map((driver) => (
                    <div key={driver.id} style={styles.driverItem}>
                      <div
                        style={{
                          background: driver.status === "AVAILABLE" ? "#22c55e" : "#eab308",
                          borderRadius: "50%",
                          height: "8px",
                          width: "8px",
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p
                          style={{
                            color: "white",
                            fontFamily: "monospace",
                            fontSize: "14px",
                            margin: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {driver.id.slice(0, 14)}...
                        </p>
                      </div>
                      <span style={styles.statusBadge(driver.status)}>{driver.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
