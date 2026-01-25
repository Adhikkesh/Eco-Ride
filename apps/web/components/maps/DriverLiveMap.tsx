"use client";

import { GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { onDisconnect, ref, remove, set } from "firebase/database";
import { useCallback, useEffect, useRef, useState } from "react";
import { FaCar, FaClock, FaLeaf, FaMapMarkerAlt, FaPowerOff } from "react-icons/fa";
import { auth, rtdb } from "@/lib/firebase";
import { darkMapStyles } from "@/lib/mapStyles";

interface DriverLocation {
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY";
  lastUpdated: number;
  vehicleType?: string;
}

interface Position {
  lat: number;
  lng: number;
  heading: number;
}

const styles = {
  buttonOffline: {
    alignItems: "center",
    background: "linear-gradient(90deg, #ef4444, #f43f5e)",
    border: "none",
    borderRadius: "16px",
    boxShadow: "0 10px 25px -5px rgba(239, 68, 68, 0.3)",
    color: "white",
    cursor: "pointer",
    display: "flex",
    fontSize: "18px",
    fontWeight: 600,
    gap: "12px",
    justifyContent: "center",
    padding: "16px",
    transition: "all 0.2s",
    width: "100%",
  } as React.CSSProperties,
  buttonOnline: {
    alignItems: "center",
    background: "linear-gradient(90deg, #22c55e, #10b981)",
    border: "none",
    borderRadius: "16px",
    boxShadow: "0 10px 25px -5px rgba(34, 197, 94, 0.3)",
    color: "white",
    cursor: "pointer",
    display: "flex",
    fontSize: "18px",
    fontWeight: 600,
    gap: "12px",
    justifyContent: "center",
    padding: "16px",
    transition: "all 0.2s",
    width: "100%",
  } as React.CSSProperties,
  card: {
    backdropFilter: "blur(12px)",
    background: "rgba(30, 41, 59, 0.8)",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    borderRadius: "24px",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
    padding: "24px",
  } as React.CSSProperties,
  headerIcon: {
    alignItems: "center",
    background: "linear-gradient(135deg, #22c55e, #10b981)",
    borderRadius: "16px",
    boxShadow: "0 10px 25px -5px rgba(34, 197, 94, 0.3)",
    display: "flex",
    height: "56px",
    justifyContent: "center",
    width: "56px",
  } as React.CSSProperties,
  locationInfo: {
    alignItems: "center",
    background: "rgba(15, 23, 42, 0.5)",
    borderRadius: "12px",
    color: "#94a3b8",
    display: "flex",
    fontSize: "14px",
    gap: "12px",
    marginTop: "16px",
    padding: "12px 16px",
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
    padding: "32px",
  } as React.CSSProperties,
  sessionTimer: {
    background: "linear-gradient(90deg, rgba(34, 197, 94, 0.1), rgba(16, 185, 129, 0.1))",
    border: "1px solid rgba(34, 197, 94, 0.2)",
    borderRadius: "16px",
    marginBottom: "24px",
    padding: "16px",
  } as React.CSSProperties,
  statusBtn: (active: boolean, type: "available" | "busy") =>
    ({
      background: active
        ? type === "available"
          ? "linear-gradient(90deg, #22c55e, #10b981)"
          : "linear-gradient(90deg, #eab308, #f97316)"
        : "rgba(71, 85, 105, 0.5)",
      border: "none",
      borderRadius: "12px",
      boxShadow: active
        ? type === "available"
          ? "0 10px 25px -5px rgba(34, 197, 94, 0.25)"
          : "0 10px 25px -5px rgba(234, 179, 8, 0.25)"
        : "none",
      color: active ? "white" : "#cbd5e1",
      cursor: "pointer",
      fontWeight: 500,
      padding: "12px",
      transition: "all 0.2s",
    }) as React.CSSProperties,
};

const mapContainerStyle = {
  borderRadius: "20px",
  height: "100%",
  width: "100%",
};

const defaultCenter = { lat: 11.0168, lng: 76.9558 };

export default function DriverLiveMap(): React.ReactNode {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    id: "google-map-script",
  });

  const [isOnline, setIsOnline] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [status, setStatus] = useState<"AVAILABLE" | "BUSY">("AVAILABLE");
  const [error, setError] = useState<string | null>(null);
  const [sessionTime, setSessionTime] = useState(0);

  const watchIdRef = useRef<number | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const sessionIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const userId = auth?.currentUser?.uid || `test-driver-${Date.now()}`;

  useEffect(() => {
    if (isOnline) {
      sessionIntervalRef.current = setInterval(() => {
        setSessionTime((prev) => prev + 1);
      }, 1000);
    } else {
      if (sessionIntervalRef.current) clearInterval(sessionIntervalRef.current);
      setSessionTime(0);
    }
    return () => {
      if (sessionIntervalRef.current) clearInterval(sessionIntervalRef.current);
    };
  }, [isOnline]);

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const prevPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  const calculateHeading = useCallback((newLat: number, newLng: number): number => {
    if (!prevPositionRef.current) return 0;
    const { lat: prevLat, lng: prevLng } = prevPositionRef.current;
    const dLng = newLng - prevLng;
    const y = Math.sin(dLng) * Math.cos(newLat);
    const x =
      Math.cos(prevLat) * Math.sin(newLat) - Math.sin(prevLat) * Math.cos(newLat) * Math.cos(dLng);
    const heading = (Math.atan2(y, x) * 180) / Math.PI;
    return (heading + 360) % 360;
  }, []);

  const writeLocationToFirebase = useCallback(
    async (pos: Position) => {
      if (!rtdb) return;
      const driverRef = ref(rtdb, `drivers-online/${userId}`);
      const locationData: DriverLocation = {
        heading: pos.heading,
        lastUpdated: Date.now(),
        lat: pos.lat,
        lng: pos.lng,
        status,
        vehicleType: "CAR",
      };
      try {
        await set(driverRef, locationData);
      } catch (err) {
        console.error("Failed to write location:", err);
      }
    },
    [userId, status],
  );

  const goOnline = useCallback(async () => {
    if (!rtdb) {
      setError("Firebase not initialized");
      return;
    }
    if (!navigator.geolocation) {
      setError("Geolocation is not supported");
      return;
    }

    const driverRef = ref(rtdb, `drivers-online/${userId}`);
    try {
      await onDisconnect(driverRef).remove();
    } catch (err) {
      console.error("Failed to setup onDisconnect:", err);
    }

    watchIdRef.current = navigator.geolocation.watchPosition(
      (geoPosition) => {
        const newLat = geoPosition.coords.latitude;
        const newLng = geoPosition.coords.longitude;
        const heading = calculateHeading(newLat, newLng);
        const newPos: Position = { heading, lat: newLat, lng: newLng };
        setPosition(newPos);
        prevPositionRef.current = { lat: newLat, lng: newLng };
        writeLocationToFirebase(newPos);
      },
      (err) => {
        console.error("Geolocation error:", err);
        setError(`Location error: ${err.message}`);
      },
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 10000 },
    );

    setIsOnline(true);
    setError(null);
  }, [userId, calculateHeading, writeLocationToFirebase]);

  const goOffline = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (rtdb) {
      const driverRef = ref(rtdb, `drivers-online/${userId}`);
      try {
        await remove(driverRef);
      } catch (err) {
        console.error("Failed to remove from DB:", err);
      }
    }
    setIsOnline(false);
    setPosition(null);
  }, [userId]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
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
              border: "2px solid #22c55e",
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

  return (
    <div style={styles.page}>
      {/* Header */}
      <header style={{ margin: "0 auto 32px", maxWidth: "1024px" }}>
        <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
          <div style={{ alignItems: "center", display: "flex", gap: "16px" }}>
            <div style={styles.headerIcon}>
              <FaCar style={{ color: "white", fontSize: "24px" }} />
            </div>
            <div>
              <h1 style={{ color: "white", fontSize: "28px", fontWeight: 700, margin: 0 }}>
                Driver Dashboard
              </h1>
              <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>EcoRide Live Tracking</p>
            </div>
          </div>
          <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
            <FaLeaf style={{ color: "#22c55e" }} />
            <span style={{ color: "#e2e8f0", fontSize: "14px", fontWeight: 500 }}>
              Eco Mode Active
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main style={{ margin: "0 auto", maxWidth: "1024px" }}>
        <div style={{ display: "grid", gap: "24px", gridTemplateColumns: "2fr 1fr" }}>
          {/* Map Card */}
          <div style={styles.mapCard}>
            <div style={{ borderRadius: "16px", height: "450px", overflow: "hidden" }}>
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
                center={position ? { lat: position.lat, lng: position.lng } : defaultCenter}
                zoom={16}
                onLoad={onLoad}
                onUnmount={onUnmount}
                options={{ disableDefaultUI: true, styles: darkMapStyles, zoomControl: true }}
              >
                {position && (
                  <Marker
                    position={{ lat: position.lat, lng: position.lng }}
                    icon={{
                      anchor: new google.maps.Point(25, 25),
                      scaledSize: new google.maps.Size(50, 50),
                      url: "/car-icon.svg",
                    }}
                  />
                )}
              </GoogleMap>
            </div>
            {position && (
              <div style={styles.locationInfo}>
                <FaMapMarkerAlt style={{ color: "#22c55e" }} />
                <span style={{ fontFamily: "monospace" }}>
                  {position.lat.toFixed(6)}, {position.lng.toFixed(6)}
                </span>
              </div>
            )}
          </div>

          {/* Control Panel */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Status Card */}
            <div style={styles.card}>
              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "24px",
                }}
              >
                <h2 style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: 0 }}>
                  Status
                </h2>
                <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                  <div
                    style={{
                      animation: isOnline ? "pulse 2s infinite" : "none",
                      background: isOnline ? "#22c55e" : "#64748b",
                      borderRadius: "50%",
                      height: "12px",
                      width: "12px",
                    }}
                  />
                  <span
                    style={{
                      color: isOnline ? "#4ade80" : "#94a3b8",
                      fontSize: "14px",
                      fontWeight: 500,
                    }}
                  >
                    {isOnline ? "Online" : "Offline"}
                  </span>
                </div>
              </div>

              {isOnline && (
                <div style={styles.sessionTimer}>
                  <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
                    <FaClock style={{ color: "#22c55e", fontSize: "20px" }} />
                    <div>
                      <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>Session Time</p>
                      <p
                        style={{
                          color: "white",
                          fontFamily: "monospace",
                          fontSize: "28px",
                          fontWeight: 700,
                          margin: 0,
                        }}
                      >
                        {formatTime(sessionTime)}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {error && (
                <div
                  style={{
                    background: "rgba(239, 68, 68, 0.1)",
                    border: "1px solid rgba(239, 68, 68, 0.2)",
                    borderRadius: "12px",
                    color: "#f87171",
                    fontSize: "14px",
                    marginBottom: "24px",
                    padding: "12px 16px",
                  }}
                >
                  {error}
                </div>
              )}

              {isOnline && (
                <div style={{ marginBottom: "24px" }}>
                  <p style={{ color: "#94a3b8", fontSize: "14px", marginBottom: "12px" }}>
                    Availability
                  </p>
                  <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "1fr 1fr" }}>
                    <button
                      type="button"
                      onClick={() => setStatus("AVAILABLE")}
                      style={styles.statusBtn(status === "AVAILABLE", "available")}
                    >
                      Available
                    </button>
                    <button
                      type="button"
                      onClick={() => setStatus("BUSY")}
                      style={styles.statusBtn(status === "BUSY", "busy")}
                    >
                      Busy
                    </button>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={isOnline ? goOffline : goOnline}
                style={isOnline ? styles.buttonOffline : styles.buttonOnline}
              >
                {isOnline ? (
                  <>
                    <FaPowerOff /> Go Offline
                  </>
                ) : (
                  <>
                    <FaCar /> Go Online
                  </>
                )}
              </button>
            </div>

            {/* Driver Info Card */}
            <div style={styles.card}>
              <h2 style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: "0 0 16px" }}>
                Driver Info
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#94a3b8", fontSize: "14px" }}>ID</span>
                  <span style={{ color: "white", fontFamily: "monospace", fontSize: "14px" }}>
                    {userId.slice(0, 16)}...
                  </span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#94a3b8", fontSize: "14px" }}>Vehicle</span>
                  <span style={{ color: "white", fontSize: "14px" }}>Eco Car</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#94a3b8", fontSize: "14px" }}>Mode</span>
                  <span
                    style={{
                      alignItems: "center",
                      color: "#4ade80",
                      display: "flex",
                      fontSize: "14px",
                      gap: "4px",
                    }}
                  >
                    <FaLeaf style={{ fontSize: "12px" }} /> Electric
                  </span>
                </div>
              </div>
            </div>
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
