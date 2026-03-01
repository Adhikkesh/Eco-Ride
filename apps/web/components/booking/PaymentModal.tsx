"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useState } from "react";
import { FaCheckCircle, FaExclamationTriangle, FaLeaf, FaLock, FaRedo } from "react-icons/fa";

// Initialize Stripe outside of component
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

interface PaymentModalProps {
  clientSecret: string | null;
  amount: number;
  greenPointsBalance: number;
  isPointsUsed: boolean;
  onTogglePoints: (usePoints: boolean) => void;
  discountAmount: number;
  onSuccess: () => void;
  onClose: () => void;
}

function CheckoutForm({ amount, onSuccess }: { amount: number; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [paymentSuccess, setPaymentSuccess] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!stripe || !elements) {
      return;
    }

    setProcessing(true);
    setError(null);

    const { error: submitError } = await stripe.confirmPayment({
      confirmParams: {
        return_url: window.location.href, // This might reload the page, using redirect: "if_required" is better
      },
      elements,
      redirect: "if_required",
    });

    if (submitError) {
      setError(submitError.message || "Payment failed");
      setProcessing(false);
    } else {
      // Payment succeeded! Show success animation first
      setProcessing(false);
      setPaymentSuccess(true);

      // Wait 3 seconds to show the success animation, then call onSuccess
      setTimeout(() => {
        onSuccess();
      }, 3000);
    }
  };

  // Payment success animation
  if (paymentSuccess) {
    return (
      <div style={{ padding: "20px", textAlign: "center" }}>
        {/* Success animation container */}
        <div
          style={{
            alignItems: "center",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          {/* Animated checkmark circle */}
          <div
            style={{
              alignItems: "center",
              animation: "successPop 0.5s cubic-bezier(0.68, -0.55, 0.265, 1.55)",
              background: "linear-gradient(135deg, #22c55e, #10b981)",
              borderRadius: "50%",
              boxShadow: "0 0 40px rgba(34, 197, 94, 0.5)",
              display: "flex",
              height: "100px",
              justifyContent: "center",
              position: "relative",
              width: "100px",
            }}
          >
            {/* Ripple effect */}
            <div
              style={{
                animation: "successRipple 1.5s ease-out infinite",
                border: "3px solid rgba(34, 197, 94, 0.6)",
                borderRadius: "50%",
                height: "100%",
                left: 0,
                position: "absolute",
                top: 0,
                width: "100%",
              }}
            />
            <FaCheckCircle
              style={{
                animation: "checkBounce 0.6s ease-out 0.2s forwards",
                color: "white",
                fontSize: "50px",
                opacity: 0,
                transform: "scale(0)",
              }}
            />
          </div>

          {/* Success text */}
          <div>
            <h2
              style={{
                animation: "fadeIn 0.5s ease-out 0.3s forwards",
                color: "#22c55e",
                fontSize: "28px",
                fontWeight: 700,
                margin: "0 0 8px",
                opacity: 0,
              }}
            >
              Payment Successful!
            </h2>
            <p
              style={{
                animation: "fadeIn 0.5s ease-out 0.5s forwards",
                color: "#94a3b8",
                fontSize: "16px",
                margin: 0,
                opacity: 0,
              }}
            >
              ₹{amount} paid successfully
            </p>
          </div>

          {/* Celebration message */}
          <div
            style={{
              animation: "fadeIn 0.5s ease-out 0.7s forwards",
              background: "rgba(34, 197, 94, 0.1)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              borderRadius: "12px",
              opacity: 0,
              padding: "16px 24px",
            }}
          >
            <p style={{ color: "#22c55e", fontSize: "14px", margin: 0 }}>
              🎉 Thank you for riding with Eco-Ride!
            </p>
          </div>

          {/* Confetti particles */}
          {[...Array(12)].map((_, i) => (
            <div
              // biome-ignore lint/suspicious/noArrayIndexKey: Static array for visual effects
              key={`confetti-${i}`}
              style={{
                animation: `confetti 1.5s ease-out ${i * 0.1}s forwards`,
                background: ["#22c55e", "#10b981", "#3b82f6", "#f59e0b", "#ec4899"][i % 5],
                borderRadius: "2px",
                height: "10px",
                left: "50%",
                opacity: 0,
                position: "absolute",
                top: "40%",
                width: "10px",
              }}
            />
          ))}
        </div>

        {/* Keyframe animations */}
        <style>{`
          @keyframes successPop {
            0% { transform: scale(0); }
            50% { transform: scale(1.2); }
            100% { transform: scale(1); }
          }
          @keyframes successRipple {
            0% { transform: scale(1); opacity: 1; }
            100% { transform: scale(1.8); opacity: 0; }
          }
          @keyframes checkBounce {
            0% { transform: scale(0); opacity: 0; }
            50% { transform: scale(1.3); opacity: 1; }
            100% { transform: scale(1); opacity: 1; }
          }
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
          }
          @keyframes confetti {
            0% {
              opacity: 1;
              transform: translate(-50%, -50%) rotate(0deg);
            }
            100% {
              opacity: 0;
              transform: translate(
                calc(-50% + 100px),
                calc(-50% + 200px)
              ) rotate(720deg);
            }
          }
        `}</style>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div style={{ marginBottom: "10px", textAlign: "center" }}>
        <div style={{ color: "#94a3b8", fontSize: "14px" }}>Amount to Pay</div>
        <div style={{ color: "white", fontSize: "32px", fontWeight: "bold" }}>₹{amount}</div>
      </div>

      <PaymentElement
        options={{
          layout: "tabs",
        }}
      />

      {error && (
        <div
          style={{
            alignItems: "center",
            animation: "shakeError 0.5s cubic-bezier(0.36, 0.07, 0.19, 0.97)",
            background: "rgba(239, 68, 68, 0.1)",
            border: "1px solid rgba(239, 68, 68, 0.3)",
            borderRadius: "12px",
            display: "flex",
            gap: "12px",
            padding: "14px 16px",
          }}
        >
          <div
            style={{
              alignItems: "center",
              background: "rgba(239, 68, 68, 0.2)",
              borderRadius: "50%",
              display: "flex",
              flexShrink: 0,
              height: "36px",
              justifyContent: "center",
              width: "36px",
            }}
          >
            <FaExclamationTriangle style={{ color: "#f87171", fontSize: "16px" }} />
          </div>
          <div>
            <p style={{ color: "#f87171", fontSize: "14px", fontWeight: 600, margin: "0 0 2px" }}>
              Payment Failed
            </p>
            <p style={{ color: "#94a3b8", fontSize: "12px", margin: 0 }}>{error}</p>
          </div>
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing}
        style={{
          alignItems: "center",
          background: error
            ? "linear-gradient(135deg, #22c55e, #10b981)"
            : "linear-gradient(135deg, #22c55e, #10b981)",
          border: "none",
          borderRadius: "12px",
          color: "white",
          cursor: !stripe || processing ? "not-allowed" : "pointer",
          display: "flex",
          fontSize: "16px",
          fontWeight: 600,
          gap: "10px",
          justifyContent: "center",
          marginTop: "10px",
          opacity: !stripe || processing ? 0.7 : 1,
          padding: "16px",
          transition: "all 0.3s ease",
        }}
      >
        {processing ? (
          <span style={{ alignItems: "center", display: "flex", gap: "10px" }}>
            <span
              style={{
                animation: "spin 1s linear infinite",
                border: "2px solid rgba(255,255,255,0.3)",
                borderRadius: "50%",
                borderTopColor: "white",
                display: "inline-block",
                height: "18px",
                width: "18px",
              }}
            />
            Processing Payment...
          </span>
        ) : error ? (
          <>
            <FaRedo /> Try Again
          </>
        ) : (
          <>
            <FaLock /> Pay Securely
          </>
        )}
      </button>

      <style>{`
        @keyframes shakeError {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-4px); }
          20%, 40%, 60%, 80% { transform: translateX(4px); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </form>
  );
}

export default function PaymentModal({
  clientSecret,
  amount,
  greenPointsBalance,
  isPointsUsed,
  onTogglePoints,
  discountAmount,
  onSuccess,
}: PaymentModalProps): JSX.Element | null {
  // If amount is 0, we don't need clientSecret
  const isFullRedemption = amount === 0;

  if (!clientSecret && !isFullRedemption) return null;

  return (
    <div
      style={{
        alignItems: "center",
        backdropFilter: "blur(8px)",
        background: "rgba(15, 23, 42, 0.9)",
        bottom: 0,
        display: "flex",
        justifyContent: "center",
        left: 0,
        padding: "20px",
        position: "fixed",
        right: 0,
        top: 0,
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: "#0f172a",
          border: "1px solid rgba(71, 85, 105, 0.5)",
          borderRadius: "24px",
          boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.5)",
          maxHeight: "90vh",
          maxWidth: "480px",
          overflowY: "auto",
          padding: "32px",
          position: "relative",
          width: "100%",
        }}
      >
        {/* Header */}
        <div style={{ marginBottom: "24px", textAlign: "center" }}>
          <div
            style={{
              alignItems: "center",
              background: "rgba(34, 197, 94, 0.2)",
              borderRadius: "50%",
              display: "flex",
              height: "64px",
              justifyContent: "center",
              margin: "0 auto 16px",
              width: "64px",
            }}
          >
            <FaCheckCircle style={{ color: "#22c55e", fontSize: "32px" }} />
          </div>
          <h2 style={{ color: "white", fontSize: "24px", fontWeight: "bold", margin: 0 }}>
            Trip Completed!
          </h2>
          <p style={{ color: "#94a3b8", marginTop: "8px" }}>
            Please complete your payment to finish.
          </p>
        </div>

        {/* Green Points Section */}
        {greenPointsBalance > 0 && (
          <div
            style={{
              background: "rgba(34, 197, 94, 0.1)",
              border: "1px solid rgba(34, 197, 94, 0.3)",
              borderRadius: "16px",
              marginBottom: "24px",
              padding: "16px",
            }}
          >
            <div
              style={{
                alignItems: "center",
                display: "flex",
                justifyContent: "space-between",
                marginBottom: "8px",
              }}
            >
              <div style={{ alignItems: "center", display: "flex", gap: "8px" }}>
                <FaLeaf style={{ color: "#22c55e" }} />
                <span style={{ color: "white", fontWeight: 600 }}>Green Points</span>
              </div>
              <span style={{ color: "#22c55e", fontWeight: "bold" }}>
                {greenPointsBalance} Available
              </span>
            </div>

            <label
              style={{ alignItems: "center", cursor: "pointer", display: "flex", gap: "12px" }}
            >
              <input
                type="checkbox"
                checked={isPointsUsed}
                onChange={(e) => onTogglePoints(e.target.checked)}
                style={{ height: "18px", width: "18px" }}
              />
              <span style={{ color: "#cbd5e1", fontSize: "14px" }}>
                Use points to save up to ₹{greenPointsBalance}
              </span>
            </label>

            {isPointsUsed && discountAmount > 0 && (
              <div
                style={{
                  borderTop: "1px solid rgba(255,255,255,0.1)",
                  marginTop: "12px",
                  paddingTop: "12px",
                }}
              >
                <div
                  style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}
                >
                  <span style={{ color: "#94a3b8", fontSize: "14px" }}>Original Fare:</span>
                  <span style={{ color: "#94a3b8", fontSize: "14px" }}>
                    ₹{amount + discountAmount}
                  </span>
                </div>
                <div
                  style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}
                >
                  <span style={{ color: "#22c55e", fontSize: "14px" }}>Discount Applied:</span>
                  <span style={{ color: "#22c55e", fontSize: "14px" }}>-₹{discountAmount}</span>
                </div>
                <div
                  style={{
                    display: "flex",
                    fontWeight: "bold",
                    justifyContent: "space-between",
                    marginTop: "4px",
                  }}
                >
                  <span style={{ color: "white" }}>To Pay:</span>
                  <span style={{ color: "white" }}>₹{amount}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {isFullRedemption ? (
          <div style={{ textAlign: "center" }}>
            <div style={{ marginBottom: "20px" }}>
              <div style={{ color: "#94a3b8", fontSize: "14px" }}>Amount to Pay</div>
              <div style={{ color: "white", fontSize: "32px", fontWeight: "bold" }}>₹0</div>
              <div style={{ color: "#22c55e", fontSize: "14px", marginTop: "4px" }}>
                Fully covered by Green Points!
              </div>
            </div>

            <button
              type="button"
              onClick={onSuccess}
              style={{
                alignItems: "center",
                background: "linear-gradient(135deg, #22c55e, #10b981)",
                border: "none",
                borderRadius: "12px",
                color: "white",
                cursor: "pointer",
                display: "flex",
                fontSize: "16px",
                fontWeight: 600,
                gap: "10px",
                justifyContent: "center",
                padding: "16px",
                width: "100%",
              }}
            >
              <FaCheckCircle /> Confirm & Finish
            </button>
          </div>
        ) : (
          clientSecret && (
            <Elements
              stripe={stripePromise}
              options={{
                appearance: {
                  theme: "night",
                  variables: {
                    colorBackground: "#1e293b",
                    colorPrimary: "#22c55e",
                    colorText: "#ffffff",
                  },
                },
                clientSecret,
              }}
              key={clientSecret}
            >
              <CheckoutForm amount={amount} onSuccess={onSuccess} />
            </Elements>
          )
        )}
      </div>
    </div>
  );
}
