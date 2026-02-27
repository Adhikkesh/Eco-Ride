"use client";

import polylineUtil from "@mapbox/polyline";
import {
  Autocomplete,
  DirectionsRenderer,
  GoogleMap,
  type Libraries,
  Marker,
  Polyline,
  useJsApiLoader,
} from "@react-google-maps/api";
import { onAuthStateChanged, type User } from "firebase/auth";
import { onValue, ref } from "firebase/database";
import {
  type DocumentData,
  type DocumentSnapshot,
  doc,
  type FirestoreError,
  getDoc,
  onSnapshot,
} from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaBriefcase,
  FaCheckCircle,
  FaClock,
  FaEdit,
  FaGift,
  FaHome,
  FaLeaf,
  FaMapMarkerAlt,
  FaRoute,
  FaSearch,
  FaSpinner,
  FaStar,
  FaSync,
  FaTimes,
  FaTrash,
  FaUsers,
} from "react-icons/fa";
import { backendUrl } from "@/config";
import { useTripEstimator } from "@/hooks/useTripEstimator";
import { auth, db, rtdb } from "@/lib/firebase";
import { darkMapStyles, lightMapStyles } from "@/lib/mapStyles";
import PaymentModal from "../booking/PaymentModal";
import RatingModal from "../booking/RatingModal";

// ---------------------------------------------------------
// Types
// ---------------------------------------------------------
interface DriverLocation {
  lat: number;
  lng: number;
  heading: number;
  status: "AVAILABLE" | "BUSY" | "RESERVED";
  lastUpdated: number;
  vehicleType?: string;
}

