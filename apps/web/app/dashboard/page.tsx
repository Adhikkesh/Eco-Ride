"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaMoon, FaShieldAlt, FaSignOutAlt, FaSun, FaUser } from "react-icons/fa";
import DriverLiveMap from "@/components/maps/DriverLiveMap";
import RiderMap from "@/components/maps/RiderMap";
import { Button } from "@/components/ui/button";
import { backendUrl } from "@/config";
import { auth, db } from "@/lib/firebase";

// Prevent static generation - this page requires Firebase auth
export const dynamic = "force-dynamic";

export default function Dashboard(): React.ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<"rider" | "driver" | null>(null);
  const [kycVerified, setKycVerified] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/");
        return;
      }

      setUser(currentUser);

      // Fetch user role from Firestore
      try {
        if (db) {
          const userDoc = await getDoc(doc(db, "users", currentUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            setUserRole(userData?.role || "rider");
            // Check KYC status for drivers (default to false if not present)
            if (userData?.role === "driver") {
              try {
                // Fetch latest status from backend API to ensure accuracy (bypass Firestore cache/sync issues)
                const token = await currentUser.getIdToken();
                // Check if backendUrl is defined before making request
                if (!backendUrl) throw new Error("Backend URL not configured");

                const statusRes = await fetch(`${backendUrl}/user/driver-status`, {
                  headers: {
                    Authorization: `Bearer ${token}`,
                  },
                });

                if (statusRes.ok) {
                  const statusData = await statusRes.json();
                  console.log("Driver API Status:", statusData);
                  setKycVerified(statusData.kyc_verified);
                } else {
                  throw new Error("API returned error status");
                }
              } catch (err) {
                console.error(
                  "Error fetching driver status from API, falling back to Firestore:",
                  err,
                );
                // Fallback: Fetch directly from driver_profile collection which has the authoritative status
                try {
                  const driverProfileDoc = await getDoc(doc(db, "driver_profile", currentUser.uid));
                  if (driverProfileDoc.exists()) {
                    setKycVerified(driverProfileDoc.data()?.kyc_verified || false);
                  } else {
                    setKycVerified(false);
                  }
                } catch (firestoreErr) {
                  console.error("Error fetching driver profile from Firestore:", firestoreErr);
                  setKycVerified(false);
                }
              }
            }
          } else {
            // User not in Firestore, redirect to onboarding
            router.push("/onboarding");
            return;
          }
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
        // Default to rider on error
        setUserRole("rider");
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

  const handleLogout = async () => {
    try {
      // Sign out from Firebase
      await signOut(auth);

      // Clear all local storage
      localStorage.clear();

      // Clear all session storage
      sessionStorage.clear();

      // Clear all cookies
      const clearCookie = (name: string) => {
        // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API is not widely supported yet
        document.cookie = `${name.trim()}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
      };
      document.cookie.split(";").forEach((cookie) => {
        const eqPos = cookie.indexOf("=");
        const name = eqPos > -1 ? cookie.substring(0, eqPos) : cookie;
        clearCookie(name);
      });

      // Redirect to home
      router.push("/");
    } catch (error) {
      console.error("Logout failed:", error);
      // Force redirect even if logout fails
      router.push("/");
    }
  };

  if (loading) {
    return (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
          display: "flex",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            alignItems: "center",
            color: "white",
            display: "flex",
            flexDirection: "column",
            gap: "16px",
          }}
        >
          <div
            style={{
              animation: "spin 1s linear infinite",
              border: "3px solid rgba(34, 197, 94, 0.3)",
              borderRadius: "50%",
              borderTopColor: "#22c55e",
              height: "48px",
              width: "48px",
            }}
          />
          <p style={{ color: "#94a3b8", fontSize: "16px" }}>Loading your dashboard...</p>
        </div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        background: darkMode
          ? "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)"
          : "linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 50%, #f0f9ff 100%)",
        minHeight: "100vh",
        transition: "background 0.3s ease",
      }}
    >
      {/* Header/Navbar */}
      <header
        style={{
          backdropFilter: "blur(12px)",
          background: darkMode ? "rgba(30, 41, 59, 0.95)" : "rgba(255, 255, 255, 0.95)",
          borderBottom: darkMode
            ? "1px solid rgba(71, 85, 105, 0.5)"
            : "1px solid rgba(203, 213, 225, 0.5)",
          boxShadow: darkMode ? "0 4px 20px rgba(0,0,0,0.3)" : "0 4px 20px rgba(0,0,0,0.1)",
          padding: "12px 24px",
          position: "sticky",
          top: 0,
          transition: "all 0.3s ease",
          zIndex: 100,
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            justifyContent: "space-between",
            margin: "0 auto",
            maxWidth: "1400px",
          }}
        >
          {/* Logo */}
          <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
            <Image
              src="/logo.png"
              alt="EcoRide Logo"
              width={150}
              height={50}
              style={{
                filter: darkMode
                  ? "brightness(1.2) contrast(1.2) invert(1) hue-rotate(180deg)"
                  : "none",
                height: "44px",
                mixBlendMode: darkMode ? "screen" : "normal",
                objectFit: "contain",
                width: "auto",
              }}
              priority
            />
          </div>

          {/* User Info & Logout */}
          <div style={{ alignItems: "center", display: "flex", gap: "16px" }}>
            {/* Dark Mode Toggle */}
            <button
              type="button"
              onClick={() => setDarkMode(!darkMode)}
              style={{
                alignItems: "center",
                background: darkMode ? "rgba(59, 130, 246, 0.2)" : "rgba(79, 70, 229, 0.1)",
                border: "1px solid",
                borderColor: darkMode ? "rgba(59, 130, 246, 0.3)" : "rgba(79, 70, 229, 0.2)",
                borderRadius: "12px",
                color: darkMode ? "#60a5fa" : "#4f46e5",
                cursor: "pointer",
                display: "flex",
                height: "40px",
                justifyContent: "center",
                transition: "all 0.3s ease",
                width: "40px",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = darkMode
                  ? "rgba(59, 130, 246, 0.3)"
                  : "rgba(79, 70, 229, 0.15)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = darkMode
                  ? "rgba(59, 130, 246, 0.2)"
                  : "rgba(79, 70, 229, 0.1)";
              }}
            >
              {darkMode ? (
                <FaSun style={{ fontSize: "16px" }} />
              ) : (
                <FaMoon style={{ fontSize: "16px" }} />
              )}
            </button>

            {/* Role Badge */}
            <div
              style={{
                background:
                  userRole === "driver" ? "rgba(34, 197, 94, 0.2)" : "rgba(59, 130, 246, 0.2)",
                border:
                  userRole === "driver"
                    ? "1px solid rgba(34, 197, 94, 0.3)"
                    : "1px solid rgba(59, 130, 246, 0.3)",
                borderRadius: "20px",
                color: userRole === "driver" ? "#4ade80" : "#60a5fa",
                fontSize: "13px",
                fontWeight: "600",
                padding: "6px 14px",
                textTransform: "capitalize",
              }}
            >
              {userRole === "driver" ? "Driver" : "Rider"}
            </div>

            {/* Profile */}
            <div
              style={{
                alignItems: "center",
                background: darkMode ? "rgba(15, 23, 42, 0.5)" : "rgba(203, 213, 225, 0.2)",
                borderRadius: "12px",
                display: "flex",
                gap: "12px",
                padding: "8px 16px",
                transition: "all 0.3s ease",
              }}
            >
              {user?.photoURL ? (
                <Image
                  src={user.photoURL}
                  alt="Profile"
                  width={36}
                  height={36}
                  style={{
                    border: "2px solid #22c55e",
                    borderRadius: "50%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    alignItems: "center",
                    background: "linear-gradient(135deg, #22c55e, #10b981)",
                    borderRadius: "50%",
                    color: "white",
                    display: "flex",
                    height: "36px",
                    justifyContent: "center",
                    width: "36px",
                  }}
                >
                  <FaUser style={{ fontSize: "14px" }} />
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column" }}>
                <span
                  style={{
                    color: darkMode ? "white" : "#1e293b",
                    fontSize: "14px",
                    fontWeight: "500",
                    transition: "color 0.3s ease",
                  }}
                >
                  {user?.displayName || user?.email?.split("@")[0] || "User"}
                </span>
                <span
                  style={{
                    color: darkMode ? "#94a3b8" : "#64748b",
                    fontSize: "11px",
                    transition: "color 0.3s ease",
                  }}
                >
                  {user?.email}
                </span>
              </div>
            </div>

            {/* Logout Button */}
            <Button
              onClick={handleLogout}
              variant="outline"
              style={{
                alignItems: "center",
                background: "transparent",
                border: "1px solid",
                borderColor: darkMode ? "rgba(239, 68, 68, 0.3)" : "rgba(239, 68, 68, 0.4)",
                borderRadius: "10px",
                color: darkMode ? "#f87171" : "#dc2626",
                display: "flex",
                gap: "8px",
                padding: "10px 16px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = darkMode
                  ? "rgba(239, 68, 68, 0.1)"
                  : "rgba(239, 68, 68, 0.08)";
                e.currentTarget.style.borderColor = darkMode
                  ? "rgba(239, 68, 68, 0.5)"
                  : "rgba(239, 68, 68, 0.6)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = darkMode
                  ? "rgba(239, 68, 68, 0.3)"
                  : "rgba(239, 68, 68, 0.4)";
              }}
            >
              <FaSignOutAlt />
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content - Render based on role */}
      <main style={{ paddingTop: "0" }}>
        {userRole === "driver" ? (
          <DriverLiveMap embedded darkMode={darkMode} />
        ) : (
          <RiderMap embedded darkMode={darkMode} />
        )}
      </main>

      {/* KYC Verification Pending Popup - Only for drivers who are not verified */}
      {userRole === "driver" && !kycVerified && (
        <div
          style={{
            alignItems: "center",
            backdropFilter: "blur(8px)",
            background: "rgba(0, 0, 0, 0.5)",
            bottom: 0,
            display: "flex",
            justifyContent: "center",
            left: 0,
            position: "fixed",
            right: 0,
            top: 0,
            zIndex: 90,
          }}
        >
          <div
            style={{
              background: darkMode ? "#1e293b" : "white",
              border: "1px solid",
              borderColor: darkMode ? "rgba(255, 255, 255, 0.1)" : "rgba(0, 0, 0, 0.1)",
              borderRadius: "16px",
              boxShadow:
                "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
              maxWidth: "400px",
              padding: "32px",
              textAlign: "center",
              width: "90%",
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: "rgba(34, 197, 94, 0.2)",
                borderRadius: "50%",
                color: "#22c55e",
                display: "inline-flex",
                height: "64px",
                justifyContent: "center",
                marginBottom: "24px",
                width: "64px",
              }}
            >
              <FaShieldAlt style={{ fontSize: "32px" }} />
            </div>
            <h2
              style={{
                color: darkMode ? "white" : "#1e293b",
                fontSize: "24px",
                fontWeight: "bold",
                marginBottom: "12px",
              }}
            >
              Verification in Progress
            </h2>
            <p
              style={{
                color: darkMode ? "#94a3b8" : "#64748b",
                fontSize: "16px",
                lineHeight: "1.5",
                marginBottom: "24px",
              }}
            >
              Please Wait We are Verifying your documents
            </p>
            <div
              style={{
                background: darkMode ? "rgba(15, 23, 42, 0.5)" : "#f1f5f9",
                borderRadius: "8px",
                color: darkMode ? "#cbd5e1" : "#475569",
                fontSize: "14px",
                padding: "12px",
              }}
            >
              This process usually takes 24-48 hours. You will be notified once your account is
              approved.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
