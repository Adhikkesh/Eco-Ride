"use client";

import { signInWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  FaCar,
  FaCheck,
  FaEnvelope,
  FaFileAlt,
  FaIdCard,
  FaLeaf,
  FaLock,
  FaPhone,
  FaShieldAlt,
  FaTimes,
  FaUser,
} from "react-icons/fa";
import { auth } from "@/lib/firebase";
import { backendUrl } from "../../../config";

// Prevent static generation - this page requires Firebase auth
export const dynamic = "force-dynamic";

// Admin credentials (hardcoded as requested)
const ADMIN_EMAIL = "admin@gmail.com";
const ADMIN_PASSWORD = "admin@123";
const ADMIN_UID = "dq8zZsXXsldH9yVcrB4B7qbHzgB2";
const ADMIN_PASSKEY = "ecoride-admin-2026";

interface Vehicle {
  plate_number: string;
  model: string;
  is_ev: boolean;
  pollution_expiry: string | { _seconds: number; _nanoseconds: number } | null;
}

interface Driver {
  uid: string;
  name: string;
  email: string;
  phone_number: string;
  kyc_url: string | null;
  license_url: string | null;
  vehicle: Vehicle | null;
}

export default function AdminVerification() {
  const router = useRouter();
  const [passkey, setPasskey] = useState("");
  const [isVerified, setIsVerified] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [authError, setAuthError] = useState("");

  // Driver data
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [isLoadingDrivers, setIsLoadingDrivers] = useState(false);
  const [selectedDriver, setSelectedDriver] = useState<Driver | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  // Fetch unverified drivers
  const fetchDrivers = useCallback(async () => {
    setIsLoadingDrivers(true);
    try {
      const user = auth.currentUser;
      if (!user) return;

      const token = await user.getIdToken();
      const response = await fetch(`${backendUrl}/admin/drivers/unverified`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setDrivers(data.data || []);
      }
    } catch (err) {
      console.error("Failed to fetch drivers:", err);
    } finally {
      setIsLoadingDrivers(false);
    }
  }, []);

  // Auto-login with admin credentials on page load
  useEffect(() => {
    const loginAsAdmin = async () => {
      try {
        const result = await signInWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);

        // Verify it's the correct admin UID
        if (result.user.uid !== ADMIN_UID) {
          setAuthError("Invalid admin account. Access denied.");
          return;
        }

        setIsLoading(false);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : "Failed to authenticate admin");
        setIsLoading(false);
      }
    };

    loginAsAdmin();
  }, []);

  // Fetch drivers when verified
  useEffect(() => {
    if (isVerified) {
      fetchDrivers();
    }
  }, [isVerified, fetchDrivers]);

  const handlePasskeySubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (passkey === ADMIN_PASSKEY) {
      setIsVerified(true);
    } else {
      setError("Invalid passkey. Please try again.");
    }
  };

  const handleVerifyDriver = async (driverUid: string, verified: boolean) => {
    setActionLoading(true);
    try {
      const user = auth.currentUser;
      if (!user) return;

      const token = await user.getIdToken();
      const response = await fetch(`${backendUrl}/admin/drivers/verify`, {
        body: JSON.stringify({ driver_uid: driverUid, verified }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (response.ok) {
        // Remove driver from list if verified
        if (verified) {
          setDrivers(drivers.filter((d) => d.uid !== driverUid));
        }
        setSelectedDriver(null);
      }
    } catch (err) {
      console.error("Failed to update driver:", err);
    } finally {
      setActionLoading(false);
    }
  };

  const formatDate = (date: string | { _seconds: number; _nanoseconds: number } | null): string => {
    if (!date) return "N/A";
    if (typeof date === "string") {
      return new Date(date).toLocaleDateString();
    }
    if (date._seconds) {
      return new Date(date._seconds * 1000).toLocaleDateString();
    }
    return "N/A";
  };

  // Show loading state while authenticating
  if (isLoading) {
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
            textAlign: "center",
          }}
        >
          <FaShieldAlt style={{ color: "#4caf50", fontSize: "48px", marginBottom: "16px" }} />
          <p style={{ color: "#333", fontSize: "18px" }}>Authenticating Admin...</p>
        </div>
      </div>
    );
  }

  // Show auth error if login failed
  if (authError) {
    return (
      <div
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #c8e6c9 0%, #a5d6a7 100%)",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
          justifyContent: "center",
          minHeight: "100vh",
        }}
      >
        <div
          style={{
            background: "white",
            borderRadius: "16px",
            boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
            maxWidth: "400px",
            padding: "40px",
            textAlign: "center",
          }}
        >
          <FaShieldAlt style={{ color: "#f44336", fontSize: "48px", marginBottom: "16px" }} />
          <h2 style={{ color: "#333", marginBottom: "12px" }}>Authentication Failed</h2>
          <p style={{ color: "#c62828", fontSize: "14px", marginBottom: "20px" }}>{authError}</p>
          <button
            type="button"
            onClick={() => router.push("/")}
            style={{
              background: "#4caf50",
              border: "none",
              borderRadius: "8px",
              color: "white",
              cursor: "pointer",
              fontSize: "14px",
              padding: "12px 24px",
            }}
          >
            Go Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <main
      style={{
        background: "linear-gradient(135deg, #c8e6c9 0%, #a5d6a7 100%)",
        minHeight: "100vh",
        position: "relative",
      }}
    >
      {/* Main Content - Blurred when not verified */}
      <div
        style={{
          filter: isVerified ? "none" : "blur(8px)",
          padding: "40px",
          pointerEvents: isVerified ? "auto" : "none",
          transition: "filter 0.3s ease",
        }}
      >
        <div style={{ margin: "0 auto", maxWidth: "1200px" }}>
          {/* Admin Header */}
          <div
            style={{
              alignItems: "center",
              background: "white",
              borderRadius: "16px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              display: "flex",
              gap: "16px",
              marginBottom: "32px",
              padding: "24px",
            }}
          >
            <div
              style={{
                alignItems: "center",
                background: "#2e7d32",
                borderRadius: "50%",
                display: "flex",
                fontSize: "24px",
                height: "56px",
                justifyContent: "center",
                width: "56px",
              }}
            >
              <FaShieldAlt style={{ color: "white" }} />
            </div>
            <div>
              <h1 style={{ color: "#2d2d2d", fontSize: "28px", fontWeight: "bold", margin: 0 }}>
                Admin Dashboard
              </h1>
              <p style={{ color: "#666", fontSize: "14px", margin: "4px 0 0" }}>
                EcoRide Driver Verification Panel
              </p>
            </div>
          </div>

          {/* Driver Verification Queue */}
          <div
            style={{
              background: "white",
              borderRadius: "16px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
              padding: "32px",
            }}
          >
            <h2 style={{ color: "#2d2d2d", fontSize: "22px", marginBottom: "24px", marginTop: 0 }}>
              Driver Verification Queue
            </h2>

            {isLoadingDrivers ? (
              <div style={{ color: "#666", padding: "40px", textAlign: "center" }}>
                Loading drivers...
              </div>
            ) : drivers.length === 0 ? (
              <div
                style={{
                  background: "#f1f8e9",
                  borderRadius: "12px",
                  color: "#33691e",
                  padding: "40px",
                  textAlign: "center",
                }}
              >
                <FaCheck style={{ fontSize: "48px", marginBottom: "16px", opacity: 0.6 }} />
                <p style={{ fontSize: "16px", margin: 0 }}>
                  All drivers have been verified! No pending reviews.
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gap: "20px",
                  gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
                }}
              >
                {drivers.map((driver) => (
                  <div
                    key={driver.uid}
                    style={{
                      background: "#f9fbe7",
                      border: "1px solid #dcedc8",
                      borderRadius: "12px",
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
                      <div
                        style={{
                          alignItems: "center",
                          background: "#4caf50",
                          borderRadius: "50%",
                          color: "white",
                          display: "flex",
                          height: "48px",
                          justifyContent: "center",
                          width: "48px",
                        }}
                      >
                        <FaUser style={{ fontSize: "20px" }} />
                      </div>
                      <div>
                        <p style={{ color: "#2d2d2d", fontWeight: "600", margin: 0 }}>
                          {driver.name}
                        </p>
                        <p style={{ color: "#666", fontSize: "13px", margin: "4px 0 0" }}>
                          {driver.email}
                        </p>
                      </div>
                    </div>

                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                        <FaPhone style={{ color: "#4caf50", fontSize: "14px" }} />
                        <span style={{ color: "#555", fontSize: "14px" }}>
                          {driver.phone_number}
                        </span>
                      </div>
                      {driver.vehicle && (
                        <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                          <FaCar style={{ color: "#4caf50", fontSize: "14px" }} />
                          <span style={{ color: "#555", fontSize: "14px" }}>
                            {driver.vehicle.plate_number} - {driver.vehicle.model}
                            {driver.vehicle.is_ev && " ⚡"}
                          </span>
                        </div>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedDriver(driver)}
                      style={{
                        background: "linear-gradient(135deg, #4caf50 0%, #43a047 100%)",
                        border: "none",
                        borderRadius: "8px",
                        boxShadow: "0 2px 8px rgba(76,175,80,0.3)",
                        color: "white",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "600",
                        marginTop: "16px",
                        padding: "12px 20px",
                        width: "100%",
                      }}
                    >
                      Review Documents
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Driver Review Modal */}
      {selectedDriver && (
        <div
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            overflow: "auto",
            padding: "20px",
            position: "fixed",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "24px",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.3)",
              maxHeight: "90vh",
              maxWidth: "600px",
              overflow: "auto",
              padding: "32px",
              width: "100%",
            }}
          >
            {/* Modal Header */}
            <div
              style={{
                alignItems: "center",
                borderBottom: "1px solid #e0e0e0",
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "24px",
                paddingBottom: "16px",
              }}
            >
              <h2 style={{ color: "#2d2d2d", fontSize: "22px", fontWeight: "bold", margin: 0 }}>
                Driver Review
              </h2>
              <button
                type="button"
                onClick={() => setSelectedDriver(null)}
                style={{
                  background: "#f5f5f5",
                  border: "none",
                  borderRadius: "50%",
                  cursor: "pointer",
                  height: "36px",
                  width: "36px",
                }}
              >
                <FaTimes style={{ color: "#666" }} />
              </button>
            </div>

            {/* Driver Info */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {/* Personal Info */}
              <div style={{ background: "#f9fbe7", borderRadius: "12px", padding: "20px" }}>
                <h3
                  style={{
                    color: "#33691e",
                    fontSize: "14px",
                    fontWeight: "600",
                    margin: "0 0 12px",
                    textTransform: "uppercase",
                  }}
                >
                  Personal Information
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
                    <FaUser style={{ color: "#4caf50", fontSize: "16px", width: "20px" }} />
                    <span style={{ color: "#333", fontSize: "15px" }}>{selectedDriver.name}</span>
                  </div>
                  <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
                    <FaEnvelope style={{ color: "#4caf50", fontSize: "16px", width: "20px" }} />
                    <span style={{ color: "#333", fontSize: "15px" }}>{selectedDriver.email}</span>
                  </div>
                  <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
                    <FaPhone style={{ color: "#4caf50", fontSize: "16px", width: "20px" }} />
                    <span style={{ color: "#333", fontSize: "15px" }}>
                      {selectedDriver.phone_number}
                    </span>
                  </div>
                </div>
              </div>

              {/* Documents */}
              <div style={{ background: "#e8f5e9", borderRadius: "12px", padding: "20px" }}>
                <h3
                  style={{
                    color: "#1b5e20",
                    fontSize: "14px",
                    fontWeight: "600",
                    margin: "0 0 12px",
                    textTransform: "uppercase",
                  }}
                >
                  Documents
                </h3>
                <div style={{ display: "flex", gap: "12px" }}>
                  <button
                    type="button"
                    onClick={() =>
                      selectedDriver.license_url &&
                      window.open(selectedDriver.license_url, "_blank")
                    }
                    disabled={!selectedDriver.license_url}
                    style={{
                      alignItems: "center",
                      background: selectedDriver.license_url ? "#4caf50" : "#ccc",
                      border: "none",
                      borderRadius: "8px",
                      color: "white",
                      cursor: selectedDriver.license_url ? "pointer" : "not-allowed",
                      display: "flex",
                      flex: 1,
                      fontSize: "14px",
                      gap: "8px",
                      justifyContent: "center",
                      padding: "14px",
                    }}
                  >
                    <FaFileAlt />
                    License
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      selectedDriver.kyc_url && window.open(selectedDriver.kyc_url, "_blank")
                    }
                    disabled={!selectedDriver.kyc_url}
                    style={{
                      alignItems: "center",
                      background: selectedDriver.kyc_url ? "#4caf50" : "#ccc",
                      border: "none",
                      borderRadius: "8px",
                      color: "white",
                      cursor: selectedDriver.kyc_url ? "pointer" : "not-allowed",
                      display: "flex",
                      flex: 1,
                      fontSize: "14px",
                      gap: "8px",
                      justifyContent: "center",
                      padding: "14px",
                    }}
                  >
                    <FaIdCard />
                    KYC Document
                  </button>
                </div>
              </div>

              {/* Vehicle Info */}
              {selectedDriver.vehicle && (
                <div style={{ background: "#f1f8e9", borderRadius: "12px", padding: "20px" }}>
                  <h3
                    style={{
                      color: "#33691e",
                      fontSize: "14px",
                      fontWeight: "600",
                      margin: "0 0 12px",
                      textTransform: "uppercase",
                    }}
                  >
                    Vehicle Information
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
                      <FaCar style={{ color: "#4caf50", fontSize: "16px", width: "20px" }} />
                      <span style={{ color: "#333", fontSize: "15px" }}>
                        <strong>Plate:</strong> {selectedDriver.vehicle.plate_number}
                      </span>
                    </div>
                    <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
                      <FaCar style={{ color: "#4caf50", fontSize: "16px", width: "20px" }} />
                      <span style={{ color: "#333", fontSize: "15px" }}>
                        <strong>Model:</strong> {selectedDriver.vehicle.model}
                      </span>
                    </div>
                    <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
                      <FaLeaf style={{ color: "#4caf50", fontSize: "16px", width: "20px" }} />
                      <span style={{ color: "#333", fontSize: "15px" }}>
                        <strong>EV:</strong> {selectedDriver.vehicle.is_ev ? "Yes ⚡" : "No"}
                      </span>
                    </div>
                    <div style={{ alignItems: "center", display: "flex", gap: "10px" }}>
                      <FaFileAlt style={{ color: "#4caf50", fontSize: "16px", width: "20px" }} />
                      <span style={{ color: "#333", fontSize: "15px" }}>
                        <strong>Pollution Expiry:</strong>{" "}
                        {formatDate(selectedDriver.vehicle.pollution_expiry)}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: "12px", marginTop: "8px" }}>
                <button
                  type="button"
                  onClick={() => handleVerifyDriver(selectedDriver.uid, false)}
                  disabled={actionLoading}
                  style={{
                    alignItems: "center",
                    background: "white",
                    border: "2px solid #f44336",
                    borderRadius: "12px",
                    color: "#f44336",
                    cursor: actionLoading ? "not-allowed" : "pointer",
                    display: "flex",
                    flex: 1,
                    fontSize: "16px",
                    fontWeight: "600",
                    gap: "8px",
                    justifyContent: "center",
                    padding: "16px",
                  }}
                >
                  <FaTimes />
                  Decline
                </button>
                <button
                  type="button"
                  onClick={() => handleVerifyDriver(selectedDriver.uid, true)}
                  disabled={actionLoading}
                  style={{
                    alignItems: "center",
                    background: "linear-gradient(135deg, #4caf50 0%, #43a047 100%)",
                    border: "none",
                    borderRadius: "12px",
                    boxShadow: "0 4px 15px rgba(76,175,80,0.35)",
                    color: "white",
                    cursor: actionLoading ? "not-allowed" : "pointer",
                    display: "flex",
                    flex: 1,
                    fontSize: "16px",
                    fontWeight: "600",
                    gap: "8px",
                    justifyContent: "center",
                    padding: "16px",
                  }}
                >
                  <FaCheck />
                  Verify
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Passkey Modal - Only shown when not verified */}
      {!isVerified && (
        <div
          style={{
            alignItems: "center",
            background: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            inset: 0,
            justifyContent: "center",
            position: "fixed",
            zIndex: 1000,
          }}
        >
          <div
            style={{
              background: "white",
              borderRadius: "24px",
              boxShadow: "0 20px 60px rgba(0, 0, 0, 0.2)",
              maxWidth: "400px",
              padding: "40px",
              width: "90%",
            }}
          >
            <div style={{ marginBottom: "24px", textAlign: "center" }}>
              <div
                style={{
                  alignItems: "center",
                  background: "linear-gradient(135deg, #4caf50 0%, #43a047 100%)",
                  borderRadius: "50%",
                  display: "inline-flex",
                  height: "72px",
                  justifyContent: "center",
                  marginBottom: "16px",
                  width: "72px",
                }}
              >
                <FaLock style={{ color: "white", fontSize: "28px" }} />
              </div>
              <h2 style={{ color: "#2d2d2d", fontSize: "24px", fontWeight: "bold", margin: 0 }}>
                Enter Admin Passkey
              </h2>
              <p style={{ color: "#666", fontSize: "14px", marginTop: "8px" }}>
                This area is restricted to authorized personnel only
              </p>
            </div>

            {error && (
              <div
                style={{
                  background: "#ffebee",
                  borderRadius: "8px",
                  color: "#c62828",
                  fontSize: "14px",
                  marginBottom: "16px",
                  padding: "12px 16px",
                  textAlign: "center",
                }}
              >
                {error}
              </div>
            )}

            <form onSubmit={handlePasskeySubmit}>
              <div style={{ marginBottom: "20px" }}>
                <input
                  type="password"
                  value={passkey}
                  onChange={(e) => setPasskey(e.target.value)}
                  placeholder="Enter passkey..."
                  required
                  style={{
                    border: "2px solid #e0e0e0",
                    borderRadius: "12px",
                    boxSizing: "border-box",
                    color: "#333",
                    fontSize: "16px",
                    outline: "none",
                    padding: "16px",
                    textAlign: "center",
                    width: "100%",
                  }}
                />
              </div>

              <button
                type="submit"
                style={{
                  background: "linear-gradient(135deg, #4caf50 0%, #43a047 100%)",
                  border: "none",
                  borderRadius: "12px",
                  boxShadow: "0 4px 15px rgba(76, 175, 80, 0.35)",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "16px",
                  fontWeight: "600",
                  padding: "16px",
                  width: "100%",
                }}
              >
                Verify Access
              </button>
            </form>

            <button
              type="button"
              onClick={() => router.push("/")}
              style={{
                background: "transparent",
                border: "none",
                color: "#666",
                cursor: "pointer",
                fontSize: "14px",
                marginTop: "16px",
                padding: "8px",
                textDecoration: "underline",
                width: "100%",
              }}
            >
              Go back to login
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
