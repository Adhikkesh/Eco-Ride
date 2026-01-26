"use client";

import {
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signInWithPopup,
} from "firebase/auth";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  FaDollarSign,
  FaEnvelope,
  FaFacebookF,
  FaGift,
  FaInstagram,
  FaLeaf,
  FaShieldAlt,
  FaTwitter,
  FaUsers,
} from "react-icons/fa";
import { auth, googleProvider } from "@/lib/firebase";
import { backendUrl } from "../config";

// Prevent static generation - this page requires Firebase auth
export const dynamic = "force-dynamic";

export default function Home(): React.ReactNode {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [error, setError] = useState("");
  const [googleHover, setGoogleHover] = useState(false);
  const [emailFocus, setEmailFocus] = useState(false);
  const [passwordFocus, setPasswordFocus] = useState(false);
  const [submitHover, setSubmitHover] = useState(false);

  // Ref to track if we're in the middle of a signup flow
  const isSigningUp = useRef(false);

  // Check if user is already authenticated AND exists in backend on page load
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      // Skip auto-redirect if we're in the middle of signing up
      if (isSigningUp.current) {
        setIsCheckingAuth(false);
        return;
      }

      if (user) {
        try {
          const token = await user.getIdToken();
          const response = await fetch(`${backendUrl}/auth/verify`, {
            headers: {
              Authorization: `Bearer ${token}`,
            },
            method: "GET",
          });

          // Only redirect to dashboard if user exists in backend (verified)
          // If response is not ok (e.g., 404 for new users), stay on page
          if (response.ok) {
            const data = await response.json();
            // Check if user actually exists in backend database
            if (data?.user) {
              router.push("/dashboard");
              return;
            }
          }
        } catch {
          // Token verification failed, user needs to login again
        }
      }
      setIsCheckingAuth(false);
    });

    return () => unsubscribe();
  }, [router]);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError("");

    // Set flag to prevent onAuthStateChanged from redirecting during signup
    isSigningUp.current = true;

    try {
      const result = await signInWithPopup(auth, googleProvider);
      const details = getAdditionalUserInfo(result);
      const user = result.user;
      if (!user) return;

      if (details?.isNewUser) {
        // New user - redirect to onboarding
        router.push("/onboarding");
      } else {
        // Existing user - redirect to dashboard
        isSigningUp.current = false;
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      isSigningUp.current = false;
      setError(err instanceof Error ? err.message : "Google sign-in failed");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    try {
      if (isSignUp) {
        // Set flag to prevent onAuthStateChanged from redirecting during signup
        isSigningUp.current = true;

        // New user signup - redirect to onboarding
        await createUserWithEmailAndPassword(auth, email, password);
        router.push("/onboarding");
      } else {
        // Existing user sign in - redirect to dashboard
        await signInWithEmailAndPassword(auth, email, password);
        router.push("/dashboard");
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Authentication failed";
      if (message.includes("user-not-found")) {
        setError("No account found with this email. Please sign up.");
      } else if (message.includes("wrong-password")) {
        setError("Incorrect password. Please try again.");
      } else if (message.includes("email-already-in-use")) {
        setError("An account already exists with this email. Please sign in.");
      } else if (message.includes("weak-password")) {
        setError("Password should be at least 6 characters.");
      } else if (message.includes("invalid-email")) {
        setError("Please enter a valid email address.");
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Show loading state while checking authentication
  if (isCheckingAuth) {
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
    <main
      style={{
        background: "linear-gradient(135deg, #c8e6c9 0%, #a5d6a7 100%)",
        minHeight: "100vh",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <div className="bird bird-1" />
      <div className="bird bird-2" />
      <div className="bird bird-3" />

      {/* Trees */}
      <div
        style={{
          bottom: "10%",
          fontSize: "120px",
          left: "5%",
          opacity: "0.15",
          position: "absolute",
          zIndex: 0,
        }}
      >
        🌳
      </div>

      <div
        style={{
          fontSize: "100px",
          opacity: "0.15",
          position: "absolute",
          right: "8%",
          top: "20%",
          zIndex: 0,
        }}
      >
        🌲
      </div>

      {/* Road SVG decoration */}
      <svg
        aria-hidden="true"
        style={{
          bottom: 0,
          height: "150px",
          left: 0,
          opacity: "0.1",
          position: "absolute",
          width: "100%",
          zIndex: 0,
        }}
        viewBox="0 0 1200 150"
      >
        <path
          d="M0,75 Q300,50 600,75 T1200,75"
          stroke="#555"
          strokeWidth="40"
          fill="none"
          strokeDasharray="60,40"
        />
      </svg>

      <div
        style={{
          margin: "0 auto",
          maxWidth: "1400px",
          padding: "24px",
          position: "relative",
          zIndex: 10,
        }}
      >
        {/* Header */}
        <header
          style={{
            background: "white",
            borderRadius: "16px",
            boxShadow: "0 1px 3px rgba(0,0,0,0.1)",
            marginBottom: "48px",
            padding: "16px 32px",
          }}
        >
          <nav style={{ alignItems: "center", display: "flex", justifyContent: "space-between" }}>
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

            <ul
              style={{
                alignItems: "center",
                color: "#555",
                display: "flex",
                fontSize: "15px",
                gap: "32px",
                listStyle: "none",
              }}
            >
              <li>Features</li>
              <li>How it Works</li>
              <li>Pricing</li>
              <li>About Us</li>
              <li>Safety</li>
              <li>Blog</li>
              <li>Help</li>
              <li>Contact</li>
            </ul>

            <button
              type="button"
              style={{
                background: "#4caf50",
                border: "none",
                borderRadius: "25px",
                color: "white",
                cursor: "pointer",
                fontSize: "15px",
                fontWeight: "600",
                padding: "12px 32px",
              }}
            >
              Get Started
            </button>
          </nav>
        </header>

        {/* Main Content */}
        <div
          style={{
            alignItems: "start",
            display: "grid",
            gap: "48px",
            gridTemplateColumns: "1fr 1fr",
          }}
        >
          {/* Left Side - Content */}
          <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
            <h1
              style={{
                color: "#2d2d2d",
                fontSize: "56px",
                fontWeight: "bold",
                lineHeight: "1.2",
                marginBottom: "16px",
              }}
            >
              Ride Green, Save Green, Live Green
            </h1>

            <p style={{ color: "#666", fontSize: "18px", lineHeight: "1.6" }}>
              Join the sustainable mobility revolution with smart carpooling, eco-friendly routes,
              and rewards for every green mile you travel.
            </p>

            {/* Features Grid */}
            <div
              style={{
                display: "grid",
                gap: "16px",
                gridTemplateColumns: "1fr 1fr",
                marginTop: "16px",
              }}
            >
              <div
                style={{
                  background: "white",
                  borderRadius: "12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  padding: "20px",
                }}
              >
                <FaLeaf style={{ color: "#4caf50", fontSize: "24px", marginBottom: "8px" }} />
                <h3
                  style={{
                    color: "#333",
                    fontSize: "16px",
                    fontWeight: "600",
                    marginBottom: "4px",
                  }}
                >
                  Eco-Smart Routing
                </h3>
                <p style={{ color: "#777", fontSize: "13px" }}>
                  Optimized routes for less emissions
                </p>
              </div>

              <div
                style={{
                  background: "white",
                  borderRadius: "12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  padding: "20px",
                }}
              >
                <FaUsers style={{ color: "#4caf50", fontSize: "24px", marginBottom: "8px" }} />
                <h3
                  style={{
                    color: "#333",
                    fontSize: "16px",
                    fontWeight: "600",
                    marginBottom: "4px",
                  }}
                >
                  One-Click Pooling
                </h3>
                <p style={{ color: "#777", fontSize: "13px" }}>Share rides instantly</p>
              </div>

              <div
                style={{
                  background: "white",
                  borderRadius: "12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  padding: "20px",
                }}
              >
                <FaShieldAlt style={{ color: "#4caf50", fontSize: "24px", marginBottom: "8px" }} />
                <h3
                  style={{
                    color: "#333",
                    fontSize: "16px",
                    fontWeight: "600",
                    marginBottom: "4px",
                  }}
                >
                  Trusted & Verified
                </h3>
                <p style={{ color: "#777", fontSize: "13px" }}>Background-checked drivers</p>
              </div>

              <div
                style={{
                  background: "white",
                  borderRadius: "12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                  padding: "20px",
                }}
              >
                <FaDollarSign style={{ color: "#4caf50", fontSize: "24px", marginBottom: "8px" }} />
                <h3
                  style={{
                    color: "#333",
                    fontSize: "16px",
                    fontWeight: "600",
                    marginBottom: "4px",
                  }}
                >
                  Fair Surge Pricing
                </h3>
                <p style={{ color: "#777", fontSize: "13px" }}>Transparent and reasonable</p>
              </div>
            </div>

            <div
              style={{
                alignItems: "center",
                background: "white",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                display: "flex",
                gap: "16px",
                padding: "20px 24px",
              }}
            >
              <FaGift style={{ color: "#4caf50", fontSize: "32px" }} />
              <div>
                <h3
                  style={{
                    color: "#333",
                    fontSize: "18px",
                    fontWeight: "600",
                    marginBottom: "4px",
                  }}
                >
                  Green Rewards
                </h3>
                <p style={{ color: "#777", fontSize: "14px" }}>
                  Earn points for every eco-friendly ride and redeem for discounts
                </p>
              </div>
            </div>

            {/* Social Media */}
            <div style={{ paddingTop: "16px" }}>
              <p style={{ color: "#666", fontWeight: "500", marginBottom: "16px" }}>Follow us on</p>
              <div style={{ display: "flex", gap: "16px" }}>
                <a
                  href="/"
                  style={{
                    alignItems: "center",
                    background: "#4caf50",
                    borderRadius: "6px",
                    color: "white",
                    display: "flex",
                    height: "40px",
                    justifyContent: "center",
                    textDecoration: "none",
                    width: "40px",
                  }}
                >
                  <FaFacebookF />
                </a>
                <a
                  href="/"
                  style={{
                    alignItems: "center",
                    background: "#4caf50",
                    borderRadius: "6px",
                    color: "white",
                    display: "flex",
                    height: "40px",
                    justifyContent: "center",
                    textDecoration: "none",
                    width: "40px",
                  }}
                >
                  <FaInstagram />
                </a>
                <a
                  href="/"
                  style={{
                    alignItems: "center",
                    background: "#4caf50",
                    borderRadius: "6px",
                    color: "white",
                    display: "flex",
                    height: "40px",
                    justifyContent: "center",
                    textDecoration: "none",
                    width: "40px",
                  }}
                >
                  <FaTwitter />
                </a>
              </div>
            </div>
          </div>

          {/* Right Side - Login Form */}
          <div style={{ position: "relative" }}>
            <div
              style={{
                background: "white",
                borderRadius: "24px",
                boxShadow: "0 10px 40px rgba(0,0,0,0.1)",
                marginLeft: "auto",
                maxWidth: "420px",
                padding: "40px",
              }}
            >
              <h2
                style={{
                  color: "#2d2d2d",
                  fontSize: "28px",
                  fontWeight: "bold",
                  marginBottom: "8px",
                  textAlign: "center",
                }}
              >
                {isSignUp ? "Create Account" : "Welcome Back"}
              </h2>
              <p
                style={{
                  color: "#666",
                  fontSize: "15px",
                  marginBottom: "32px",
                  textAlign: "center",
                }}
              >
                {isSignUp
                  ? "Start your green journey today"
                  : "Sign in to continue your green journey"}
              </p>

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

              {/* Google Login Button - Official styling */}
              <button
                type="button"
                onClick={handleGoogleLogin}
                disabled={isLoading}
                onMouseEnter={() => setGoogleHover(true)}
                onMouseLeave={() => setGoogleHover(false)}
                style={{
                  alignItems: "center",
                  background: googleHover && !isLoading ? "#f8f9fa" : "white",
                  border: "2px solid",
                  borderColor: googleHover && !isLoading ? "#dadce0" : "#e0e0e0",
                  borderRadius: "12px",
                  color: "#3c4043",
                  cursor: isLoading ? "not-allowed" : "pointer",
                  display: "flex",
                  fontSize: "15px",
                  fontWeight: "600",
                  gap: "12px",
                  justifyContent: "center",
                  marginBottom: "16px",
                  padding: "14px 24px",
                  transition: "all 0.2s ease",
                  width: "100%",
                }}
              >
                {/* Google Icon */}
                <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
                  <path
                    fill="#4285F4"
                    d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  />
                  <path
                    fill="#34A853"
                    d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  />
                  <path
                    fill="#FBBC05"
                    d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                  />
                  <path
                    fill="#EA4335"
                    d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  />
                </svg>
                Continue with Google
              </button>

              <div
                style={{
                  alignItems: "center",
                  display: "flex",
                  gap: "16px",
                  margin: "24px 0",
                }}
              >
                <div style={{ background: "#e0e0e0", flex: 1, height: "1px" }} />
                <span style={{ color: "#999", fontSize: "14px" }}>or</span>
                <div style={{ background: "#e0e0e0", flex: 1, height: "1px" }} />
              </div>

              {/* Email Login Form */}
              <form onSubmit={handleEmailAuth}>
                <div style={{ marginBottom: "16px" }}>
                  <label
                    htmlFor="email"
                    style={{
                      color: "#333",
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      marginBottom: "8px",
                    }}
                  >
                    Email
                  </label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    required
                    onFocus={() => setEmailFocus(true)}
                    onBlur={() => setEmailFocus(false)}
                    style={{
                      border: "2px solid",
                      borderColor: emailFocus ? "#4caf50" : "#e0e0e0",
                      borderRadius: "12px",
                      boxSizing: "border-box",
                      fontSize: "15px",
                      outline: "none",
                      padding: "14px 16px",
                      transition: "border-color 0.2s",
                      width: "100%",
                    }}
                  />
                </div>

                <div style={{ marginBottom: "24px" }}>
                  <label
                    htmlFor="password"
                    style={{
                      color: "#333",
                      display: "block",
                      fontSize: "14px",
                      fontWeight: "500",
                      marginBottom: "8px",
                    }}
                  >
                    Password
                  </label>
                  <input
                    id="password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    required
                    minLength={6}
                    onFocus={() => setPasswordFocus(true)}
                    onBlur={() => setPasswordFocus(false)}
                    style={{
                      border: "2px solid",
                      borderColor: passwordFocus ? "#4caf50" : "#e0e0e0",
                      borderRadius: "12px",
                      boxSizing: "border-box",
                      fontSize: "15px",
                      outline: "none",
                      padding: "14px 16px",
                      transition: "border-color 0.2s",
                      width: "100%",
                    }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  onMouseEnter={() => setSubmitHover(true)}
                  onMouseLeave={() => setSubmitHover(false)}
                  style={{
                    alignItems: "center",
                    background: isLoading
                      ? "linear-gradient(135deg, #a5d6a7 0%, #81c784 100%)"
                      : "linear-gradient(135deg, #4caf50 0%, #43a047 100%)",
                    border: "none",
                    borderRadius: "12px",
                    boxShadow:
                      submitHover && !isLoading
                        ? "0 6px 20px rgba(76,175,80,0.45)"
                        : "0 4px 15px rgba(76,175,80,0.35)",
                    color: "white",
                    cursor: isLoading ? "not-allowed" : "pointer",
                    display: "flex",
                    fontSize: "16px",
                    fontWeight: "600",
                    gap: "10px",
                    height: "52px",
                    justifyContent: "center",
                    transform: submitHover && !isLoading ? "translateY(-2px)" : "translateY(0)",
                    transition: "all 0.2s ease",
                    width: "100%",
                  }}
                >
                  <FaEnvelope style={{ fontSize: "18px" }} />
                  {isLoading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
                </button>
              </form>

              <p
                style={{
                  color: "#666",
                  fontSize: "14px",
                  marginTop: "24px",
                  textAlign: "center",
                }}
              >
                {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
                <button
                  type="button"
                  onClick={() => {
                    setIsSignUp(!isSignUp);
                    setError("");
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#4caf50",
                    cursor: "pointer",
                    fontWeight: "600",
                    padding: 0,
                  }}
                >
                  {isSignUp ? "Sign In" : "Sign Up"}
                </button>
              </p>

              <p
                style={{
                  color: "#888",
                  fontSize: "13px",
                  marginTop: "12px",
                  textAlign: "center",
                }}
              >
                <a
                  href="/Admin/verification"
                  style={{
                    color: "#666",
                    cursor: "pointer",
                    textDecoration: "underline",
                  }}
                >
                  Login as Admin
                </a>
              </p>

              <p
                style={{
                  color: "#999",
                  fontSize: "12px",
                  lineHeight: "1.6",
                  marginTop: "20px",
                  textAlign: "center",
                }}
              >
                By continuing, you agree to our{" "}
                <a href="/" style={{ color: "#4caf50", textDecoration: "none" }}>
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="/" style={{ color: "#4caf50", textDecoration: "none" }}>
                  Privacy Policy
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
