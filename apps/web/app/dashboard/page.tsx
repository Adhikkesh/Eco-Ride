"use client";

import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaCar, FaLeaf, FaMapMarkerAlt, FaSignOutAlt, FaUser } from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase";

export default function Dashboard(): React.ReactNode {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      if (!currentUser) {
        router.push("/");
      } else {
        setUser(currentUser);
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
          background: "linear-gradient(135deg, #c8e6c9 0%, #a5d6a7 100%)",
          display: "flex",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            background: "white",
            borderRadius: "16px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
            padding: "40px",
          }}
        >
          <p style={{ color: "#666", fontSize: "18px" }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: "linear-gradient(135deg, #c8e6c9 0%, #a5d6a7 100%)",
        minHeight: "100vh",
      }}
    >
      {/* Header */}
      <header
        style={{
          background: "white",
          boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
          padding: "16px 32px",
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
          <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
            <div
              style={{
                alignItems: "center",
                background: "#2e7d32",
                borderRadius: "50%",
                display: "flex",
                fontSize: "24px",
                height: "48px",
                justifyContent: "center",
                width: "48px",
              }}
            >
              🚗
            </div>
            <span style={{ color: "#333", fontSize: "24px", fontWeight: "bold" }}>EcoRide</span>
          </div>

          <div style={{ alignItems: "center", display: "flex", gap: "20px" }}>
            <div style={{ alignItems: "center", display: "flex", gap: "12px" }}>
              {user?.photoURL ? (
                <Image
                  src={user.photoURL}
                  alt="Profile"
                  width={40}
                  height={40}
                  style={{
                    borderRadius: "50%",
                    objectFit: "cover",
                  }}
                />
              ) : (
                <div
                  style={{
                    alignItems: "center",
                    background: "#4caf50",
                    borderRadius: "50%",
                    color: "white",
                    display: "flex",
                    height: "40px",
                    justifyContent: "center",
                    width: "40px",
                  }}
                >
                  <FaUser />
                </div>
              )}
              <span style={{ color: "#333", fontWeight: "500" }}>
                {user?.displayName || user?.email?.split("@")[0] || "User"}
              </span>
            </div>
            <Button
              onClick={handleLogout}
              variant="outline"
              style={{
                alignItems: "center",
                borderRadius: "10px",
                display: "flex",
                gap: "8px",
                padding: "10px 20px",
              }}
            >
              <FaSignOutAlt />
              Logout
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main
        style={{
          margin: "0 auto",
          maxWidth: "1400px",
          padding: "40px 32px",
        }}
      >
        <h1
          style={{
            color: "#2d2d2d",
            fontSize: "36px",
            fontWeight: "bold",
            marginBottom: "8px",
          }}
        >
          Welcome back, {user?.displayName?.split(" ")[0] || "Rider"}! 👋
        </h1>
        <p style={{ color: "#666", fontSize: "18px", marginBottom: "40px" }}>
          Ready for your next green journey?
        </p>

        {/* Quick Actions */}
        <div
          style={{
            display: "grid",
            gap: "24px",
            gridTemplateColumns: "repeat(3, 1fr)",
            marginBottom: "40px",
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "20px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
              cursor: "pointer",
              padding: "32px",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: "#e8f5e9",
                borderRadius: "16px",
                display: "flex",
                height: "60px",
                justifyContent: "center",
                marginBottom: "20px",
                width: "60px",
              }}
            >
              <FaCar style={{ color: "#4caf50", fontSize: "28px" }} />
            </div>
            <h3 style={{ color: "#333", fontSize: "20px", fontWeight: "600", marginBottom: "8px" }}>
              Find a Ride
            </h3>
            <p style={{ color: "#777", fontSize: "15px" }}>
              Search for available carpools near you
            </p>
          </div>

          <div
            style={{
              background: "white",
              borderRadius: "20px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
              cursor: "pointer",
              padding: "32px",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: "#e8f5e9",
                borderRadius: "16px",
                display: "flex",
                height: "60px",
                justifyContent: "center",
                marginBottom: "20px",
                width: "60px",
              }}
            >
              <FaMapMarkerAlt style={{ color: "#4caf50", fontSize: "28px" }} />
            </div>
            <h3 style={{ color: "#333", fontSize: "20px", fontWeight: "600", marginBottom: "8px" }}>
              Offer a Ride
            </h3>
            <p style={{ color: "#777", fontSize: "15px" }}>Share your ride and earn rewards</p>
          </div>

          <div
            style={{
              background: "white",
              borderRadius: "20px",
              boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
              cursor: "pointer",
              padding: "32px",
              transition: "transform 0.2s, box-shadow 0.2s",
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: "#e8f5e9",
                borderRadius: "16px",
                display: "flex",
                height: "60px",
                justifyContent: "center",
                marginBottom: "20px",
                width: "60px",
              }}
            >
              <FaLeaf style={{ color: "#4caf50", fontSize: "28px" }} />
            </div>
            <h3 style={{ color: "#333", fontSize: "20px", fontWeight: "600", marginBottom: "8px" }}>
              Green Rewards
            </h3>
            <p style={{ color: "#777", fontSize: "15px" }}>Check your eco-points and redeem</p>
          </div>
        </div>

        {/* Stats Cards */}
        <div
          style={{
            background: "white",
            borderRadius: "20px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
            padding: "32px",
          }}
        >
          <h2
            style={{
              color: "#333",
              fontSize: "24px",
              fontWeight: "600",
              marginBottom: "24px",
            }}
          >
            Your Impact 🌍
          </h2>
          <div
            style={{
              display: "grid",
              gap: "24px",
              gridTemplateColumns: "repeat(4, 1fr)",
            }}
          >
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  color: "#4caf50",
                  fontSize: "36px",
                  fontWeight: "bold",
                  marginBottom: "8px",
                }}
              >
                0
              </p>
              <p style={{ color: "#777", fontSize: "14px" }}>Rides Taken</p>
            </div>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  color: "#4caf50",
                  fontSize: "36px",
                  fontWeight: "bold",
                  marginBottom: "8px",
                }}
              >
                0 kg
              </p>
              <p style={{ color: "#777", fontSize: "14px" }}>CO₂ Saved</p>
            </div>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  color: "#4caf50",
                  fontSize: "36px",
                  fontWeight: "bold",
                  marginBottom: "8px",
                }}
              >
                0
              </p>
              <p style={{ color: "#777", fontSize: "14px" }}>Green Points</p>
            </div>
            <div style={{ textAlign: "center" }}>
              <p
                style={{
                  color: "#4caf50",
                  fontSize: "36px",
                  fontWeight: "bold",
                  marginBottom: "8px",
                }}
              >
                $0
              </p>
              <p style={{ color: "#777", fontSize: "14px" }}>Money Saved</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