interface DriverMarker extends DriverLocation {
  id: string;
  animatedLat?: number;
  animatedLng?: number;
  animatedHeading?: number; // For smooth rotation
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

// Saved locations types
interface SavedLocation {
  lat: number;
  lng: number;
  name: string;
}

interface SavedLocations {
  home: SavedLocation | null;
  work: SavedLocation | null;
  favourite: SavedLocation | null;
}

type LocationType = "home" | "work" | "favourite";

type RideStatus =
  | "idle"
  | "searching"
  | "pending_acceptance"
  | "matched"
  | "arrived"
  | "on_trip"
  | "error";

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
    marginTop: "4px",
    padding: "16px 24px",
    transition: "all 0.3s ease",
    width: "100%",
  } as React.CSSProperties,
  actionButtonDisabled: {
    alignItems: "center",
    background: "rgba(71, 85, 105, 0.5)",
    border: "none",
    borderRadius: "16px",
    color: "#94a3b8",
    cursor: "not-allowed",
    display: "flex",
    fontSize: "16px",
    fontWeight: 600,
    gap: "12px",
    justifyContent: "center",
    marginTop: "4px",
    padding: "16px 24px",
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
  matchedCard: {
    background: "linear-gradient(135deg, rgba(34, 197, 94, 0.2), rgba(16, 185, 129, 0.2))",
    border: "2px solid rgba(34, 197, 94, 0.5)",
    borderRadius: "24px",
    marginBottom: "24px",
    padding: "24px",
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

// Helper function to create rotated car icon SVG
const createRotatedCarIcon = (
  heading: number,
  color: string = "#22c55e",
  size: number = 45,
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

// Haversine formula to calculate distance between two coordinates in meters
const haversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371e3; // Earth radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lng2 - lng1) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

// Find closest point on a polyline to a given GPS position
// This "snaps" the driver to the route, eliminating zigzag jitter from GPS/pathfinding
const findClosestPointOnRoute = (
  position: { lat: number; lng: number },
  route: google.maps.DirectionsResult | null,
): { lat: number; lng: number; heading: number } | null => {
  if (!route || !route.routes[0]) return null;

  const path = route.routes[0].overview_path;
  if (!path || path.length === 0) return null;

  let closestPoint = { lat: path[0].lat(), lng: path[0].lng() };
  let minDistance = Number.MAX_VALUE;
  let closestIndex = 0;

  // Find the closest point on the route
  for (let i = 0; i < path.length; i++) {
    const pathPoint = { lat: path[i].lat(), lng: path[i].lng() };
    const distance = haversineDistance(position.lat, position.lng, pathPoint.lat, pathPoint.lng);

    if (distance < minDistance) {
      minDistance = distance;
      closestPoint = pathPoint;
      closestIndex = i;
    }
  }

  // Calculate heading from the route direction
  let heading = 0;
  if (closestIndex < path.length - 1) {
    const current = closestPoint;
    const next = { lat: path[closestIndex + 1].lat(), lng: path[closestIndex + 1].lng() };

    // Calculate bearing between two points
    const dLng = ((next.lng - current.lng) * Math.PI) / 180;
    const lat1 = (current.lat * Math.PI) / 180;
    const lat2 = (next.lat * Math.PI) / 180;

    const y = Math.sin(dLng) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
    heading = (Math.atan2(y, x) * 180) / Math.PI;
    heading = (heading + 360) % 360; // Normalize to 0-360
  }

  return { ...closestPoint, heading };
};

// ---------------------------------------------------------
// Component
// ---------------------------------------------------------
interface RiderMapProps {
  embedded?: boolean;
  darkMode?: boolean;
}

export default function RiderMap({
  embedded = false,
  darkMode = true,
}: RiderMapProps): React.ReactNode {
  const { isLoaded } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    id: "google-map-script",
    libraries,
  });

  // Existing state
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

  // New ride matching state
  const [rideStatus, setRideStatus] = useState<RideStatus>("idle");
  const [rideId, setRideId] = useState<string | null>(null);
  const [assignedDriverId, setAssignedDriverId] = useState<string | null>(null);
  const [assignedDriverName, setAssignedDriverName] = useState<string | null>(null);
  const [assignedDriverPhone, setAssignedDriverPhone] = useState<string | null>(null);
  const [assignedDriverLocation, setAssignedDriverLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [ridePickup, setRidePickup] = useState<{ lat: number; lng: number } | null>(null);
  const [rideDrop, setRideDrop] = useState<{ lat: number; lng: number } | null>(null);
  const [animatedAssignedDriver, setAnimatedAssignedDriver] = useState<{
    lat: number;
    lng: number;
    heading: number;
  } | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  const [otp, setOtp] = useState<string | null>(null); // OTP state - fetched at 100m proximity
  const [showOtpModal, setShowOtpModal] = useState(false); // Modal visibility state
  const [_otpAvailable, setOtpAvailable] = useState(false); // Whether driver is within 100m
  const [_distanceToPickup, setDistanceToPickup] = useState<number | null>(null); // Distance in meters
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [driverRating, setDriverRating] = useState<number>(0);
  const [driverRatingCount, setDriverRatingCount] = useState<number>(0);
  const [ratingPayload, setRatingPayload] = useState<{
    rideId: string;
    driverId: string;
    driverName: string;
  } | null>(null);
  // Color-coded routes: blue for driver->pickup, green for pickup->destination
  const [directionsToPickup, setDirectionsToPickup] = useState<google.maps.DirectionsResult | null>(
    null,
  );
  const [directionsToDestination, setDirectionsToDestination] =
    useState<google.maps.DirectionsResult | null>(null);

  // Pickup location state
  const [pickupLocation, setPickupLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [pickupSearchText, setPickupSearchText] = useState("");
  const [manualPickupMode, setManualPickupMode] = useState(false);

  // Payment State
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [showPayment, setShowPayment] = useState(false);
  const [isGreenPointsUsed, setIsGreenPointsUsed] = useState(false);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [pointsUsed, setPointsUsed] = useState(0);

  // Auto-complete trip state
  const [dropOffLocation, setDropOffLocation] = useState<{ lat: number; lng: number } | null>(null);
  const autoCompleteTriggeredRef = useRef(false);

  // Estimation State
  const { getEstimate, estimate, loading: estimating, clearEstimate } = useTripEstimator();
  const [decodedPolyline, setDecodedPolyline] = useState<{ lat: number; lng: number }[]>([]);

  // Saved Locations State
  const [savedLocations, setSavedLocations] = useState<SavedLocations>({
    favourite: null,
    home: null,
    work: null,
  });
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [editingLocationType, setEditingLocationType] = useState<LocationType | null>(null);

  const mapRef = useRef<google.maps.Map | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const pickupAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);
  const lastMatchedDirectionUpdateRef = useRef<number>(0); // Throttle direction updates in matched state

  const applyRideLocations = useCallback((data: unknown) => {
    if (!data) return;
    const rideData = data as {
      pickup?: { lat: number; lng: number };
      drop?: { lat: number; lng: number };
      pickupLat?: number;
      pickupLng?: number;
      dropLat?: number;
      dropLng?: number;
      pickupName?: string;
      dropName?: string;
    };

    const pickupFromRide =
      rideData.pickup?.lat && rideData.pickup?.lng
        ? rideData.pickup
        : rideData.pickupLat !== undefined && rideData.pickupLng !== undefined
          ? { lat: rideData.pickupLat, lng: rideData.pickupLng }
          : null;

    const dropFromRide =
      rideData.drop?.lat && rideData.drop?.lng
        ? rideData.drop
        : rideData.dropLat !== undefined && rideData.dropLng !== undefined
          ? { lat: rideData.dropLat, lng: rideData.dropLng }
          : null;

    if (pickupFromRide) {
      setRidePickup(pickupFromRide);
      setPickupLocation((prev) => (prev ? prev : pickupFromRide));
      if (rideData.pickupName) {
        setPickupSearchText(rideData.pickupName);
      }
    }

    if (dropFromRide) {
      setRideDrop(dropFromRide);
      setDropOffLocation(dropFromRide);
      setSelectedDestination((prev) => {
        const name = rideData.dropName || prev?.name || "Destination";
        if (prev && prev.lat === dropFromRide.lat && prev.lng === dropFromRide.lng) {
          return prev.name === name ? prev : { ...prev, name };
        }
        return { lat: dropFromRide.lat, lng: dropFromRide.lng, name };
      });
    }
  }, []);

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
    // Use the imported onAuthStateChanged

    const unsubscribe = onAuthStateChanged(auth, (user: { uid: string } | null) => {
      let unsubscribeSnapshot: (() => void) | undefined;

      if (user && db) {
        try {
          // Real-time listener for user stats
          unsubscribeSnapshot = onSnapshot(
            doc(db, "users", user.uid),
            (docSnapshot: DocumentSnapshot<DocumentData>) => {
              if (docSnapshot.exists()) {
                const data = docSnapshot.data() as UserData;
                setUserStats((prev) => ({
                  ...prev,
                  greenPoints: data.green_points ?? 0,
                  trustScore: data.trust_score ?? 0,
                }));
              }
            },
            (error: FirestoreError) => {
              console.error("Error listening to user stats:", error);
            },
          );
        } catch (error) {
          console.error("Error setting up user listener:", error);
        }
      }

      // Cleanup snapshot listener when auth state changes or component unmounts
      return () => {
        if (unsubscribeSnapshot) {
          unsubscribeSnapshot();
        }
      };
    });

    return () => unsubscribe();
  }, []);

  // Fetch saved locations on mount
  useEffect(() => {
    const fetchSavedLocations = async () => {
      const user = auth?.currentUser;
      if (!user) return;

      try {
        const token = await user.getIdToken();
        const response = await fetch(`${backendUrl}/user/saved-locations`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.savedLocations) {
            setSavedLocations(data.savedLocations);
          }
        }
      } catch (error) {
        console.error("Error fetching saved locations:", error);
      }
    };

    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        fetchSavedLocations();
      }
    });

    return () => unsubscribe();
  }, []);

  // Check for active ride on mount
  useEffect(() => {
    const checkActiveRide = async () => {
      const user = auth?.currentUser;
      if (!user || !db) return;

      // TOP PRIORITY: Check localStorage first (bypasses list query permissions)
      const cachedRideId = localStorage.getItem("currentRideId");
      if (cachedRideId) {
        try {
          console.log("Checking cached ride:", cachedRideId);
          const rideDocRef = doc(db, "rides", cachedRideId);
          const rideDoc = await getDoc(rideDocRef);

          if (rideDoc.exists()) {
            const rideData = rideDoc.data();
            // Only restore if it's still active
            if (rideData && rideData.status === "MATCHED") {
              console.log("Restoring ride from cache");
              setRideStatus("matched");
              setRideId(cachedRideId);
              setAssignedDriverId(rideData.driverId);

              // Use stored driver name if available (new rides), otherwise fetch (legacy rides)
              console.log("DEBUG: Restoring ride", {
                hasDriverName: !!rideData.driverName,
                rideId: cachedRideId,
              });

              if (rideData.driverName) {
                setAssignedDriverName(rideData.driverName);
              } else {
                console.warn("DEBUG: driverName missing in ride doc, attempting fetch");
                try {
                  const userDoc = await getDoc(doc(db, "users", rideData.driverId));
                  if (userDoc.exists()) {
                    setAssignedDriverName(userDoc.data()?.name || "Unknown Driver");
                  }
                } catch (_err) {
                  console.log(
                    "Note: Could not fetch driver name details (expected behavior due to privacy rules). Using default.",
                  );
                  setAssignedDriverName("Unknown Driver");
                }
              }

              // Set OTP if available (for legacy support or if stored)
              if (rideData.otp) {
                setOtp(rideData.otp);
                setShowOtpModal(true);
              }
              applyRideLocations(rideData);
              return; // Exit early if successful
            } else {
              // Ride is no longer valid, clear cache
              localStorage.removeItem("currentRideId");
            }
          }
        } catch (error) {
          console.error("Error checking cached ride:", error);
          // Don't return, fall through to query method as backup
        }
      }

      // FALLBACK: Query Backend API (Bypasses Firestore Security Rules)
      try {
        console.log("DEBUG: Checking active ride via Backend API...");
        const token = await user.getIdToken();
        const response = await fetch(`${backendUrl}/ride/active`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          if (data.success && data.rideId) {
            console.log("DEBUG: Active ride found via API:", data);
            setRideStatus("matched");
            setRideId(data.rideId);
            localStorage.setItem("currentRideId", data.rideId);
            setAssignedDriverId(data.driverId);
            setAssignedDriverName(data.driverName || "Unknown Driver");
            setAssignedDriverPhone(data.driverPhone || "No Phone");
            setDriverRating(data.driverRating || 0);
            setDriverRatingCount(data.driverRatingCount || 0);
            applyRideLocations(data);

            // RESTORE ROUTE STATE
            if (data.pickup) {
              setPickupLocation(data.pickup);
            }
            if (data.drop) {
              setSelectedDestination({
                lat: data.drop.lat,
                lng: data.drop.lng,
                name: "Destination", // Default name as backend only stores lat/lng
              });
            }

            // ETA logic
            // We can re-calculate ETA in the effect that watches driver location
          }
        } else {
          if (response.status !== 404) {
            console.warn("DEBUG: Backend check active ride failed:", response.status);
          }
        }
      } catch (error) {
        console.error("Error checking active ride via API:", error);
      }
    };

    // Use onAuthStateChanged to ensure we have a user
    const unsubscribe = onAuthStateChanged(auth, (user: User | null) => {
      if (user) {
        checkActiveRide();
      }
    });

    return () => unsubscribe();
  }, [applyRideLocations]);

  const handleGreenPointsToggle = async (usePoints: boolean) => {
    setIsGreenPointsUsed(usePoints);

    // Refresh payment intent with new setting
    if (rideId && auth.currentUser) {
      try {
        const token = await auth.currentUser.getIdToken();
        const response = await fetch(`${backendUrl}/payment/create-intent`, {
          body: JSON.stringify({
            rideId,
            useGreenPoints: usePoints,
          }),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        const data = await response.json();
        console.log("[PaymentDebug] Payment Intent Response:", data);

        if (data.debug) {
          alert(
            `DEBUG INFO:\nOriginal Fare From DB: ${data.debug.originalFareFromDB}\nAvailable Points: ${data.debug.availablePoints}\nCalculated Discount: ${data.debug.calculatedDiscount}\nFinal Fare: ${data.debug.finalCalculatedFare}`,
          );
        }

        if (data.success) {
          setClientSecret(data.clientSecret);
          setPaymentAmount(data.amount);
          setDiscountAmount(data.discountAmount || 0);
          setPointsUsed(data.pointsUsed || 0);
        }
      } catch (error) {
        console.error("Error updating payment intent:", error);
      }
    }
  };

  const handlePaymentSuccess = useCallback(async () => {
    // Notify backend about payment success so driver gets the popup
    if (rideId && auth.currentUser) {
      try {
        const token = await auth.currentUser.getIdToken();
        await fetch(`${backendUrl}/ride/confirm-payment`, {
          body: JSON.stringify({
            amount: paymentAmount,
            pointsUsed,
            rideId,
          }),
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          method: "POST",
        });
        console.log("Payment confirmed with backend");
      } catch (err) {
        console.error("Failed to confirm payment:", err);
      }
    }

    setShowPayment(false);
    setClientSecret(null);
    localStorage.removeItem("currentRideId");

    // Capture rating info before clearing state
    if (rideId && assignedDriverId) {
      setRatingPayload({
        driverId: assignedDriverId,
        driverName: assignedDriverName || "Driver",
        rideId,
      });
      setShowRatingModal(true);
    }

    // Reset all ride state
    setRideStatus("idle");
    setRideId(null);
    setAssignedDriverId(null);
    setAssignedDriverName(null);
    setAssignedDriverLocation(null);
    setRidePickup(null);
    setRideDrop(null);
    setDirectionsToPickup(null);
    setDirectionsToDestination(null);
    setEta(null);
    setOtp(null);
    setPickupLocation(null);
    setSelectedDestination(null);
    setSearchDestination("");
    setManualPickupMode(false);
    setErrorMessage(null);
    setIsGreenPointsUsed(false);
    setDiscountAmount(0);
    setPointsUsed(0);
    setDropOffLocation(null);
    setDecodedPolyline([]);
    autoCompleteTriggeredRef.current = false;
  }, [rideId, paymentAmount, pointsUsed, assignedDriverId, assignedDriverName]);

  // Listen for ride status changes (Start/Complete) via RTDB (Bypasses Firestore permissions)
  useEffect(() => {
    if (!rideId || !rtdb) return;

    const rideStatusRef = ref(rtdb, `rides/${rideId}`);
    const unsubscribe = onValue(rideStatusRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        applyRideLocations(data);
        console.log("DEBUG: RTDB Ride Update:", data);

        if (data.status === "IN_PROGRESS") {
          setRideStatus("on_trip");
        } else if (data.status === "COMPLETED" && data.paymentStatus !== "PAID") {
          // Trip Completed Logic - Trigger Payment
          console.log("Trip completed. Initializing payment...");

          // Clear route lines from the map
          setDirectionsToPickup(null);
          setDirectionsToDestination(null);
          setDecodedPolyline([]);

          // Fetch payment intent
          const user = auth?.currentUser;
          if (user) {
            user.getIdToken().then((token: string) => {
              fetch(`${backendUrl}/payment/create-intent`, {
                body: JSON.stringify({ rideId }),
                headers: {
                  Authorization: `Bearer ${token}`,
                  "Content-Type": "application/json",
                },
                method: "POST",
              })
                .then((res) => res.json())
                .then((paymentData) => {
                  if (paymentData.success && paymentData.clientSecret) {
                    setClientSecret(paymentData.clientSecret);
                    setPaymentAmount(paymentData.amount);
                    setShowPayment(true);
                  } else {
                    console.error("Failed to create payment intent", {
                      fullResponse: paymentData,
                      message: paymentData.message,
                      success: paymentData.success,
                    });
                    alert(
                      `Error initializing payment: ${paymentData.message || "Unknown error"}. Please contact support.`,
                    );
                    handlePaymentSuccess(); // Fallback to close for now if payment fails initialization
                  }
                })
                .catch((err) => {
                  console.error("Payment Intent Error", err);
                  // Fallback for demo if backend fails or not configured
                  alert("Trip completed! (Payment skipped due to error)");
                  handlePaymentSuccess();
                });
            });
          }
        }
      }
    });

    return () => unsubscribe();
  }, [rideId, handlePaymentSuccess, applyRideLocations]);

  // Listen to online drivers with throttling to prevent excessive updates
  const driversBufferRef = useRef<Map<string, DriverLocation>>(new Map());
  const lastDriversUpdateRef = useRef<number>(0);

  useEffect(() => {
    if (!rtdb) return;

    const driversRef = ref(rtdb, "drivers-online");

    const unsubscribe = onValue(
      driversRef,
      (snapshot) => {
        setIsConnected(true);
        setLastUpdate(new Date());

        const data = snapshot.val();
        const now = Date.now();
        const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes
        const UPDATE_INTERVAL = 3000; // Only update state every 3 seconds

        if (data) {
          // Store in buffer without triggering state update
          Object.entries(data).forEach(([driverId, locationData]) => {
            const location = locationData as DriverLocation;
            if (!location.lastUpdated || now - location.lastUpdated > STALE_THRESHOLD) {
              driversBufferRef.current.delete(driverId);
            } else {
              driversBufferRef.current.set(driverId, location);
            }
          });
        }

        // Throttle state updates to reduce re-renders
        const timeSinceLastUpdate = now - lastDriversUpdateRef.current;
        if (timeSinceLastUpdate >= UPDATE_INTERVAL) {
          lastDriversUpdateRef.current = now;

          const newDrivers = new Map<string, DriverMarker>();
          driversBufferRef.current.forEach((location, driverId) => {
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

          setDrivers(newDrivers);
        }
      },
      (error) => {
        console.error("Firebase listener error:", error);
        setIsConnected(false);
      },
    );

    // Set up interval to push buffered updates even if Firebase doesn't fire
    const intervalId = setInterval(() => {
      const now = Date.now();
      const timeSinceLastUpdate = now - lastDriversUpdateRef.current;
      if (timeSinceLastUpdate >= 3000 && driversBufferRef.current.size > 0) {
        lastDriversUpdateRef.current = now;

        const newDrivers = new Map<string, DriverMarker>();
        const STALE_THRESHOLD = 5 * 60 * 1000;

        driversBufferRef.current.forEach((location, driverId) => {
          if (location.lastUpdated && now - location.lastUpdated < STALE_THRESHOLD) {
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
          }
        });

        setDrivers(newDrivers);
      }
    }, 3000);

    return () => {
      unsubscribe();
      clearInterval(intervalId);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  // Listen to assigned driver location updates with route-snapping to eliminate zigzag
  const assignedDriverBufferRef = useRef<{ lat: number; lng: number; time: number } | null>(null);
  const lastAssignedUpdateRef = useRef<number>(0);
  const assignedDriverDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const currentRouteRef = useRef<google.maps.DirectionsResult | null>(null);

  // Store the current active route for snapping
  useEffect(() => {
    if (rideStatus === "matched" && directionsToPickup) {
      currentRouteRef.current = directionsToPickup;
    } else if (rideStatus === "on_trip" && directionsToDestination) {
      currentRouteRef.current = directionsToDestination;
    } else {
      currentRouteRef.current = null;
    }
  }, [rideStatus, directionsToPickup, directionsToDestination]);

  useEffect(() => {
    if (
      !assignedDriverId ||
      (rideStatus !== "matched" && rideStatus !== "arrived" && rideStatus !== "on_trip")
    )
      return;

    const driverRef = ref(rtdb, `drivers-online/${assignedDriverId}`);

    const unsubscribe = onValue(driverRef, (snapshot) => {
      const data = snapshot.val() as DriverLocation | null;
      if (!data) return;

      let newLocation = { lat: data.lat, lng: data.lng };
      const now = Date.now();

      // ROUTE SNAPPING: Snap driver position to the route to eliminate GPS jitter & zigzag
      if (currentRouteRef.current) {
        const snapped = findClosestPointOnRoute(newLocation, currentRouteRef.current);
        if (snapped) {
          console.log(
            `🧲 Snapped driver from (${newLocation.lat.toFixed(5)}, ${newLocation.lng.toFixed(5)}) to route`,
          );
          newLocation = { lat: snapped.lat, lng: snapped.lng };
          // Also update heading from route direction (more accurate than GPS heading)
          data.heading = snapped.heading;
        }
      }

      // Constants for filtering (now even more lenient since we're route-snapping)
      const MIN_DISTANCE_METERS = 5; // Reduced from 12 since snapping reduces noise
      const MIN_UPDATE_INTERVAL = 1500; // Reduced from 2500
      const MAX_UPDATE_INTERVAL = 4000; // Reduced from 5000
      const DEBOUNCE_DELAY = 500; // Reduced from 800

      // Clear any pending debounced update
      if (assignedDriverDebounceRef.current) {
        clearTimeout(assignedDriverDebounceRef.current);
      }

      // Debounce the update to prevent rapid-fire changes
      assignedDriverDebounceRef.current = setTimeout(() => {
        const timeSinceLastUpdate = now - lastAssignedUpdateRef.current;
        let shouldUpdate = false;

        if (!assignedDriverBufferRef.current) {
          // First update, always accept
          shouldUpdate = true;
        } else {
          const distance = haversineDistance(
            assignedDriverBufferRef.current.lat,
            assignedDriverBufferRef.current.lng,
            newLocation.lat,
            newLocation.lng,
          );

          // Update only if significant distance AND enough time passed
          if (distance >= MIN_DISTANCE_METERS && timeSinceLastUpdate >= MIN_UPDATE_INTERVAL) {
            shouldUpdate = true;
          } else if (timeSinceLastUpdate >= MAX_UPDATE_INTERVAL) {
            // Force update after max interval to catch slow movements
            shouldUpdate = true;
          }
        }

        if (shouldUpdate) {
          assignedDriverBufferRef.current = { ...newLocation, time: now };
          lastAssignedUpdateRef.current = now;
          setAssignedDriverLocation(newLocation);
          console.log(
            `✅ Driver location updated: ${newLocation.lat.toFixed(4)}, ${newLocation.lng.toFixed(4)}`,
          );
        } else {
          console.log(
            `⏭️  Driver update filtered (distance: ${assignedDriverBufferRef.current ? haversineDistance(assignedDriverBufferRef.current.lat, assignedDriverBufferRef.current.lng, newLocation.lat, newLocation.lng).toFixed(1) : "N/A"}m)`,
          );
        }
      }, DEBOUNCE_DELAY);
    });

    return () => {
      unsubscribe();
      if (assignedDriverDebounceRef.current) {
        clearTimeout(assignedDriverDebounceRef.current);
      }
    };
  }, [assignedDriverId, rideStatus]);

  const clearLocalRideState = useCallback(() => {
    // Clear persistence
    localStorage.removeItem("currentRideId");

    // Reset all ride state
    setRideStatus("idle");
    setRideId(null);
    setAssignedDriverId(null);
    setAssignedDriverName(null);
    setAssignedDriverPhone(null);
    setAssignedDriverLocation(null);
    setRidePickup(null);
    setRideDrop(null);
    setEta(null);
    setDirectionsToPickup(null);
    setDirectionsToDestination(null);
    setDecodedPolyline([]);
    setErrorMessage(null);
    setManualPickupMode(false);
    setOtp(null);
    setPickupLocation(null);
    setSelectedDestination(null);
    setSearchDestination("");
    setDropOffLocation(null);
    autoCompleteTriggeredRef.current = false;
  }, []);

  // Listen for ride status updates from RTDB (e.g., driver accepts, trip starts)
  useEffect(() => {
    if (!rtdb || !rideId) return;

    const rideRef = ref(rtdb, `rides/${rideId}`);

    const unsubscribe = onValue(rideRef, (snapshot) => {
      const data = snapshot.val();
      if (!data) return;
      applyRideLocations(data);

      // Update ride status based on RTDB updates
      if (data.status === "MATCHED" && rideStatus === "pending_acceptance") {
        console.log("Driver accepted the ride!");
        setRideStatus("matched");
        setDecodedPolyline([]); // Clear estimate polyline when ride is matched
        if (data.driverName) setAssignedDriverName(data.driverName);
        if (data.driverPhone) setAssignedDriverPhone(data.driverPhone);
      } else if (
        data.status === "ARRIVED" &&
        (rideStatus === "matched" || rideStatus === "pending_acceptance")
      ) {
        console.log("Driver has arrived!");
        setRideStatus("arrived");
      } else if (
        data.status === "IN_PROGRESS" &&
        (rideStatus === "matched" || rideStatus === "arrived")
      ) {
        console.log("Trip started!");
        setRideStatus("on_trip");
      } else if (data.status === "SEARCHING" && rideStatus === "pending_acceptance") {
        // Driver declined, system is re-matching
        console.log("Driver declined, searching for new driver...");
        setErrorMessage("Driver unavailable. Finding another driver...");
      } else if (
        data.status === "CANCELLED" &&
        (rideStatus === "matched" ||
          rideStatus === "arrived" ||
          rideStatus === "pending_acceptance")
      ) {
        console.log("Ride was cancelled!");
        clearLocalRideState();
        if (data.cancelReason === "TIMEOUT") {
          setErrorMessage("Ride cancelled due to no response.");
        } else {
          setErrorMessage("The ride was cancelled.");
        }
      } else if (data.status === "NO_DRIVERS") {
        setRideStatus("error");
        setErrorMessage("No drivers available. Please try again.");
      }
    });

    return () => unsubscribe();
  }, [rideId, rideStatus, clearLocalRideState, applyRideLocations]);

  // Poll for OTP when matched or arrived (available at 100m proximity)
  useEffect(() => {
    if ((rideStatus !== "matched" && rideStatus !== "arrived") || !rideId) return;

    // Polling function to check OTP availability
    const checkOtpAvailability = async () => {
      try {
        const user = auth?.currentUser;
        if (!user) return;

        const token = await user.getIdToken();
        const response = await fetch(`${backendUrl}/ride/otp/${rideId}`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        const data = await response.json();
        if (data.success) {
          setDistanceToPickup(data.distanceToPickup || null);

          if (data.otpAvailable && data.otp) {
            setOtp(data.otp);
            setOtpAvailable(true);
            setShowOtpModal(true);
          } else {
            setOtpAvailable(false);
          }
        }
      } catch (error) {
        console.error("Error checking OTP availability:", error);
      }
    };

    // Check immediately and then poll every 5 seconds
    checkOtpAvailability();
    const pollInterval = setInterval(checkOtpAvailability, 5000);

    return () => clearInterval(pollInterval);
  }, [rideStatus, rideId]);

  // Auto-complete trip when driver reaches within 100m of destination
  useEffect(() => {
    if (
      rideStatus !== "on_trip" ||
      !assignedDriverLocation ||
      !dropOffLocation ||
      !rideId ||
      autoCompleteTriggeredRef.current
    ) {
      return;
    }

    const distance = haversineDistance(
      assignedDriverLocation.lat,
      assignedDriverLocation.lng,
      dropOffLocation.lat,
      dropOffLocation.lng,
    );

    console.log(`Distance to destination: ${distance.toFixed(0)}m`);

    if (distance <= 100) {
      console.log("Driver within 100m of destination - Auto-completing trip...");
      autoCompleteTriggeredRef.current = true;

      // Auto-complete the ride
      const autoCompleteRide = async () => {
        try {
          const user = auth?.currentUser;
          if (!user) return;

          const token = await user.getIdToken();
          const response = await fetch(`${backendUrl}/ride/complete`, {
            body: JSON.stringify({ rideId }),
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            method: "POST",
          });

          const data = await response.json();
          if (data.success) {
            console.log("Trip auto-completed successfully!");
            // The RTDB listener will handle showing the payment modal
          } else {
            console.error("Failed to auto-complete trip:", data.message);
            autoCompleteTriggeredRef.current = false; // Allow retry
          }
        } catch (error) {
          console.error("Error auto-completing trip:", error);
          autoCompleteTriggeredRef.current = false; // Allow retry
        }
      };

      autoCompleteRide();
    }
  }, [assignedDriverLocation, dropOffLocation, rideStatus, rideId]);

  // Calculate and update route when driver location or destination changes
  useEffect(() => {
    const destination =
      rideDrop ||
      (selectedDestination ? { lat: selectedDestination.lat, lng: selectedDestination.lng } : null);
    if (!isLoaded || (!assignedDriverLocation && !currentLocation) || !destination) {
      return;
    }

    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }

    const pickup = ridePickup || pickupLocation || currentLocation;

    // CASE 1: PENDING_ACCEPTANCE (Show pickup -> destination preview while waiting)
    if (rideStatus === "pending_acceptance" && pickup) {
      // Just show planned route: Pickup -> Destination
      directionsServiceRef.current.route(
        {
          destination,
          origin: pickup,
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            setDirectionsToDestination(result);
            setDirectionsToPickup(null); // No pickup route yet - driver hasn't accepted
          }
        },
      );
    }

    // CASE 2: MATCHED (Driver coming to pickup) - Throttle updates to prevent flickering
    else if (rideStatus === "matched" && assignedDriverLocation && pickup) {
      // Skip if last update was less than 3 seconds ago (prevents excessive API calls)
      const now = Date.now();
      if (now - lastMatchedDirectionUpdateRef.current < 3000) {
        return;
      }
      lastMatchedDirectionUpdateRef.current = now;
      // Calculate route: Driver -> Pickup
      directionsServiceRef.current.route(
        {
          destination: pickup,
          origin: assignedDriverLocation,
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            setDirectionsToPickup(result);

            // Extract ETA from driver to pickup
            const leg = result.routes[0]?.legs[0];
            if (leg?.duration?.text) {
              setEta(leg.duration.text);
            }
          } else {
            console.error("Directions to pickup failed:", status);
          }
        },
      );

      // Also prepare route: Pickup -> Destination for display
      directionsServiceRef.current.route(
        {
          destination,
          origin: pickup,
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            setDirectionsToDestination(result);
          }
        },
      );
    }

    // CASE 3: ON TRIP (Driving to Destination) - Update every 10s for live ETA
    else if (rideStatus === "on_trip" && assignedDriverLocation) {
      // Recalculate route every 10 seconds during on_trip for live ETA updates
      const now = Date.now();
      const lastDirectionsUpdate = (window as unknown as { lastDirectionsUpdate?: number })
        .lastDirectionsUpdate;
      if (lastDirectionsUpdate && now - lastDirectionsUpdate < 10000) {
        return; // Skip if last update was less than 10 seconds ago
      }
      (window as unknown as { lastDirectionsUpdate: number }).lastDirectionsUpdate = now;

      // Calculate route: Driver (Current Loc) -> Destination
      directionsServiceRef.current.route(
        {
          destination,
          origin: assignedDriverLocation, // Driver's current location is the car location
          travelMode: google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          if (status === google.maps.DirectionsStatus.OK && result) {
            setDirectionsToDestination(result);
            setDirectionsToPickup(null); // Clear pickup route

            // Extract ETA to destination
            const leg = result.routes[0]?.legs[0];
            if (leg?.duration?.text) {
              setEta(leg.duration.text);
            }
          }
        },
      );
    }

    // CASE 4: IDLE, COMPLETED, or CANCELLED - Clear all routes
    else if (
      rideStatus === "idle" ||
      rideStatus === "error" ||
      (rideStatus as string) === "COMPLETED" ||
      (rideStatus as string) === "CANCELLED"
    ) {
      setDirectionsToDestination(null);
      setDirectionsToPickup(null);
    }
  }, [
    isLoaded,
    rideStatus,
    assignedDriverLocation,
    currentLocation,
    pickupLocation,
    ridePickup,
    rideDrop,
    selectedDestination,
  ]);

  // Animate driver markers with smooth position and heading interpolation
  // Use a ref to store animated values and only update state at reduced rate
  const animatedDriversRef = useRef<Map<string, { lat: number; lng: number; heading: number }>>(
    new Map(),
  );
  const lastAnimationUpdateRef = useRef<number>(0);

  useEffect(() => {
    const animate = (timestamp: number) => {
      // Initialize animated positions from driver state
      drivers.forEach((driver, id) => {
        if (!animatedDriversRef.current.has(id)) {
          animatedDriversRef.current.set(id, {
            heading: driver.heading,
            lat: driver.lat,
            lng: driver.lng,
          });
        }
      });

      // Clean up removed drivers
      animatedDriversRef.current.forEach((_, id) => {
        if (!drivers.has(id)) {
          animatedDriversRef.current.delete(id);
        }
      });

      // Interpolate positions in ref with adaptive smoothing
      let hasSignificantChange = false;
      animatedDriversRef.current.forEach((animated, id) => {
        const driver = drivers.get(id);
        if (!driver) return;

        const targetLat = driver.lat;
        const targetLng = driver.lng;
        const targetHeading = driver.heading;

        // Calculate distance for adaptive interpolation
        const distance = haversineDistance(animated.lat, animated.lng, targetLat, targetLng);

        // Adaptive interpolation: slower when very close to prevent oscillation
        let posLerp: number;
        if (distance < 5) {
          posLerp = 0.04; // Ultra slow for micro-movements
        } else if (distance < 15) {
          posLerp = 0.06; // Very slow for small movements
        } else if (distance < 50) {
          posLerp = 0.08; // Slow for normal movements
        } else if (distance < 100) {
          posLerp = 0.1; // Medium for longer distances
        } else {
          posLerp = 0.12; // Faster catch-up for large distances
        }

        const newLat = animated.lat + (targetLat - animated.lat) * posLerp;
        const newLng = animated.lng + (targetLng - animated.lng) * posLerp;

        // Smooth heading interpolation (handle wrap-around)
        let headingDiff = targetHeading - animated.heading;
        if (headingDiff > 180) headingDiff -= 360;
        if (headingDiff < -180) headingDiff += 360;
        const headingLerp = 0.12; // Slower heading interpolation
        let newHeading = animated.heading + headingDiff * headingLerp;
        if (newHeading < 0) newHeading += 360;
        if (newHeading >= 360) newHeading -= 360;

        // Check for significant change
        if (
          Math.abs(newLat - animated.lat) > 0.000005 ||
          Math.abs(newLng - animated.lng) > 0.000005 ||
          Math.abs(newHeading - animated.heading) > 0.5
        ) {
          hasSignificantChange = true;
        }

        animated.lat = newLat;
        animated.lng = newLng;
        animated.heading = newHeading;
      });

      // Only trigger React state update every 200ms (5 FPS) to reduce re-renders
      const timeSinceLastUpdate = timestamp - lastAnimationUpdateRef.current;
      if (hasSignificantChange && timeSinceLastUpdate > 200) {
        lastAnimationUpdateRef.current = timestamp;
        setDrivers((prev) => {
          const updated = new Map(prev);
          animatedDriversRef.current.forEach((animated, id) => {
            const driver = prev.get(id);
            if (driver) {
              updated.set(id, {
                ...driver,
                animatedHeading: animated.heading,
                animatedLat: animated.lat,
                animatedLng: animated.lng,
              });
            }
          });
          return updated;
        });
      }

      animationFrameRef.current = requestAnimationFrame(animate);
    };

    animationFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [drivers]);

  // Separate ultra-smooth animation specifically for assigned driver
  const assignedDriverAnimFrameRef = useRef<number | null>(null);
  const assignedDriverAnimatedRef = useRef<{ lat: number; lng: number; heading: number } | null>(
    null,
  );

  useEffect(() => {
    if (!assignedDriverLocation) {
      setAnimatedAssignedDriver(null);
      assignedDriverAnimatedRef.current = null;
      return;
    }

    // Initialize animated position
    if (!assignedDriverAnimatedRef.current) {
      assignedDriverAnimatedRef.current = {
        heading: 0,
        lat: assignedDriverLocation.lat,
        lng: assignedDriverLocation.lng,
      };
      setAnimatedAssignedDriver(assignedDriverAnimatedRef.current);
    }

    const animate = () => {
      if (!assignedDriverLocation || !assignedDriverAnimatedRef.current) return;

      const target = assignedDriverLocation;
      const current = assignedDriverAnimatedRef.current;

      // Ultra-smooth interpolation for assigned driver (user's primary focus)
      const distance = haversineDistance(current.lat, current.lng, target.lat, target.lng);

      // Very slow interpolation for buttery-smooth movement
      const posLerp = distance < 10 ? 0.03 : distance < 30 ? 0.05 : 0.07;

      const newLat = current.lat + (target.lat - current.lat) * posLerp;
      const newLng = current.lng + (target.lng - current.lng) * posLerp;

      // Calculate heading from movement direction
      let newHeading = current.heading;
      if (distance > 1) {
        // Only update heading if actually moving
        const dLng = ((target.lng - current.lng) * Math.PI) / 180;
        const lat1 = (current.lat * Math.PI) / 180;
        const lat2 = (target.lat * Math.PI) / 180;

        const y = Math.sin(dLng) * Math.cos(lat2);
        const x =
          Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
        const bearing = (Math.atan2(y, x) * 180) / Math.PI;
        const targetHeading = (bearing + 360) % 360;

        // Smooth heading transition
        let headingDiff = targetHeading - current.heading;
        if (headingDiff > 180) headingDiff -= 360;
        if (headingDiff < -180) headingDiff += 360;
        newHeading = current.heading + headingDiff * 0.08; // Very smooth heading
        if (newHeading < 0) newHeading += 360;
        if (newHeading >= 360) newHeading -= 360;
      }

      // Update animated state
      assignedDriverAnimatedRef.current = {
        heading: newHeading,
        lat: newLat,
        lng: newLng,
      };

      setAnimatedAssignedDriver({ ...assignedDriverAnimatedRef.current });

      assignedDriverAnimFrameRef.current = requestAnimationFrame(animate);
    };

    assignedDriverAnimFrameRef.current = requestAnimationFrame(animate);

    return () => {
      if (assignedDriverAnimFrameRef.current) {
        cancelAnimationFrame(assignedDriverAnimFrameRef.current);
      }
    };
  }, [assignedDriverLocation]);

  const onLoad = useCallback((map: google.maps.Map) => {
    mapRef.current = map;
  }, []);

  const onUnmount = useCallback(() => {
    mapRef.current = null;
  }, []);

  // Handle map click to set pickup location manually
  const onMapClick = useCallback(
    (e: google.maps.MapMouseEvent) => {
      if (!manualPickupMode || rideStatus !== "idle" || !e.latLng) return;

      const lat = e.latLng.lat();
      const lng = e.latLng.lng();

      setPickupLocation({ lat, lng });

      // Also update currentLocation for compatibility
      setCurrentLocation({ lat, lng });

      // Exit manual mode after setting location
      setManualPickupMode(false);

      // Pan map to the selected location
      if (mapRef.current) {
        mapRef.current.panTo({ lat, lng });
      }

      // Update search text to coordinates
      setPickupSearchText(`${lat.toFixed(6)}, ${lng.toFixed(6)}`);
    },
    [manualPickupMode, rideStatus],
  );

  const onAutocompleteLoad = useCallback((autocomplete: google.maps.places.Autocomplete) => {
    autocompleteRef.current = autocomplete;
  }, []);

  const onPickupAutocompleteLoad = useCallback((autocomplete: google.maps.places.Autocomplete) => {
    pickupAutocompleteRef.current = autocomplete;
  }, []);

  const onPlaceChanged = useCallback(() => {
    if (autocompleteRef.current) {
      const place = autocompleteRef.current.getPlace();
      if (!place || !place.geometry || !place.geometry.location) {
        console.warn("Place selection did not return valid geometry");
        return;
      }
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
  }, []);

  const onPickupPlaceChanged = useCallback(() => {
    if (pickupAutocompleteRef.current) {
      const place = pickupAutocompleteRef.current.getPlace();
      if (!place || !place.geometry || !place.geometry.location) {
        console.warn("Pickup place selection did not return valid geometry");
        return;
      }
      const lat = place.geometry.location.lat();
      const lng = place.geometry.location.lng();

      setPickupLocation({ lat, lng });
      setCurrentLocation({ lat, lng });
      setPickupSearchText(place.name || place.formatted_address || "Selected Location");

      // Pan map to selected location
      if (mapRef.current) {
        mapRef.current.panTo({ lat, lng });
        mapRef.current.setZoom(15);
      }
    }
  }, []);

  // Handle Get Estimate
  const handleGetEstimate = async () => {
    if (!currentLocation || !selectedDestination) {
      setErrorMessage("Please select a destination first");
      return;
    }

    const pickup = pickupLocation || currentLocation;
    if (!pickup) {
      setErrorMessage("Please set a pickup location");
      return;
    }

    const result = await getEstimate(pickup, {
      lat: selectedDestination.lat,
      lng: selectedDestination.lng,
    });

    if (result?.polyline) {
      try {
        const decoded = polylineUtil.decode(result.polyline);
        const path = decoded.map((p) => ({ lat: p[0], lng: p[1] }));
        setDecodedPolyline(path);

        // Fit bounds
        if (mapRef.current) {
          const bounds = new google.maps.LatLngBounds();
          path.forEach((p) => {
            bounds.extend(p);
          });
          mapRef.current.fitBounds(bounds);
        }
      } catch (e) {
        console.error("Polyline decode error", e);
      }
    }
  };

  const cancelEstimate = () => {
    clearEstimate();
    setDecodedPolyline([]);
  };

  const handleFindRide = async () => {
    if (!currentLocation || !selectedDestination) {
      setErrorMessage("Please select a destination first");
      return;
    }

    setRideStatus("searching");
    setErrorMessage(null);
    clearEstimate(); // Clear estimate UI when searching starts
    setDecodedPolyline([]);
    autoCompleteTriggeredRef.current = false; // Reset auto-complete flag

    // Store drop-off location for auto-complete distance calculation
    setDropOffLocation({ lat: selectedDestination.lat, lng: selectedDestination.lng });

    try {
      // Get auth token
      const user = auth?.currentUser;
      if (!user) {
        setRideStatus("error");
        setErrorMessage("Please log in to request a ride");
        return;
      }

      // Determine pickup location (prioritize manual selection)
      const pickup = pickupLocation || currentLocation;
      if (!pickup) {
        setRideStatus("error");
        setErrorMessage("Please set a pickup location");
        return;
      }

      setRidePickup(pickup);
      setRideDrop({ lat: selectedDestination.lat, lng: selectedDestination.lng });

      const token = await user.getIdToken();

      const response = await fetch(`${backendUrl}/ride/request`, {
        body: JSON.stringify({
          co2Saved: estimate?.co2_saved_g || 0,
          distance: estimate?.distance_km || null,
          dropLat: selectedDestination.lat,
          dropLng: selectedDestination.lng,
          dropName: selectedDestination.name,
          duration: estimate?.details?.duration_s || null,
          fare: estimate?.fare || null,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          pickupName: pickupSearchText || "Current Location",
          riderId: user.uid,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data = await response.json();

      if (data.success && data.rideId) {
        // Store ride info
        setRideId(data.rideId);
        setAssignedDriverId(data.driverId);
        setAssignedDriverName(data.driverName || "Unknown Driver");
        setAssignedDriverPhone(data.driverPhone || "No Phone");
        setDriverRating(data.driverRating || 0);
        setDriverRatingCount(data.driverRatingCount || 0);
        localStorage.setItem("currentRideId", data.rideId);

        if (data.driverLocation) {
          setAssignedDriverLocation(data.driverLocation);
        }
        applyRideLocations(data);
        setEta(data.eta || null);

        // Handle based on status from backend
        if (data.status === "PENDING_ACCEPTANCE") {
          // Driver needs to accept the ride first
          setRideStatus("pending_acceptance");
          setOtp(null);
          setOtpAvailable(false);
        } else if (data.status === "MATCHED") {
          // Driver already accepted
          setRideStatus("matched");
          if (data.otp) {
            setOtp(data.otp);
            setShowOtpModal(true);
          }
        }
      } else {
        setRideStatus("error");
        setErrorMessage(data.message || "Failed to find a driver");
      }
    } catch (error) {
      console.error("Error requesting ride:", error);
      setRideStatus("error");
      setErrorMessage("Network error. Please try again.");
    }
  };

  const handleCancelRide = async () => {
    if (!rideId) return;

    try {
      const user = auth?.currentUser;
      const token = await user?.getIdToken();

      await fetch(`${backendUrl}/ride/cancel`, {
        body: JSON.stringify({ rideId }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      clearLocalRideState();
    } catch (error) {
      console.error("Error cancelling ride:", error);
      // Still clear local state if the ride is already cancelled on backend
      clearLocalRideState();
    }
  };

  const handleViewRewards = () => {
    // TODO: Navigate to rewards page
    alert("Viewing your green rewards...");
  };

  // Save current destination to a slot
  const handleSaveLocation = async (type: LocationType) => {
    if (!selectedDestination) {
      setErrorMessage("Please select a destination first");
      return;
    }

    const user = auth?.currentUser;
    if (!user) {
      setErrorMessage("Please log in to save locations");
      return;
    }

    setSavingLocation(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${backendUrl}/user/saved-locations`, {
        body: JSON.stringify({
          location: {
            lat: selectedDestination.lat,
            lng: selectedDestination.lng,
            name: selectedDestination.name,
          },
          type,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "PUT",
      });

      if (response.ok) {
        // Update local state
        setSavedLocations((prev) => ({
          ...prev,
          [type]: {
            lat: selectedDestination.lat,
            lng: selectedDestination.lng,
            name: selectedDestination.name,
          },
        }));
        setShowSaveModal(false);
      } else {
        const data = await response.json();
        setErrorMessage(data.message || "Failed to save location");
      }
    } catch (error) {
      console.error("Error saving location:", error);
      setErrorMessage("Failed to save location");
    } finally {
      setSavingLocation(false);
    }
  };

  // Select a saved location as destination
  const handleSelectSavedLocation = (type: LocationType) => {
    const location = savedLocations[type];
    if (!location) return;

    setSelectedDestination({
      lat: location.lat,
      lng: location.lng,
      name: location.name,
    });
    setSearchDestination(location.name);
    setEditingLocationType(null); // Close edit menu

    // Pan map to selected location
    if (mapRef.current) {
      mapRef.current.panTo({ lat: location.lat, lng: location.lng });
      mapRef.current.setZoom(15);
    }
  };

  // Clear/delete a saved location
  const handleClearSavedLocation = async (type: LocationType) => {
    const user = auth?.currentUser;
    if (!user) return;

    setSavingLocation(true);
    try {
      const token = await user.getIdToken();
      const response = await fetch(`${backendUrl}/user/saved-locations`, {
        body: JSON.stringify({
          location: null, // Setting to null clears the location
          type,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "PUT",
      });

      if (response.ok) {
        setSavedLocations((prev) => ({
          ...prev,
          [type]: null,
        }));
        setEditingLocationType(null);
      }
    } catch (error) {
      console.error("Error clearing saved location:", error);
    } finally {
      setSavingLocation(false);
    }
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
  const busyCount = driverArray.filter(
    (d) => d.status === "BUSY" || d.status === "RESERVED",
  ).length;

  const pageStyle = embedded ? { padding: "24px" } : styles.page;

  // Determine button state
  const pickup = pickupLocation || currentLocation;
  const canRequestRide =
    pickup && selectedDestination && (rideStatus === "idle" || rideStatus === "error");

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
            {/* Enhanced Driver Search Animation Overlay */}
            {(rideStatus === "searching" || rideStatus === "pending_acceptance") && (
              <div
                style={{
                  background:
                    "linear-gradient(135deg, rgba(15, 23, 42, 0.98), rgba(30, 41, 59, 0.95))",
                  border: "1px solid rgba(34, 197, 94, 0.3)",
                  borderRadius: "24px",
                  boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
                  overflow: "hidden",
                  padding: "32px",
                  position: "relative",
                }}
              >
                {/* Animated background gradient */}
                <div
                  style={{
                    animation: "gradientShift 3s ease infinite",
                    background:
                      "linear-gradient(45deg, rgba(34, 197, 94, 0.1), rgba(59, 130, 246, 0.1), rgba(34, 197, 94, 0.1))",
                    backgroundSize: "200% 200%",
                    height: "100%",
                    left: 0,
                    position: "absolute",
                    top: 0,
                    width: "100%",
                  }}
                />

                {/* Content */}
                <div style={{ position: "relative", zIndex: 1 }}>
                  {/* Animated Car Icon with Pulse Effect */}
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      justifyContent: "center",
                      marginBottom: "24px",
                    }}
                  >
                    <div
                      style={{
                        alignItems: "center",
                        animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                        background:
                          "linear-gradient(135deg, rgba(34, 197, 94, 0.3), rgba(16, 185, 129, 0.2))",
                        borderRadius: "50%",
                        display: "flex",
                        height: "120px",
                        justifyContent: "center",
                        position: "relative",
                        width: "120px",
                      }}
                    >
                      {/* Ripple Effects */}
                      <div
                        style={{
                          animation: "ripple 2s linear infinite",
                          border: "2px solid rgba(34, 197, 94, 0.4)",
                          borderRadius: "50%",
                          height: "100%",
                          left: 0,
                          position: "absolute",
                          top: 0,
                          width: "100%",
                        }}
                      />
                      <div
                        style={{
                          animation: "ripple 2s linear infinite 0.5s",
                          border: "2px solid rgba(34, 197, 94, 0.3)",
                          borderRadius: "50%",
                          height: "100%",
                          left: 0,
                          position: "absolute",
                          top: 0,
                          width: "100%",
                        }}
                      />
                      <div
                        style={{
                          animation: "ripple 2s linear infinite 1s",
                          border: "2px solid rgba(34, 197, 94, 0.2)",
                          borderRadius: "50%",
                          height: "100%",
                          left: 0,
                          position: "absolute",
                          top: 0,
                          width: "100%",
                        }}
                      />
                      <FaCar
                        style={{
                          animation: "carBounce 1.5s ease-in-out infinite",
                          color: "#22c55e",
                          fontSize: "48px",
                        }}
                      />
                    </div>
                  </div>

                  {/* Status Text */}
                  <div style={{ marginBottom: "28px", textAlign: "center" }}>
                    <h2
                      style={{
                        color: "white",
                        fontSize: "24px",
                        fontWeight: 700,
                        margin: "0 0 8px",
                      }}
                    >
                      {rideStatus === "searching" ? "Finding Your Driver" : "Driver Notified"}
                    </h2>
                    <p style={{ color: "#94a3b8", fontSize: "15px", margin: 0 }}>
                      {rideStatus === "searching"
                        ? "Searching nearby drivers for the best match..."
                        : "Waiting for driver to accept your ride request..."}
                    </p>
                  </div>

                  {/* Backend Process Steps */}
                  <div
                    style={{
                      background: "rgba(15, 23, 42, 0.6)",
                      borderRadius: "16px",
                      marginBottom: "24px",
                      padding: "20px",
                    }}
                  >
                    <h3
                      style={{
                        alignItems: "center",
                        color: "#94a3b8",
                        display: "flex",
                        fontSize: "12px",
                        fontWeight: 600,
                        gap: "8px",
                        letterSpacing: "0.5px",
                        margin: "0 0 16px",
                        textTransform: "uppercase",
                      }}
                    >
                      <FaSync style={{ animation: "spin 2s linear infinite" }} />
                      What's happening in the backend
                    </h3>

                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                      {/* Step 1: Finding Drivers */}
                      <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
                        <div
                          style={{
                            alignItems: "center",
                            animation:
                              rideStatus === "searching" ? "stepPulse 1.5s ease infinite" : "none",
                            background: "rgba(34, 197, 94, 0.2)",
                            borderRadius: "50%",
                            display: "flex",
                            height: "32px",
                            justifyContent: "center",
                            minWidth: "32px",
                          }}
                        >
                          <FaSearch style={{ color: "#4ade80", fontSize: "14px" }} />
                        </div>
                        <div>
                          <p
                            style={{ color: "white", fontSize: "14px", fontWeight: 500, margin: 0 }}
                          >
                            Scanning nearby drivers
                          </p>
                          <p style={{ color: "#64748b", fontSize: "12px", margin: "2px 0 0" }}>
                            Querying real-time driver locations within 5km radius
                          </p>
                        </div>
                      </div>

                      {/* Step 2: Matching Algorithm */}
                      <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
                        <div
                          style={{
                            alignItems: "center",
                            animation:
                              rideStatus === "searching"
                                ? "stepPulse 1.5s ease infinite 0.3s"
                                : "none",
                            background: "rgba(59, 130, 246, 0.2)",
                            borderRadius: "50%",
                            display: "flex",
                            height: "32px",
                            justifyContent: "center",
                            minWidth: "32px",
                          }}
                        >
                          <FaUsers style={{ color: "#60a5fa", fontSize: "14px" }} />
                        </div>
                        <div>
                          <p
                            style={{ color: "white", fontSize: "14px", fontWeight: 500, margin: 0 }}
                          >
                            Matching with best driver
                          </p>
                          <p style={{ color: "#64748b", fontSize: "12px", margin: "2px 0 0" }}>
                            Analyzing driver ratings, vehicle type & availability
                          </p>
                        </div>
                      </div>

                      {/* Step 3: ETA Calculation */}
                      <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
                        <div
                          style={{
                            alignItems: "center",
                            animation:
                              rideStatus === "pending_acceptance"
                                ? "stepPulse 1.5s ease infinite"
                                : "none",
                            background: "rgba(168, 85, 247, 0.2)",
                            borderRadius: "50%",
                            display: "flex",
                            height: "32px",
                            justifyContent: "center",
                            minWidth: "32px",
                          }}
                        >
                          <FaClock style={{ color: "#a855f7", fontSize: "14px" }} />
                        </div>
                        <div>
                          <p
                            style={{ color: "white", fontSize: "14px", fontWeight: 500, margin: 0 }}
                          >
                            Calculating ETA
                          </p>
                          <p style={{ color: "#64748b", fontSize: "12px", margin: "2px 0 0" }}>
                            Computing optimal route with live traffic data
                          </p>
                        </div>
                      </div>

                      {/* Step 4: Sending Request */}
                      <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
                        <div
                          style={{
                            alignItems: "center",
                            animation:
                              rideStatus === "pending_acceptance"
                                ? "stepPulse 1.5s ease infinite 0.3s"
                                : "none",
                            background: "rgba(251, 191, 36, 0.2)",
                            borderRadius: "50%",
                            display: "flex",
                            height: "32px",
                            justifyContent: "center",
                            minWidth: "32px",
                          }}
                        >
                          <FaRoute style={{ color: "#fbbf24", fontSize: "14px" }} />
                        </div>
                        <div>
                          <p
                            style={{ color: "white", fontSize: "14px", fontWeight: 500, margin: 0 }}
                          >
                            {rideStatus === "pending_acceptance"
                              ? "Awaiting driver response"
                              : "Preparing ride request"}
                          </p>
                          <p style={{ color: "#64748b", fontSize: "12px", margin: "2px 0 0" }}>
                            {rideStatus === "pending_acceptance"
                              ? "Driver has 30 seconds to accept your request"
                              : "Optimizing for eco-friendly route matching"}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Eco Tip */}
                  <div
                    style={{
                      alignItems: "center",
                      background: "rgba(34, 197, 94, 0.1)",
                      borderRadius: "12px",
                      display: "flex",
                      gap: "12px",
                      marginBottom: "20px",
                      padding: "14px 16px",
                    }}
                  >
                    <FaLeaf style={{ color: "#4ade80", fontSize: "20px" }} />
                    <p style={{ color: "#94a3b8", fontSize: "13px", margin: 0 }}>
                      <span style={{ color: "#4ade80", fontWeight: 600 }}>Eco Tip:</span> Carpooling
                      reduces carbon emissions by up to 50% compared to solo rides!
                    </p>
                  </div>

                  {/* Cancel Button */}
                  <button
                    type="button"
                    onClick={handleCancelRide}
                    style={{
                      alignItems: "center",
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      borderRadius: "12px",
                      color: "#f87171",
                      cursor: "pointer",
                      display: "flex",
                      fontSize: "15px",
                      fontWeight: 600,
                      gap: "8px",
                      justifyContent: "center",
                      padding: "14px",
                      transition: "all 0.3s ease",
                      width: "100%",
                    }}
                  >
                    <FaTimes />
                    Cancel Request
                  </button>
                </div>

                {/* CSS Animations */}
                <style>{`
                  @keyframes gradientShift {
                    0%, 100% { background-position: 0% 50%; }
                    50% { background-position: 100% 50%; }
                  }
                  @keyframes pulse {
                    0%, 100% { opacity: 1; transform: scale(1); }
                    50% { opacity: 0.8; transform: scale(0.95); }
                  }
                  @keyframes ripple {
                    0% { transform: scale(1); opacity: 0.8; }
                    100% { transform: scale(1.8); opacity: 0; }
                  }
                  @keyframes carBounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-8px); }
                  }
                  @keyframes stepPulse {
                    0%, 100% { opacity: 1; box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.4); }
                    50% { opacity: 0.7; box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
                  }
                  @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                  }
                `}</style>
              </div>
            )}

            {/* Driver Matched Card */}
            {(rideStatus === "matched" || rideStatus === "arrived" || rideStatus === "on_trip") &&
              assignedDriverId && (
                <div style={styles.matchedCard}>
                  <div
                    style={{
                      alignItems: "center",
                      display: "flex",
                      gap: "16px",
                      marginBottom: "16px",
                    }}
                  >
                    <div
                      style={{
                        alignItems: "center",
                        background: "rgba(34, 197, 94, 0.3)",
                        borderRadius: "50%",
                        display: "flex",
                        height: "56px",
                        justifyContent: "center",
                        width: "56px",
                      }}
                    >
                      <FaCheckCircle style={{ color: "#4ade80", fontSize: "28px" }} />
                    </div>
                    <div>
                      <h2
                        style={{ color: "#4ade80", fontSize: "22px", fontWeight: 700, margin: 0 }}
                      >
                        {rideStatus === "on_trip"
                          ? "Trip in Progress"
                          : rideStatus === "arrived"
                            ? "Driver has Arrived!"
                            : "Driver Assigned!"}
                      </h2>
                      <p style={{ color: "#94a3b8", fontSize: "14px", margin: "4px 0 0" }}>
                        {rideStatus === "on_trip"
                          ? "Sit back and relax"
                          : "Your driver is on the way"}
                      </p>
                    </div>
                  </div>

                  <div
                    style={{
                      background: "rgba(15, 23, 42, 0.6)",
                      borderRadius: "16px",
                      display: "grid",
                      gap: "16px",
                      gridTemplateColumns: "1fr 1fr",
                      padding: "16px",
                    }}
                  >
                    <div>
                      <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>Driver Name</p>
                      <p
                        style={{
                          color: "white",
                          fontSize: "14px",
                          fontWeight: 600,
                          margin: "4px 0 0",
                        }}
                      >
                        {assignedDriverName}
                      </p>
                      <div
                        style={{
                          alignItems: "center",
                          display: "flex",
                          gap: "4px",
                          marginTop: "2px",
                        }}
                      >
                        <FaStar style={{ color: "#fbbf24", fontSize: "12px" }} />
                        <span style={{ color: "white", fontSize: "13px", fontWeight: 600 }}>
                          {driverRating > 0 ? driverRating.toFixed(1) : "New"}
                        </span>
                        <span style={{ color: "#94a3b8", fontSize: "11px" }}>
                          ({driverRatingCount})
                        </span>
                      </div>
                      {/* Driver Phone Display */}
                      <div style={{ marginTop: "12px" }}>
                        <p
                          style={{
                            color: "#94a3b8",
                            fontSize: "11px",
                            margin: 0,
                            textTransform: "uppercase",
                          }}
                        >
                          Mobile
                        </p>
                        <p
                          style={{
                            color: "#3b82f6",
                            fontSize: "14px",
                            fontWeight: 700,
                            margin: "2px 0 0",
                          }}
                        >
                          {assignedDriverPhone || "No Phone"}
                        </p>
                      </div>
                    </div>
                    <div>
                      <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>ETA</p>
                      <p
                        style={{
                          color: "#4ade80",
                          fontSize: "20px",
                          fontWeight: 700,
                          margin: "4px 0 0",
                        }}
                      >
                        {eta || "Calculating..."}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={handleCancelRide}
                    disabled={rideStatus === "on_trip"}
                    style={
                      rideStatus === "on_trip"
                        ? styles.actionButtonDisabled
                        : {
                            alignItems: "center",
                            background: "rgba(239, 68, 68, 0.2)",
                            border: "1px solid rgba(239, 68, 68, 0.5)",
                            borderRadius: "12px",
                            color: "#f87171",
                            cursor: "pointer",
                            display: "flex",
                            fontSize: "14px",
                            fontWeight: 500,
                            gap: "8px",
                            justifyContent: "center",

                            marginTop: "2px",
                            padding: "12px",
                            width: "100%",
                          }
                    }
                  >
                    <FaTimes /> {rideStatus === "on_trip" ? "Trip Started" : "Cancel Ride"}
                  </button>
                </div>
              )}

            {/* Search Card - Only show when idle or error (hide during active ride) */}
            {(rideStatus === "idle" || rideStatus === "error") && (
              <div style={styles.card}>
                <div style={{ marginBottom: "16px" }}>
                  <h2
                    style={{
                      color: "white",
                      fontSize: "18px",
                      fontWeight: 600,
                      margin: "0 0 16px",
                    }}
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

                  {/* Saved Locations Quick Select */}
                  <div style={{ marginTop: "16px" }}>
                    <p style={{ color: "#94a3b8", fontSize: "12px", marginBottom: "8px" }}>
                      Quick Select:
                    </p>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                      {/* Home Button */}
                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          onClick={() =>
                            savedLocations.home
                              ? editingLocationType === "home"
                                ? setEditingLocationType(null)
                                : setEditingLocationType("home")
                              : selectedDestination
                                ? setShowSaveModal(true)
                                : setErrorMessage("Please search and select a destination first")
                          }
                          style={{
                            alignItems: "center",
                            background: savedLocations.home
                              ? "rgba(34, 197, 94, 0.15)"
                              : "rgba(71, 85, 105, 0.3)",
                            border: savedLocations.home
                              ? "1px solid rgba(34, 197, 94, 0.4)"
                              : "1px solid rgba(71, 85, 105, 0.4)",
                            borderRadius: "8px",
                            color: savedLocations.home ? "#4ade80" : "#64748b",
                            cursor: "pointer",
                            display: "flex",
                            fontSize: "13px",
                            gap: "6px",
                            padding: "8px 12px",
                          }}
                          title={savedLocations.home?.name || "Click to set Home"}
                        >
                          <FaHome style={{ fontSize: "14px" }} /> Home
                        </button>
                        {/* Edit Menu for Home */}
                        {editingLocationType === "home" && savedLocations.home && (
                          <div
                            style={{
                              background: "rgba(15, 23, 42, 0.98)",
                              border: "1px solid rgba(34, 197, 94, 0.3)",
                              borderRadius: "8px",
                              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                              left: 0,
                              minWidth: "140px",
                              padding: "8px",
                              position: "absolute",
                              top: "100%",
                              zIndex: 10,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectSavedLocation("home")}
                              style={{
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "#4ade80",
                                cursor: "pointer",
                                display: "flex",
                                fontSize: "12px",
                                gap: "8px",
                                padding: "8px",
                                width: "100%",
                              }}
                            >
                              <FaMapMarkerAlt /> Use Location
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLocationType(null);
                                setShowSaveModal(true);
                              }}
                              style={{
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "#60a5fa",
                                cursor: "pointer",
                                display: "flex",
                                fontSize: "12px",
                                gap: "8px",
                                padding: "8px",
                                width: "100%",
                              }}
                            >
                              <FaEdit /> Change
                            </button>
                            <button
                              type="button"
                              onClick={() => handleClearSavedLocation("home")}
                              disabled={savingLocation}
                              style={{
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "#f87171",
                                cursor: savingLocation ? "not-allowed" : "pointer",
                                display: "flex",
                                fontSize: "12px",
                                gap: "8px",
                                padding: "8px",
                                width: "100%",
                              }}
                            >
                              <FaTrash /> Remove
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Work Button */}
                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          onClick={() =>
                            savedLocations.work
                              ? editingLocationType === "work"
                                ? setEditingLocationType(null)
                                : setEditingLocationType("work")
                              : selectedDestination
                                ? setShowSaveModal(true)
                                : setErrorMessage("Please search and select a destination first")
                          }
                          style={{
                            alignItems: "center",
                            background: savedLocations.work
                              ? "rgba(34, 197, 94, 0.15)"
                              : "rgba(71, 85, 105, 0.3)",
                            border: savedLocations.work
                              ? "1px solid rgba(34, 197, 94, 0.4)"
                              : "1px solid rgba(71, 85, 105, 0.4)",
                            borderRadius: "8px",
                            color: savedLocations.work ? "#4ade80" : "#64748b",
                            cursor: "pointer",
                            display: "flex",
                            fontSize: "13px",
                            gap: "6px",
                            padding: "8px 12px",
                          }}
                          title={savedLocations.work?.name || "Click to set Work"}
                        >
                          <FaBriefcase style={{ fontSize: "14px" }} /> Work
                        </button>
                        {/* Edit Menu for Work */}
                        {editingLocationType === "work" && savedLocations.work && (
                          <div
                            style={{
                              background: "rgba(15, 23, 42, 0.98)",
                              border: "1px solid rgba(34, 197, 94, 0.3)",
                              borderRadius: "8px",
                              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                              left: 0,
                              minWidth: "140px",
                              padding: "8px",
                              position: "absolute",
                              top: "100%",
                              zIndex: 10,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectSavedLocation("work")}
                              style={{
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "#4ade80",
                                cursor: "pointer",
                                display: "flex",
                                fontSize: "12px",
                                gap: "8px",
                                padding: "8px",
                                width: "100%",
                              }}
                            >
                              <FaMapMarkerAlt /> Use Location
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLocationType(null);
                                setShowSaveModal(true);
                              }}
                              style={{
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "#60a5fa",
                                cursor: "pointer",
                                display: "flex",
                                fontSize: "12px",
                                gap: "8px",
                                padding: "8px",
                                width: "100%",
                              }}
                            >
                              <FaEdit /> Change
                            </button>
                            <button
                              type="button"
                              onClick={() => handleClearSavedLocation("work")}
                              disabled={savingLocation}
                              style={{
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "#f87171",
                                cursor: savingLocation ? "not-allowed" : "pointer",
                                display: "flex",
                                fontSize: "12px",
                                gap: "8px",
                                padding: "8px",
                                width: "100%",
                              }}
                            >
                              <FaTrash /> Remove
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Favourite Button */}
                      <div style={{ position: "relative" }}>
                        <button
                          type="button"
                          onClick={() =>
                            savedLocations.favourite
                              ? editingLocationType === "favourite"
                                ? setEditingLocationType(null)
                                : setEditingLocationType("favourite")
                              : selectedDestination
                                ? setShowSaveModal(true)
                                : setErrorMessage("Please search and select a destination first")
                          }
                          style={{
                            alignItems: "center",
                            background: savedLocations.favourite
                              ? "rgba(34, 197, 94, 0.15)"
                              : "rgba(71, 85, 105, 0.3)",
                            border: savedLocations.favourite
                              ? "1px solid rgba(34, 197, 94, 0.4)"
                              : "1px solid rgba(71, 85, 105, 0.4)",
                            borderRadius: "8px",
                            color: savedLocations.favourite ? "#4ade80" : "#64748b",
                            cursor: "pointer",
                            display: "flex",
                            fontSize: "13px",
                            gap: "6px",
                            padding: "8px 12px",
                          }}
                          title={savedLocations.favourite?.name || "Click to set Favourite"}
                        >
                          <FaStar style={{ fontSize: "14px" }} /> Favourite
                        </button>
                        {/* Edit Menu for Favourite */}
                        {editingLocationType === "favourite" && savedLocations.favourite && (
                          <div
                            style={{
                              background: "rgba(15, 23, 42, 0.98)",
                              border: "1px solid rgba(34, 197, 94, 0.3)",
                              borderRadius: "8px",
                              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.3)",
                              left: 0,
                              minWidth: "140px",
                              padding: "8px",
                              position: "absolute",
                              top: "100%",
                              zIndex: 10,
                            }}
                          >
                            <button
                              type="button"
                              onClick={() => handleSelectSavedLocation("favourite")}
                              style={{
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "#4ade80",
                                cursor: "pointer",
                                display: "flex",
                                fontSize: "12px",
                                gap: "8px",
                                padding: "8px",
                                width: "100%",
                              }}
                            >
                              <FaMapMarkerAlt /> Use Location
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setEditingLocationType(null);
                                setShowSaveModal(true);
                              }}
                              style={{
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "#60a5fa",
                                cursor: "pointer",
                                display: "flex",
                                fontSize: "12px",
                                gap: "8px",
                                padding: "8px",
                                width: "100%",
                              }}
                            >
                              <FaEdit /> Change
                            </button>
                            <button
                              type="button"
                              onClick={() => handleClearSavedLocation("favourite")}
                              disabled={savingLocation}
                              style={{
                                alignItems: "center",
                                background: "transparent",
                                border: "none",
                                color: "#f87171",
                                cursor: savingLocation ? "not-allowed" : "pointer",
                                display: "flex",
                                fontSize: "12px",
                                gap: "8px",
                                padding: "8px",
                                width: "100%",
                              }}
                            >
                              <FaTrash /> Remove
                            </button>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Save Current Destination Button */}
                    {selectedDestination && (
                      <button
                        type="button"
                        onClick={() => setShowSaveModal(true)}
                        style={{
                          alignItems: "center",
                          background: "transparent",
                          border: "1px dashed rgba(34, 197, 94, 0.5)",
                          borderRadius: "8px",
                          color: "#4ade80",
                          cursor: "pointer",
                          display: "flex",
                          fontSize: "13px",
                          gap: "6px",
                          justifyContent: "center",
                          marginTop: "8px",
                          padding: "8px 12px",
                          width: "100%",
                        }}
                      >
                        + Save this destination
                      </button>
                    )}
                  </div>
                </div>

                {/* Save Location Modal */}
                {showSaveModal && (
                  <div
                    style={{
                      background: "rgba(15, 23, 42, 0.95)",
                      border: "1px solid rgba(34, 197, 94, 0.3)",
                      borderRadius: "16px",
                      marginBottom: "16px",
                      padding: "16px",
                    }}
                  >
                    <h4 style={{ color: "white", fontSize: "14px", margin: "0 0 12px" }}>
                      Save "{selectedDestination?.name}" as:
                    </h4>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => handleSaveLocation("home")}
                        disabled={savingLocation}
                        style={{
                          alignItems: "center",
                          background: "rgba(34, 197, 94, 0.2)",
                          border: "1px solid rgba(34, 197, 94, 0.5)",
                          borderRadius: "8px",
                          color: "#4ade80",
                          cursor: savingLocation ? "not-allowed" : "pointer",
                          display: "flex",
                          flex: 1,
                          fontSize: "13px",
                          gap: "6px",
                          justifyContent: "center",
                          padding: "10px",
                        }}
                      >
                        <FaHome style={{ fontSize: "14px" }} /> Home
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveLocation("work")}
                        disabled={savingLocation}
                        style={{
                          alignItems: "center",
                          background: "rgba(34, 197, 94, 0.2)",
                          border: "1px solid rgba(34, 197, 94, 0.5)",
                          borderRadius: "8px",
                          color: "#4ade80",
                          cursor: savingLocation ? "not-allowed" : "pointer",
                          display: "flex",
                          flex: 1,
                          fontSize: "13px",
                          gap: "6px",
                          justifyContent: "center",
                          padding: "10px",
                        }}
                      >
                        <FaBriefcase style={{ fontSize: "14px" }} /> Work
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSaveLocation("favourite")}
                        disabled={savingLocation}
                        style={{
                          alignItems: "center",
                          background: "rgba(34, 197, 94, 0.2)",
                          border: "1px solid rgba(34, 197, 94, 0.5)",
                          borderRadius: "8px",
                          color: "#4ade80",
                          cursor: savingLocation ? "not-allowed" : "pointer",
                          display: "flex",
                          flex: 1,
                          fontSize: "13px",
                          gap: "6px",
                          justifyContent: "center",
                          padding: "10px",
                        }}
                      >
                        <FaStar style={{ fontSize: "14px" }} /> Favourite
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowSaveModal(false)}
                      style={{
                        background: "transparent",
                        border: "none",
                        color: "#94a3b8",
                        cursor: "pointer",
                        fontSize: "12px",
                        marginTop: "12px",
                        padding: "4px",
                        width: "100%",
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {/* Pickup Location Section */}
                <div style={{ marginBottom: "16px" }}>
                  <h3
                    style={{
                      color: "white",
                      fontSize: "16px",
                      fontWeight: 600,
                      margin: "0 0 12px",
                    }}
                  >
                    <FaMapMarkerAlt style={{ color: "#22c55e", marginRight: "8px" }} />
                    Pickup Location
                  </h3>

                  {/* Autocomplete Input for Pickup */}
                  <div style={{ marginBottom: "12px", position: "relative", width: "100%" }}>
                    <FaMapMarkerAlt
                      style={{
                        color: "#3b82f6",
                        fontSize: "18px",
                        left: "16px",
                        position: "absolute",
                        top: "50%",
                        transform: "translateY(-50%)",
                        zIndex: 1,
                      }}
                    />
                    <Autocomplete
                      onLoad={onPickupAutocompleteLoad}
                      onPlaceChanged={onPickupPlaceChanged}
                    >
                      <input
                        type="text"
                        placeholder="Current Location (GPS)"
                        value={pickupSearchText}
                        onChange={(e) => setPickupSearchText(e.target.value)}
                        style={{
                          ...styles.searchInput,
                          borderColor: manualPickupMode ? "#3b82f6" : "rgba(255, 255, 255, 0.1)",
                        }}
                      />
                    </Autocomplete>
                  </div>

                  {/* Button to set pickup location */}
                  <button
                    type="button"
                    onClick={() => setManualPickupMode(!manualPickupMode)}
                    style={{
                      alignItems: "center",
                      background: manualPickupMode
                        ? "linear-gradient(135deg, #3b82f6, #2563eb)"
                        : "rgba(30, 41, 59, 0.8)",
                      border: manualPickupMode ? "none" : "2px solid rgba(71, 85, 105, 0.5)",
                      borderRadius: "12px",
                      color: manualPickupMode ? "white" : "#94a3b8",
                      cursor: "pointer",
                      display: "flex",
                      fontSize: "14px",
                      fontWeight: 600,
                      gap: "10px",
                      justifyContent: "center",
                      padding: "12px 16px",
                      transition: "all 0.3s ease",
                      width: "100%",
                    }}
                  >
                    <FaMapMarkerAlt />
                    {manualPickupMode ? "Cancel" : "Set Pickup on Map"}
                  </button>
                </div>

                {/* Error message */}
                {errorMessage && (
                  <div
                    style={{
                      alignItems: "center",
                      background: "rgba(239, 68, 68, 0.1)",
                      border: "1px solid rgba(239, 68, 68, 0.3)",
                      borderRadius: "12px",
                      color: "#f87171",
                      display: "flex",
                      fontSize: "14px",
                      gap: "8px",
                      marginBottom: "16px",
                      padding: "12px 16px",
                    }}
                  >
                    <FaTimes />
                    {errorMessage}
                  </div>
                )}

                {/* Estimate Card */}
                {estimate ? (
                  <div
                    style={{
                      background: "rgba(34, 197, 94, 0.1)",
                      border: "1px solid rgba(34, 197, 94, 0.3)",
                      borderRadius: "16px",
                      marginBottom: "10px",
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
                        <div style={{ color: "#94a3b8", fontSize: "12px" }}>Total Fare</div>
                        <div style={{ color: "#22c55e", fontSize: "24px", fontWeight: "bold" }}>
                          ₹{estimate.fare}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <div
                          style={{
                            alignItems: "center",
                            color: "#e2e8f0",
                            display: "flex",
                            fontSize: "14px",
                            gap: "6px",
                          }}
                        >
                          <FaClock size={12} /> {estimate.eta_min} min
                        </div>
                        <div style={{ color: "#94a3b8", fontSize: "12px" }}>
                          {estimate.distance_km} km
                        </div>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "12px" }}>
                      <button
                        type="button"
                        onClick={cancelEstimate}
                        style={{
                          background: "rgba(239, 68, 68, 0.1)",
                          border: "1px solid rgba(239, 68, 68, 0.5)",
                          borderRadius: "12px",
                          color: "#f87171",
                          cursor: "pointer",
                          flex: 1,
                          fontWeight: 600,
                          padding: "12px",
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleFindRide}
                        style={{
                          background: "linear-gradient(135deg, #22c55e, #10b981)",
                          border: "none",
                          borderRadius: "12px",
                          boxShadow: "0 4px 12px rgba(34, 197, 94, 0.3)",
                          color: "white",
                          cursor: "pointer",
                          flex: 2,
                          fontWeight: 600,
                          padding: "12px",
                        }}
                      >
                        Confirm Ride
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={handleGetEstimate}
                    disabled={!canRequestRide || estimating}
                    style={canRequestRide ? styles.actionButton : styles.actionButtonDisabled}
                    onMouseEnter={(e) => {
                      if (canRequestRide) {
                        e.currentTarget.style.transform = "translateY(-2px)";
                        e.currentTarget.style.boxShadow = "0 12px 28px rgba(34, 197, 94, 0.4)";
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (canRequestRide) {
                        e.currentTarget.style.transform = "translateY(0)";
                        e.currentTarget.style.boxShadow = "0 8px 24px rgba(34, 197, 94, 0.3)";
                      }
                    }}
                  >
                    {estimating ? (
                      <>
                        <FaSpinner
                          style={{ animation: "spin 1s linear infinite", fontSize: "20px" }}
                        />
                        Getting Estimate...
                      </>
                    ) : (
                      <>
                        <FaLeaf style={{ fontSize: "20px" }} />
                        Get Price Estimate
                      </>
                    )}
                  </button>
                )}
              </div>
            )}

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
                {/* Route Legend - Show when matched/arrived */}
                {(rideStatus === "matched" || rideStatus === "arrived") &&
                  (directionsToPickup || directionsToDestination) && (
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
                        <span style={{ color: "#94a3b8", fontSize: "12px" }}>
                          Driver approaching
                        </span>
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
                        <span style={{ color: "#94a3b8", fontSize: "12px" }}>
                          Trip to destination
                        </span>
                      </div>
                    </div>
                  )}
                {/* Manual pickup mode indicator */}
                {manualPickupMode && (
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
                    <FaMapMarkerAlt /> Click on the map to set your pickup location
                  </div>
                )}
                <GoogleMap
                  mapContainerStyle={mapContainerStyle}
                  center={currentLocation || defaultCenter}
                  zoom={14}
                  onLoad={onLoad}
                  onUnmount={onUnmount}
                  onClick={onMapClick}
                  options={{
                    disableDefaultUI: true,
                    draggableCursor: manualPickupMode ? "crosshair" : undefined,
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

                  {/* Estimated Route Polyline (Green) - Only show when no active ride */}
                  {decodedPolyline.length > 0 && !directionsToDestination && (
                    <Polyline
                      path={decodedPolyline}
                      options={{
                        strokeColor: "#22c55e",
                        strokeOpacity: 0.9,
                        strokeWeight: 6,
                      }}
                    />
                  )}

                  {/* Current Location Marker */}
                  {currentLocation && (
                    <Marker
                      position={currentLocation}
                      icon={{
                        anchor: new google.maps.Point(12, 12),
                        scaledSize: new google.maps.Size(24, 24),
                        url:
                          "data:image/svg+xml;charset=UTF-8," +
                          encodeURIComponent(`
                          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
                            <circle cx="12" cy="12" r="10" fill="#22c55e" stroke="#ffffff" stroke-width="3"/>
                          </svg>
                        `),
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

                  {/* Assigned Driver Marker (when matched) - with ultra-smooth animation */}
                  {rideStatus === "matched" && animatedAssignedDriver && (
                    <Marker
                      position={{
                        lat: animatedAssignedDriver.lat,
                        lng: animatedAssignedDriver.lng,
                      }}
                      icon={{
                        anchor: new google.maps.Point(25, 25),
                        scaledSize: new google.maps.Size(50, 50),
                        url: createRotatedCarIcon(animatedAssignedDriver.heading, "#3b82f6", 50), // Blue for assigned driver
                      }}
                      title="Your Driver"
                    />
                  )}

                  {/* Other Driver Markers (when not matched) - with smooth rotation */}
                  {rideStatus !== "matched" &&
                    driverArray.map((driver) => (
                      <Marker
                        key={driver.id}
                        position={{
                          lat: driver.animatedLat ?? driver.lat,
                          lng: driver.animatedLng ?? driver.lng,
                        }}
                        icon={{
                          anchor: new google.maps.Point(22, 22),
                          scaledSize: new google.maps.Size(45, 45),
                          url: createRotatedCarIcon(
                            driver.animatedHeading ?? driver.heading,
                            driver.status === "AVAILABLE" ? "#22c55e" : "#f59e0b",
                            45,
                          ),
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
                  onClick={rideStatus === "idle" ? handleGetEstimate : undefined}
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
                      {estimating ? (
                        <FaSpinner
                          className="animate-spin"
                          style={{ color: "#4ade80", fontSize: "20px" }}
                        />
                      ) : (
                        <FaLeaf style={{ color: "#4ade80", fontSize: "20px" }} />
                      )}
                    </div>
                    <div>
                      <h3 style={{ color: "white", fontSize: "16px", fontWeight: 600, margin: 0 }}>
                        Get Price Estimate
                      </h3>
                      <p style={{ color: "#94a3b8", fontSize: "13px", margin: "4px 0 0" }}>
                        Check fare and ETA before booking
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

      {/* Rider OTP Modal */}
      {otp && (rideStatus === "matched" || rideStatus === "arrived") && showOtpModal && (
        <div
          style={{
            alignItems: "center",
            backdropFilter: "blur(4px)",
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            left: 0,
            position: "fixed",
            right: 0,
            top: 0,
            zIndex: 2000,
          }}
        >
          <div
            style={{
              animation: "popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275)",
              background: "rgba(30, 41, 59, 1)",
              border: "1px solid rgba(71, 85, 105, 0.5)",
              borderRadius: "24px",
              boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
              maxWidth: "360px",
              padding: "32px",
              textAlign: "center",
              width: "90%",
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: "rgba(34, 197, 94, 0.2)",
                border: "2px solid #22c55e",
                borderRadius: "50%",
                display: "flex",
                height: "64px",
                justifyContent: "center",
                margin: "0 auto 16px",
                width: "64px",
              }}
            >
              <FaCheckCircle style={{ color: "#22c55e", fontSize: "32px" }} />
            </div>

            <h2 style={{ color: "white", fontSize: "22px", fontWeight: 700, margin: "0 0 8px" }}>
              Ride Confirmed!
            </h2>
            <p style={{ color: "#94a3b8", fontSize: "14px", margin: "0 0 24px" }}>
              Please share this OTP with your driver to start the trip.
            </p>

            <div
              style={{
                background: "rgba(15, 23, 42, 0.8)",
                border: "2px dashed rgba(34, 197, 94, 0.5)",
                borderRadius: "16px",
                marginBottom: "24px",
                padding: "16px",
              }}
            >
              <span
                style={{
                  color: "#4ade80",
                  display: "block",
                  fontFamily: "monospace",
                  fontSize: "32px",
                  fontWeight: "bold",
                  letterSpacing: "8px",
                }}
              >
                {otp}
              </span>
            </div>

            <button
              // Close modal only (we might want a state for closing it, but for now just let it be persistent or add a close button)
              // However, user asked for a popup. Usually these dismiss themselves or minimize.
              // Let's make it minimize to the card.
              // But wait, my logic "otp && rideStatus === matched" keeps it open.
              // I should add a local state to dismiss it, or just a generic "Okay" button that doesn't actually remove the OTP but maybe overlays it?
              // Actually, keeping it persistent until trip starts is better UX for "Don't forget the OTP".
              // Maybe just a "Close" button that sets a temporary flag?
              // For simplicity and to ensure they see it, I'll just leave it or adding a "Close" button that sets a local state "showOtpModal" instead of relying on "otp" existence.
              onClick={() => setShowOtpModal(false)}
              type="button"
              style={{
                background: "linear-gradient(90deg, #22c55e, #16a34a)",
                border: "none",
                borderRadius: "12px",
                color: "white",
                cursor: "pointer",
                fontSize: "16px",
                fontWeight: 600,
                padding: "12px 24px",
                width: "100%",
              }}
            >
              Okay, got it
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
        @keyframes popIn {
          0% { transform: scale(0.9); opacity: 0; }
          100% { transform: scale(1); opacity: 1; }
        }
          50% { opacity: 0.5; }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      {/* Payment Modal */}
      {showPayment && clientSecret !== undefined && (
        <PaymentModal
          amount={paymentAmount}
          clientSecret={clientSecret}
          greenPointsBalance={userStats.greenPoints}
          isPointsUsed={isGreenPointsUsed}
          onTogglePoints={handleGreenPointsToggle}
          discountAmount={discountAmount}
          onClose={() => setShowPayment(false)}
          onSuccess={handlePaymentSuccess}
        />
      )}
      {/* Rating Modal */}
      {showRatingModal && ratingPayload && (
        <RatingModal
          rideId={ratingPayload.rideId}
          driverId={ratingPayload.driverId}
          driverName={ratingPayload.driverName}
          onClose={() => {
            setShowRatingModal(false);
            setRatingPayload(null);
          }}
          onSuccess={() => {
            setShowRatingModal(false);
            setRatingPayload(null);
            alert("Thank you for your feedback!");
          }}
        />
      )}
    </div>
  );
}
