"use client";

import { onAuthStateChanged } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import RiderMap from "@/components/maps/RiderMap";
import { auth, db } from "@/lib/firebase";

// Prevent static generation
export const dynamic = "force-dynamic";

export default function RiderPage(): React.ReactNode {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [isRider, setIsRider] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/");
        return;
      }

      // Check if user has rider role
      try {
        if (db) {
          const userDoc = await getDoc(doc(db, "users", currentUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            if (userData?.role === "rider") {
              setIsRider(true);
            } else {
              // Not a rider, redirect to dashboard
              router.push("/dashboard");
              return;
            }
          } else {
            // User not found in database, redirect to onboarding
            router.push("/onboarding");
            return;
          }
        }
      } catch (error) {
        console.error("Error checking user role:", error);
        // On error, still allow access but show warning
        setIsRider(true);
      }

      setLoading(false);
    });

    return () => unsubscribe();
  }, [router]);

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
          <p style={{ color: "#94a3b8", fontSize: "16px" }}>Loading your ride experience...</p>
        </div>
        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  if (!isRider) {
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
            background: "rgba(30, 41, 59, 0.9)",
            borderRadius: "24px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
            maxWidth: "400px",
            padding: "40px",
            textAlign: "center",
          }}
        >
          <div
            style={{
              alignItems: "center",
              background: "rgba(239, 68, 68, 0.2)",
              borderRadius: "50%",
              display: "flex",
              height: "64px",
              justifyContent: "center",
              margin: "0 auto 24px",
              width: "64px",
            }}
          >
            ⚠️
          </div>
          <h2 style={{ color: "white", fontSize: "24px", fontWeight: 600, marginBottom: "12px" }}>
            Access Restricted
          </h2>
          <p style={{ color: "#94a3b8", fontSize: "14px", marginBottom: "24px" }}>
            This page is only accessible to riders. Please contact support if you believe this is an
            error.
          </p>
          <button
            type="button"
            onClick={() => router.push("/dashboard")}
            style={{
              background: "linear-gradient(135deg, #22c55e, #10b981)",
              border: "none",
              borderRadius: "12px",
              color: "white",
              cursor: "pointer",
              fontSize: "15px",
              fontWeight: 600,
              padding: "14px 28px",
            }}
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return <RiderMap />;
}
