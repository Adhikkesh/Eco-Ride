"use client";

import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { useState } from "react";
import { FaCheckCircle, FaLock } from "react-icons/fa";

// Initialize Stripe outside of component
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "");

interface PaymentModalProps {
  clientSecret: string;
  amount: number;
  onSuccess: () => void;
  onClose: () => void;
}

function CheckoutForm({ amount, onSuccess }: { amount: number; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);

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
      // Payment succeeded!
      setProcessing(false);
      onSuccess();
    }
  };

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
            background: "rgba(239, 68, 68, 0.1)",
            borderRadius: "8px",
            color: "#f87171",
            fontSize: "14px",
            padding: "10px",
            textAlign: "center",
          }}
        >
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!stripe || processing}
        style={{
          alignItems: "center",
          background: "linear-gradient(135deg, #22c55e, #10b981)",
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
        }}
      >
        {processing ? (
          "Processing..."
        ) : (
          <>
            <FaLock /> Pay Securely
          </>
        )}
      </button>
    </form>
  );
}

export default function PaymentModal({
  clientSecret,
  amount,
  onSuccess,
}: PaymentModalProps): JSX.Element | null {
  if (!clientSecret) return null;

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
          maxWidth: "480px",
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
        >
          <CheckoutForm amount={amount} onSuccess={onSuccess} />
        </Elements>
      </div>
    </div>
  );
}
