import type { Request, Response } from "express";
import Stripe from "stripe";
import { db, rtdb } from "../config/firebase.js";

let stripeInstance: Stripe | null = null;

const getStripe = () => {
  if (!stripeInstance) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (key) {
      console.log("✅ STRIPE_SECRET_KEY found, initializing Stripe client...");
      stripeInstance = new Stripe(key, {
        typescript: true,
      });
    } else {
      console.warn("⚠️ STRIPE_SECRET_KEY is missing when attempting to initialize Stripe.");
    }
  }
  return stripeInstance;
};

export const createPaymentIntent = async (req: Request, res: Response) => {
  try {
    const { rideId } = req.body;

    if (!rideId) {
      return res.status(400).json({
        message: "Missing rideId",
        success: false,
      });
    }

    // 1. Fetch Ride Details to get Fare
    const rideRef = db.collection("rides").doc(rideId);
    const rideDoc = await rideRef.get();

    if (!rideDoc.exists) {
      return res.status(404).json({
        message: "Ride not found",
        success: false,
      });
    }

    const rideData = rideDoc.data();
    const fare = rideData?.fare;

    // Fallback for legacy rides (created before fare was saved)
    let finalFare = fare || 100;

    // Stripe India minimum amount is ₹50
    if (finalFare < 50) {
      console.warn(`Fare ₹${finalFare} is below Stripe minimum. Adjusting to ₹50.`);
      finalFare = 50;
    }

    // Stripe expects amount in cents/lowest currency unit
    // Assuming fare is in INR integers (Rupees), convert to paise
    const amountInPaise = Math.round(finalFare * 100);

    // 2. Create Payment Intent
    const stripe = getStripe();
    if (!stripe) {
      console.error("❌ Stripe is not initialized. Missing API Key.");
      return res.status(503).json({
        message:
          "Payment service unavailable (Stripe not configured - STRIPE_SECRET_KEY missing or invalid)",
        success: false,
      });
    }

    console.log(`Creating payment intent for ride: ${rideId}, amount: ${finalFare}`);

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountInPaise,
      automatic_payment_methods: {
        enabled: true,
      },
      currency: "inr",
      metadata: {
        rideId,
        riderId: rideData?.riderId || "unknown",
      },
    });

    console.log(`✅ Payment intent created successfully: ${paymentIntent.id}`);

    return res.status(200).json({
      amount: finalFare,
      clientSecret: paymentIntent.client_secret,
      success: true,
    });
  } catch (error) {
    console.error("❌ Create Payment Intent Error:", error);
    return res.status(500).json({
      message: `Error creating payment intent: ${error instanceof Error ? error.message : "Unknown error"}`,
      success: false,
    });
  }
};

export const confirmPayment = async (req: Request, res: Response) => {
  try {
    const { rideId, amount } = req.body;

    if (!rideId) {
      return res.status(400).json({
        message: "Missing rideId",
        success: false,
      });
    }

    console.log(`Confirming payment for ride: ${rideId}, amount: ${amount}`);

    // Update RTDB to notify driver
    await rtdb.ref(`rides/${rideId}`).update({
      paidAmount: amount,
      paymentStatus: "PAID",
    });

    // Update Firestore
    await db.collection("rides").doc(rideId).update({
      paidAmount: amount,
      paymentStatus: "PAID",
    });

    return res.status(200).json({
      message: "Payment confirmed",
      success: true,
    });
  } catch (error) {
    console.error("Confirm Payment Error:", error);
    return res.status(500).json({
      message: "Error confirming payment",
      success: false,
    });
  }
};
