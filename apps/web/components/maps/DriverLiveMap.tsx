"use client";

import {
  DirectionsRenderer,
  GoogleMap,
  type Libraries,
  Marker,
  useJsApiLoader,
} from "@react-google-maps/api";
import { onDisconnect, onValue, ref, remove, set } from "firebase/database";
import * as geofire from "geofire-common";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaCar,
  FaCheckCircle,
  FaClock,
  FaFlagCheckered,
  FaLeaf,
  FaMapMarkerAlt,
  FaPlay,
  FaPowerOff,
  FaRoute,
} from "react-icons/fa";
import { backendUrl } from "@/config";
import { auth, db, rtdb } from "@/lib/firebase";
import { darkMapStyles, lightMapStyles } from "@/lib/mapStyles";

interface DriverLocation {
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY";
  lastUpdated: number;
  vehicleType?: string;
  geohash: string;
}

interface Position {
  lat: number;
  lng: number;
  heading: number;
}

interface AssignedRide {
  rideId: string;
  riderId: string;
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  timestamp: number;
  status?: "MATCHED" | "IN_PROGRESS";
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

// Use same libraries as RiderMap to avoid loader conflict
const libraries: Libraries = ["places"];

interface DriverLiveMapProps {
  embedded?: boolean;
  darkMode?: boolean;
}

export default function DriverLiveMap({
  embedded = false,
  darkMode = true,
}: DriverLiveMapProps): React.ReactNode {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    id: "google-map-script",
    libraries,
  });

  const [isOnline, setIsOnline] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [status, setStatus] = useState<"AVAILABLE" | "BUSY">("AVAILABLE");
  const [error, setError] = useState<string | null>(null);
  const [sessionTime, setSessionTime] = useState(0);
  const [manualLocationMode, setManualLocationMode] = useState(false);

  // OTP State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [submittingOtp, setSubmittingOtp] = useState(false);

  // Payment Popup State
  const [finishedRideId, setFinishedRideId] = useState<string | null>(null);
  const [showPaymentPopup, setShowPaymentPopup] = useState(false);
  const [receivedAmount, setReceivedAmount] = useState(0);

  // Ride assignment state
  const [assignedRide, setAssignedRide] = useState<AssignedRide | null>(null);
  // Color-coded routes: blue for driver->pickup, green for pickup->destination
  const [directionsToPickup, setDirectionsToPickup] = useState<google.maps.DirectionsResult | null>(
    null,
  );
  const [directionsToDestination, setDirectionsToDestination] =
    useState<google.maps.DirectionsResult | null>(null);

  const watchIdRef = useRef<number | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const sessionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

  const userId = auth?.currentUser?.uid || `test-driver-${Date.now()}`;

  const [driverName, setDriverName] = useState<string | null>(null);

  useEffect(() => {
    const fetchDriverName = async () => {
      if (!userId || !db) return;
      try {
        const { doc, getDoc } = await import("firebase/firestore");
        const userDocRef = doc(db, "users", userId);
        const userDoc = await getDoc(userDocRef);
        if (userDoc.exists()) {
          const userData = userDoc.data();
          setDriverName(userData.name || "Unknown Driver");
        }
      } catch (error) {
        console.error("Error fetching driver name:", error);
      }
    };
    fetchDriverName();
  }, [userId]);

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

  // Update Firebase immediately when status changes while online
  useEffect(() => {
    if (isOnline && position && rtdb) {
      const driverRef = ref(rtdb, `drivers-online/${userId}`);
      const hash = geofire.geohashForLocation([position.lat, position.lng]);
      const locationData: DriverLocation = {
        geohash: hash,
        heading: position.heading,
        lastUpdated: Date.now(),
        lat: position.lat,
        lng: position.lng,
        status,
        vehicleType: "CAR",
      };
      set(driverRef, locationData).catch((err) => {
        console.error("Failed to update status:", err);
      });
    }
  }, [status, isOnline, position, userId]);

  // Listen for ride assignments from RTDB
  useEffect(() => {
    if (!rtdb || !isOnline) {
      setAssignedRide(null);
      setDirectionsToPickup(null);
      setDirectionsToDestination(null);
      return;
    }

    const assignedRideRef = ref(rtdb, `rides-assigned/${userId}`);

    const unsubscribe = onValue(assignedRideRef, (snapshot) => {
      const data = snapshot.val() as AssignedRide | null;
      if (data) {
        console.log("Ride assigned:", data);
        setAssignedRide(data);
        // Reset local ride status to saved status or MATCHED
        setRideStatus(data.status || "MATCHED");
        // Auto-set status to BUSY when assigned
        setStatus("BUSY");
      } else {
        setAssignedRide(null);
        setDirectionsToPickup(null);
        setDirectionsToDestination(null);
      }
    });

    return () => unsubscribe();
  }, [isOnline, userId]);

  const [rideStatus, setRideStatus] = useState<"MATCHED" | "IN_PROGRESS" | "COMPLETED">("MATCHED");

  const handleStartRideClick = () => {
    setShowOtpModal(true);
    setOtpInput("");
  };

  const handleSubmitOtp = async () => {
    if (!assignedRide || !otpInput || otpInput.length !== 4) {
      alert("Please enter a valid 4-digit OTP");
      return;
    }

    setSubmittingOtp(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${backendUrl}/api/v1/ride/start`, {
        body: JSON.stringify({ otp: otpInput, rideId: assignedRide.rideId }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setRideStatus("IN_PROGRESS");
        setShowOtpModal(false);
      } else {
        console.error("Failed to start ride:", data.message);
        alert(data.message || "Failed to start ride. Check OTP.");
      }
    } catch (err) {
      console.error("Error starting ride:", err);
      alert("Error starting ride. Please try again.");
    } finally {
      setSubmittingOtp(false);
    }
  };

  const handleCompleteRide = async () => {
    if (!assignedRide) return;
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${backendUrl}/api/v1/ride/complete`, {
        body: JSON.stringify({ rideId: assignedRide.rideId }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });
      if (res.ok) {
        setFinishedRideId(assignedRide.rideId); // Track for payment
        setRideStatus("COMPLETED");
        setAssignedRide(null);
        setDirectionsToPickup(null);
        setDirectionsToDestination(null);
        setStatus("AVAILABLE"); // Reset driver status
      } else {
        console.error("Failed to complete ride");
      }
    } catch (err) {
      console.error("Error completing ride:", err);
    }
  };

  // Calculate routes when ride is assigned
  useEffect(() => {
    if (!isLoaded || !assignedRide || !position) {
      return;
    }

    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }

    // Calculate route 1: Driver -> Pickup (BLUE route)
    directionsServiceRef.current.route(
      {
        destination: assignedRide.pickup,
        origin: { lat: position.lat, lng: position.lng },
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          setDirectionsToPickup(result);
        } else {
          console.error("Directions to pickup failed:", status);
        }
      },
    );

    // Calculate route 2: Pickup -> Destination (GREEN route)
    directionsServiceRef.current.route(
      {
        destination: assignedRide.drop,
        origin: assignedRide.pickup,
        travelMode: google.maps.TravelMode.DRIVING,
      },
      (result, status) => {
        if (status === google.maps.DirectionsStatus.OK && result) {
          setDirectionsToDestination(result);
        } else {
          console.error("Directions to destination failed:", status);
        }
      },
    );
  }, [isLoaded, assignedRide, position]);

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
      // Calculate geohash for efficient geo-queries
      const hash = geofire.geohashForLocation([pos.lat, pos.lng]);
      const locationData: DriverLocation = {
        geohash: hash,
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

  const [greenPointsRedeemed, setGreenPointsRedeemed] = useState(0);

  // Listen for payment confirmation
  useEffect(() => {
    if (!finishedRideId || !rtdb) return;

    const rideRef = ref(rtdb, `rides/${finishedRideId}`);
    const unsubscribe = onValue(rideRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.paymentStatus === "PAID") {
        setReceivedAmount(data.paidAmount || 0);
        setGreenPointsRedeemed(data.greenPointsRedeemed || 0);
        setShowPaymentPopup(true);
      }
    });

    return () => unsubscribe();
  }, [finishedRideId]);

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
        // Instead of blocking, enable manual location mode
        setError("Location unavailable. Use 'Set Location on Map' to set your position.");
        setManualLocationMode(true);
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

  // Handle map click to set location manually
  const onMapClick = useCallback(
    async (e: google.maps.MapMouseEvent) => {
      if (!manualLocationMode || !isOnline || !e.latLng) return;

      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      const newPos: Position = { heading: position?.heading ?? 0, lat, lng };

      setPosition(newPos);
      prevPositionRef.current = { lat, lng };

      // Write to Firebase
      await writeLocationToFirebase(newPos);

      // Exit manual mode after setting location
      setManualLocationMode(false);
    },
    [manualLocationMode, isOnline, position, writeLocationToFirebase],
  );

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

  const pageStyle = embedded ? { padding: "24px" } : styles.page;

  return (
    <div style={pageStyle}>
      {/* Header - only show when not embedded */}
      {!embedded && (
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
                <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>
                  EcoRide Live Tracking
                </p>
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
      )}

      {/* Main Content */}
      <main style={{ margin: "0 auto", maxWidth: "1024px" }}>
        <div style={{ display: "grid", gap: "24px", gridTemplateColumns: "2fr 1fr" }}>
          {/* Map Card */}
          <div style={styles.mapCard}>
            <div
              style={{
                borderRadius: "16px",
                height: "450px",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {/* Manual location mode indicator */}
              {manualLocationMode && (
                <div
                  style={{
                    alignItems: "center",
                    background: "rgba(34, 197, 94, 0.9)",
                    color: "white",
                    display: "flex",
                    fontSize: "14px",
                    fontWeight: 600,
                    gap: "8px",
                    justifyContent: "center",
                    left: 0,
                    padding: "10px",
                    position: "absolute",
                    right: 0,
                    top: 0,
                    zIndex: 10,
                  }}
                >
                  <FaMapMarkerAlt /> Click on the map to set your location
                </div>
              )}
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
                center={defaultCenter}
                zoom={16}
                onLoad={onLoad}
                onUnmount={onUnmount}
                onClick={onMapClick}
                options={{
                  disableDefaultUI: true,
                  draggableCursor: manualLocationMode ? "crosshair" : undefined,
                  gestureHandling: "greedy",
                  styles: darkMode ? darkMapStyles : lightMapStyles,
                  zoomControl: true,
                }}
              >
                {/* Route Directions - Driver to Pickup (BLUE) */}
                {directionsToPickup && (
                  <DirectionsRenderer
                    directions={directionsToPickup}
                    options={{
                      polylineOptions: {
                        strokeColor: "#3b82f6",
                        strokeOpacity: 0.9,
                        strokeWeight: 5,
                      },
                      suppressMarkers: true,
                    }}
                  />
                )}

                {/* Route Directions - Pickup to Destination (GREEN) */}
                {directionsToDestination && (
                  <DirectionsRenderer
                    directions={directionsToDestination}
                    options={{
                      polylineOptions: {
                        strokeColor: "#22c55e",
                        strokeOpacity: 0.9,
                        strokeWeight: 5,
                      },
                      suppressMarkers: true,
                    }}
                  />
                )}

                {/* Driver Position Marker */}
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

                {/* Pickup Location Marker */}
                {assignedRide && (
                  <Marker
                    position={assignedRide.pickup}
                    icon={{
                      anchor: new google.maps.Point(12, 12),
                      fillColor: "#3b82f6",
                      fillOpacity: 1,
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 12,
                      strokeColor: "#fff",
                      strokeWeight: 3,
                    }}
                    title="Pickup Location"
                  />
                )}

                {/* Destination Marker */}
                {assignedRide && (
                  <Marker
                    position={assignedRide.drop}
                    icon={{
                      anchor: new google.maps.Point(12, 12),
                      fillColor: "#22c55e",
                      fillOpacity: 1,
                      path: google.maps.SymbolPath.CIRCLE,
                      scale: 12,
                      strokeColor: "#fff",
                      strokeWeight: 3,
                    }}
                    title="Destination"
                  />
                )}
              </GoogleMap>

              {/* Route Legend - Show when ride is assigned */}
              {assignedRide && (directionsToPickup || directionsToDestination) && (
                <div
                  style={{
                    background: "rgba(15, 23, 42, 0.9)",
                    borderRadius: "12px",
                    bottom: "16px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "8px",
                    left: "16px",
                    padding: "12px 16px",
                    position: "absolute",
                    zIndex: 10,
                  }}
                >
                  <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                    <div
                      style={{
                        background: "#3b82f6",
                        borderRadius: "2px",
                        height: "4px",
                        width: "24px",
                      }}
                    />
                    <span style={{ color: "#94a3b8", fontSize: "12px" }}>To pickup</span>
                  </div>
                  <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                    <div
                      style={{
                        background: "#22c55e",
                        borderRadius: "2px",
                        height: "4px",
                        width: "24px",
                      }}
                    />
                    <span style={{ color: "#94a3b8", fontSize: "12px" }}>To destination</span>
                  </div>
                </div>
              )}
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
            {/* Assigned Ride Card - Show when ride is assigned */}
            {assignedRide && (
              <div
                style={{
                  background:
                    "linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(34, 197, 94, 0.2))",
                  border: "2px solid rgba(59, 130, 246, 0.5)",
                  borderRadius: "24px",
                  padding: "24px",
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "12px",
                    marginBottom: "16px",
                  }}
                >
                  <FaRoute style={{ color: "#3b82f6", fontSize: "24px" }} />
                  <div>
                    <h2 style={{ color: "#fff", fontSize: "18px", fontWeight: 700, margin: 0 }}>
                      {rideStatus === "IN_PROGRESS" ? "Trip in Progress" : "Ride Assigned!"}
                    </h2>
                    <p style={{ color: "#94a3b8", fontSize: "12px", margin: "2px 0 0" }}>
                      {rideStatus === "IN_PROGRESS" ? "Head to destination" : "Follow local laws"}
                    </p>
                  </div>
                </div>
                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                    marginBottom: "20px",
                  }}
                >
                  <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                    <div
                      style={{
                        background: rideStatus === "IN_PROGRESS" ? "#64748b" : "#3b82f6",
                        borderRadius: "50%",
                        height: "10px",
                        width: "10px",
                      }}
                    />
                    <span
                      style={{
                        color: rideStatus === "IN_PROGRESS" ? "#64748b" : "#94a3b8",
                        fontSize: "13px",
                        textDecoration: rideStatus === "IN_PROGRESS" ? "line-through" : "none",
                      }}
                    >
                      Pickup: {assignedRide.pickup.lat.toFixed(4)},{" "}
                      {assignedRide.pickup.lng.toFixed(4)}
                    </span>
                  </div>
                  <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                    <div
                      style={{
                        background: "#22c55e",
                        borderRadius: "50%",
                        height: "10px",
                        width: "10px",
                      }}
                    />
                    <span style={{ color: "#94a3b8", fontSize: "13px" }}>
                      Drop: {assignedRide.drop.lat.toFixed(4)}, {assignedRide.drop.lng.toFixed(4)}
                    </span>
                  </div>
                </div>

                {rideStatus === "MATCHED" ? (
                  <button
                    type="button"
                    onClick={() => {
                      handleStartRideClick();
                    }}
                    style={{
                      background: "linear-gradient(90deg, #3b82f6, #2563eb)",
                      border: "none",
                      borderRadius: "12px",
                      color: "white",
                      cursor: "pointer",
                      display: "flex",
                      fontSize: "16px",
                      fontWeight: 600,
                      gap: "8px",
                      justifyContent: "center",
                      padding: "12px",
                      width: "100%",
                    }}
                  >
                    <FaPlay /> Start Trip
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      handleCompleteRide();
                    }}
                    style={{
                      background: "linear-gradient(90deg, #22c55e, #16a34a)",
                      border: "none",
                      borderRadius: "12px",
                      color: "white",
                      cursor: "pointer",
                      display: "flex",
                      fontSize: "16px",
                      fontWeight: 600,
                      gap: "8px",
                      justifyContent: "center",
                      padding: "12px",
                      width: "100%",
                    }}
                  >
                    <FaFlagCheckered /> Complete Trip
                  </button>
                )}
              </div>
            )}

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

              {/* Manual Location Button - Show when online */}
              {isOnline && (
                <div style={{ marginBottom: "24px" }}>
                  <button
                    type="button"
                    onClick={() => setManualLocationMode(!manualLocationMode)}
                    style={{
                      alignItems: "center",
                      background: manualLocationMode
                        ? "linear-gradient(135deg, #22c55e, #10b981)"
                        : "rgba(30, 41, 59, 0.8)",
                      border: manualLocationMode ? "none" : "2px solid rgba(71, 85, 105, 0.5)",
                      borderRadius: "12px",
                      color: manualLocationMode ? "white" : "#94a3b8",
                      cursor: "pointer",
                      display: "flex",
                      fontSize: "14px",
                      fontWeight: 600,
                      gap: "10px",
                      justifyContent: "center",
                      padding: "14px 20px",
                      transition: "all 0.3s ease",
                      width: "100%",
                    }}
                  >
                    <FaMapMarkerAlt />
                    {manualLocationMode ? "Cancel Set Location" : "Set Location on Map"}
                  </button>
                  <p
                    style={{
                      color: "#64748b",
                      fontSize: "12px",
                      marginTop: "8px",
                      textAlign: "center",
                    }}
                  >
                    Click the button, then click on the map to set your location
                  </p>
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
                  <span style={{ color: "#94a3b8", fontSize: "14px" }}>Name</span>
                  <span style={{ color: "white", fontFamily: "monospace", fontSize: "14px" }}>
                    {driverName || "Loading..."}
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

      {/* OTP Modal */}
      {showOtpModal && (
        <div
          style={{
            alignItems: "center",
            backdropFilter: "blur(5px)",
            backgroundColor: "rgba(0, 0, 0, 0.7)",
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            left: 0,
            position: "fixed",
            right: 0,
            top: 0,
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "rgba(30, 41, 59, 1)",
              border: "1px solid rgba(71, 85, 105, 0.5)",
              borderRadius: "24px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
              maxWidth: "400px",
              padding: "32px",
              width: "90%",
            }}
          >
            <h2
              style={{
                color: "white",
                fontSize: "24px",
                fontWeight: 700,
                margin: "0 0 16px",
                textAlign: "center",
              }}
            >
              Enter OTP
            </h2>
            <p
              style={{
                color: "#94a3b8",
                fontSize: "14px",
                marginBottom: "24px",
                textAlign: "center",
              }}
            >
              Ask the rider for the 4-digit OTP to start the trip.
            </p>

            <input
              type="text"
              value={otpInput}
              onChange={(e) => setOtpInput(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
              placeholder="0000"
              style={{
                background: "rgba(15, 23, 42, 0.5)",
                border: "2px solid rgba(59, 130, 246, 0.5)",
                borderRadius: "12px",
                color: "white",
                fontSize: "32px",
                fontWeight: "bold",
                letterSpacing: "8px",
                marginBottom: "24px",
                outline: "none",
                padding: "16px",
                textAlign: "center",
                width: "100%",
              }}
            />

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                onClick={() => setShowOtpModal(false)}
                type="button"
                style={{
                  background: "transparent",
                  border: "1px solid rgba(148, 163, 184, 0.3)",
                  borderRadius: "12px",
                  color: "#cbd5e1",
                  cursor: "pointer",
                  flex: 1,
                  fontSize: "16px",
                  fontWeight: 600,
                  padding: "12px",
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitOtp}
                type="button"
                disabled={submittingOtp || otpInput.length !== 4}
                style={{
                  background: "linear-gradient(90deg, #22c55e, #16a34a)",
                  border: "none",
                  borderRadius: "12px",
                  color: "white",
                  cursor: submittingOtp || otpInput.length !== 4 ? "not-allowed" : "pointer",
                  flex: 1,
                  fontSize: "16px",
                  fontWeight: 600,
                  opacity: submittingOtp || otpInput.length !== 4 ? 0.7 : 1,
                  padding: "12px",
                }}
              >
                {submittingOtp ? "Verifying..." : "Start Trip"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Received Popup */}
      {showPaymentPopup && (
        <div
          style={{
            alignItems: "center",
            backdropFilter: "blur(8px)",
            backgroundColor: "rgba(0, 0, 0, 0.8)",
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            left: 0,
            position: "fixed",
            right: 0,
            top: 0,
            zIndex: 1100,
          }}
        >
          <div
            style={{
              alignItems: "center",
              background: "rgba(30, 41, 59, 0.95)",
              border: "1px solid rgba(34, 197, 94, 0.5)",
              borderRadius: "24px",
              boxShadow: "0 25px 50px -12px rgba(34, 197, 94, 0.25)",
              display: "flex",
              flexDirection: "column",
              maxWidth: "400px",
              padding: "40px",
              textAlign: "center",
              width: "90%",
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: "rgba(34, 197, 94, 0.2)",
                borderRadius: "50%",
                display: "flex",
                height: "96px",
                justifyContent: "center",
                marginBottom: "24px",
                width: "96px",
              }}
            >
              <FaCheckCircle style={{ color: "#22c55e", fontSize: "48px" }} />
            </div>

            <h2
              style={{ color: "white", fontSize: "24px", fontWeight: "bold", margin: "0 0 16px" }}
            >
              Payment Received
            </h2>

            <p style={{ color: "#94a3b8", fontSize: "16px", margin: "0 0 8px" }}>Amount Paid</p>

            <p
              style={{ color: "#ffffff", fontSize: "36px", fontWeight: "bold", margin: "0 0 32px" }}
            >
              ₹{receivedAmount + (greenPointsRedeemed || 0)}
            </p>

            <button
              type="button"
              onClick={() => {
                setShowPaymentPopup(false);
                setFinishedRideId(null);
              }}
              style={{
                background: "linear-gradient(90deg, #22c55e, #16a34a)",
                border: "none",
                borderRadius: "16px",
                boxShadow: "0 10px 25px -5px rgba(34, 197, 94, 0.4)",
                color: "white",
                cursor: "pointer",
                fontSize: "18px",
                fontWeight: "600",
                padding: "16px",
                transition: "transform 0.2s",
                width: "100%",
              }}
            >
              Okay
            </button>
          </div>
        </div>
      )}

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
