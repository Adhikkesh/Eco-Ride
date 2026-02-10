"use client";

import { onAuthStateChanged, signOut, type User, updateProfile } from "firebase/auth";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { getDownloadURL, ref, uploadBytes } from "firebase/storage";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  FaBriefcase,
  FaCamera,
  FaChevronLeft,
  FaEnvelope,
  FaHeart,
  FaHome,
  FaPhone,
  FaSignOutAlt,
  FaSpinner,
  FaUser,
} from "react-icons/fa";
import { Button } from "@/components/ui/button";
import { auth, db, storage } from "@/lib/firebase";

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [darkMode] = useState(true); // Consistent with Dashboard

  // Form State
  const [displayName, setDisplayName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [photoURL, setPhotoURL] = useState("");

  // Saved Places State
  const [homeAddress, setHomeAddress] = useState("");
  const [workAddress, setWorkAddress] = useState("");
  const [favAddress, setFavAddress] = useState("");

  const [initialData, setInitialData] = useState({
    displayName: "",
    favAddress: "",
    homeAddress: "",
    phoneNumber: "",
    workAddress: "",
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (!currentUser) {
        router.push("/");
        return;
      }

      setUser(currentUser);
      setDisplayName(currentUser.displayName || "");
      setPhotoURL(currentUser.photoURL || "");

      try {
        if (db) {
          const userDoc = await getDoc(doc(db, "users", currentUser.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            const phone = userData.phoneNumber || "";
            const hAddress = userData.homeAddress || "";
            const wAddress = userData.workAddress || "";
            const fAddress = userData.favAddress || "";

            setPhoneNumber(phone);
            setHomeAddress(hAddress);
            setWorkAddress(wAddress);
            setFavAddress(fAddress);

            setInitialData({
              displayName: currentUser.displayName || "",
              favAddress: fAddress,
              homeAddress: hAddress,
              phoneNumber: phone,
              workAddress: wAddress,
            });
          }
        }
      } catch (error) {
        console.error("Error fetching user data:", error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, [router]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;

    setSaving(true);
    try {
      await updateProfile(user, {
        displayName: displayName,
        photoURL: photoURL,
      });

      if (db) {
        const userRef = doc(db, "users", user.uid);
        await updateDoc(userRef, {
          displayName: displayName,
          favAddress: favAddress,
          homeAddress: homeAddress,
          phoneNumber: phoneNumber,
          photoURL: photoURL,
          workAddress: workAddress,
        });
      }

      setInitialData({
        displayName,
        favAddress,
        homeAddress,
        phoneNumber,
        workAddress,
      });
      setIsEditing(false);
      alert("Profile updated successfully!");
    } catch (error) {
      console.error("Error updating profile:", error);
      alert("Failed to update profile. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setDisplayName(initialData.displayName);
    setPhoneNumber(initialData.phoneNumber);
    setHomeAddress(initialData.homeAddress);
    setWorkAddress(initialData.workAddress);
    setFavAddress(initialData.favAddress);
    setIsEditing(false);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      router.push("/");
    } catch (error) {
      console.error("Error logging out:", error);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target?.files?.[0] && user) {
      const file = e.target.files[0];
      const storageRef = ref(storage, `profile-pictures/${user.uid}`);

      try {
        setSaving(true);
        const snapshot = await uploadBytes(storageRef, file);
        const downloadURL = await getDownloadURL(snapshot.ref);

        setPhotoURL(downloadURL);

        await updateProfile(user, { photoURL: downloadURL });
        if (db) {
          await updateDoc(doc(db, "users", user.uid), { photoURL: downloadURL });
        }
      } catch (error) {
        console.error("Error uploading image:", error);
        alert("Failed to upload image.");
      } finally {
        setSaving(false);
      }
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
            animation: "spin 1s linear infinite",
            border: "3px solid rgba(34, 197, 94, 0.3)",
            borderRadius: "50%",
            borderTopColor: "#22c55e",
            height: "48px",
            width: "48px",
          }}
        />
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
        paddingBottom: "80px",
        transition: "background 0.3s ease",
      }}
    >
      {/* Header */}
      <header
        style={{
          backdropFilter: "blur(12px)",
          background: darkMode ? "rgba(30, 41, 59, 0.95)" : "rgba(255, 255, 255, 0.95)",
          borderBottom: darkMode
            ? "1px solid rgba(71, 85, 105, 0.5)"
            : "1px solid rgba(203, 213, 225, 0.5)",
          padding: "16px 24px",
          position: "sticky",
          top: 0,
          zIndex: 100,
        }}
      >
        <div className="max-w-4xl mx-auto flex items-center" style={{ gap: "32px" }}>
          <button
            type="button"
            onClick={() => router.back()}
            style={{
              alignItems: "center",
              background: darkMode ? "rgba(15, 23, 42, 0.8)" : "#ffffff",
              border: darkMode
                ? "1px solid rgba(255, 255, 255, 0.1)"
                : "1px solid rgba(0, 0, 0, 0.1)",
              borderRadius: "14px",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
              color: darkMode ? "white" : "#1e293b",
              cursor: "pointer",
              display: "flex",
              height: "42px",
              justifyContent: "center",
              transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
              width: "42px",
            }}
            onMouseEnter={(e) => {
              const target = e.currentTarget;
              target.style.background = "#22c55e";
              target.style.borderColor = "#22c55e";
              target.style.transform = "translateX(-4px)";
            }}
            onMouseLeave={(e) => {
              const target = e.currentTarget;
              target.style.background = darkMode ? "rgba(15, 23, 42, 0.8)" : "#ffffff";
              target.style.borderColor = darkMode
                ? "rgba(255, 255, 255, 0.1)"
                : "rgba(0, 0, 0, 0.1)";
              target.style.transform = "translateX(0)";
            }}
          >
            <FaChevronLeft size={16} />
          </button>
          <h1
            style={{
              color: darkMode ? "white" : "#1e293b",
              fontSize: "22px",
              fontWeight: "700",
              letterSpacing: "-0.01em",
            }}
          >
            Profile
          </h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto p-6 md:p-8">
        <form
          onSubmit={handleSave}
          style={{ display: "flex", flexDirection: "column", gap: "40px" }}
        >
          {/* Avatar Section */}
          <div
            style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: "16px" }}
          >
            <div
              style={{
                background: darkMode ? "#1e293b" : "#f1f5f9",
                border: "4px solid #22c55e",
                borderRadius: "50%",
                height: "128px",
                overflow: "hidden",
                position: "relative",
                width: "128px",
              }}
            >
              {photoURL ? (
                <Image src={photoURL} alt="Profile" fill style={{ objectFit: "cover" }} />
              ) : (
                <div
                  style={{
                    alignItems: "center",
                    color: "#94a3b8",
                    display: "flex",
                    height: "100%",
                    justifyContent: "center",
                    width: "100%",
                  }}
                >
                  <FaUser size={48} />
                </div>
              )}
              {isEditing && (
                <label
                  htmlFor="photo-upload"
                  style={{
                    alignItems: "center",
                    background: "rgba(0,0,0,0.4)",
                    cursor: "pointer",
                    display: "flex",
                    inset: 0,
                    justifyContent: "center",
                    opacity: 0,
                    position: "absolute",
                    transition: "opacity 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "1";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "0";
                  }}
                >
                  <FaCamera color="white" size={24} />
                  <input
                    id="photo-upload"
                    type="file"
                    accept="image/*"
                    style={{ display: "none" }}
                    onChange={handlePhotoUpload}
                  />
                </label>
              )}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
            {/* Personal Information */}
            <div
              style={{
                backdropFilter: "blur(12px)",
                background: darkMode ? "rgba(30, 41, 59, 0.7)" : "white",
                border: darkMode ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.1)",
                borderRadius: "24px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
                display: "flex",
                flexDirection: "column",
                gap: "24px",
                padding: "32px",
              }}
            >
              <h2
                style={{
                  color: "#22c55e",
                  fontSize: "16px",
                  fontWeight: "600",
                  marginBottom: "8px",
                }}
              >
                Personal Information
              </h2>

              {/* Name field */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label
                  htmlFor="display-name"
                  style={{
                    color: darkMode ? "#94a3b8" : "#64748b",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  Full Name
                </label>
                <div
                  style={{
                    alignItems: "center",
                    background: darkMode ? "rgba(15, 23, 42, 0.6)" : "#f8fafc",
                    border: isEditing ? "1px solid #22c55e" : "1px solid transparent",
                    borderRadius: "12px",
                    display: "flex",
                    opacity: isEditing ? 1 : 0.8,
                    padding: "0 16px",
                    transition: "all 0.2s",
                  }}
                >
                  <FaUser color="#94a3b8" style={{ marginRight: "12px" }} />
                  <input
                    id="display-name"
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    readOnly={!isEditing}
                    style={{
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                      color: darkMode ? "white" : "#1e293b",
                      cursor: isEditing ? "text" : "default",
                      flex: 1,
                      fontSize: "16px",
                      outline: "none",
                      padding: "16px 0",
                    }}
                  />
                </div>
              </div>

              {/* Phone field */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label
                  htmlFor="phone-number"
                  style={{
                    color: darkMode ? "#94a3b8" : "#64748b",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  Phone Number
                </label>
                <div
                  style={{
                    alignItems: "center",
                    background: darkMode ? "rgba(15, 23, 42, 0.6)" : "#f8fafc",
                    border: isEditing ? "1px solid #22c55e" : "1px solid transparent",
                    borderRadius: "12px",
                    display: "flex",
                    opacity: isEditing ? 1 : 0.8,
                    padding: "0 16px",
                    transition: "all 0.2s",
                  }}
                >
                  <FaPhone color="#94a3b8" style={{ marginRight: "12px" }} />
                  <input
                    id="phone-number"
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    readOnly={!isEditing}
                    style={{
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                      color: darkMode ? "white" : "#1e293b",
                      cursor: isEditing ? "text" : "default",
                      flex: 1,
                      fontSize: "16px",
                      outline: "none",
                      padding: "16px 0",
                    }}
                  />
                </div>
              </div>

              {/* Email field (Read Only) */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label
                  htmlFor="email"
                  style={{
                    color: darkMode ? "#94a3b8" : "#64748b",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  Email Address
                </label>
                <div
                  style={{
                    alignItems: "center",
                    background: darkMode ? "rgba(15, 23, 42, 0.4)" : "#f1f5f9",
                    borderRadius: "12px",
                    display: "flex",
                    opacity: 0.6,
                    padding: "0 16px",
                  }}
                >
                  <FaEnvelope color="#94a3b8" style={{ marginRight: "12px" }} />
                  <input
                    id="email"
                    type="email"
                    value={user?.email || ""}
                    readOnly
                    style={{
                      background: "transparent",
                      border: "none",
                      color: "#94a3b8",
                      cursor: "not-allowed",
                      flex: 1,
                      fontSize: "16px",
                      outline: "none",
                      padding: "16px 0",
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Saved Places */}
            <div
              style={{
                backdropFilter: "blur(12px)",
                background: darkMode ? "rgba(30, 41, 59, 0.7)" : "white",
                border: darkMode ? "1px solid rgba(255,255,255,0.1)" : "1px solid rgba(0,0,0,0.1)",
                borderRadius: "24px",
                boxShadow: "0 10px 30px rgba(0,0,0,0.2)",
                display: "flex",
                flexDirection: "column",
                gap: "24px",
                padding: "32px",
              }}
            >
              <h2
                style={{
                  color: "#22c55e",
                  fontSize: "16px",
                  fontWeight: "600",
                  marginBottom: "8px",
                }}
              >
                Saved Places
              </h2>

              {/* Home */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label
                  htmlFor="home-address"
                  style={{
                    color: darkMode ? "#94a3b8" : "#64748b",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  Home
                </label>
                <div
                  style={{
                    alignItems: "center",
                    background: darkMode ? "rgba(15, 23, 42, 0.6)" : "#f8fafc",
                    border: isEditing ? "1px solid #22c55e" : "1px solid transparent",
                    borderRadius: "12px",
                    display: "flex",
                    opacity: isEditing ? 1 : 0.8,
                    padding: "0 16px",
                    transition: "all 0.2s",
                  }}
                >
                  <FaHome color="#94a3b8" style={{ marginRight: "12px" }} />
                  <input
                    id="home-address"
                    type="text"
                    placeholder="Add home address"
                    value={homeAddress}
                    onChange={(e) => setHomeAddress(e.target.value)}
                    readOnly={!isEditing}
                    style={{
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                      color: darkMode ? "white" : "#1e293b",
                      cursor: isEditing ? "text" : "default",
                      flex: 1,
                      fontSize: "14px",
                      outline: "none",
                      padding: "14px 0",
                    }}
                  />
                </div>
              </div>

              {/* Work */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label
                  htmlFor="work-address"
                  style={{
                    color: darkMode ? "#94a3b8" : "#64748b",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  Work
                </label>
                <div
                  style={{
                    alignItems: "center",
                    background: darkMode ? "rgba(15, 23, 42, 0.6)" : "#f8fafc",
                    border: isEditing ? "1px solid #22c55e" : "1px solid transparent",
                    borderRadius: "12px",
                    display: "flex",
                    opacity: isEditing ? 1 : 0.8,
                    padding: "0 16px",
                    transition: "all 0.2s",
                  }}
                >
                  <FaBriefcase color="#94a3b8" style={{ marginRight: "12px" }} />
                  <input
                    id="work-address"
                    type="text"
                    placeholder="Add work address"
                    value={workAddress}
                    onChange={(e) => setWorkAddress(e.target.value)}
                    readOnly={!isEditing}
                    style={{
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                      color: darkMode ? "white" : "#1e293b",
                      cursor: isEditing ? "text" : "default",
                      flex: 1,
                      fontSize: "14px",
                      outline: "none",
                      padding: "14px 0",
                    }}
                  />
                </div>
              </div>

              {/* Favourite */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <label
                  htmlFor="fav-address"
                  style={{
                    color: darkMode ? "#94a3b8" : "#64748b",
                    fontSize: "14px",
                    fontWeight: "600",
                  }}
                >
                  Favourite
                </label>
                <div
                  style={{
                    alignItems: "center",
                    background: darkMode ? "rgba(15, 23, 42, 0.6)" : "#f8fafc",
                    border: isEditing ? "1px solid #22c55e" : "1px solid transparent",
                    borderRadius: "12px",
                    display: "flex",
                    opacity: isEditing ? 1 : 0.8,
                    padding: "0 16px",
                    transition: "all 0.2s",
                  }}
                >
                  <FaHeart color="#ef4444" style={{ marginRight: "12px" }} />
                  <input
                    id="fav-address"
                    type="text"
                    placeholder="Add a favourite place"
                    value={favAddress}
                    onChange={(e) => setFavAddress(e.target.value)}
                    readOnly={!isEditing}
                    style={{
                      background: "transparent",
                      border: "none",
                      boxShadow: "none",
                      color: darkMode ? "white" : "#1e293b",
                      cursor: isEditing ? "text" : "default",
                      flex: 1,
                      fontSize: "14px",
                      outline: "none",
                      padding: "14px 0",
                    }}
                  />
                </div>
              </div>
            </div>
          </div>

          <div
            style={{ alignItems: "center", display: "flex", flexDirection: "column", gap: "24px" }}
          >
            <div style={{ display: "flex", gap: "16px", justifyContent: "center" }}>
              {!isEditing ? (
                <Button
                  type="button"
                  onClick={() => setIsEditing(true)}
                  style={{
                    background: "rgba(34, 197, 94, 0.1)",
                    border: "1px solid #22c55e",
                    borderRadius: "12px",
                    color: "#22c55e",
                    fontSize: "14px",
                    fontWeight: "600",
                    height: "auto",
                    padding: "12px 24px",
                    transition: "all 0.2s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#22c55e";
                    e.currentTarget.style.color = "white";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "rgba(34, 197, 94, 0.1)";
                    e.currentTarget.style.color = "#22c55e";
                  }}
                >
                  Edit Profile
                </Button>
              ) : (
                <>
                  <Button
                    type="button"
                    onClick={handleCancel}
                    variant="outline"
                    style={{
                      borderColor: darkMode ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)",
                      borderRadius: "12px",
                      color: darkMode ? "#94a3b8" : "#64748b",
                      fontSize: "14px",
                      fontWeight: "600",
                      height: "auto",
                      padding: "12px 24px",
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    disabled={saving}
                    style={{
                      background: "linear-gradient(135deg, #22c55e, #10b981)",
                      borderRadius: "12px",
                      boxShadow: "0 4px 12px rgba(34, 197, 94, 0.2)",
                      color: "white",
                      fontSize: "14px",
                      fontWeight: "600",
                      height: "auto",
                      padding: "12px 24px",
                    }}
                  >
                    {saving ? <FaSpinner className="animate-spin" /> : "Save Profile"}
                  </Button>
                </>
              )}
            </div>

            {/* Logout Button */}
            {!isEditing && (
              <button
                type="button"
                onClick={handleLogout}
                style={{
                  alignItems: "center",
                  background: "transparent",
                  border: "1px solid rgba(239, 68, 68, 0.3)",
                  borderRadius: "12px",
                  color: "#ef4444",
                  cursor: "pointer",
                  display: "flex",
                  fontSize: "14px",
                  fontWeight: "600",
                  gap: "8px",
                  padding: "10px 20px",
                  transition: "all 0.2s",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(239, 68, 68, 0.1)";
                  e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.6)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.borderColor = "rgba(239, 68, 68, 0.3)";
                }}
              >
                <FaSignOutAlt />
                Logout
              </button>
            )}
          </div>
        </form>
      </main>
    </div>
  );
}
