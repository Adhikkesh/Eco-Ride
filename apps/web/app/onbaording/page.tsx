"use client";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FaCalendar, FaCar, FaFileAlt, FaIdCard, FaLeaf, FaPhone, FaUser } from "react-icons/fa";
import { auth, storage } from "@/lib/firebase";
import { backendUrl } from "../../config";

// Prevent static generation - this page requires Firebase auth
export const dynamic = "force-dynamic";

export default function Onboarding() {
  const router = useRouter();

  // Form state
  const [name, setName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [role, setRole] = useState<"rider" | "driver">("rider");

  // Driver-specific fields
  const [kycFile, setKycFile] = useState<File | null>(null);
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [plateNumber, setPlateNumber] = useState("");
  const [model, setModel] = useState("");
  const [isEv, setIsEv] = useState(false);
  const [pollutionExpiry, setPollutionExpiry] = useState("");

  // UI state
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  // Get user info from Firebase auth
  useEffect(() => {
    const user = auth.currentUser;
    if (user) {
      // Pre-fill name if available from Google sign-in
      if (user.displayName) {
        setName(user.displayName);
      }
    }
  }, []);

  const uploadFile = async (file: File, path: string): Promise<string> => {
    const storageRef = ref(storage, path);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");

    try {
      const user = auth.currentUser;
      if (!user) {
        setError("Not authenticated. Please sign in again.");
        return;
      }

      let kycUrl: string | undefined;
      let licenseUrl: string | undefined;

      // Upload files if driver
      if (role === "driver") {
        if (kycFile) {
          const kycPath = `drivers/${user.uid}/kyc/${Date.now()}_${kycFile.name}`;
          kycUrl = await uploadFile(kycFile, kycPath);
        }
        if (licenseFile) {
          const licensePath = `drivers/${user.uid}/license/${Date.now()}_${licenseFile.name}`;
          licenseUrl = await uploadFile(licenseFile, licensePath);
        }
      }

      const token = await user.getIdToken();

      const payload: Record<string, unknown> = {
        name,
        phone_number: phoneNumber,
        role,
      };

      // Add driver-specific fields
      if (role === "driver") {
        payload.kyc_url = kycUrl;
        payload.license_url = licenseUrl;
        payload.plate_number = plateNumber;
        payload.model = model;
        payload.is_ev = isEv;
        payload.pollution_expiry = pollutionExpiry;
      }

      const response = await fetch(`${backendUrl}/api/v1/user`, {
        body: JSON.stringify(payload),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      if (response.ok) {
        router.push("/dashboard");
      } else {
        const data = await response.json();
        setError(data.message || "Failed to create profile");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setIsLoading(false);
    }
  };

  const handleFileChange = (
    e: React.ChangeEvent<HTMLInputElement>,
    setter: (file: File | null) => void,
  ) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      const validTypes = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
      if (!validTypes.includes(file.type)) {
        setError("Please upload a PDF or JPEG/PNG file");
        return;
      }
      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        setError("File size must be less than 5MB");
        return;
      }
      setter(file);
      setError("");
    }
  };

  const inputStyle = {
    border: "2px solid #e0e0e0",
    borderRadius: "12px",
    boxSizing: "border-box" as const,
    fontSize: "15px",
    outline: "none",
    padding: "14px 16px",
    paddingLeft: "48px",
    transition: "border-color 0.2s",
    width: "100%",
  };

  const labelStyle = {
    color: "#333",
    display: "block",
    fontSize: "14px",
    fontWeight: "500" as const,
    marginBottom: "8px",
  };

  const iconStyle = {
    color: "#4caf50",
    fontSize: "18px",
    left: "16px",
    position: "absolute" as const,
    top: "50%",
    transform: "translateY(-50%)",
  };

  return (
    <main
      style={{
        background: "linear-gradient(135deg, #c8e6c9 0%, #a5d6a7 100%)",
        minHeight: "100vh",
        padding: "40px 20px",
      }}
    >
      <div
        style={{
          background: "white",
          borderRadius: "24px",
          boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
          margin: "0 auto",
          maxWidth: "600px",
          padding: "40px",
        }}
      >
        <div style={{ marginBottom: "32px", textAlign: "center" }}>
          <div
            style={{
              alignItems: "center",
              background: "#2e7d32",
              borderRadius: "50%",
              display: "inline-flex",
              fontSize: "32px",
              height: "64px",
              justifyContent: "center",
              marginBottom: "16px",
              width: "64px",
            }}
          >
            🚗
          </div>
          <h1 style={{ color: "#2d2d2d", fontSize: "28px", fontWeight: "bold", margin: 0 }}>
            Complete Your Profile
          </h1>
          <p style={{ color: "#666", fontSize: "15px", marginTop: "8px" }}>
            Just a few more details to get you started
          </p>
        </div>

        {error && (
          <div
            style={{
              background: "#ffebee",
              borderRadius: "8px",
              color: "#c62828",
              fontSize: "14px",
              marginBottom: "20px",
              padding: "12px 16px",
            }}
          >
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {/* Name Field */}
          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="name" style={labelStyle}>
              Full Name
            </label>
            <div style={{ position: "relative" }}>
              <FaUser style={iconStyle} />
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Enter your full name"
                required
                style={inputStyle}
              />
            </div>
          </div>

          {/* Phone Number Field */}
          <div style={{ marginBottom: "20px" }}>
            <label htmlFor="phoneNumber" style={labelStyle}>
              Phone Number
            </label>
            <div style={{ position: "relative" }}>
              <FaPhone style={iconStyle} />
              <input
                id="phoneNumber"
                type="tel"
                value={phoneNumber}
                onChange={(e) => setPhoneNumber(e.target.value)}
                placeholder="Enter your phone number"
                required
                style={inputStyle}
              />
            </div>
          </div>

          {/* Role Selector */}
          <div style={{ marginBottom: "24px" }}>
            <span style={labelStyle}>I want to join as</span>
            <div style={{ display: "flex", gap: "12px" }}>
              <button
                type="button"
                onClick={() => setRole("rider")}
                style={{
                  alignItems: "center",
                  background: role === "rider" ? "#4caf50" : "white",
                  border: "2px solid",
                  borderColor: role === "rider" ? "#4caf50" : "#e0e0e0",
                  borderRadius: "12px",
                  color: role === "rider" ? "white" : "#333",
                  cursor: "pointer",
                  display: "flex",
                  flex: 1,
                  fontSize: "15px",
                  fontWeight: "600",
                  gap: "8px",
                  justifyContent: "center",
                  padding: "14px 16px",
                  transition: "all 0.2s ease",
                }}
              >
                🚶 Rider
              </button>
              <button
                type="button"
                onClick={() => setRole("driver")}
                style={{
                  alignItems: "center",
                  background: role === "driver" ? "#4caf50" : "white",
                  border: "2px solid",
                  borderColor: role === "driver" ? "#4caf50" : "#e0e0e0",
                  borderRadius: "12px",
                  color: role === "driver" ? "white" : "#333",
                  cursor: "pointer",
                  display: "flex",
                  flex: 1,
                  fontSize: "15px",
                  fontWeight: "600",
                  gap: "8px",
                  justifyContent: "center",
                  padding: "14px 16px",
                  transition: "all 0.2s ease",
                }}
              >
                🚗 Driver
              </button>
            </div>
          </div>

          {/* Driver-specific fields */}
          {role === "driver" && (
            <div
              style={{
                background: "#f9fbe7",
                borderRadius: "16px",
                marginBottom: "24px",
                padding: "24px",
              }}
            >
              <h3
                style={{
                  color: "#33691e",
                  fontSize: "18px",
                  fontWeight: "600",
                  marginBottom: "20px",
                  marginTop: 0,
                }}
              >
                Driver Information
              </h3>

              {/* KYC Document */}
              <div style={{ marginBottom: "20px" }}>
                <label htmlFor="kycFile" style={labelStyle}>
                  <FaIdCard style={{ color: "#4caf50", marginRight: "8px" }} />
                  KYC Document (PDF/JPEG)
                </label>
                <input
                  id="kycFile"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => handleFileChange(e, setKycFile)}
                  style={{
                    border: "2px dashed #c8e6c9",
                    borderRadius: "12px",
                    boxSizing: "border-box",
                    cursor: "pointer",
                    padding: "20px",
                    width: "100%",
                  }}
                />
                {kycFile && (
                  <p style={{ color: "#4caf50", fontSize: "12px", marginTop: "4px" }}>
                    ✓ {kycFile.name}
                  </p>
                )}
              </div>

              {/* Driver License */}
              <div style={{ marginBottom: "20px" }}>
                <label htmlFor="licenseFile" style={labelStyle}>
                  <FaFileAlt style={{ color: "#4caf50", marginRight: "8px" }} />
                  Driver License (PDF/JPEG) *
                </label>
                <input
                  id="licenseFile"
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  onChange={(e) => handleFileChange(e, setLicenseFile)}
                  required={role === "driver"}
                  style={{
                    border: "2px dashed #c8e6c9",
                    borderRadius: "12px",
                    boxSizing: "border-box",
                    cursor: "pointer",
                    padding: "20px",
                    width: "100%",
                  }}
                />
                {licenseFile && (
                  <p style={{ color: "#4caf50", fontSize: "12px", marginTop: "4px" }}>
                    ✓ {licenseFile.name}
                  </p>
                )}
              </div>

              {/* Plate Number */}
              <div style={{ marginBottom: "20px" }}>
                <label htmlFor="plateNumber" style={labelStyle}>
                  Plate Number *
                </label>
                <div style={{ position: "relative" }}>
                  <FaCar style={iconStyle} />
                  <input
                    id="plateNumber"
                    type="text"
                    value={plateNumber}
                    onChange={(e) => setPlateNumber(e.target.value.toUpperCase())}
                    placeholder="e.g., MH12AB1234"
                    required={role === "driver"}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Vehicle Model */}
              <div style={{ marginBottom: "20px" }}>
                <label htmlFor="model" style={labelStyle}>
                  Vehicle Model *
                </label>
                <div style={{ position: "relative" }}>
                  <FaCar style={iconStyle} />
                  <input
                    id="model"
                    type="text"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="e.g., Maruti Swift"
                    required={role === "driver"}
                    style={inputStyle}
                  />
                </div>
              </div>

              {/* Is EV */}
              <div style={{ marginBottom: "20px" }}>
                <label
                  style={{
                    alignItems: "center",
                    cursor: "pointer",
                    display: "flex",
                    gap: "12px",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isEv}
                    onChange={(e) => setIsEv(e.target.checked)}
                    style={{
                      accentColor: "#4caf50",
                      height: "20px",
                      width: "20px",
                    }}
                  />
                  <span style={{ color: "#333", fontSize: "15px", fontWeight: "500" }}>
                    <FaLeaf style={{ color: "#4caf50", marginRight: "8px" }} />
                    This is an Electric Vehicle (EV)
                  </span>
                </label>
              </div>

              {/* Pollution Expiry */}
              <div style={{ marginBottom: "0" }}>
                <label htmlFor="pollutionExpiry" style={labelStyle}>
                  <FaCalendar style={{ color: "#4caf50", marginRight: "8px" }} />
                  Pollution Certificate Expiry *
                </label>
                <input
                  id="pollutionExpiry"
                  type="date"
                  value={pollutionExpiry}
                  onChange={(e) => setPollutionExpiry(e.target.value)}
                  required={role === "driver"}
                  style={{
                    ...inputStyle,
                    paddingLeft: "16px",
                  }}
                />
              </div>
            </div>
          )}

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isLoading}
            style={{
              alignItems: "center",
              background: isLoading
                ? "linear-gradient(135deg, #a5d6a7 0%, #81c784 100%)"
                : "linear-gradient(135deg, #4caf50 0%, #43a047 100%)",
              border: "none",
              borderRadius: "12px",
              boxShadow: "0 4px 15px rgba(76,175,80,0.35)",
              color: "white",
              cursor: isLoading ? "not-allowed" : "pointer",
              display: "flex",
              fontSize: "16px",
              fontWeight: "600",
              gap: "10px",
              height: "52px",
              justifyContent: "center",
              transition: "all 0.2s ease",
              width: "100%",
            }}
          >
            {isLoading ? "Creating Profile..." : "Complete Registration"}
          </button>
        </form>
      </div>
    </main>
  );
}
