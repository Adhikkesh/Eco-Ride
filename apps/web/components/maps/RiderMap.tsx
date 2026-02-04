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
import { doc, getDoc, onSnapshot } from "firebase/firestore";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  FaCar,
  FaCheckCircle,
  FaClock,
  FaGift,
  FaLeaf,
  FaMapMarkerAlt,
  FaRoute,
  FaSearch,
  FaSpinner,
  FaSync,
  FaTimes,
  FaUsers,
} from "react-icons/fa";
import { backendUrl } from "@/config";
import { useTripEstimator } from "@/hooks/useTripEstimator";
import { auth, db, rtdb } from "@/lib/firebase";
import { darkMapStyles, lightMapStyles } from "@/lib/mapStyles";
import PaymentModal from "../booking/PaymentModal";

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

interface RideResponse {
  success: boolean;
  message: string;
  rideId?: string;
  driverId?: string;
  driverName?: string;
  driverLocation?: { lat: number; lng: number };
  distance?: number;
  eta?: string;
  otp?: string;
}

type RideStatus = "idle" | "searching" | "matched" | "on_trip" | "error";

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
  const [assignedDriverLocation, setAssignedDriverLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [eta, setEta] = useState<string | null>(null);
  const [otp, setOtp] = useState<string | null>(null); // New OTP state
  const [showOtpModal, setShowOtpModal] = useState(false); // Modal visibility state
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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

  // Estimation State
  const { getEstimate, estimate, loading: estimating, clearEstimate } = useTripEstimator();
  const [decodedPolyline, setDecodedPolyline] = useState<{ lat: number; lng: number }[]>([]);

  const mapRef = useRef<google.maps.Map | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const autocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const pickupAutocompleteRef = useRef<google.maps.places.Autocomplete | null>(null);
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null);

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
            (docSnapshot: any) => {
              if (docSnapshot.exists()) {
                const data = docSnapshot.data() as UserData;
                setUserStats((prev) => ({
                  ...prev,
                  greenPoints: data.green_points ?? 0,
                  trustScore: data.trust_score ?? 0,
                }));
              }
            },
            (error: any) => {
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
  }, []);

  const handlePaymentSuccess = useCallback(async () => {
    // Notify backend about payment success so driver gets the popup
    if (rideId && auth.currentUser) {
      try {
        const token = await auth.currentUser.getIdToken();
        await fetch(`${backendUrl}/ride/confirm-payment`, {
          body: JSON.stringify({
            amount: paymentAmount,
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

    // Reset all ride state
    setRideStatus("idle");
    setRideId(null);
    setAssignedDriverId(null);
    setAssignedDriverName(null);
    setAssignedDriverLocation(null);
    setDirectionsToPickup(null);
    setDirectionsToDestination(null);
    setDirectionsToPickup(null);
    setDirectionsToDestination(null);
    setEta(null);
    setOtp(null);
    setPickupLocation(null);
    setSelectedDestination(null);
    setSearchDestination("");
    setManualPickupMode(false);
    setErrorMessage(null);

    // Nice success message could go here or in the modal close
    // alert("Payment Successful! Thank you for riding with EcoRide.");
  }, [rideId, paymentAmount]);

  // Listen for ride status changes (Start/Complete) via RTDB (Bypasses Firestore permissions)
  useEffect(() => {
    if (!rideId || !rtdb) return;

    const rideStatusRef = ref(rtdb, `rides/${rideId}`);
    const unsubscribe = onValue(rideStatusRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.val();
        console.log("DEBUG: RTDB Ride Update:", data);

        if (data.status === "IN_PROGRESS") {
          setRideStatus("on_trip");
        } else if (data.status === "COMPLETED" && data.paymentStatus !== "PAID") {
          // Trip Completed Logic - Trigger Payment
          console.log("Trip completed. Initializing payment...");

          // Fetch payment intent
          const user = auth?.currentUser;
          if (user) {
            user.getIdToken().then((token) => {
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
  }, [rideId, handlePaymentSuccess]);

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
        const now = Date.now();
        const STALE_THRESHOLD = 5 * 60 * 1000; // 5 minutes

        if (data) {
          Object.entries(data).forEach(([driverId, locationData]) => {
            const location = locationData as DriverLocation;
            // Filter out stale drivers (older than 5 mins or missing timestamp)
            if (!location.lastUpdated || now - location.lastUpdated > STALE_THRESHOLD) {
              return;
            }

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

  // Listen to assigned driver location updates
  useEffect(() => {
    if (!rtdb || !assignedDriverId || rideStatus !== "matched") return;

    const driverRef = ref(rtdb, `drivers-online/${assignedDriverId}`);

    const unsubscribe = onValue(driverRef, (snapshot) => {
      const data = snapshot.val() as DriverLocation | null;
      if (data) {
        setAssignedDriverLocation({ lat: data.lat, lng: data.lng });
      }
    });

    return () => unsubscribe();
  }, [assignedDriverId, rideStatus]);

  // Calculate and update route when driver location or destination changes
  useEffect(() => {
    if (!isLoaded || (!assignedDriverLocation && !currentLocation) || !selectedDestination) {
      return;
    }

    if (!directionsServiceRef.current) {
      directionsServiceRef.current = new google.maps.DirectionsService();
    }

    const pickup = pickupLocation || currentLocation;

    // CASE 1: MATCHED (Driver coming to pickup)
    if (rideStatus === "matched" && assignedDriverLocation && pickup) {
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
          destination: { lat: selectedDestination.lat, lng: selectedDestination.lng },
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

    // CASE 2: ON TRIP (Driving to Destination)
    else if (rideStatus === "on_trip" && assignedDriverLocation) {
      // Calculate route: Driver (Current Loc) -> Destination
      directionsServiceRef.current.route(
        {
          destination: { lat: selectedDestination.lat, lng: selectedDestination.lng },
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
  }, [
    isLoaded,
    rideStatus,
    assignedDriverLocation,
    currentLocation,
    pickupLocation,
    selectedDestination,
  ]);

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

  const onPickupPlaceChanged = useCallback(() => {
    if (pickupAutocompleteRef.current) {
      const place = pickupAutocompleteRef.current.getPlace();
      if (place.geometry?.location) {
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

      const token = await user.getIdToken();

      const response = await fetch(`${backendUrl}/ride/request`, {
        body: JSON.stringify({
          dropLat: selectedDestination.lat,
          dropLng: selectedDestination.lng,
          fare: estimate?.fare || null,
          pickupLat: pickup.lat,
          pickupLng: pickup.lng,
          riderId: user.uid,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data: RideResponse = await response.json();

      if (data.success && data.rideId && data.driverId && data.driverLocation) {
        setRideStatus("matched");
        setRideId(data.rideId);
        // Persist to localStorage
        localStorage.setItem("currentRideId", data.rideId);
        setAssignedDriverId(data.driverId);
        setAssignedDriverName(data.driverName || "Unknown Driver");
        setAssignedDriverLocation(data.driverLocation);
        setEta(data.eta || null);
        setOtp(data.otp || null); // Store OTP
        if (data.otp) setShowOtpModal(true);
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

      // Clear persistence
      localStorage.removeItem("currentRideId");

      // Reset all ride state
      setRideStatus("idle");
      setRideId(null);
      setAssignedDriverId(null);
      setAssignedDriverName(null);
      setAssignedDriverLocation(null);
      setEta(null);
      setDirectionsToPickup(null);
      setDirectionsToDestination(null);
      setErrorMessage(null);
    } catch (error) {
      console.error("Error cancelling ride:", error);
      setErrorMessage("Failed to cancel ride. Please try again.");
    }
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
            {/* Driver Matched Card */}
            {(rideStatus === "matched" || rideStatus === "on_trip") && assignedDriverId && (
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
                    <h2 style={{ color: "#4ade80", fontSize: "22px", fontWeight: 700, margin: 0 }}>
                      {rideStatus === "on_trip" ? "Trip in Progress" : "Driver Assigned!"}
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

            {/* Search Card - Hide when matched */}
            {rideStatus !== "matched" && (
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
                </div>

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
                    onClick={handleFindRide}
                    disabled={!canRequestRide}
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
                    {rideStatus === "searching" ? (
                      <>
                        <FaSpinner
                          style={{ animation: "spin 1s linear infinite", fontSize: "20px" }}
                        />
                        Finding Driver...
                      </>
                    ) : (
                      <>
                        <FaCar style={{ fontSize: "20px" }} />
                        Find a Ride
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
                  height: "450px",
                  overflow: "hidden",
                  position: "relative",
                }}
              >
                {/* Route Legend - Show when matched */}
                {rideStatus === "matched" && (directionsToPickup || directionsToDestination) && (
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
                      <span style={{ color: "#94a3b8", fontSize: "12px" }}>Driver approaching</span>
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
                  {directionsToDestination && !decodedPolyline.length && (
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

                  {/* Estimated Route Polyline (Green) */}
                  {decodedPolyline.length > 0 && (
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

                  {/* Assigned Driver Marker (when matched) */}
                  {rideStatus === "matched" && assignedDriverLocation && (
                    <Marker
                      position={assignedDriverLocation}
                      icon={{
                        anchor: new google.maps.Point(22, 22),
                        scaledSize: new google.maps.Size(50, 50),
                        url: "/car-icon.svg",
                      }}
                      title="Your Driver"
                    />
                  )}

                  {/* Other Driver Markers (when not matched) */}
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
      {otp && rideStatus === "matched" && showOtpModal && (
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
      {showPayment && clientSecret && (
        <PaymentModal
          clientSecret={clientSecret}
          amount={paymentAmount}
          onSuccess={handlePaymentSuccess}
          onClose={() => setShowPayment(false)}
        />
      )}
    </div>
  );
}
