"use client";

import type React from "react";
import { useState } from "react";
import { FaStar, FaTimes } from "react-icons/fa";
import { backendUrl } from "@/config";
import { auth } from "@/lib/firebase";

interface RatingModalProps {
  rideId: string;
  driverId: string;
  driverName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const RatingModal: React.FC<RatingModalProps> = ({
  rideId,
  driverId,
  driverName,
  onClose,
  onSuccess,
}) => {
  const [rating, setRating] = useState<number>(4);
  const [hover, setHover] = useState<number>(0);
  const [comment, setComment] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);

    try {
      const user = auth?.currentUser;
      if (!user) {
        setError("Please login to submit rating");
        return;
      }

      const token = await user.getIdToken();
      const response = await fetch(`${backendUrl}/ride/rate`, {
        body: JSON.stringify({
          comment,
          driverId,
          rating,
          rideId,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      });

      const data = await response.json();

      if (response.ok) {
        onSuccess();
      } else {
        setError(data.message || "Failed to submit rating");
      }
    } catch (err) {
      console.error("Submit Rating Error:", err);
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div style={styles.overlay}>
      <div style={styles.modal}>
        <button type="button" onClick={onClose} style={styles.closeButton}>
          <FaTimes />
        </button>

        <div style={styles.header}>
          <h2 style={styles.title}>Rate Your Trip</h2>
          <p style={styles.subtitle}>How was your ride with {driverName}?</p>
        </div>

        <div style={styles.starContainer}>
          {[1, 2, 3, 4, 5].map((star) => (
            <FaStar
              key={star}
              size={40}
              style={{
                color: star <= (hover || rating) ? "#fbbf24" : "#475569",
                cursor: "pointer",
                transition: "color 0.2s",
              }}
              onClick={() => setRating(star)}
              onMouseEnter={() => setHover(star)}
              onMouseLeave={() => setHover(0)}
            />
          ))}
        </div>

        <div style={styles.feedbackText}>
          {rating === 1 && "Terrible"}
          {rating === 2 && "Poor"}
          {rating === 3 && "Good"}
          {rating === 4 && "Very Good"}
          {rating === 5 && "Excellent!"}
        </div>

        <div style={styles.commentSection}>
          <label htmlFor="rating-comment" style={styles.label}>
            Additional Comments (Optional)
          </label>
          <textarea
            id="rating-comment"
            style={styles.textarea}
            placeholder="Tell us more about your experience..."
            value={comment}
            onChange={(e) => setComment(e.target.value)}
          />
        </div>

        {error && <div style={styles.error}>{error}</div>}

        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSubmitting}
          style={isSubmitting ? styles.submitButtonDisabled : styles.submitButton}
        >
          {isSubmitting ? "Submitting..." : "Submit Rating"}
        </button>
      </div>
    </div>
  );
};

const styles = {
  closeButton: {
    background: "none",
    border: "none",
    color: "#94a3b8",
    cursor: "pointer",
    fontSize: "20px",
    position: "absolute" as const,
    right: "20px",
    top: "20px",
  },
  commentSection: {
    marginBottom: "24px",
  },
  error: {
    color: "#ef4444",
    fontSize: "14px",
    marginBottom: "16px",
    textAlign: "center" as const,
  },
  feedbackText: {
    color: "#22c55e",
    fontSize: "18px",
    fontWeight: 600,
    marginBottom: "24px",
    minHeight: "27px",
    textAlign: "center" as const,
  },
  header: {
    marginBottom: "32px",
    textAlign: "center" as const,
  },
  label: {
    color: "#e2e8f0",
    display: "block",
    fontSize: "14px",
    fontWeight: 500,
    marginBottom: "8px",
  },
  modal: {
    backgroundColor: "#1e293b",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "24px",
    boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
    maxWidth: "90%",
    padding: "32px",
    position: "relative" as const,
    width: "450px",
  },
  overlay: {
    alignItems: "center",
    backdropFilter: "blur(8px)",
    backgroundColor: "rgba(0, 0, 0, 0.85)",
    bottom: 0,
    display: "flex",
    justifyContent: "center",
    left: 0,
    position: "fixed" as const,
    right: 0,
    top: 0,
    zIndex: 2000,
  },
  starContainer: {
    display: "flex",
    gap: "12px",
    justifyContent: "center",
    marginBottom: "12px",
  },
  submitButton: {
    backgroundColor: "#22c55e",
    border: "none",
    borderRadius: "12px",
    color: "white",
    cursor: "pointer",
    fontSize: "16px",
    fontWeight: 600,
    padding: "16px",
    transition: "transform 0.2s, background-color 0.2s",
    width: "100%",
  },
  submitButtonDisabled: {
    backgroundColor: "#475569",
    border: "none",
    borderRadius: "12px",
    color: "#94a3b8",
    cursor: "not-allowed",
    fontSize: "16px",
    fontWeight: 600,
    padding: "16px",
    width: "100%",
  },
  subtitle: {
    color: "#94a3b8",
    fontSize: "16px",
    margin: 0,
  },
  textarea: {
    backgroundColor: "#0f172a",
    border: "1px solid rgba(255, 255, 255, 0.1)",
    borderRadius: "12px",
    color: "white",
    fontSize: "14px",
    height: "100px",
    outline: "none",
    padding: "12px",
    resize: "none" as const,
    width: "100%",
  },
  title: {
    color: "white",
    fontSize: "24px",
    fontWeight: 700,
    margin: "0 0 8px",
  },
};

export default RatingModal;
