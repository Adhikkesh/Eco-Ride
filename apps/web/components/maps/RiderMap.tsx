"use client";

import { Autocomplete, GoogleMap, Marker, useJsApiLoader } from "@react-google-maps/api";
import { onValue, ref } from "firebase/database";
import { doc, getDoc } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaCar,
  FaGift,
  FaLeaf,
  FaMapMarkerAlt,
  FaRoute,
  FaSearch,
  FaSync,
  FaUsers,
} from "react-icons/fa";
import { auth, db, rtdb } from "@/lib/firebase";
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

interface UserStats {
  ridesTaken: number;
  trustScore: number;
  greenPoints: number;
  moneySaved: number;
}

interface UserData {
  green_points?: number;
  trust_score?: number;
}

type Libraries = "places"[];
const libraries: Libraries = ["places"];

// ---------------------------------------------------------
// Styles
// ---------------------------------------------------------
const styles = {
  actionButton: {
    alignItems: "center",
    background: "linear-gradient(135deg, #22c55e, #10b981)",
    border: "none",
    borderRadius: "16px",
    boxShadow: "0 8px 24px rgba(34, 197, 94, 0.3)",
    color: "white",
    cursor: "pointer",
    display: "flex",
    fontSize: "16px",
    fontWeight: 600,
    gap: "12px",
    justifyContent: "center",
    padding: "16px 24px",
    transition: "all 0.3s ease",
    width: "100%",
  } as React.CSSProperties,
  actionCard: {
    background: "rgba(30, 41, 59, 0.9)",
    border: "1px solid rgba(71, 85, 105, 0.5)",
    borderRadius: "20px",
    boxShadow: "0 4px 16px rgba(0, 0, 0, 0.2)",
    cursor: "pointer",
    padding: "20px",
    transition: "all 0.3s ease",
  } as React.CSSProperties,
  card: {
    backdropFilter: "blur(12px)",
    background: "rgba(30, 41, 59, 0.9)",
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
  impactCard: {
    background: "rgba(15, 23, 42, 0.6)",
    borderRadius: "16px",
    padding: "16px",
    textAlign: "center",
  } as React.CSSProperties,
  mapCard: {
    backdropFilter: "blur(12px)",
    background: "rgba(30, 41, 59, 0.9)",
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
  searchInput: {
    background: "rgba(15, 23, 42, 0.8)",
    border: "2px solid rgba(34, 197, 94, 0.3)",
    borderRadius: "12px",
    color: "white",
    fontSize: "15px",
    outline: "none",
    padding: "14px 16px 14px 48px",
    transition: "all 0.2s ease",
    width: "100%",
  } as React.CSSProperties,
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
interface RiderMapProps {
  embedded?: boolean;
}

export default function RiderMap({ embedded = false }: RiderMapProps): React.ReactNode {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    id: "google-map-script",
    libraries,
  });

  const [drivers, setDrivers] = useState<Map<string, DriverMarker>>(new Map());
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [searchDestination, setSearchDestination] = useState("");
  const [selectedDestination, setSelectedDestination] = useState<{
    lat: number;
    lng: number;
    name: string;
  } | null>(null);
  const [userStats, setUserStats] = useState<UserStats>({
    greenPoints: 0,
    moneySaved: 0,
    ridesTaken: 0,
    trustScore: 0,
  });

  const mapRef = useRef<google.maps.Map | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);

  // Get current location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Error getting location:", error);
        },
        { enableHighAccuracy: true },
      );

      // Watch for location changes
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          setCurrentLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          });
        },
        (error) => {
          console.error("Error watching location:", error);
        },
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 },
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, []);

  // Fetch user stats from Firestore when user is authenticated
  useEffect(() => {
    // Import onAuthStateChanged dynamically
    const { onAuthStateChanged } = require("firebase/auth");

    const unsubscribe = onAuthStateChanged(auth, async (user: { uid: string } | null) => {
      if (user && db) {
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          if (userDoc.exists()) {
            const data = userDoc.data() as UserData;
            setUserStats((prev) => ({
              ...prev,
              greenPoints: data.green_points ?? 0,
              trustScore: data.trust_score ?? 0,
            }));
          }
        } catch (error) {
          console.error("Error fetching user stats:", error);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Listen to online drivers
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

  // Animate driver markers
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

  const onAutocompleteLoad = useCallback((autocomplete: google.maps.places.Autocomplete) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const onPlaceChanged = useCallback(() => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();
      if (place.geometry?.location) {
        const location = {
          lat: place.geometry.location.lat(),
          lng: place.geometry.location.lng(),
          name: place.name || place.formatted_address || "Selected Location",
        };
        setSelectedDestination(location);
        setSearchDestination(location.name);

        // Pan map to selected location
        if (mapRef.current) {
          mapRef.current.panTo({ lat: location.lat, lng: location.lng });
          mapRef.current.setZoom(15);
        }
      }
    }
  }, []);

  const handleFindRide = () => {
    // TODO: Implement ride finding logic
    alert("Finding rides near you...");
  };

  const handleViewRewards = () => {
    // TODO: Navigate to rewards page
    alert("Viewing your green rewards...");
  };

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

  const driverArray = Array.from(drivers.values());
  const availableCount = driverArray.filter((d) => d.status === "AVAILABLE").length;
  const busyCount = driverArray.filter((d) => d.status === "BUSY").length;

  const pageStyle = embedded ? { padding: "24px" } : styles.page;

  return (
    <div style={pageStyle}>
      {/* Header - only show when not embedded */}
      {!embedded && (
        <header style={{ margin: "0 auto 24px", maxWidth: "1400px" }}>
          <div style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
            <div style={{ alignItems: "center", display: "flex", gap: "16px" }}>
              <div style={styles.headerIcon}>
                <FaMapMarkerAlt style={{ color: "white", fontSize: "24px" }} />
              </div>
              <div>
                <h1 style={{ color: "white", fontSize: "28px", fontWeight: 700, margin: 0 }}>
                  Find Your Ride
                </h1>
                <p style={{ color: "#94a3b8", fontSize: "14px", margin: 0 }}>
                  Eco-friendly carpooling near you
                </p>
              </div>
            </div>
            <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
              <div style={styles.statusDot(isConnected)} />
              <span style={{ color: "#e2e8f0", fontSize: "14px", fontWeight: 500 }}>
                {isConnected ? "Live" : "Disconnected"}
              </span>
              {currentLocation && (
                <span style={{ color: "#94a3b8", fontSize: "12px", marginLeft: "16px" }}>
                  <FaMapMarkerAlt style={{ marginRight: "4px" }} />
                  {currentLocation.lat.toFixed(4)}, {currentLocation.lng.toFixed(4)}
                </span>
              )}
            </div>
          </div>
        </header>
      )}

      {/* Main Content */}
      <main style={{ margin: "0 auto", maxWidth: "1400px" }}>
        <div style={{ display: "grid", gap: "24px", gridTemplateColumns: "1fr 380px" }}>
          {/* Left Column - Map and Search */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Search Card */}
            <div style={styles.card}>
              <div style={{ marginBottom: "16px" }}>
                <h2
                  style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: "0 0 16px" }}
                >
                  <FaSearch style={{ marginRight: "8px" }} />
                  Search Destination
                </h2>
                <div style={{ position: "relative" }}>
                  <FaSearch
                    style={{
                      color: "#22c55e",
                      fontSize: "18px",
                      left: "16px",
                      position: "absolute",
                      top: "50%",
                      transform: "translateY(-50%)",
                    }}
                  />
                  <Autocomplete onLoad={onAutocompleteLoad} onPlaceChanged={onPlaceChanged}>
                    <input
                      type="text"
                      placeholder="Where do you want to go?"
                      value={searchDestination}
                      onChange={(e) => setSearchDestination(e.target.value)}
                      style={styles.searchInput}
                    />
                  </Autocomplete>
                </div>
                {selectedDestination && (
                  <div
                    style={{
                      alignItems: "center",
                      background: "rgba(34, 197, 94, 0.1)",
                      border: "1px solid rgba(34, 197, 94, 0.3)",
                      borderRadius: "12px",
                      color: "#4ade80",
                      display: "flex",
                      fontSize: "14px",
                      gap: "8px",
                      marginTop: "12px",
                      padding: "12px 16px",
                    }}
                  >
                    <FaRoute />
                    <span>Destination: {selectedDestination.name}</span>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={handleFindRide}
                style={styles.actionButton}
                onMouseEnter={(e) => {
                  e.currentTarget.style.transform = "translateY(-2px)";
                  e.currentTarget.style.boxShadow = "0 12px 28px rgba(34, 197, 94, 0.4)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.transform = "translateY(0)";
                  e.currentTarget.style.boxShadow = "0 8px 24px rgba(34, 197, 94, 0.3)";
                }}
              >
                <FaCar style={{ fontSize: "20px" }} />
                Find a Ride
              </button>
            </div>

            {/* Map Card */}
            <div style={styles.mapCard}>
              <div style={{ borderRadius: "16px", height: "450px", overflow: "hidden" }}>
                <GoogleMap
                  mapContainerStyle={mapContainerStyle}
                  center={currentLocation || defaultCenter}
                  zoom={14}
                  onLoad={onLoad}
                  onUnmount={onUnmount}
                  options={{
                    disableDefaultUI: true,
                    styles: darkMapStyles,
                    zoomControl: true,
                  }}
                >
                  {/* Current Location Marker */}
                  {currentLocation && (
                    <Marker
                      position={currentLocation}
                      icon={{
                        anchor: new google.maps.Point(12, 12),
                        fillColor: "#22c55e",
                        fillOpacity: 1,
                        path: google.maps.SymbolPath.CIRCLE,
                        scale: 12,
                        strokeColor: "#ffffff",
                        strokeWeight: 3,
                      }}
                      title="Your Location"
                    />
                  )}

                  {/* Destination Marker */}
                  {selectedDestination && (
                    <Marker
                      position={{ lat: selectedDestination.lat, lng: selectedDestination.lng }}
                      icon={{
                        anchor: new google.maps.Point(20, 40),
                        scaledSize: new google.maps.Size(40, 40),
                        url:
                          "data:image/svg+xml;charset=UTF-8," +
                          encodeURIComponent(`
                          <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24">
                            <path fill="#ef4444" d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5a2.5 2.5 0 0 1 0-5 2.5 2.5 0 0 1 0 5z"/>
                          </svg>
                        `),
                      }}
                      title={selectedDestination.name}
                    />
                  )}

                  {/* Driver Markers */}
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
                      title={`Driver (${driver.status})`}
                    />
                  ))}
                </GoogleMap>
              </div>
            </div>
          </div>

          {/* Right Column - Actions and Stats */}
          <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
            {/* Quick Actions */}
            <div style={styles.card}>
              <h2 style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: "0 0 20px" }}>
                Quick Actions
              </h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                <button
                  type="button"
                  style={styles.actionCard}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-4px)";
                    e.currentTarget.style.borderColor = "rgba(34, 197, 94, 0.5)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.5)";
                  }}
                  onClick={handleFindRide}
                >
                  <div style={{ alignItems: "center", display: "flex", gap: "16px" }}>
                    <div
                      style={{
                        alignItems: "center",
                        background: "rgba(34, 197, 94, 0.2)",
                        borderRadius: "12px",
                        display: "flex",
                        height: "48px",
                        justifyContent: "center",
                        width: "48px",
                      }}
                    >
                      <FaCar style={{ color: "#4ade80", fontSize: "20px" }} />
                    </div>
                    <div>
                      <h3 style={{ color: "white", fontSize: "16px", fontWeight: 600, margin: 0 }}>
                        Find a Ride
                      </h3>
                      <p style={{ color: "#94a3b8", fontSize: "13px", margin: "4px 0 0" }}>
                        Search for available carpools near you
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  style={styles.actionCard}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = "translateY(-4px)";
                    e.currentTarget.style.borderColor = "rgba(34, 197, 94, 0.5)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.borderColor = "rgba(71, 85, 105, 0.5)";
                  }}
                  onClick={handleViewRewards}
                >
                  <div style={{ alignItems: "center", display: "flex", gap: "16px" }}>
                    <div
                      style={{
                        alignItems: "center",
                        background: "rgba(34, 197, 94, 0.2)",
                        borderRadius: "12px",
                        display: "flex",
                        height: "48px",
                        justifyContent: "center",
                        width: "48px",
                      }}
                    >
                      <FaGift style={{ color: "#4ade80", fontSize: "20px" }} />
                    </div>
                    <div>
                      <h3 style={{ color: "white", fontSize: "16px", fontWeight: 600, margin: 0 }}>
                        Green Rewards
                      </h3>
                      <p style={{ color: "#94a3b8", fontSize: "13px", margin: "4px 0 0" }}>
                        Check your eco-points and redeem
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Your Impact */}
            <div style={styles.card}>
              <div
                style={{ alignItems: "center", display: "flex", gap: "12px", marginBottom: "20px" }}
              >
                <FaLeaf style={{ color: "#22c55e", fontSize: "20px" }} />
                <h2 style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: 0 }}>
                  Your Impact 🌍
                </h2>
              </div>

              <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "1fr 1fr" }}>
                <div style={styles.impactCard as React.CSSProperties}>
                  <p style={{ color: "#4ade80", fontSize: "28px", fontWeight: 700, margin: 0 }}>
                    {userStats.ridesTaken}
                  </p>
                  <p style={{ color: "#94a3b8", fontSize: "12px", margin: "4px 0 0" }}>
                    Rides Taken
                  </p>
                </div>
                <div style={styles.impactCard as React.CSSProperties}>
                  <p style={{ color: "#4ade80", fontSize: "28px", fontWeight: 700, margin: 0 }}>
                    {userStats.trustScore}%
                  </p>
                  <p style={{ color: "#94a3b8", fontSize: "12px", margin: "4px 0 0" }}>
                    Trust Score
                  </p>
                </div>
                <div style={styles.impactCard as React.CSSProperties}>
                  <p style={{ color: "#4ade80", fontSize: "28px", fontWeight: 700, margin: 0 }}>
                    {userStats.greenPoints}
                  </p>
                  <p style={{ color: "#94a3b8", fontSize: "12px", margin: "4px 0 0" }}>
                    Green Points
                  </p>
                </div>
                <div style={styles.impactCard as React.CSSProperties}>
                  <p style={{ color: "#4ade80", fontSize: "28px", fontWeight: 700, margin: 0 }}>
                    ₹{userStats.moneySaved}
                  </p>
                  <p style={{ color: "#94a3b8", fontSize: "12px", margin: "4px 0 0" }}>
                    Money Saved
                  </p>
                </div>
              </div>
            </div>

            {/* Nearby Drivers */}
            <div style={styles.card}>
              <div
                style={{ alignItems: "center", display: "flex", gap: "12px", marginBottom: "16px" }}
              >
                <FaUsers style={{ color: "#22c55e", fontSize: "18px" }} />
                <h2 style={{ color: "white", fontSize: "18px", fontWeight: 600, margin: 0 }}>
                  Nearby Drivers
                </h2>
              </div>

              <div style={{ display: "grid", gap: "12px", gridTemplateColumns: "1fr 1fr" }}>
                <div
                  style={{
                    background: "rgba(34, 197, 94, 0.1)",
                    border: "1px solid rgba(34, 197, 94, 0.2)",
                    borderRadius: "12px",
                    padding: "16px",
                    textAlign: "center",
                  }}
                >
                  <p style={{ color: "#4ade80", fontSize: "32px", fontWeight: 700, margin: 0 }}>
                    {availableCount}
                  </p>
                  <p style={{ color: "#94a3b8", fontSize: "12px", margin: "4px 0 0" }}>Available</p>
                </div>
                <div
                  style={{
                    background: "rgba(234, 179, 8, 0.1)",
                    border: "1px solid rgba(234, 179, 8, 0.2)",
                    borderRadius: "12px",
                    padding: "16px",
                    textAlign: "center",
                  }}
                >
                  <p style={{ color: "#facc15", fontSize: "32px", fontWeight: 700, margin: 0 }}>
                    {busyCount}
                  </p>
                  <p style={{ color: "#94a3b8", fontSize: "12px", margin: "4px 0 0" }}>Busy</p>
                </div>
              </div>

              {lastUpdate && (
                <div
                  style={{
                    alignItems: "center",
                    background: "rgba(15, 23, 42, 0.5)",
                    borderRadius: "8px",
                    color: "#94a3b8",
                    display: "flex",
                    fontSize: "12px",
                    gap: "8px",
                    marginTop: "16px",
                    padding: "8px 12px",
                  }}
                >
                  <FaSync style={{ fontSize: "10px" }} />
                  Last updated: {lastUpdate.toLocaleTimeString()}
                </div>
              )}
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
