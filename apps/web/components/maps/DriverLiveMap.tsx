"use client";

import {
  DirectionsRenderer,
  GoogleMap,
  type Libraries,
  Marker,
  useJsApiLoader,
} from "@react-google-maps/api";
import { onAuthStateChanged } from "firebase/auth";
import { onDisconnect, onValue, ref, remove, set, update } from "firebase/database";
import * as geofire from "geofire-common";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  status: "AVAILABLE" | "BUSY" | "RESERVED";
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
  status?: "MATCHED" | "IN_PROGRESS" | "ARRIVED";
  arrivedAt?: number;
  riderName?: string;
  riderPhone?: string;
}

interface PendingRide {
  rideId: string;
  riderId: string;
  pickup: { lat: number; lng: number };
  drop: { lat: number; lng: number };
  fare?: number;
  timestamp: number;
  status: "PENDING_ACCEPTANCE";
  riderName?: string;
  riderPhone?: string;
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

// No fixed default center - will be set by user choice
const TAMIL_NADU_CENTER = { lat: 11.1271, lng: 78.6569 }; // Tamil Nadu center as initial view

// Helper function to create rotated car icon SVG
const createRotatedCarIcon = (
  heading: number,
  color: string = "#22c55e",
  size: number = 50,
): string => {
  // Car SVG that points upward (north) by default
  const carSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">
      <g transform="rotate(${heading}, 12, 12)">
        <path fill="${color}" d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"/>
      </g>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(carSvg)}`;
};

// Use same libraries as RiderMap to avoid loader conflict
const libraries: Libraries = ["places"];

// Haversine formula to calculate distance between two coordinates in meters
const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371e3;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lng2 - lng1) * Math.PI) / 180;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const getErrorMessage = (err: unknown, fallback: string): string => {
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback;
};

// Location selection mode before going online
type LocationMode = "select" | "gps" | "map" | "ready";

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

  // New: Location selection before going online
  const [locationMode, setLocationMode] = useState<LocationMode>("select");
  const [selectedStartLocation, setSelectedStartLocation] = useState<Position | null>(null);
  const [isGettingGPS, setIsGettingGPS] = useState(false);

  // OTP State
  const [showOtpModal, setShowOtpModal] = useState(false);
  const [otpInput, setOtpInput] = useState("");
  const [submittingOtp, setSubmittingOtp] = useState(false);

  // Payment Popup State
  const [finishedRideId, setFinishedRideId] = useState<string | null>(null);
  const [showPaymentPopup, setShowPaymentPopup] = useState(false);
  const [receivedAmount, setReceivedAmount] = useState(0);

  // Pending Ride Acceptance State
  const [pendingRide, setPendingRide] = useState<PendingRide | null>(null);
  const [showAcceptModal, setShowAcceptModal] = useState(false);
  const [acceptingRide, setAcceptingRide] = useState(false);
  const [decliningRide, setDecliningRide] = useState(false);

  // Location names (reverse geocoded)
  const [pickupLocationName, setPickupLocationName] = useState<string | null>(null);
  const [dropLocationName, setDropLocationName] = useState<string | null>(null);

  // Distance and ETA tracking
  const [distanceToPickup, setDistanceToPickup] = useState<number | null>(null);
  const [distanceToDestination, setDistanceToDestination] = useState<number | null>(null);
  const [waitingTimer, setWaitingTimer] = useState<number | null>(null); // Remaining seconds
  const [isArrived, setIsArrived] = useState(false);
  const [etaToPickup, setEtaToPickup] = useState<string | null>(null);
  const [etaToDestination, setEtaToDestination] = useState<string | null>(null);
  const [waitingForPayment, setWaitingForPayment] = useState(false);
  const autoCompleteTriggeredRef = useRef(false);

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

  const [userId, setUserId] = useState<string | null>(null);
  const [authReady, setAuthReady] = useState(false);

  const [driverName, setDriverName] = useState<string | null>(null);

  useEffect(() => {
    if (!auth) {
      setAuthReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUserId(user?.uid ?? null);
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  // Check if driver is already online in RTDB on mount (handles page refresh)
  useEffect(() => {
    const checkExistingSession = async () => {
      if (!rtdb || !userId) return;

      try {
        const { get, ref: dbRef } = await import("firebase/database");
        const driverRef = dbRef(rtdb, `drivers-online/${userId}`);
        const snapshot = await get(driverRef);
        const data = snapshot.val();

        if (data?.lat && data?.lng) {
          console.log("🔄 Restoring driver session from RTDB:", data);
          // Driver is already online - restore state
          setPosition({
            heading: data.heading ?? 0,
            lat: data.lat,
            lng: data.lng,
          });
          setStatus(data.status || "AVAILABLE");
          setIsOnline(true);
          setLocationMode("ready");

          // Set up onDisconnect again
          const { onDisconnect: onDisconnectFn } = await import("firebase/database");
          await onDisconnectFn(driverRef).remove();
        }
      } catch (error) {
        console.error("Error checking existing session:", error);
      }
    };

    checkExistingSession();
  }, [userId]);

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

  // Store current position in ref for status update effect (avoids position in deps)
  const positionRef = useRef(position);
  positionRef.current = position;

  // Store current status in ref for listener to compare without re-subscribing
  const statusRef = useRef(status);
  statusRef.current = status;

  // Update Firebase ONLY when status changes (position is handled by simulator)
  // Use update() instead of set() so we only touch the status field
  // and never overwrite the position the simulator is managing.
  useEffect(() => {
    if (isOnline && rtdb && userId) {
      const driverRef = ref(rtdb, `drivers-online/${userId}`);
      update(driverRef, { lastUpdated: Date.now(), status }).catch((err) => {
        console.error("Failed to update status:", err);
      });
    }
  }, [status, isOnline, userId]); // Only status changes trigger this

  // Listen for position updates from RTDB (simulator updates the driver's position)
  useEffect(() => {
    if (!rtdb || !isOnline) {
      return;
    }

    const driverRef = ref(rtdb, `drivers-online/${userId}`);

    const unsubscribe = onValue(driverRef, (snapshot) => {
      const data = snapshot.val() as DriverLocation | null;
      if (data?.lat && data?.lng) {
        // Update position from RTDB (simulator moves the driver)
        // Don't set the local flag - this is from RTDB, not local
        setPosition({
          heading: data.heading ?? 0,
          lat: data.lat,
          lng: data.lng,
        });
        // Also update status if changed (use ref to avoid re-subscribing)
        if (data.status && data.status !== statusRef.current) {
          setStatus(data.status as "AVAILABLE" | "BUSY");
        }
      }
    });

    return () => unsubscribe();
  }, [isOnline, userId]); // Removed status from dependencies!

  // Listen for ride assignments from RTDB
  useEffect(() => {
    if (!rtdb || !isOnline) {
      setAssignedRide(null);
      setDirectionsToPickup(null);
      setDirectionsToDestination(null);
      setPickupLocationName(null);
      setDropLocationName(null);
      return;
    }

    const assignedRideRef = ref(rtdb, `rides-assigned/${userId}`);

    const unsubscribe = onValue(assignedRideRef, async (snapshot) => {
      const data = snapshot.val() as AssignedRide | null;
      if (data) {
        console.log("Ride assigned:", data);
        setAssignedRide(data);
        // Reset local ride status to saved status or MATCHED
        setRideStatus(data.status || "MATCHED");
        // Auto-set status to BUSY when assigned
        setStatus("BUSY");

        // Fetch readable location names if not already set
        if (!pickupLocationName || !dropLocationName) {
          // Use reverseGeocode after it's defined (call it inline here)
          try {
            if (window.google?.maps?.Geocoder) {
              const geocoder = new google.maps.Geocoder();

              const [pickupRes, dropRes] = await Promise.all([
                geocoder.geocode({ location: data.pickup }).catch(() => ({ results: [] })),
                geocoder.geocode({ location: data.drop }).catch(() => ({ results: [] })),
              ]);

              const getShortName = (results: google.maps.GeocoderResult[]) => {
                if (!results?.length) return null;
                const components = results[0].address_components || [];
                const sublocality = components.find((c) =>
                  c.types.includes("sublocality"),
                )?.long_name;
                const route = components.find((c) => c.types.includes("route"))?.short_name;
                if (route && sublocality) return `${route}, ${sublocality}`;
                if (sublocality) return sublocality;
                return results[0].formatted_address?.split(",").slice(0, 2).join(",") || null;
              };

              setPickupLocationName(
                getShortName(pickupRes.results) ||
                  `${data.pickup.lat.toFixed(4)}, ${data.pickup.lng.toFixed(4)}`,
              );
              setDropLocationName(
                getShortName(dropRes.results) ||
                  `${data.drop.lat.toFixed(4)}, ${data.drop.lng.toFixed(4)}`,
              );
            }
          } catch (_err) {
            // Silently ignore geocoding errors
          }
        }
      } else {
        setAssignedRide(null);
        setDirectionsToPickup(null);
        setDirectionsToDestination(null);
        setPickupLocationName(null);
        setDropLocationName(null);
      }
    });

    return () => unsubscribe();
  }, [isOnline, userId, pickupLocationName, dropLocationName]);

  // Reverse geocode coordinates to a readable landmark name
  // Falls back to coordinates if Geocoding API is not enabled
  const reverseGeocode = useCallback(async (lat: number, lng: number): Promise<string> => {
    const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    try {
      // Check if Geocoder is available
      if (!window.google?.maps?.Geocoder) {
        return fallback;
      }

      const geocoder = new google.maps.Geocoder();
      const response = await geocoder.geocode({ location: { lat, lng } });

      if (response.results && response.results.length > 0) {
        // Try to get a short, meaningful name from the address components
        const result = response.results[0];
        const components = result.address_components || [];

        // Try to find a meaningful landmark
        const neighborhood = components.find((c) => c.types.includes("neighborhood"))?.long_name;
        const locality = components.find((c) => c.types.includes("locality"))?.long_name;
        const sublocality = components.find((c) => c.types.includes("sublocality"))?.long_name;
        const route = components.find((c) => c.types.includes("route"))?.short_name;
        const premise = components.find((c) => c.types.includes("premise"))?.long_name;

        // Build a short name prioritizing landmarks
        if (premise) return premise;
        if (route && sublocality) return `${route}, ${sublocality}`;
        if (route && neighborhood) return `${route}, ${neighborhood}`;
        if (sublocality) return sublocality;
        if (neighborhood) return neighborhood;
        if (locality) return locality;

        // Fallback to short formatted address
        return result.formatted_address?.split(",").slice(0, 2).join(",") || fallback;
      }
      return fallback;
    } catch (_error) {
      // Silently fail and return coordinates
      // This handles cases where Geocoding API is not enabled
      return fallback;
    }
  }, []);

  // Listen for PENDING ride requests (driver must accept/decline)
  useEffect(() => {
    if (!rtdb || !isOnline) {
      setPendingRide(null);
      setShowAcceptModal(false);
      setPickupLocationName(null);
      setDropLocationName(null);
      return;
    }

    const pendingRideRef = ref(rtdb, `rides-pending/${userId}`);

    const unsubscribe = onValue(pendingRideRef, async (snapshot) => {
      const data = snapshot.val() as PendingRide | null;
      if (data && data.status === "PENDING_ACCEPTANCE") {
        console.log("Pending ride request:", data);
        setPendingRide(data);
        setShowAcceptModal(true);

        // Fetch readable location names
        const [pickupName, dropName] = await Promise.all([
          reverseGeocode(data.pickup.lat, data.pickup.lng),
          reverseGeocode(data.drop.lat, data.drop.lng),
        ]);
        setPickupLocationName(pickupName);
        setDropLocationName(dropName);
      } else {
        setPendingRide(null);
        setShowAcceptModal(false);
        setPickupLocationName(null);
        setDropLocationName(null);
      }
    });

    return () => unsubscribe();
  }, [isOnline, userId, reverseGeocode]);

  // Handle accepting a pending ride
  const handleAcceptRide = async () => {
    if (!pendingRide) return;

    // Check backend URL
    if (!backendUrl) {
      alert("System Error: Backend URL configuration missing");
      return;
    }

    setAcceptingRide(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${backendUrl}/ride/accept`, {
        body: JSON.stringify({ rideId: pendingRide.rideId }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          console.log("Ride accepted successfully");
          setShowAcceptModal(false);
          setPendingRide(null);
          // The rides-assigned listener will pick up the ride
        } else {
          console.error("Failed to accept ride:", data.message);
          // If ride is already cancelled, close the modal
          if (data.message?.includes("CANCELLED")) {
            setShowAcceptModal(false);
            setPendingRide(null);
          }
          alert(data.message || "Failed to accept ride");
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Server returned ${res.status}`);
      }
    } catch (err: unknown) {
      console.error("Error accepting ride:", err);
      alert(
        getErrorMessage(
          err,
          "Network error: Could not connect to server. Please check your connection.",
        ),
      );
    } finally {
      setAcceptingRide(false);
    }
  };

  // Handle declining a pending ride
  const handleDeclineRide = async () => {
    if (!pendingRide) return;

    if (!backendUrl) {
      alert("System Error: Backend URL configuration missing");
      return;
    }

    setDecliningRide(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${backendUrl}/ride/decline`, {
        body: JSON.stringify({ rideId: pendingRide.rideId }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          console.log("Ride declined:", data.message);
          setShowAcceptModal(false);
          setPendingRide(null);
          // Driver returns to AVAILABLE and waits for new rides
        } else {
          console.error("Failed to decline ride:", data.message);
          // If ride is already cancelled, close the modal
          if (data.message?.includes("CANCELLED")) {
            setShowAcceptModal(false);
            setPendingRide(null);
          }
          alert(data.message || "Failed to decline ride");
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Server returned ${res.status}`);
      }
    } catch (err: unknown) {
      console.error("Error declining ride:", err);
      alert(getErrorMessage(err, "Network error: Could not decline ride."));
    } finally {
      setDecliningRide(false);
    }
  };

  const [rideStatus, setRideStatus] = useState<"MATCHED" | "IN_PROGRESS" | "COMPLETED" | "ARRIVED">(
    "MATCHED",
  );

  const handleStartRideClick = () => {
    setShowOtpModal(true);
    setOtpInput("");
  };

  const handleSubmitOtp = async () => {
    if (!assignedRide || !otpInput || otpInput.length !== 4) {
      alert("Please enter a valid 4-digit OTP");
      return;
    }

    if (!backendUrl) {
      alert("System Error: Backend URL configuration missing");
      return;
    }

    setSubmittingOtp(true);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${backendUrl}/ride/start`, {
        body: JSON.stringify({ otp: otpInput, rideId: assignedRide.rideId }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (res.ok) {
        const data = await res.json();
        if (data.success) {
          setRideStatus("IN_PROGRESS");
          setShowOtpModal(false);
        } else {
          console.error("Failed to start ride:", data.message);
          alert(data.message || "Failed to start ride. Check OTP.");
        }
      } else {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.message || `Server returned ${res.status}`);
      }
    } catch (err: unknown) {
      console.error("Error starting ride:", err);
      alert(getErrorMessage(err, "Network error: Could not start ride. Please try again."));
    } finally {
      setSubmittingOtp(false);
    }
  };

  const handleCompleteRide = async () => {
    if (!assignedRide) return;

    if (!backendUrl) {
      // Silent fail or minimal alert
      console.error("Backend URL missing");
      return;
    }

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${backendUrl}/ride/complete`, {
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
        setWaitingForPayment(true);
        setAssignedRide(null);
        setDirectionsToPickup(null);
        setDirectionsToDestination(null);
        setDistanceToDestination(null);
        setEtaToDestination(null);
        autoCompleteTriggeredRef.current = false;
        // Driver stays BUSY until payment is confirmed
      } else {
        const errorData = await res.json().catch(() => ({}));
        console.error("Failed to complete ride:", errorData.message);
        alert(errorData.message || `Failed to complete ride (Status: ${res.status})`);
      }
    } catch (err: unknown) {
      console.error("Error completing ride:", err);
      alert(getErrorMessage(err, "Network error while completing ride"));
    }
  };

  // Ref to track last ride ID to avoid recalculating directions on every position change
  const lastRideIdRef = useRef<string | null>(null);

  // Calculate routes when ride is FIRST assigned (not on every position change)
  useEffect(() => {
    // Only calculate once when a NEW ride is assigned
    if (!isLoaded || !assignedRide || !position) {
      return;
    }

    // Skip if we already calculated for this ride
    if (lastRideIdRef.current === assignedRide.rideId) {
      return;
    }

    lastRideIdRef.current = assignedRide.rideId;

    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }

    // Calculate route 1: Driver -> Pickup (BLUE route)
    // Use position at time of assignment, not continuously updated position
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

  // Track distance to pickup
  useEffect(() => {
    if (!assignedRide || !position || rideStatus !== "MATCHED") return;

    const dist = haversineDistance(
      position.lat,
      position.lng,
      assignedRide.pickup.lat,
      assignedRide.pickup.lng,
    );
    setDistanceToPickup(Math.round(dist));
  }, [position, assignedRide, rideStatus]);

  // Handle waiting timer countdown based on server timestamp to avoid drift
  useEffect(() => {
    if (rideStatus !== "ARRIVED" || !assignedRide?.arrivedAt) {
      setWaitingTimer(null);
      return;
    }

    const calculateRemaining = () => {
      const elapsedMs = Date.now() - assignedRide.arrivedAt!;
      const remainingSec = Math.max(0, 300 - Math.floor(elapsedMs / 1000));
      setWaitingTimer(remainingSec);
    };

    calculateRemaining();
    const interval = setInterval(calculateRemaining, 1000);

    return () => clearInterval(interval);
  }, [rideStatus, assignedRide?.arrivedAt]);

  // Sync isArrived state with rideStatus
  useEffect(() => {
    if (rideStatus === "ARRIVED") {
      setIsArrived(true);
    } else {
      setIsArrived(false);
    }
  }, [rideStatus]);

  // Track distance to destination during trip and auto-complete at 100m
  // biome-ignore lint/correctness/useExhaustiveDependencies: handleCompleteRide is guarded by autoCompleteTriggeredRef
  useEffect(() => {
    if (
      !assignedRide ||
      !position ||
      rideStatus !== "IN_PROGRESS" ||
      autoCompleteTriggeredRef.current
    )
      return;

    const dist = haversineDistance(
      position.lat,
      position.lng,
      assignedRide.drop.lat,
      assignedRide.drop.lng,
    );
    setDistanceToDestination(Math.round(dist));

    if (dist <= 100) {
      console.log("Driver within 100m of destination - Auto-completing trip...");
      autoCompleteTriggeredRef.current = true;
      handleCompleteRide();
    }
  }, [position, assignedRide, rideStatus]);

  // Update ETA every 10 seconds during ride
  // Use positionRef so the interval stays stable and doesn't restart on every
  // position tick from the simulator.
  useEffect(() => {
    if (!isLoaded || !assignedRide) return;

    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }

    const updateEta = () => {
      const pos = positionRef.current;
      if (!directionsServiceRef.current || !assignedRide || !pos) return;

      if (rideStatus === "MATCHED") {
        // ETA: Driver → Pickup
        directionsServiceRef.current.route(
          {
            destination: assignedRide.pickup,
            origin: { lat: pos.lat, lng: pos.lng },
            travelMode: google.maps.TravelMode.DRIVING,
          },
          (result, dirStatus) => {
            if (dirStatus === google.maps.DirectionsStatus.OK && result) {
              const leg = result.routes[0]?.legs[0];
              if (leg?.duration?.text) {
                setEtaToPickup(leg.duration.text);
              }
              setDirectionsToPickup(result);
            }
          },
        );
      } else if (rideStatus === "IN_PROGRESS") {
        // ETA: Driver → Destination
        directionsServiceRef.current.route(
          {
            destination: assignedRide.drop,
            origin: { lat: pos.lat, lng: pos.lng },
            travelMode: google.maps.TravelMode.DRIVING,
          },
          (result, dirStatus) => {
            if (dirStatus === google.maps.DirectionsStatus.OK && result) {
              const leg = result.routes[0]?.legs[0];
              if (leg?.duration?.text) {
                setEtaToDestination(leg.duration.text);
              }
              setDirectionsToDestination(result);
              setDirectionsToPickup(null);
            }
          },
        );
      }
    };

    // Initial calculation
    updateEta();

    // Update every 10 seconds (stable interval, not restarted on position changes)
    const interval = setInterval(updateEta, 10000);
    return () => clearInterval(interval);
  }, [isLoaded, assignedRide, rideStatus]); // position intentionally excluded — read from positionRef

  const formatTime = (seconds: number): string => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hrs.toString().padStart(2, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const prevPositionRef = useRef<{ lat: number; lng: number } | null>(null);

  const writeLocationToFirebase = useCallback(
    async (pos: Position) => {
      if (!rtdb || !userId) return;
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

  // Handler: Use GPS location
  const handleUseGPS = useCallback(async () => {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }

    // Clear any existing error
    setError(null);

    // Request location permission
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude, accuracy, heading } = position.coords;
        console.log("GPS Location:", latitude, longitude, "Accuracy:", accuracy);

        // Update local state
        const newPos = { heading: heading ?? 0, lat: latitude, lng: longitude };
        setPosition(newPos);
        setSelectedStartLocation(newPos);
        setLocationMode("ready");

        // Write to Firebase
        if (rtdb && userId) {
          const driverRef = ref(rtdb, `drivers-online/${userId}`);
          const hash = geofire.geohashForLocation([latitude, longitude]);
          const locationData: DriverLocation = {
            geohash: hash,
            heading: heading ?? 0,
            lastUpdated: Date.now(),
            lat: latitude,
            lng: longitude,
            status: statusRef.current,
            vehicleType: "CAR",
          };
          await set(driverRef, locationData);
          console.log("✅ Location written to Firebase");
        }
      },
      (error) => {
        console.error("Error getting location:", error);
        setError(error.message);
        setLocationMode("select");
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 10000,
      },
    );
  }, [userId]);

  // Listen for payment confirmation
  useEffect(() => {
    if (!finishedRideId || !rtdb) return;

    const rideRef = ref(rtdb, `rides/${finishedRideId}`);
    const unsubscribe = onValue(rideRef, (snapshot) => {
      const data = snapshot.val();
      if (data && data.paymentStatus === "PAID") {
        setReceivedAmount(data.paidAmount || 0);
        setShowPaymentPopup(true);
        setWaitingForPayment(false);
      }
    });

    return () => unsubscribe();
  }, [finishedRideId]);

  const _goOnline = useCallback(async () => {
    if (!rtdb) {
      setError("Firebase not initialized");
      return;
    }
    if (!authReady) {
      setError("Please wait for authentication to initialize");
      return;
    }
    if (!userId) {
      setError("Please sign in to go online");
      return;
    }

    setIsGettingGPS(true);
    setError(null);

    navigator.geolocation.getCurrentPosition(
      (geoPosition) => {
        const newPos: Position = {
          heading: 0,
          lat: geoPosition.coords.latitude,
          lng: geoPosition.coords.longitude,
        };
        setSelectedStartLocation(newPos);
        setLocationMode("ready");
        setIsGettingGPS(false);
        // Pan map to selected location
        if (mapRef.current) {
          mapRef.current.panTo({ lat: newPos.lat, lng: newPos.lng });
          mapRef.current.setZoom(16);
        }
      },
      (err) => {
        console.error("GPS error:", err);
        setError("Could not get GPS location. Please pick a location on the map instead.");
        setLocationMode("map");
        setIsGettingGPS(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  }, [authReady, userId]);

  // Handler: Pick location on map
  const handlePickOnMap = useCallback(() => {
    setLocationMode("map");
    setError(null);
  }, []);

  // Handler: Confirm location and go online
  const handleConfirmAndGoOnline = useCallback(async () => {
    if (!selectedStartLocation || !rtdb) {
      setError("Please select a starting location first");
      return;
    }
    if (!userId) {
      setError("Please sign in to go online");
      return;
    }

    const driverRef = ref(rtdb, `drivers-online/${userId}`);
    try {
      await onDisconnect(driverRef).remove();
    } catch (err) {
      console.error("Failed to setup onDisconnect:", err);
    }

    // Set initial position from selected location
    setPosition(selectedStartLocation);
    prevPositionRef.current = { lat: selectedStartLocation.lat, lng: selectedStartLocation.lng };

    // Write to Firebase
    await writeLocationToFirebase(selectedStartLocation);

    // NOTE: We do NOT start GPS watching here anymore.
    // The simulator will handle driver movement.
    // If real GPS tracking is needed later, it can be enabled as an option.

    setIsOnline(true);
    setError(null);
  }, [selectedStartLocation, userId, writeLocationToFirebase]);

  // Handler: Reset location selection
  const handleResetLocation = useCallback(() => {
    setSelectedStartLocation(null);
    setLocationMode("select");
  }, []);

  const goOffline = useCallback(async () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    if (rtdb && userId) {
      const driverRef = ref(rtdb, `drivers-online/${userId}`);
      try {
        await remove(driverRef);
      } catch (err) {
        console.error("Failed to remove from DB:", err);
      }
    }
    setIsOnline(false);
    setPosition(null);
    // Reset location selection for next time
    setLocationMode("select");
    setSelectedStartLocation(null);
  }, [userId]);

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  // Memoized map options - prevents re-initialization on every render
  // Only cursor needs to change based on mode
  const _mapOptions = useMemo(
    () => ({
      disableDefaultUI: true,
      draggableCursor: locationMode === "map" || manualLocationMode ? "crosshair" : undefined,
      gestureHandling: "greedy" as const,
      styles: darkMapStyles,
      zoomControl: true,
      // NO center or zoom here - let onLoad handle initial state
      // This prevents the map from re-centering on every render
    }),
    [locationMode, manualLocationMode],
  );

  // Stable onLoad - only runs once when map mounts
  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
    // Set initial center to Tamil Nadu - user will pan/select location
    map.setCenter(TAMIL_NADU_CENTER);
    map.setZoom(10);
  }, []);

  // Handle marking arrival at pickup
  const handleArriveAtPickup = async () => {
    if (!assignedRide) return;

    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch(`${backendUrl}/ride/arrive`, {
        body: JSON.stringify({ rideId: assignedRide.rideId }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || "Failed to mark arrival");
      }

      // Status and timer will sync via RTDB listener
    } catch (error) {
      console.error("Error marking arrival:", error);
      alert(error instanceof Error ? error.message : "Error marking arrival");
    }
  };

  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  // Handle map click to set location manually
  const onMapClick = useCallback(
    async (e: google.maps.MapMouseEvent) => {
      if (!e.latLng) return;

      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      // Pre-online location selection (picking start location before going online)
      if (!isOnline && locationMode === "map") {
        const newPos: Position = { heading: 0, lat, lng };
        setSelectedStartLocation(newPos);
        setLocationMode("ready");
        // Pan to the selected location
        if (mapRef.current) {
          mapRef.current.panTo({ lat, lng });
          mapRef.current.setZoom(16);
        }
        return;
      }

      // Online manual location update
      if (manualLocationMode && isOnline) {
        const newPos: Position = { heading: position?.heading ?? 0, lat, lng };
        setPosition(newPos);
        prevPositionRef.current = { lat, lng };
        await writeLocationToFirebase(newPos);
        setManualLocationMode(false);
      }
    },
    [manualLocationMode, isOnline, position, writeLocationToFirebase, locationMode],
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
                height: "600px",
                overflow: "hidden",
                position: "relative",
              }}
            >
              {/* Location selection mode indicator (before going online) */}
              {!isOnline && locationMode === "map" && (
                <div
                  style={{
                    alignItems: "center",
                    background: "linear-gradient(90deg, #3b82f6, #2563eb)",
                    color: "white",
                    display: "flex",
                    fontSize: "14px",
                    fontWeight: 600,
                    gap: "8px",
                    justifyContent: "center",
                    left: 0,
                    padding: "12px",
                    position: "absolute",
                    right: 0,
                    top: 0,
                    zIndex: 10,
                  }}
                >
                  <FaMapMarkerAlt /> Click on the map to select your starting location
                </div>
              )}
              {/* Manual location mode indicator (while online) */}
              {isOnline && manualLocationMode && (
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
                  <FaMapMarkerAlt /> Click on the map to update your location
                </div>
              )}
              <GoogleMap
                mapContainerStyle={mapContainerStyle}
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
                {/* Selected start location marker (before going online) */}
                {!isOnline && selectedStartLocation && (
                  <Marker
                    position={{ lat: selectedStartLocation.lat, lng: selectedStartLocation.lng }}
                    icon={{
                      anchor: new google.maps.Point(20, 20),
                      scaledSize: new google.maps.Size(40, 40),
                      url: createRotatedCarIcon(selectedStartLocation.heading, "#3b82f6", 40),
                    }}
                    title="Your starting location"
                  />
                )}
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

                {/* Driver Position Marker - with heading rotation */}
                {position && (
                  <Marker
                    position={{ lat: position.lat, lng: position.lng }}
                    icon={{
                      anchor: new google.maps.Point(25, 25),
                      scaledSize: new google.maps.Size(50, 50),
                      url: createRotatedCarIcon(position.heading, "#22c55e", 50),
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
            {/* Waiting for Payment Card */}
            {waitingForPayment && !showPaymentPopup && (
              <div
                style={{
                  background:
                    "linear-gradient(135deg, rgba(234, 179, 8, 0.15), rgba(251, 191, 36, 0.1))",
                  border: "2px solid rgba(234, 179, 8, 0.5)",
                  borderRadius: "24px",
                  padding: "24px",
                  textAlign: "center",
                }}
              >
                <div
                  style={{
                    alignItems: "center",
                    animation: "pulse 2s infinite",
                    background: "rgba(234, 179, 8, 0.2)",
                    borderRadius: "50%",
                    display: "flex",
                    height: "64px",
                    justifyContent: "center",
                    margin: "0 auto 16px",
                    width: "64px",
                  }}
                >
                  <FaClock style={{ color: "#fbbf24", fontSize: "28px" }} />
                </div>
                <h2
                  style={{ color: "#fbbf24", fontSize: "20px", fontWeight: 700, margin: "0 0 8px" }}
                >
                  Waiting for Payment
                </h2>
                <p style={{ color: "#94a3b8", fontSize: "14px", margin: "0 0 16px" }}>
                  Trip completed. Please wait while the rider completes the payment.
                </p>
                <div
                  style={{
                    animation: "progressBar 3s ease-in-out infinite",
                    background: "linear-gradient(90deg, #fbbf24, #f59e0b, #fbbf24)",
                    backgroundSize: "200% 100%",
                    borderRadius: "4px",
                    height: "4px",
                    width: "100%",
                  }}
                />
              </div>
            )}

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
                      {rideStatus === "IN_PROGRESS" ? "Head to destination" : "Navigate to pickup"}
                    </p>
                  </div>
                </div>

                {/* ETA and Distance Info */}
                <div
                  style={{
                    background: "rgba(15, 23, 42, 0.5)",
                    borderRadius: "12px",
                    display: "grid",
                    gap: "12px",
                    gridTemplateColumns: "1fr 1fr",
                    marginBottom: "16px",
                    padding: "12px",
                  }}
                >
                  <div style={{ textAlign: "center" }}>
                    <p
                      style={{
                        color: "#94a3b8",
                        fontSize: "11px",
                        margin: "0 0 4px",
                        textTransform: "uppercase",
                      }}
                    >
                      ETA
                    </p>
                    <p style={{ color: "#4ade80", fontSize: "18px", fontWeight: 700, margin: 0 }}>
                      {rideStatus === "IN_PROGRESS"
                        ? etaToDestination || "Calculating..."
                        : etaToPickup || "Calculating..."}
                    </p>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <p
                      style={{
                        color: "#94a3b8",
                        fontSize: "11px",
                        margin: "0 0 4px",
                        textTransform: "uppercase",
                      }}
                    >
                      Distance
                    </p>
                    <p style={{ color: "#60a5fa", fontSize: "18px", fontWeight: 700, margin: 0 }}>
                      {rideStatus === "IN_PROGRESS"
                        ? distanceToDestination != null
                          ? distanceToDestination > 1000
                            ? `${(distanceToDestination / 1000).toFixed(1)} km`
                            : `${distanceToDestination} m`
                          : "..."
                        : distanceToPickup != null
                          ? distanceToPickup > 1000
                            ? `${(distanceToPickup / 1000).toFixed(1)} km`
                            : `${distanceToPickup} m`
                          : "..."}
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
                      Pickup:{" "}
                      {pickupLocationName ||
                        `${assignedRide.pickup.lat.toFixed(4)}, ${assignedRide.pickup.lng.toFixed(4)}`}
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
                      Drop:{" "}
                      {dropLocationName ||
                        `${assignedRide.drop.lat.toFixed(4)}, ${assignedRide.drop.lng.toFixed(4)}`}
                    </span>
                  </div>
                </div>

                {/* Rider Information Section */}
                {(assignedRide?.riderName || assignedRide?.riderPhone) && (
                  <div
                    style={{
                      background: "rgba(30, 41, 59, 0.5)",
                      borderRadius: "16px",
                      marginBottom: "20px",
                      padding: "16px",
                    }}
                  >
                    <div
                      style={{
                        alignItems: "center",
                        display: "flex",
                        justifyContent: "space-between",
                      }}
                    >
                      <div>
                        <p
                          style={{
                            color: "#94a3b8",
                            fontSize: "11px",
                            margin: "0 0 4px",
                            textTransform: "uppercase",
                          }}
                        >
                          Rider
                        </p>
                        <p style={{ color: "white", fontSize: "15px", fontWeight: 600, margin: 0 }}>
                          {assignedRide?.riderName || "Unknown Rider"}
                        </p>
                      </div>
                      {assignedRide?.riderPhone && (
                        <div style={{ textAlign: "right" }}>
                          <p
                            style={{
                              color: "#94a3b8",
                              fontSize: "11px",
                              margin: "0 0 4px",
                              textTransform: "uppercase",
                            }}
                          >
                            Mobile
                          </p>
                          <p
                            style={{
                              color: "#3b82f6",
                              fontSize: "15px",
                              fontWeight: 600,
                              margin: 0,
                            }}
                          >
                            {assignedRide?.riderPhone}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {rideStatus === "MATCHED" || rideStatus === "ARRIVED" ? (
                  isArrived ? (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div
                        style={{
                          alignItems: "center",
                          background: "rgba(34, 197, 94, 0.1)",
                          border: "1px solid rgba(34, 197, 94, 0.3)",
                          borderRadius: "12px",
                          display: "flex",
                          flexDirection: "column",
                          gap: "8px",
                          justifyContent: "center",
                          padding: "16px",
                        }}
                      >
                        <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                          <FaCheckCircle style={{ color: "#4ade80" }} />
                          <span style={{ color: "#4ade80", fontSize: "14px", fontWeight: 600 }}>
                            You have arrived!
                          </span>
                        </div>
                        {waitingTimer !== null && (
                          <div
                            style={{
                              alignItems: "center",
                              color: waitingTimer < 60 ? "#f87171" : "#94a3b8",
                              display: "flex",
                              fontSize: "13px",
                              gap: "6px",
                            }}
                          >
                            <FaClock />
                            Waiting for rider: {Math.floor(waitingTimer / 60)}:
                            {(waitingTimer % 60).toString().padStart(2, "0")}
                          </div>
                        )}
                      </div>
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
                        <FaPlay /> Enter OTP to Start Trip
                      </button>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div
                        style={{
                          alignItems: "center",
                          background: "rgba(59, 130, 246, 0.1)",
                          border: "1px solid rgba(59, 130, 246, 0.3)",
                          borderRadius: "12px",
                          display: "flex",
                          gap: "8px",
                          justifyContent: "center",
                          padding: "10px",
                        }}
                      >
                        <FaCar style={{ color: "#60a5fa" }} />
                        <span style={{ color: "#60a5fa", fontSize: "14px", fontWeight: 600 }}>
                          {distanceToPickup != null && distanceToPickup > 1000
                            ? `Navigating to Pickup (${(distanceToPickup / 1000).toFixed(1)}km)`
                            : `Navigating to Pickup (${distanceToPickup}m)`}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={handleArriveAtPickup}
                        style={{
                          background: "linear-gradient(90deg, #10b981, #059669)",
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
                        <FaCheckCircle /> Reached Rider Location
                      </button>
                    </div>
                  )
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {distanceToDestination != null && distanceToDestination <= 200 && (
                      <div
                        style={{
                          alignItems: "center",
                          animation: "pulse 2s infinite",
                          background: "rgba(34, 197, 94, 0.15)",
                          border: "1px solid rgba(34, 197, 94, 0.4)",
                          borderRadius: "12px",
                          display: "flex",
                          gap: "8px",
                          justifyContent: "center",
                          padding: "10px",
                        }}
                      >
                        <FaFlagCheckered style={{ color: "#4ade80" }} />
                        <span style={{ color: "#4ade80", fontSize: "14px", fontWeight: 600 }}>
                          Approaching destination!
                        </span>
                      </div>
                    )}
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
                  </div>
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

              {/* Location Selection UI - Show when offline */}
              {!isOnline && (
                <div style={{ marginBottom: "24px" }}>
                  <p style={{ color: "#94a3b8", fontSize: "14px", marginBottom: "12px" }}>
                    Select your starting location
                  </p>

                  {/* Location mode: select (initial state) */}
                  {locationMode === "select" && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      <button
                        type="button"
                        onClick={handleUseGPS}
                        disabled={isGettingGPS}
                        style={{
                          alignItems: "center",
                          background: "linear-gradient(90deg, #3b82f6, #2563eb)",
                          border: "none",
                          borderRadius: "12px",
                          color: "white",
                          cursor: isGettingGPS ? "wait" : "pointer",
                          display: "flex",
                          fontSize: "14px",
                          fontWeight: 600,
                          gap: "10px",
                          justifyContent: "center",
                          opacity: isGettingGPS ? 0.7 : 1,
                          padding: "14px 20px",
                          transition: "all 0.3s ease",
                          width: "100%",
                        }}
                      >
                        <FaMapMarkerAlt />
                        {isGettingGPS ? "Getting GPS Location..." : "Use My Current Location"}
                      </button>
                      <button
                        type="button"
                        onClick={handlePickOnMap}
                        style={{
                          alignItems: "center",
                          background: "rgba(30, 41, 59, 0.8)",
                          border: "2px solid rgba(71, 85, 105, 0.5)",
                          borderRadius: "12px",
                          color: "#94a3b8",
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
                        <FaRoute />
                        Pick Location on Map
                      </button>
                    </div>
                  )}

                  {/* Location mode: map (picking on map) */}
                  {locationMode === "map" && (
                    <div
                      style={{
                        alignItems: "center",
                        background: "rgba(59, 130, 246, 0.1)",
                        border: "1px solid rgba(59, 130, 246, 0.3)",
                        borderRadius: "12px",
                        display: "flex",
                        flexDirection: "column",
                        gap: "12px",
                        padding: "16px",
                      }}
                    >
                      <p
                        style={{
                          color: "#60a5fa",
                          fontSize: "14px",
                          margin: 0,
                          textAlign: "center",
                        }}
                      >
                        Click anywhere on the map to select your starting location
                      </p>
                      <button
                        type="button"
                        onClick={handleResetLocation}
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(148, 163, 184, 0.3)",
                          borderRadius: "8px",
                          color: "#94a3b8",
                          cursor: "pointer",
                          fontSize: "13px",
                          padding: "8px 16px",
                        }}
                      >
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Location mode: ready (location selected) */}
                  {locationMode === "ready" && selectedStartLocation && (
                    <div
                      style={{
                        background: "rgba(34, 197, 94, 0.1)",
                        border: "1px solid rgba(34, 197, 94, 0.3)",
                        borderRadius: "12px",
                        padding: "16px",
                      }}
                    >
                      <div
                        style={{
                          alignItems: "center",
                          display: "flex",
                          gap: "12px",
                          marginBottom: "12px",
                        }}
                      >
                        <div
                          style={{
                            alignItems: "center",
                            background: "#22c55e",
                            borderRadius: "50%",
                            display: "flex",
                            height: "32px",
                            justifyContent: "center",
                            width: "32px",
                          }}
                        >
                          <FaMapMarkerAlt style={{ color: "white", fontSize: "14px" }} />
                        </div>
                        <div>
                          <p
                            style={{
                              color: "#4ade80",
                              fontSize: "14px",
                              fontWeight: 600,
                              margin: 0,
                            }}
                          >
                            Location Selected
                          </p>
                          <p
                            style={{
                              color: "#94a3b8",
                              fontFamily: "monospace",
                              fontSize: "12px",
                              margin: 0,
                            }}
                          >
                            {selectedStartLocation.lat.toFixed(6)},{" "}
                            {selectedStartLocation.lng.toFixed(6)}
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleResetLocation}
                        style={{
                          background: "transparent",
                          border: "1px solid rgba(148, 163, 184, 0.3)",
                          borderRadius: "8px",
                          color: "#94a3b8",
                          cursor: "pointer",
                          fontSize: "13px",
                          padding: "8px 16px",
                          width: "100%",
                        }}
                      >
                        Change Location
                      </button>
                    </div>
                  )}
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

              {/* Go Online/Offline Button */}
              {isOnline ? (
                <button type="button" onClick={goOffline} style={styles.buttonOffline}>
                  <FaPowerOff /> Go Offline
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleConfirmAndGoOnline}
                  disabled={!selectedStartLocation || locationMode !== "ready"}
                  style={{
                    ...styles.buttonOnline,
                    cursor:
                      !selectedStartLocation || locationMode !== "ready"
                        ? "not-allowed"
                        : "pointer",
                    opacity: !selectedStartLocation || locationMode !== "ready" ? 0.5 : 1,
                  }}
                >
                  <FaCar /> {selectedStartLocation ? "Go Online" : "Select Location First"}
                </button>
              )}
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

      {/* Ride Acceptance Modal */}
      {showAcceptModal && pendingRide && (
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
              background: "rgba(30, 41, 59, 0.98)",
              border: "2px solid rgba(59, 130, 246, 0.5)",
              borderRadius: "24px",
              boxShadow: "0 25px 50px -12px rgba(59, 130, 246, 0.3)",
              maxWidth: "420px",
              padding: "32px",
              width: "90%",
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                gap: "16px",
                marginBottom: "24px",
              }}
            >
              <div
                style={{
                  alignItems: "center",
                  background: "linear-gradient(135deg, #3b82f6, #2563eb)",
                  borderRadius: "50%",
                  display: "flex",
                  height: "56px",
                  justifyContent: "center",
                  width: "56px",
                }}
              >
                <FaCar style={{ color: "white", fontSize: "24px" }} />
              </div>
              <div>
                <h2 style={{ color: "white", fontSize: "22px", fontWeight: 700, margin: 0 }}>
                  New Ride Request
                </h2>
                <p style={{ color: "#94a3b8", fontSize: "14px", margin: "4px 0 0" }}>
                  A rider is waiting for you
                </p>
              </div>
            </div>

            <div
              style={{
                background: "rgba(15, 23, 42, 0.6)",
                borderRadius: "16px",
                marginBottom: "24px",
                padding: "20px",
              }}
            >
              <div style={{ marginBottom: "16px" }}>
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "10px",
                    marginBottom: "8px",
                  }}
                >
                  <div
                    style={{
                      background: "#3b82f6",
                      borderRadius: "50%",
                      height: "12px",
                      width: "12px",
                    }}
                  />
                  <span style={{ color: "#94a3b8", fontSize: "13px", fontWeight: 500 }}>
                    PICKUP
                  </span>
                </div>
                <p style={{ color: "#e2e8f0", fontSize: "15px", margin: 0, paddingLeft: "22px" }}>
                  {pickupLocationName ||
                    `${pendingRide?.pickup?.lat?.toFixed(4)}, ${pendingRide?.pickup?.lng?.toFixed(4)}`}
                </p>
              </div>

              <div>
                <div
                  style={{
                    alignItems: "center",
                    display: "flex",
                    gap: "10px",
                    marginBottom: "8px",
                  }}
                >
                  <div
                    style={{
                      background: "#22c55e",
                      borderRadius: "50%",
                      height: "12px",
                      width: "12px",
                    }}
                  />
                  <span style={{ color: "#94a3b8", fontSize: "13px", fontWeight: 500 }}>
                    DROP-OFF
                  </span>
                </div>
                <p style={{ color: "#e2e8f0", fontSize: "15px", margin: 0, paddingLeft: "22px" }}>
                  {dropLocationName ||
                    `${pendingRide?.drop?.lat?.toFixed(4)}, ${pendingRide?.drop?.lng?.toFixed(4)}`}
                </p>
              </div>

              {pendingRide.fare && (
                <div
                  style={{
                    borderTop: "1px solid rgba(71, 85, 105, 0.5)",
                    marginTop: "16px",
                    paddingTop: "16px",
                  }}
                >
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      justifyContent: "space-between",
                    }}
                  >
                    <span style={{ color: "#94a3b8", fontSize: "14px" }}>Estimated Fare</span>
                    <span style={{ color: "#22c55e", fontSize: "20px", fontWeight: 700 }}>
                      ₹{pendingRide.fare}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={handleDeclineRide}
                disabled={decliningRide || acceptingRide}
                style={{
                  background: "rgba(239, 68, 68, 0.15)",
                  border: "1px solid rgba(239, 68, 68, 0.5)",
                  borderRadius: "12px",
                  color: "#f87171",
                  cursor: decliningRide || acceptingRide ? "not-allowed" : "pointer",
                  flex: 1,
                  fontSize: "16px",
                  fontWeight: 600,
                  opacity: decliningRide || acceptingRide ? 0.7 : 1,
                  padding: "14px",
                }}
              >
                {decliningRide ? "Declining..." : "Decline"}
              </button>
              <button
                type="button"
                onClick={handleAcceptRide}
                disabled={acceptingRide || decliningRide}
                style={{
                  background: "linear-gradient(90deg, #22c55e, #16a34a)",
                  border: "none",
                  borderRadius: "12px",
                  boxShadow: "0 8px 20px -4px rgba(34, 197, 94, 0.4)",
                  color: "white",
                  cursor: acceptingRide || decliningRide ? "not-allowed" : "pointer",
                  flex: 1,
                  fontSize: "16px",
                  fontWeight: 600,
                  opacity: acceptingRide || decliningRide ? 0.7 : 1,
                  padding: "14px",
                }}
              >
                {acceptingRide ? "Accepting..." : "Accept Ride"}
              </button>
            </div>
          </div>
        </div>
      )}

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
            backgroundColor: "rgba(0, 0, 0, 0.85)",
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
              animation: "popIn 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
              background: "linear-gradient(135deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98))",
              border: "2px solid rgba(34, 197, 94, 0.5)",
              borderRadius: "28px",
              boxShadow: "0 30px 60px -12px rgba(34, 197, 94, 0.3)",
              display: "flex",
              flexDirection: "column",
              maxWidth: "420px",
              padding: "48px 40px",
              position: "relative",
              textAlign: "center",
              width: "90%",
            }}
          >
            {/* Success checkmark with animation */}
            <div
              style={{
                alignItems: "center",
                animation: "successPop 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)",
                background: "linear-gradient(135deg, #22c55e, #10b981)",
                borderRadius: "50%",
                boxShadow: "0 0 40px rgba(34, 197, 94, 0.4)",
                display: "flex",
                height: "100px",
                justifyContent: "center",
                marginBottom: "24px",
                position: "relative",
                width: "100px",
              }}
            >
              <div
                style={{
                  animation: "successRipple 1.5s ease-out infinite",
                  border: "3px solid rgba(34, 197, 94, 0.5)",
                  borderRadius: "50%",
                  height: "100%",
                  left: 0,
                  position: "absolute",
                  top: 0,
                  width: "100%",
                }}
              />
              <FaCheckCircle style={{ color: "white", fontSize: "48px" }} />
            </div>

            <h2
              style={{
                animation: "fadeIn 0.5s ease-out 0.2s forwards",
                color: "#22c55e",
                fontSize: "26px",
                fontWeight: 700,
                margin: "0 0 8px",
                opacity: 0,
              }}
            >
              Payment Received!
            </h2>

            <p
              style={{
                animation: "fadeIn 0.5s ease-out 0.4s forwards",
                color: "#94a3b8",
                fontSize: "15px",
                margin: "0 0 24px",
                opacity: 0,
              }}
            >
              Ride completed successfully
            </p>

            <div
              style={{
                animation: "fadeIn 0.5s ease-out 0.5s forwards",
                background: "rgba(34, 197, 94, 0.1)",
                border: "1px solid rgba(34, 197, 94, 0.3)",
                borderRadius: "16px",
                marginBottom: "28px",
                opacity: 0,
                padding: "20px",
                width: "100%",
              }}
            >
              <p style={{ color: "#94a3b8", fontSize: "13px", margin: "0 0 4px" }}>Amount Earned</p>
              <p style={{ color: "#4ade80", fontSize: "40px", fontWeight: 800, margin: 0 }}>
                ₹{receivedAmount}
              </p>
            </div>

            <div
              style={{
                alignItems: "center",
                animation: "fadeIn 0.5s ease-out 0.6s forwards",
                background: "rgba(34, 197, 94, 0.08)",
                borderRadius: "12px",
                display: "flex",
                gap: "8px",
                justifyContent: "center",
                marginBottom: "24px",
                opacity: 0,
                padding: "12px",
                width: "100%",
              }}
            >
              <FaLeaf style={{ color: "#4ade80" }} />
              <span style={{ color: "#4ade80", fontSize: "13px" }}>
                Thank you for driving green with Eco-Ride!
              </span>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowPaymentPopup(false);
                setFinishedRideId(null);
                setWaitingForPayment(false);
                setStatus("AVAILABLE");
              }}
              style={{
                animation: "fadeIn 0.5s ease-out 0.7s forwards",
                background: "linear-gradient(135deg, #22c55e, #10b981)",
                border: "none",
                borderRadius: "16px",
                boxShadow: "0 10px 25px -5px rgba(34, 197, 94, 0.4)",
                color: "white",
                cursor: "pointer",
                fontSize: "18px",
                fontWeight: 600,
                opacity: 0,
                padding: "16px",
                transition: "transform 0.2s",
                width: "100%",
              }}
            >
              Continue Driving
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
        @keyframes popIn {
          0% { transform: scale(0.8); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
        @keyframes successPop {
          0% { transform: scale(0); }
          50% { transform: scale(1.2); }
          100% { transform: scale(1); }
        }
        @keyframes successRipple {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.8); opacity: 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes progressBar {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
      `}</style>
    </div>
  );
}
