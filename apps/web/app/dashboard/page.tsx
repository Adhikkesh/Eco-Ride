"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaSignOutAlt, FaUser } from "react-icons/fa";
import DriverLiveMap from "@/components/maps/DriverLiveMap";
import RiderMap from "@/components/maps/RiderMap";
import { Button } from "@/components/ui/button";
import { auth, db } from "@/lib/firebase";

// Prevent static generation - this page requires Firebase auth
export const dynamic = "force-dynamic";

export default function Dashboard(): React.ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<"rider" | "driver" | null>(null);

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
        background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)",
        minHeight: "100vh",
      }}
    >
      {/* Header/Navbar */}
      <header
        style={{
          backdropFilter: "blur(12px)",
          background: "rgba(30, 41, 59, 0.95)",
          borderBottom: "1px solid rgba(71, 85, 105, 0.5)",
          boxShadow: "0 4px 20px rgba(0,0,0,0.3)",
          padding: "12px 24px",
          position: "sticky",
          top: 0,
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
            <div
              style={{
                alignItems: "center",
                background: "linear-gradient(135deg, #22c55e, #10b981)",
                borderRadius: "12px",
                boxShadow: "0 4px 12px rgba(34, 197, 94, 0.3)",
                display: "flex",
                fontSize: "20px",
                height: "44px",
                justifyContent: "center",
                width: "44px",
              }}
            >
              🚗
            </div>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <span style={{ color: "white", fontSize: "20px", fontWeight: "bold" }}>EcoRide</span>
              <span style={{ color: "#94a3b8", fontSize: "12px" }}>
                {userRole === "driver" ? "Driver Dashboard" : "Rider Dashboard"}
              </span>
            </div>
          </div>

          {/* User Info & Logout */}
          <div style={{ alignItems: "center", display: "flex", gap: "16px" }}>
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
              {userRole === "driver" ? "🚗 Driver" : "🚶 Rider"}
            </div>

            {/* Profile */}
            <div
              style={{
                alignItems: "center",
                background: "rgba(15, 23, 42, 0.5)",
                borderRadius: "12px",
                display: "flex",
                gap: "12px",
                padding: "8px 16px",
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
                <span style={{ color: "white", fontSize: "14px", fontWeight: "500" }}>
                  {user?.displayName || user?.email?.split("@")[0] || "User"}
                </span>
                <span style={{ color: "#94a3b8", fontSize: "11px" }}>{user?.email}</span>
              </div>
            </div>

            {/* Logout Button */}
            <Button
              onClick={handleLogout}
              variant="outline"
              style={{
                alignItems: "center",
                background: "transparent",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "10px",
                color: "#f87171",
                display: "flex",
                gap: "8px",
                padding: "10px 16px",
                transition: "all 0.2s ease",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.5)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
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
        {userRole === "driver" ? <DriverLiveMap embedded /> : <RiderMap embedded />}
      </main>
    </div>
  );
}
