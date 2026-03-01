"use client";

import { useEffect } from "react";

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactNode {
  useEffect(() => {
    console.error("Dashboard error:", error);
  }, [error]);

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
          background: "rgba(30, 41, 59, 0.95)",
          border: "1px solid rgba(239, 68, 68, 0.3)",
          borderRadius: "24px",
          maxWidth: "480px",
          padding: "40px",
          textAlign: "center",
          width: "90%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            background: "rgba(239, 68, 68, 0.1)",
            borderRadius: "50%",
            display: "flex",
            height: "64px",
            justifyContent: "center",
            margin: "0 auto 20px",
            width: "64px",
          }}
        >
          <span style={{ fontSize: "32px" }}>⚠️</span>
        </div>
        <h2
          style={{
            color: "#f87171",
            fontSize: "22px",
            fontWeight: 700,
            margin: "0 0 12px",
          }}
        >
          Dashboard Error
        </h2>
        <p
          style={{
            color: "#94a3b8",
            fontSize: "14px",
            lineHeight: "1.6",
            margin: "0 0 8px",
          }}
        >
          Something went wrong while loading the dashboard.
        </p>
        <p
          style={{
            color: "#64748b",
            fontFamily: "monospace",
            fontSize: "12px",
            margin: "0 0 24px",
            wordBreak: "break-word",
          }}
        >
          {error.message}
        </p>
        <button
          type="button"
          onClick={reset}
          style={{
            background: "linear-gradient(135deg, #3b82f6, #2563eb)",
            border: "none",
            borderRadius: "12px",
            color: "white",
            cursor: "pointer",
            fontSize: "16px",
            fontWeight: 600,
            padding: "14px 28px",
            transition: "all 0.2s",
            width: "100%",
          }}
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
